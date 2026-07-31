/**
 * Reactive tracker for each open mod's git "dirty" state. A mod is dirty when it
 * has uncommitted changes on disk or local commits that have not been pushed to
 * its origin remote.
 *
 * Status is keyed by mod directory and read on demand: a page mounts the save
 * control, which asks this store to refresh the mod it shows. The pure git reads
 * (`getStatus`, `getAheadBehind`) live in core; this store caches their result
 * and exposes it reactively.
 */
import { getStatus, getAheadBehind, isMerging } from "core";

/** Cached git state for one mod directory. */
export type GitStatusEntry = {
  dir: string;
  /** True while a refresh is in flight. */
  checking: boolean;
  /** Whether a status read has completed at least once. */
  loaded: boolean;
  /** Uncommitted changes exist in the working tree. */
  hasUncommitted: boolean;
  /**
   * Tracked changes exist (staged, modified, deleted, or conflicted).
   */
  hasTrackedChanges: boolean;
  /** Local commits are not yet on the remote (includes a never-pushed branch). */
  hasUnpushed: boolean;
  /** A merge is in progress. */
  merging: boolean;
  /** Message from a failed status read, or null. */
  error: string | null;
};

function blankEntry(dir: string): GitStatusEntry {
  return {
    dir,
    checking: false,
    loaded: false,
    hasUncommitted: false,
    hasTrackedChanges: false,
    hasUnpushed: false,
    merging: false,
    error: null,
  };
}

/** Whether a status entry represents unsaved work (uncommitted or unpushed). */
export function isDirty(entry: GitStatusEntry | null | undefined): boolean {
  return Boolean(entry && (entry.hasUncommitted || entry.hasUnpushed));
}

class GitStatusTracker {
  /** Per-directory status, reactive. */
  entries = $state<Record<string, GitStatusEntry>>({});

  /** Return the cached status for a directory, or null when never checked. */
  get(dir: string): GitStatusEntry | null {
    return this.entries[dir] ?? null;
  }

  /** Refresh a directory only if it has not been read yet. */
  ensure(dir: string) {
    if (!this.entries[dir]?.loaded) this.refresh(dir);
  }

  /**
   * Read the working-tree and ahead/behind state for a mod and cache it. A read
   * already in flight for the directory is not started again.
   */
  async refresh(dir: string) {
    const existing = this.entries[dir];
    if (existing?.checking) return;
    // Create the entry if needed, then read it BACK from `this.entries[dir]` so the
    // rest of this method mutates the reactive `$state` PROXY.
    if (!existing) this.entries[dir] = blankEntry(dir);
    const entry = this.entries[dir]!;
    entry.checking = true;
    try {
      const status = await getStatus(dir);
      const ahead = await getAheadBehind(dir);
      entry.hasUncommitted = !status.isClean;
      entry.hasTrackedChanges =
        status.staged.length > 0 ||
        status.modified.length > 0 ||
        status.deleted.length > 0 ||
        status.conflicted.length > 0;
      // getAheadBehind returns null when the upstream tracking ref cannot be
      // resolved (most commonly a never-pushed branch) so null is treated
      // conservatively as "has unpushed work". Otherwise the branch is unpushed
      // when it is ahead of the remote.
      entry.hasUnpushed = ahead === null || ahead.ahead > 0;
      entry.merging = await isMerging(dir);
      entry.error = null;
      entry.loaded = true;
    } catch (err) {
      entry.error = (err as Error)?.message ?? "error";
      entry.loaded = true;
    } finally {
      entry.checking = false;
    }
  }
}

export const gitStatus = new GitStatusTracker();
