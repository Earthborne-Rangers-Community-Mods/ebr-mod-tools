/**
 * Reactive store behind the "Add content" launcher on the Mod Details page. It
 * is type-gated (see {@link addContentKinds}).
 * 
 * The template flow goes:
 * chooser (gated behind a clean tree) -> preview -> report, optionally adding the
 * template's implied product. The pure logic lives in `core` (`planScaffold`,
 * `includeScaffold`, `addScaffoldProduct`); this is the orchestration layer.
 */
import {
  planScaffold,
  includeScaffold,
  addScaffoldProduct,
  computeMissingScaffoldProduct,
  KNOWN_SCAFFOLDS,
  NothingToCommitError,
  ScaffoldRefNotFoundError,
  NotARepoError,
  ValidationError,
} from "core";
import type { ProgressEvent } from "core/types.js";
import { runGuarded } from "./guarded.js";
import { FlowStore } from "./flowstore.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { saveFlow } from "./save.svelte.js";
import type { AddContentKind } from "./addcontent.js";

/** Where to add a template's implied product, or skip adding it. */
export type ProductChoice = "required" | "optional" | "skip";

/** The changelist a stamp would produce, from the dry-run preview. */
interface ScaffoldPreview {
  branch: string;
  filesToAdd: string[];
  filesToSkip: string[];
}

/** The result of a completed template stamp, shown on the report screen. */
interface StampReport {
  filesAdded: number;
  filesSkipped: string[];
  /** The product added to the manifest, or null if none was. */
  productAdded: string | null;
  /** Which product list it was added to, or null when none was added. */
  productList: "required" | "optional" | null;
}

const DEFAULT_SCAFFOLD = KNOWN_SCAFFOLDS[0]?.branch ?? "";

class AddContentFlow extends FlowStore {
  /** Type of the mod being edited, driving which kinds are offered. */
  modType = $state("");
  /** Selected content kind, or null while the chooser is showing. */
  kind = $state<AddContentKind | null>(null);
  /** Scaffold branch selected for a template stamp. */
  scaffoldBranch = $state(DEFAULT_SCAFFOLD);
  /** The dry-run preview for the selected template, or null before it loads. */
  preview = $state<ScaffoldPreview | null>(null);
  /** True while the async preview clone is in flight. */
  previewing = $state(false);
  /** Where to add the template's implied product on stamp (or skip it). */
  productChoice = $state<ProductChoice>("required");
  /** The completed stamp's report, or null until it finishes. */
  report = $state<StampReport | null>(null);

  /** Monotonic guard so a stale preview clone cannot overwrite a newer one. */
  #previewToken = 0;

