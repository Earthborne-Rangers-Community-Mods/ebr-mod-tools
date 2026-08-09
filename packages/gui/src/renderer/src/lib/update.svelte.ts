/**
 * Update flow: walks a mod's available updates one source at a time - shell base
 * content, then included campaigns, then included mods - offering accept or skip
 * for each, and summarizing what landed. Merges that conflict hand off to the
 * conflict flow, which is where the remaining queue is abandoned: the author
 * resolves the merge, then runs the flow again for whatever is left.
 */
import {
  applyBaseUpdate,
  includeCampaign,
  includeMod,
  MergeConflictError,
  DirtyWorkingTreeError,
  IndexNotCleanError,
  BaseRemoteMissingError,
  IncludeRefNotFoundError,
  IncludeModNotFoundError,
  NotARepoError,
  GithubError,
} from "core";
import { FlowStore } from "./flowstore.svelte.js";
import { runGuarded } from "./guarded.js";
import { buildUpdateQueue, type UpdateItem } from "./updatequeue.js";
import { updateStatus } from "./updatestatus.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { saveFlow } from "./save.svelte.js";
import { conflictFlow } from "./conflict.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";

/** What became of one queued update. */
export type UpdateOutcome = "updated" | "already-up-to-date" | "skipped";

/** One finished queue entry, shown on the closing summary. */
export interface UpdateResult {
  item: UpdateItem;
  outcome: UpdateOutcome;
}

class UpdateFlow extends FlowStore {
  /** The updates to walk, in source order. */
  items = $state<UpdateItem[]>([]);
  /** Position in {@link items}; equal to its length once every item is done. */
  index = $state(0);
  /** What happened to each item already walked. */
  results = $state<UpdateResult[]>([]);
  /** True when the check behind this queue could not read every source. */
  incomplete = $state(false);

  /** The update awaiting a decision, or null once the queue is exhausted. */
  get current(): UpdateItem | null {
    return this.items[this.index] ?? null;
  }

  /** Whether every queued update has been accepted or skipped. */
  get done(): boolean {
    return this.index >= this.items.length;
  }

  /** Whether the mod has uncommitted work that must be saved before merging. */
  get needsSave(): boolean {
    return Boolean(gitStatus.get(this.dir ?? "")?.hasUncommitted);
  }

  /**
   * True until the mod's git status has loaded at least once, so the dialog can
   * wait rather than briefly show an update before the save-first gate is known.
   */
  get statusPending(): boolean {
    const entry = gitStatus.get(this.dir ?? "");
    return !entry || !entry.loaded;
  }

  /** Open the flow over the updates the last check found for a mod. */
  start(dir: string) {
    if (this.busy) return;
    const status = updateStatus.get(dir);
    this.dir = dir;
    this.items = buildUpdateQueue(status);
    this.incomplete = status?.incomplete ?? false;
    this.index = 0;
    this.results = [];
    this.resetStatus();
    // Refresh the dirty state so the save-first gate is current.
    gitStatus.refresh(dir);
  }

  /** Leave the current update for another time and move to the next. */
  skip() {
    const item = this.current;
    if (!item || this.busy) return;
    this.#advance(item, "skipped");
  }

  /**
   * Apply the current update. A clean merge records the outcome and moves on; a
   * conflicting one routes to the Conflict Resolution page with the rest of the
   * queue dropped.
   */
  async accept() {
    const dir = this.dir;
    const item = this.current;
    if (!dir || !item) return;

    await runGuarded(
      this,
      "update-failed",
      async () => {
        try {
          const alreadyUpToDate = await this.#apply(dir, item);
          await this.#refreshCaches(dir);
          this.#advance(item, alreadyUpToDate ? "already-up-to-date" : "updated");
        } catch (err) {
          if (err instanceof MergeConflictError) {
            conflictFlow.start(dir, { conflictedFiles: err.conflictedFiles });
            this.#close();
            navigation.go(ROUTES.CONFLICT, { dir });
            return;
          }
          throw err;
        }
      },
      {
        onError: (err) => {
          this.errorCode = classifyError(err);
        },
      },
    );
  }

  /**
   * Close the flow. Once anything was applied the cached update state is wrong,
   * so it is dropped and re-read; a walk that only skipped leaves it alone.
   * Dropping it before the re-read matters: leaving the stale lists in place
   * would let the chip report - and a re-opened flow re-offer - updates that
   * just landed.
   */
  close() {
    if (this.busy) return;
    const dir = this.dir;
    const applied = this.results.some((r) => r.outcome !== "skipped");
    this.#close();
    if (dir && applied) {
      updateStatus.invalidate(dir);
      void updateStatus.check(dir);
    }
  }

  /**
   * Close the flow and open the save flow instead. Offered when the mod has
   * unsaved work: the author saves, then re-opens the flow.
   */
  saveFirst() {
    const dir = this.dir;
    if (!dir || this.busy) return;
    const status = gitStatus.get(dir);
    const mode = status?.hasUncommitted ? "commit" : "push";
    const currentVersion = openMods.getByDir(dir)?.manifest?.version ?? "0.0.0";
    this.#close();
    saveFlow.start(dir, { currentVersion, mode });
  }

  /** Merge one update in. Returns whether the mod already had it. */
  async #apply(dir: string, item: UpdateItem): Promise<boolean> {
    if (item.kind === "base") {
      await applyBaseUpdate({ dir });
      return false;
    }
    if (item.kind === "campaign") {
      // No product prompt on an update: the campaign is already included, so its
      // products were settled when it was first brought in.
      return (await includeCampaign({ dir, source: item.id })).alreadyUpToDate;
    }
    // Merge against the registry snapshot the check ran on, so the commit
    // applied is the one the queue was built from.
    const registry = updateStatus.get(dir)?.registry ?? undefined;
    return (await includeMod({ dir, source: item.id, registry })).alreadyUpToDate;
  }

  /** Record an item's outcome and move to the next one. */
  #advance(item: UpdateItem, outcome: UpdateOutcome) {
    this.results = [...this.results, { item, outcome }];
    this.index++;
    this.resetStatus();
  }

  /** Refresh the cached manifest and git status after the tree changed. */
  async #refreshCaches(dir: string) {
    try {
      await openMods.reload(dir);
      await gitStatus.refresh(dir);
    } catch {
      // Non-fatal: the update landed; the cached view may lag until refresh.
    }
  }

  /** Drop all flow state, closing the dialog. */
  #close() {
    this.items = [];
    this.index = 0;
    this.results = [];
    this.incomplete = false;
    this.dir = null;
    this.resetStatus();
  }
}

/** Map a core error to the localized error code the dialog renders. */
function classifyError(err: unknown): string {
  if (err instanceof DirtyWorkingTreeError) return "dirty-tree";
  if (err instanceof IndexNotCleanError) return "index-not-clean";
  if (err instanceof BaseRemoteMissingError) return "no-base";
  if (err instanceof IncludeRefNotFoundError) return "ref-not-found";
  if (err instanceof IncludeModNotFoundError) return "mod-not-found";
  if (err instanceof NotARepoError) return "not-a-repo";
  if (err instanceof GithubError) return "registry-unreachable";
  return "update-failed";
}

export const updateFlow = new UpdateFlow();
