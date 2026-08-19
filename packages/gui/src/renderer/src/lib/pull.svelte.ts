/**
 * Advanced-mode `git pull` flow: fetches the mod's origin remote and merges its
 * tracking branch into HEAD. A clean merge just refreshes the cached state; a
 * conflicting one hands off to the conflict flow.
 */
import { fetchRemote, getCurrentBranch, merge, MergeConflictError } from "core";
import { FlowStore } from "./flowstore.svelte.js";
import { runGuarded } from "./guarded.js";
import { conflictFlow } from "./conflict.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { updateStatus } from "./updatestatus.svelte.js";

class PullFlow extends FlowStore {
  /** Pull the current branch's origin tracking ref into HEAD. */
  async pull(dir: string) {
    if (this.busy) return;
    this.dir = dir;
    await runGuarded(
      this,
      "pull-failed",
      async () => {
        await fetchRemote(dir, "origin");
        const branch = await getCurrentBranch(dir);
        try {
          await merge(dir, `origin/${branch}`);
        } catch (err) {
          if (err instanceof MergeConflictError) {
            conflictFlow.start(dir, { conflictedFiles: err.conflictedFiles });
            this.dir = null;
            navigation.go(ROUTES.CONFLICT, { dir });
            return;
          }
          throw err;
        }
        updateStatus.invalidate(dir);
        try {
          await openMods.reload(dir);
          await gitStatus.refresh(dir);
        } catch {
          // Non-fatal: the pull landed; the cached view may lag until refresh.
        }
        this.dir = null;
      },
    );
  }
}

export const pullFlow = new PullFlow();