  /** The mod's manifest, or null. */
  get #manifest() {
    return (this.dir && openMods.getByDir(this.dir)?.manifest) || null;
  }

  /**
   * The product the selected template implies that the manifest does not yet
   * list, or null. Drives the required/optional/skip product choice.
   */
  get missingProduct(): string | null {
    const manifest = this.#manifest;
    if (!manifest) return null;
    return computeMissingScaffoldProduct(this.scaffoldBranch, manifest);
  }

  /**
   * Whether the mod has tracked changes that must be saved before adding
   * content. Untracked files are fine (the scaffold stamp allows them), so this
   * reads the tracked-only signal.
   */
  get needsSave(): boolean {
    return Boolean(gitStatus.get(this.dir ?? "")?.hasTrackedChanges);
  }

  /**
   * True until the open mod's git status has loaded at least once, so the
   * chooser can wait rather than briefly show the template path before the
   * save-first gate is known.
   */
  get statusPending(): boolean {
    const entry = gitStatus.get(this.dir ?? "");
    return !entry || !entry.loaded;
  }

  /** Open the launcher for a mod, starting at the chooser. */
  start(dir: string, modType: string) {
    if (this.busy) return;
    this.#previewToken++;
    this.dir = dir;
    this.modType = modType;
    this.kind = null;
    this.scaffoldBranch = DEFAULT_SCAFFOLD;
    this.preview = null;
    this.previewing = false;
    this.productChoice = "required";
    this.report = null;
    this.resetStatus();
    // Refresh the dirty state so the save-first gate on the chooser is current.
    gitStatus.refresh(dir);
  }

  /** Pick a content kind, advancing from the chooser to that kind's screen. */
  chooseKind(kind: AddContentKind) {
    if (this.busy) return;
    this.kind = kind;
    this.resetStatus();
    if (kind === "template") this.#loadPreview();
  }

  /** Return to the chooser, discarding any in-flight or loaded preview. */
  back() {
    if (this.busy) return;
    this.#previewToken++;
    this.kind = null;
    this.preview = null;
    this.previewing = false;
    this.resetStatus();
  }

  /** Select a different template and refresh its preview. */
  selectScaffold(branch: string) {
    if (this.busy) return;
    this.scaffoldBranch = branch;
    this.productChoice = "required";
    this.#loadPreview();
  }

  /** Close the launcher. No-op while a stamp is in flight. */
  cancel() {
    if (this.busy) return;
    this.#previewToken++;
    this.dir = null;
    this.kind = null;
    this.preview = null;
    this.previewing = false;
    this.report = null;
    this.resetStatus();
  }

  /**
   * Close the launcher and open the save flow instead. Offered on the chooser
   * when the mod has unsaved work: the user saves, then re-opens the launcher.
   */
  saveFirst() {
    const dir = this.dir;
    if (!dir || this.busy) return;
    const status = gitStatus.get(dir);
    const mode = status?.hasUncommitted ? "commit" : "push";
    const currentVersion = openMods.getByDir(dir)?.manifest?.version ?? "0.0.0";
    this.cancel();
    saveFlow.start(dir, { currentVersion, mode });
  }

  /**
   * Dry-run the selected template so the pick screen can show its changelist.
   * A monotonic token discards stale results if the user switches templates (or
   * leaves the screen) while a clone is still in flight.
   */
  async #loadPreview() {
    const dir = this.dir;
    const branch = this.scaffoldBranch;
    if (!dir || !branch) return;
    const token = ++this.#previewToken;
    this.previewing = true;
    this.preview = null;
    this.resetStatus();
    try {
      const result = await planScaffold({ dir, source: branch });
      if (token !== this.#previewToken) return;
      this.preview = { branch: result.branch, filesToAdd: result.filesToAdd, filesToSkip: result.filesToSkip };
    } catch (err) {
      if (token !== this.#previewToken) return;
      this.errorCode = this.#classifyError(err);
      this.errorDetail = (err as Error)?.message ?? null;
    } finally {
      if (token === this.#previewToken) this.previewing = false;
    }
  }

  /**
   * Stamp the selected template into the mod, optionally adding its implied
   * product to the manifest. Existing files are skipped (never overwritten). On
   * success the cached manifest and git status refresh and the report shows.
   */
  async stampTemplate() {
    const dir = this.dir;
    const branch = this.scaffoldBranch;
    if (!dir || !branch) return;

    // Skipped paths arrive through the "conflict" progress step, not the return
    // value; capture them as they come.
    let skipped: string[] = [];
    let productAdded: string | null = null;
    let productList: "required" | "optional" | null = null;
    const choice = this.productChoice;
    await runGuarded(
      this,
      "add-failed",
      async () => {
        const onProgress = (p: ProgressEvent) => {
          this.progress = p.message ?? null;
          if (p.step === "conflict" && Array.isArray(p.paths)) skipped = p.paths;
        };
        const result = await includeScaffold({ dir, source: branch }, { onProgress });
        if (choice !== "skip" && this.missingProduct !== null) {
          const added = await addScaffoldProduct({ dir, branch, list: choice }, { onProgress });
          productAdded = added.product;
          productList = added.added ? added.list : null;
        }
        this.report = { filesAdded: result.filesAdded, filesSkipped: skipped, productAdded, productList };
        // The stamp (and product add) committed: refresh the cached manifest and
        // git status so the mod's dirty/unpushed state reflects it. Best-effort.
        try {
          await openMods.reload(dir);
          await gitStatus.refresh(dir);
        } catch {
          // Non-fatal: the stamp landed; the cached view may lag until refresh.
        }
      },
      {
        onError: (err) => {
          this.errorCode = this.#classifyError(err);
          this.errorDetail = (err as Error)?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }

  /** Map a core error to a localized error code the dialog renders. */
  #classifyError(err: unknown): string {
    if (err instanceof NothingToCommitError) return "nothing-to-add";
    if (err instanceof ScaffoldRefNotFoundError) return "not-found";
    if (err instanceof NotARepoError) return "not-a-repo";
    if (err instanceof ValidationError) return "invalid";
    return "add-failed";
  }
}

export const addContentFlow = new AddContentFlow();
