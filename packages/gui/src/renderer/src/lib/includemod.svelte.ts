/**
 * Include-mod "Add content" kind (Advanced mode only): merge another creator's
 * published mod into this one. The author pastes the mod's Mod Manager or
 * GitHub URL (or just its bare id; see {@link extractModId}) and it is
 * resolved against the registry before any preview runs. A clean merge
 * commits and reports; a conflicting merge hands the conflicted files to the
 * conflict flow.
 */
import {
  includeMod,
  predictModInclude,
  resolveModSource,
  extractModId,
  fetchRegistry,
  IncludeModNotFoundError,
  MergeConflictError,
  DirtyWorkingTreeError,
  IndexNotCleanError,
  NotARepoError,
  ValidationError,
  GithubError,
} from "core";
import { runGuarded } from "./guarded.js";
import { ContentKindFlow } from "./contentkind.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { conflictFlow } from "./conflict.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";

/** The registry entry a typed mod id resolved to, for display. */
interface ResolvedMod {
  modId: string;
  name: string;
  author: string;
}

/** What including the resolved mod would do, from the dry-run preview. */
interface ModPreview {
  /** Paths that would conflict; empty when the merge is clean. */
  conflicts: string[];
  /** True when the mod already has this mod's content at its current tip (no-op). */
  alreadyUpToDate: boolean;
}

/** The result of a completed clean mod include, shown on the report screen. */
interface IncludeModReport {
  modId: string;
  alreadyUpToDate: boolean;
}

export class IncludeModFlow extends ContentKindFlow {
  /** Mod id, Mod Manager URL, or GitHub URL typed into the lookup field. */
  modSource = $state("");
  /** The registry entry the typed id resolved to, or null until resolved. */
  resolved = $state<ResolvedMod | null>(null);
  /** What the resolved mod would do, or null before the preview loads. */
  preview = $state<ModPreview | null>(null);
  /** The completed clean-include report, or null until it finishes. */
  report = $state<IncludeModReport | null>(null);
  /**
   * The trimmed `modSource` that {@link resolved}/{@link preview} were computed
   * for. Compared against the live field so editing the id after resolving
   * invalidates the stale resolution rather than letting Include silently act
   * on whatever was last confirmed.
   */
  #resolvedFor = $state<string | null>(null);

  /** Whether the current field text still matches the last resolved id. */
  get isStale(): boolean {
    return this.resolved !== null && this.modSource.trim() !== this.#resolvedFor;
  }

  begin(dir: string) {
    this.dir = dir;
    this.modSource = "";
    this.resolved = null;
    this.preview = null;
    this.report = null;
    this.#resolvedFor = null;
    this.resetStatus();
  }

  protected clearResult() {
    this.modSource = "";
    this.resolved = null;
    this.preview = null;
    this.report = null;
    this.#resolvedFor = null;
  }

  protected classifyError(err: unknown): string {
    if (err instanceof IncludeModNotFoundError) return "mod-not-found";
    if (err instanceof GithubError) return "registry-unreachable";
    if (err instanceof NotARepoError) return "not-a-repo";
    if (err instanceof DirtyWorkingTreeError) return "dirty-tree";
    if (err instanceof IndexNotCleanError) return "index-not-clean";
    if (err instanceof ValidationError) return "invalid";
    return "include-mod-failed";
  }

  /**
   * Resolve the typed mod id (or URL) against the registry, then predict
   * whether including it would conflict. Both steps share one registry fetch.
   */
  resolve() {
    const dir = this.dir;
    const source = this.modSource.trim();
    if (!dir || !source) return;
    const modId = extractModId(source);
    if (!modId) return;
    this.resolved = null;
    this.preview = null;
    this.#resolvedFor = null;
    this.runPreview(
      async () => {
        const registry = await fetchRegistry();
        const resolvedSource = resolveModSource(modId, registry);
        const predicted = await predictModInclude({ dir, source: resolvedSource.modId, registry });
        return { modId: resolvedSource.modId, entry: resolvedSource.entry, predicted };
      },
      (r) => {
        this.resolved = { modId: r.modId, name: r.entry.name, author: r.entry.author };
        this.preview = { conflicts: r.predicted.conflicts, alreadyUpToDate: r.predicted.alreadyUpToDate };
        this.#resolvedFor = source;
      },
    );
  }

  /**
   * Include the resolved mod. A clean merge commits and shows a report; a
   * conflicting merge hands the conflicted files to the conflict flow and
   * routes to the Conflict Resolution page.
   */
  async include() {
    const dir = this.dir;
    const modId = this.resolved?.modId;
    if (!dir || !modId || this.isStale) return;

    await runGuarded(
      this,
      "include-mod-failed",
      async () => {
        try {
          const result = await includeMod({ dir, source: modId });
          this.report = { modId: result.modId, alreadyUpToDate: result.alreadyUpToDate };
          try {
            await openMods.reload(dir);
            await gitStatus.refresh(dir);
          } catch {
            // Non-fatal: the include landed; the cached view may lag.
          }
        } catch (err) {
          if (err instanceof MergeConflictError) {
            conflictFlow.start(dir, { conflictedFiles: err.conflictedFiles });
            this.dismiss();
            navigation.go(ROUTES.CONFLICT, { dir });
            return;
          }
          throw err;
        }
      },
      {
        onError: (err) => {
          this.errorCode = this.classifyError(err);
        },
      },
    );
  }
}
