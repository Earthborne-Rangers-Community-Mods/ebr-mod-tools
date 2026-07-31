/**
 * Reactive store behind the Conflict Resolution page. The page
 * offers a per-file "keep mine / use incoming" choice and either finishes the
 * merge or aborts it.
 *
 * The heavy lifting lives in `core` (`finishMerge`, `abortMerge`);
 * this is the orchestration and screen state.
 */
import { finishMerge, abortMerge, getStatus, isMerging, readConflictSide, MergeConflictError } from "core";
import { runGuarded } from "./guarded.js";
import { FlowStore } from "./flowstore.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";

/** Which side of a conflict to keep, or null while the file is undecided. */
export type ConflictSide = "ours" | "theirs";

/** A conflicted file and the user's choice for it. */
export interface ConflictFile {
  path: string;
  choice: ConflictSide | null;
  /**
   * Each side's contents once read, cached so toggling between them is instant.
   * A side is `undefined` while still loading and null when it has no text to
   * show (missing side or binary content).
   */
  preview: Partial<Record<ConflictSide, string | null>>;
}

const EXPLAINER_KEY = "ebr-gui:seen-merge-explainer";

/** Whether the one-time merge explainer has already been shown on this device. */
function loadSeenExplainer(): boolean {
  try {
    return localStorage.getItem(EXPLAINER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Record that the merge explainer has been shown. Best-effort. */
function persistSeenExplainer(): void {
  try {
    localStorage.setItem(EXPLAINER_KEY, "1");
  } catch {
    // Storage unavailable - the explainer may show again next time.
  }
}

class ConflictFlow extends FlowStore {
  /** The conflicted files and their per-file choices. */
  files = $state<ConflictFile[]>([]);
  /** Whether the one-time merge explainer is currently shown. */
  showExplainer = $state(false);

  /**
   * Enter conflict resolution for a mod whose merge stopped on conflicts.
   * Shows the merge explainer the first time it is ever reached.
   */
  start(dir: string, { conflictedFiles }: { conflictedFiles: string[] }) {
    this.dir = dir;
    this.files = conflictedFiles.map((path) => ({ path, choice: null, preview: {} }));
    this.resetStatus();
    this.#maybeShowExplainer();
  }

  /**
   * Enter conflict resolution for a mod that is already mid-merge on disk (for
   * example reopened from My Mods in a later session, where no in-memory include
   * state survives).
   *
   * @returns True when the mod is mid-merge and the Conflict page was entered;
   *   false when there is no merge in progress (the caller proceeds normally).
   */
  async enterFromDisk(dir: string): Promise<boolean> {
    if (!(await isMerging(dir))) return false;
    this.dir = dir;
    this.resetStatus();
    try {
      this.files = (await getStatus(dir)).conflicted.map((path) => ({ path, choice: null, preview: {} }));
    } catch {
      // The merge is real (MERGE_HEAD present) but its conflicted list could not
      // be read. Surface an error rather than a misleading "all resolved"; Undo
      // and Finish still work (Finish re-reads and fails safe).
      this.files = [];
      this.errorCode = "status-failed";
    }
    this.#maybeShowExplainer();
    navigation.go(ROUTES.CONFLICT, { dir });
    return true;
  }

  /** Show the one-time merge explainer the first time it is ever reached. */
  #maybeShowExplainer() {
    if (!loadSeenExplainer()) {
      this.showExplainer = true;
      persistSeenExplainer();
    }
  }

  /** Set the keep-mine / use-incoming choice for one file. */
  setChoice(path: string, side: ConflictSide) {
    if (this.busy) return;
    const file = this.files.find((f) => f.path === path);
    if (!file) return;
    file.choice = side;
    void this.#loadPreview(file, side);
  }

  /** Read one side of a conflicted file into its preview cache, once. */
  async #loadPreview(file: ConflictFile, side: ConflictSide) {
    const dir = this.dir;
    if (!dir || side in file.preview) return;
    try {
      file.preview[side] = await readConflictSide(dir, file.path, side);
    } catch {
      file.preview[side] = null;
    }
  }

  /** Reopen the merge explainer from the page's help affordance. */
  openExplainer() {
    this.showExplainer = true;
  }

  /** Dismiss the merge explainer. */
  dismissExplainer() {
    this.showExplainer = false;
  }

  /**
   * Apply the chosen resolutions and commit the merge. Files left without a
   * choice are accepted only if no conflict markers remain; any still carrying
   * markers keep the user on the page with those files highlighted.
   */
  async finish() {
    const dir = this.dir;
    if (!dir || this.busy) return;
    const resolutions: Record<string, ConflictSide> = {};
    for (const f of this.files) {
      if (f.choice) resolutions[f.path] = f.choice;
    }
    await runGuarded(
      this,
      "finish-failed",
      async () => {
        await finishMerge({ dir, resolutions });
        await this.#refreshCaches(dir);
        this.#leaveTo(dir);
      },
      {
        onError: (err) => {
          if (err instanceof MergeConflictError) {
            // Some files still carry conflict markers; keep the user here with
            // only those remaining, preserving any choices they already made.
            this.errorCode = "unresolved";
            const remaining = new Set(err.conflictedFiles);
            this.files = this.files
              .filter((f) => remaining.has(f.path))
              .map((f) => ({ path: f.path, choice: f.choice, preview: f.preview }));
          }
          // Any other failure keeps runGuarded's "finish-failed" code, which the
          // page renders as a localized generic message.
        },
      },
    );
  }

  /**
   * Abort the in-progress merge (`git merge --abort`), restoring the mod to its
   * pre-include state, and return to the Mod Details page.
   */
  async undo() {
    const dir = this.dir;
    if (!dir || this.busy) return;
    // runGuarded records the "undo-failed" code on throw, which the page renders
    // as a localized generic message; no per-error detail is surfaced.
    await runGuarded(this, "undo-failed", async () => {
      await abortMerge(dir);
      await this.#refreshCaches(dir);
      this.#leaveTo(dir);
    });
  }

  /** Refresh the cached manifest and git status after the tree changed. */
  async #refreshCaches(dir: string) {
    try {
      await openMods.reload(dir);
      await gitStatus.refresh(dir);
    } catch {
      // Non-fatal: the merge resolved; the cached view may lag until refresh.
    }
  }

  /** Clear the flow and navigate back to the mod's details page. */
  #leaveTo(dir: string) {
    this.files = [];
    this.dir = null;
    this.resetStatus();
    navigation.go(ROUTES.MOD_DETAILS, { dir });
  }
}

export const conflictFlow = new ConflictFlow();
