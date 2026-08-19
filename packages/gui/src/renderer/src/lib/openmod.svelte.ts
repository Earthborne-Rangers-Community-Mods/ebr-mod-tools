/**
 * Reactive store backing the "Open Mod" dialog on the My Mods page: choose
 * between opening a mod already on disk  or cloning one of the creator's mod
 * branches from their GitHub fork.
 */
import { listModBranches, cloneModFromFork } from "core";
import { join } from "node:path";
import { openMods } from "./mods.svelte.js";
import { setupStore } from "./setup.svelte.js";
import { pickDirectory } from "./platform.js";
import { runGuarded } from "./guarded.js";
import type { ProgressEvent } from "core/types.js";

type Screen = "choice" | "backup";

class OpenModFlow {
  screen = $state<Screen | null>(null);
  /** Mod ids available on the creator's fork (branch names, `mod/` prefix stripped). */
  branches = $state<string[]>([]);
  selected = $state<string | null>(null);
  /** True while the branch list is being fetched. */
  loadingBranches = $state(false);
  /** True while a clone is running (also drives {@link runGuarded}). */
  busy = $state(false);
  /** Error code from the last operation, localized by the component, or null. */
  errorCode = $state<string | null>(null);
  /** Detail message from a failed run, surfaced with the error. */
  errorDetail = $state<string | null>(null);
  /** Live progress message during a clone. */
  progress = $state<string | null>(null);

  get isOpen() {
    return this.screen !== null;
  }

  /** Open the dialog at the initial choice screen. */
  open() {
    this.screen = "choice";
    this.errorCode = null;
    this.errorDetail = null;
  }

  /** Close the dialog. No-op while a clone is in flight. */
  close() {
    if (this.busy) return;
    this.screen = null;
    this.branches = [];
    this.selected = null;
    this.errorCode = null;
    this.errorDetail = null;
    this.progress = null;
  }

  /** Return to the choice screen. No-op while a clone is in flight. */
  back() {
    if (this.busy) return;
    this.screen = "choice";
    this.branches = [];
    this.selected = null;
    this.errorCode = null;
    this.errorDetail = null;
  }

  /**
   * Pick an existing local folder and add it directly.
   * Closes the dialog on success; the caller formats and displays a failure.
   * The picked `dir` is always included (even on failure) so the caller can
   * reference it in an error message.
   */
  async openFromDisk(): Promise<(Awaited<ReturnType<typeof openMods.add>> & { dir: string }) | null> {
    const dir = await pickDirectory(openMods.pickerDefaultPath);
    if (!dir) return null;
    const result = await openMods.add(dir);
    if (result.ok) this.close();
    return { ...result, dir };
  }

  /** List the creator's mod branches on their GitHub fork. */
  async browseBackup() {
    const forkUrl = setupStore.forks.baseContent;
    if (!forkUrl) {
      this.errorCode = "setup-required";
      return;
    }
    this.screen = "backup";
    this.selected = null;
    this.errorCode = null;
    this.errorDetail = null;
    this.loadingBranches = true;
    try {
      this.branches = await listModBranches(forkUrl);
    } catch (err) {
      this.errorCode = "list-failed";
      this.errorDetail = (err as Error)?.message ?? null;
      this.branches = [];
    } finally {
      this.loadingBranches = false;
    }
  }

  select(modId: string) {
    this.selected = modId;
  }

  /** Clone the selected mod branch into a folder the user chooses, then track it. */
  async clone() {
    if (this.busy || !this.selected) return;
    const forkUrl = setupStore.forks.baseContent;
    if (!forkUrl) {
      this.errorCode = "setup-required";
      return;
    }
    const parentDir = await pickDirectory(openMods.pickerDefaultPath);
    if (!parentDir) return;
    const modId = this.selected;

    await runGuarded(
      this,
      "clone-failed",
      async () => {
        const targetDir = join(parentDir, modId);
        await cloneModFromFork(
          { forkUrl, modId, dir: targetDir },
          { onProgress: (p: ProgressEvent) => (this.progress = p.message ?? null) },
        );
        const added = await openMods.add(targetDir);
        if (added.ok) {
          this.screen = null;
          this.branches = [];
          this.selected = null;
          this.progress = null;
        } else {
          // The clone succeeded but the branch's ebr-mod.json could not be read as
          // a mod.
          this.errorCode = "clone-unreadable";
          this.errorDetail = added.message ?? null;
        }
      },
      {
        onError: (err: unknown) => {
          this.errorDetail = (err as Error)?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }
}

export const openModFlow = new OpenModFlow();
