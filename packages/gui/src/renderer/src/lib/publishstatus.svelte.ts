/**
 * Reactive tracker for each open mod's registry publish state: whether it
 * appears in the public registry, at what version, and whether a submission PR
 * is still open for it.
 *
 * Two reads back this, with different costs:
 *   - `refresh(dir)` reads the browse-tier registry (shared, cached by
 *     `getRegistry`) to learn the published version. Cheap enough to run widely.
 *   - `checkPr(dir)` hits GitHub's REST API anonymously (rate-limited) to find
 *     the open PRs. Kept as a separate call because of that cost. Its result is
 *     cached per mod for the session: a repeat lookup within 30 minutes is
 *     served from cache. `addPr` seeds the cache directly when a PR is already
 *     known, so it can show with no round-trip.
 */
import { findOpenRegistryPrs } from "core";
import { getRegistry } from "./registry.js";
import { openMods } from "./mods.svelte.js";
import { setupStore } from "./setup.svelte.js";

/** How long a mod's open-PR lookup stays fresh before `checkPr` re-queries. */
const PR_TTL_MS = 30 * 60 * 1000;

/** An open registry PR for a mod: its URL and (when known) its number. */
export type OpenPr = { url: string; number?: number };

/** Cached registry-publish state for one mod directory. */
export type PublishStatusEntry = {
  dir: string;
  /** True while a registry refresh is in flight. */
  checking: boolean;
  /** Whether a registry read has completed at least once. */
  loaded: boolean;
  /** Whether the mod appears in the public registry. */
  published: boolean;
  /** The version published in the registry, or null when unpublished/unknown. */
  publishedVersion: string | null;
  /** True while the open-PR lookup is in flight. */
  prChecking: boolean;
  /** Whether an open-PR lookup has completed at least once. */
  prChecked: boolean;
  /** When the cached PR result was last set (epoch ms), or null. Drives the TTL. */
  prCheckedAt: number | null;
  /** Open registry PRs for this mod (usually 0 or 1; more in an odd state). */
  prs: OpenPr[];
  /** Message from a failed registry read, or null. */
  error: string | null;
};

function blankEntry(dir: string): PublishStatusEntry {
  return {
    dir,
    checking: false,
    loaded: false,
    published: false,
    publishedVersion: null,
    prChecking: false,
    prChecked: false,
    prCheckedAt: null,
    prs: [],
    error: null,
  };
}

/**
 * Whether the published version differs from the version on disk. False when the
 * mod is unpublished, its published version is unknown, or the two match.
 */
export function publishedDiffers(entry: PublishStatusEntry | null | undefined, diskVersion: string | undefined): boolean {
  return Boolean(entry?.published && entry.publishedVersion && entry.publishedVersion !== diskVersion);
}

class PublishStatusTracker {
  /** Per-directory publish status, reactive. */
  entries = $state<Record<string, PublishStatusEntry>>({});

  /** Return the cached status for a directory, or null when never checked. */
  get(dir: string): PublishStatusEntry | null {
    return this.entries[dir] ?? null;
  }

  /**
   * Read the registry publish state for a mod and cache it. A read already in
   * flight for the directory is not started again. Reads the mod's id from its
   * open-mods manifest; a mod with no readable id is treated as unpublished.
   */
  async refresh(dir: string) {
    const existing = this.entries[dir];
    if (existing?.checking) return;
    // Create the entry if needed, then read it BACK so the rest of this method
    // mutates the reactive `$state` proxy rather than a detached raw object.
    if (!existing) this.entries[dir] = blankEntry(dir);
    const entry = this.entries[dir]!;

    const id = openMods.getByDir(dir)?.manifest?.id;
    if (!id) {
      entry.published = false;
      entry.publishedVersion = null;
      entry.error = null;
      entry.loaded = true;
      return;
    }

    entry.checking = true;
    try {
      const registry = await getRegistry();
      const mod = registry.mods.find((m) => m.id === id);
      entry.published = Boolean(mod);
      entry.publishedVersion = mod?.latestVersion ?? null;
      entry.error = null;
      entry.loaded = true;
    } catch (err) {
      // A registry read failure only downgrades the published-state display; it
      // never blocks the page. Surface it on the entry for callers that care.
      entry.error = (err as Error)?.message ?? "error";
      entry.loaded = true;
    } finally {
      entry.checking = false;
    }
  }

  /**
   * Look up the open registry PRs for the mod and cache them for the session.
   * A prior result stays fresh for 30 minutes; a repeat call within that window
   * is a no-op unless `force` is set. Needs the registry fork URL from setup to
   * know which fork owns the publish branch; without it, or when none is open,
   * `prs` stays empty. Never throws; degrades to an empty array on any failure.
   *
   * @param options.force - Bypass the 30-minute cache and re-query.
   */
  async checkPr(dir: string, { force = false }: { force?: boolean } = {}) {
    const existing = this.entries[dir];
    if (existing?.prChecking) return;
    // Serve from the session cache when a real lookup ran recently.
    if (!force && existing?.prCheckedAt != null && Date.now() - existing.prCheckedAt < PR_TTL_MS) return;
    if (!existing) this.entries[dir] = blankEntry(dir);
    const entry = this.entries[dir]!;

    const id = openMods.getByDir(dir)?.manifest?.id;
    const registryForkUrl = setupStore.forks.registry;
    if (!id || !registryForkUrl) {
      entry.prs = [];
      entry.prChecked = true;
      return;
    }

    entry.prChecking = true;
    try {
      entry.prs = await findOpenRegistryPrs({ registryForkUrl, modId: id });
      entry.prChecked = true;
      entry.prCheckedAt = Date.now();
    } finally {
      entry.prChecking = false;
    }
  }

  /**
   * Record a known open PR directly, merging it into the cached set and skipping
   * the network lookup - for when the PR is already known (e.g. just opened by a
   * publish), so it shows without spending a rate-limited API call.
   */
  addPr(dir: string, pr: OpenPr) {
    if (!this.entries[dir]) this.entries[dir] = blankEntry(dir);
    const entry = this.entries[dir]!;
    if (!entry.prs.some((p) => p.url === pr.url)) {
      entry.prs = [...entry.prs, pr];
    }
    entry.prChecked = true;
    entry.prCheckedAt = Date.now();
  }
}

export const publishStatus = new PublishStatusTracker();
