/**
 * Template (scaffold) "Add content" kind: stamp a map/set scaffold's blank
 * journal entries into the mod, previewing the changelist first and optionally
 * adding the scaffold's implied product to the manifest. Pure logic lives in
 * core.
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
import { ContentKindFlow } from "./contentkind.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";

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

export class TemplateFlow extends ContentKindFlow {
  /** Scaffold branch selected for a stamp. */
  scaffoldBranch = $state(DEFAULT_SCAFFOLD);
  /** The dry-run preview for the selected template, or null before it loads. */
  preview = $state<ScaffoldPreview | null>(null);
  /** Where to add the template's implied product on stamp (or skip it). */
  productChoice = $state<ProductChoice>("required");
  /** The completed stamp's report, or null until it finishes. */
  report = $state<StampReport | null>(null);

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

  begin(dir: string) {
    this.dir = dir;
    this.scaffoldBranch = DEFAULT_SCAFFOLD;
    this.productChoice = "required";
    this.preview = null;
    this.report = null;
    this.resetStatus();
    this.#loadPreview();
  }

  protected clearResult() {
    this.scaffoldBranch = DEFAULT_SCAFFOLD;
    this.productChoice = "required";
    this.preview = null;
    this.report = null;
  }

  protected classifyError(err: unknown): string {
    if (err instanceof NothingToCommitError) return "nothing-to-add";
    if (err instanceof ScaffoldRefNotFoundError) return "not-found";
    if (err instanceof NotARepoError) return "not-a-repo";
    if (err instanceof ValidationError) return "invalid";
    return "add-failed";
  }

  /** Select a different template and refresh its preview. */
  selectScaffold(branch: string) {
    if (this.busy) return;
    this.scaffoldBranch = branch;
    this.productChoice = "required";
    this.#loadPreview();
  }

  /** Dry-run the selected template so the pick screen can show its changelist. */
  #loadPreview() {
    const dir = this.dir;
    const branch = this.scaffoldBranch;
    if (!dir || !branch) return;
    this.preview = null;
    this.runPreview(
      () => planScaffold({ dir, source: branch }),
      (r) => (this.preview = { branch: r.branch, filesToAdd: r.filesToAdd, filesToSkip: r.filesToSkip }),
    );
  }

  /**
   * Stamp the selected template into the mod, optionally adding its implied
   * product to the manifest. Existing files are skipped. On success the cached
   * manifest and git status refresh and the report shows.
   */
  async stamp() {
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
          this.errorCode = this.classifyError(err);
          this.errorDetail = (err as Error)?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }
}
