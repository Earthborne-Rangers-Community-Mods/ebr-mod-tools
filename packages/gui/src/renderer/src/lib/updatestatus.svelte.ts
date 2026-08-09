/**
 * Reactive tracker for each open mod's available downstream updates: new shell
 * base content, new commits on an included official campaign, and newer
 * published versions of an included mod.
 *
 * The check is the read-only half of `ebr update`: it fetches the remotes
 * involved and compares them against HEAD, without merging anything. That makes
 * it costly enough to cache: a mod's result stays fresh for 30 minutes unless a
 * caller forces a re-read or invalidates it after the tree changes.
 */
import { checkBaseUpdate, checkIncludedCampaignsUpdates, checkIncludedModsUpdates } from "core";
import type { Registry } from "core/types.js";
import { getRegistry } from "./registry.js";
import type { UpdateSources } from "./updatequeue.js";

/** How long a mod's update check stays fresh before `check` re-reads it. */
const TTL_MS = 30 * 60 * 1000;

/** Cached update state for one mod directory. */
export type UpdateStatusEntry = UpdateSources & {
  dir: string;
  /** True while a check is in flight. */
  checking: boolean;
  /** When the cached result was last set (epoch ms), or null. Drives the TTL. */
  checkedAt: number | null;
  /**
   * The registry snapshot the included-mod check ran against, reused when
   * applying a mod update so the merge targets the commit that was checked.
   */
  registry: Registry | null;
  /** True when a source could not be read, so the result may be incomplete. */
  incomplete: boolean;
};

function blankEntry(dir: string): UpdateStatusEntry {
  return {
    dir,
    checking: false,
    checkedAt: null,
    baseUpdateAvailable: false,
    campaigns: [],
    mods: [],
    registry: null,
    incomplete: false,
  };
}

class UpdateStatusTracker {
  /** Per-directory update status, reactive. */
  entries = $state<Record<string, UpdateStatusEntry>>({});

  /** Return the cached status for a directory, or null when never checked. */
  get(dir: string): UpdateStatusEntry | null {
    return this.entries[dir] ?? null;
  }

  /**
   * Check a mod's three update sources and cache the result. A cached result
   * stays fresh for 30 minutes; a repeat call within that window is a no-op
   * unless `force` is set.
   *
   * Each source is read independently: one that cannot be read (a mod with no
   * base remote, an unreachable registry) leaves its own list empty and marks
   * the result incomplete rather than failing the whole check.
   *
   * @param options.force - Bypass the freshness check and re-read.
   */
  async check(dir: string, { force = false }: { force?: boolean } = {}) {
    const existing = this.entries[dir];
    if (existing?.checking) return;
    if (!force && existing?.checkedAt != null && Date.now() - existing.checkedAt < TTL_MS) return;
    // Create the entry if needed, then read it BACK so the rest of this method
    // mutates the reactive `$state` proxy rather than a detached raw object.
    if (!existing) this.entries[dir] = blankEntry(dir);
    const entry = this.entries[dir]!;

    entry.checking = true;
    try {
      let incomplete = false;

      try {
        entry.baseUpdateAvailable = (await checkBaseUpdate({ dir })).updateAvailable;
      } catch {
        entry.baseUpdateAvailable = false;
        incomplete = true;
      }

      try {
        entry.campaigns = (await checkIncludedCampaignsUpdates({ dir })).updates;
      } catch {
        entry.campaigns = [];
        incomplete = true;
      }

      try {
        const registry = await getRegistry();
        entry.mods = (await checkIncludedModsUpdates({ dir, registry })).updates;
        entry.registry = registry;
      } catch {
        entry.mods = [];
        entry.registry = null;
        incomplete = true;
      }

      entry.incomplete = incomplete;
      entry.checkedAt = Date.now();
    } finally {
      entry.checking = false;
    }
  }

  /**
   * Drop a mod's cached result, so its update affordances hide until a fresh
   * check lands. Called after anything that moves HEAD (an applied update, a
   * resolved merge) makes the cached answer wrong.
   */
  invalidate(dir: string) {
    if (this.entries[dir]) this.entries[dir] = blankEntry(dir);
  }
}

export const updateStatus = new UpdateStatusTracker();
