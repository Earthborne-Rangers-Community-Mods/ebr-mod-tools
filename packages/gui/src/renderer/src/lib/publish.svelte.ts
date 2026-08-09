/**
 * Reactive store behind the publish control - the GUI equivalent of
 * `ebr publish`.
 *
 * Drives the publish modal: confirm, then run the core `publishMod` workflow
 * (validate, ownership/version preflight, write the registry entry to the
 * user's fork, open a PR), then show the result with a link to the PR (or the
 * compare-page fallback). Publishing uses the version already on disk - bumping
 * is the save flow's job.
 *
 * The pure logic lives in `core`; this is the front-end orchestration layer.
 */
import {
  publishMod,
  saveMod,
  getStatus,
  isBelowStable,
  STABLE_VERSION,
  previewIdentityOverride,
  UnpushedChangesError,
  ModIdConflictError,
  VersionNotHigherError,
  GitAuthenticationError,
  ManifestError,
  ValidationError,
} from "core";
import type { ProgressEvent, IdentityOverridePreview } from "core/types.js";
import { runGuarded } from "./guarded.js";
import { FlowStore } from "./flowstore.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";
import { openMods } from "./mods.svelte.js";
import { setupStore } from "./setup.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { publishStatus } from "./publishstatus.svelte.js";
import { saveFlow } from "./save.svelte.js";

/** What a completed publish produced, for the result screen. */
export type PublishResult = {
  /** GitHub compare URL, always available as a manual fallback. */
  compareUrl: string;
  /** Whether a PR was already open for this mod's publish branch. */
  prAlreadyExists: boolean;
  /** Whether this publish updated an existing registry entry (vs. a new one). */
  isUpdate: boolean;
};

class PublishFlow extends FlowStore {
  /** True once a publish has completed, switching the dialog to its result view. */
  done = $state(false);
  /** The completed publish result, or null before completion. */
  result = $state<PublishResult | null>(null);
  /** Non-fatal warnings from the publish (e.g. delisted includedMods). */
  warnings = $state<string[]>([]);
  /**
   * Set when the registry commit was made under a GitHub no-reply address for
   * a different account than the one publishing, so it will be misattributed.
   */
  identityWarning = $state<{ email: string; login: string } | null>(null);
  /** Whether to bump a pre-1.0 mod to 1.0.0 before publishing (offered only when below stable). */
  bumpToStable = $state(true);
  /**
   * Set when the stored commit identity (from Setup) would stamp the
   * registry-entry commit differently than the local git config would.
   */
  identityOverride = $state<IdentityOverridePreview | null>(null);

  /** Version on disk for the mod being published. */
  get currentVersion() {
    return (this.dir && openMods.getByDir(this.dir)?.manifest?.version) || "0.0.0";
  }

  /** Whether the mod is a pre-1.0 release, so the 1.0.0 bump is offered. */
  get needsBump() {
    return isBelowStable(this.currentVersion);
  }

  /** The version this publish will submit, accounting for an accepted bump. */
  get publishVersion() {
    return this.needsBump && this.bumpToStable ? STABLE_VERSION : this.currentVersion;
  }

  /** Open the flow for a mod, resetting any prior run's state. */
  start(dir: string) {
    if (this.busy) return;
    this.dir = dir;
    this.resetStatus();
    this.done = false;
    this.result = null;
    this.warnings = [];
    this.identityWarning = null;
    this.identityOverride = null;
    this.bumpToStable = true;
    this.#loadIdentityOverride(dir);
  }

  /** Check the stored commit identity against the mod's git config. */
  async #loadIdentityOverride(dir: string) {
    const { login, noReplyEmail } = setupStore.identity;
    const identity = login && noReplyEmail ? { name: login, email: noReplyEmail } : null;
    try {
      const preview = await previewIdentityOverride({ dir, identity });
      if (this.dir === dir) this.identityOverride = preview;
    } catch {
      // Best-effort banner; a failed check just leaves it hidden.
    }
  }

  /** Close the dialog. No-op while a run is in flight. */
  cancel() {
    if (this.busy) return;
    this.dir = null;
    this.resetStatus();
    this.done = false;
    this.result = null;
    this.warnings = [];
    this.identityWarning = null;
  }

  /**
   * Close the publish dialog and open the save flow instead. Offered when
   * publish is blocked by unsaved work: the user saves, then re-opens publish.
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
   * Close the publish dialog and open the Setup page. Offered when publish fails
   * because the GitHub sign-in or the registry fork needs attention.
   */
  goToSetup() {
    if (this.busy) return;
    this.cancel();
    navigation.go(ROUTES.SETUP);
  }

  /**
   * Run the publish. Requires the registry fork from setup; publishes the
   * on-disk version. On success it records the result for the dialog's
   * result view and refreshes the mod's publish and git status. Typed errors
   * from core map to specific, actionable error codes.
   */
  async submit() {
    const dir = this.dir;
    if (!dir) return;

    const registryForkUrl = setupStore.forks.registry;
    if (!registryForkUrl) {
      this.errorCode = "setup-required";
      return;
    }

    await runGuarded(
      this,
      "publish-failed",
      async () => {
        const onProgress = (p: ProgressEvent) => (this.progress = p.message ?? null);
        const { login, noReplyEmail } = setupStore.identity;
        const identity = login && noReplyEmail ? { name: login, email: noReplyEmail } : null;

        // Promote a pre-1.0 mod to a stable release first, if offered and accepted.
        if (this.needsBump && this.bumpToStable && (await getStatus(dir)).isClean) {
          await saveMod({ dir, commitMessage: "Bump version to 1.0.0", version: STABLE_VERSION, identity }, { onProgress });
          await openMods.reload(dir);
        }

        const res = await publishMod({ dir, registryForkUrl, identity }, { onProgress });

        this.result = {
          compareUrl: res.compareUrl,
          prAlreadyExists: res.prAlreadyExists,
          isUpdate: res.isUpdate,
        };
        this.warnings = res.includedModWarnings.map((w) => w.message);
        this.identityWarning = res.identityWarning;
        this.done = true;

        // Reflect the just-opened PR and refresh the cached status views. All
        // best-effort: the publish itself succeeded, so a failed refresh only
        // means the page lags until the next read.
        if (res.createdPr?.url) publishStatus.addPr(dir, { url: res.createdPr.url, number: res.createdPr.number });
        try {
          await gitStatus.refresh(dir);
          await publishStatus.refresh(dir);
          // Re-check only if there's a chance the user had to open the PR manually
          if (!res.createdPr?.url && !res.prAlreadyExists) await publishStatus.checkPr(dir, { force: true });
        } catch {
          // Non-fatal.
        }
      },
      {
        onError: (err) => {
          // Specific subclasses first: ModIdConflictError and VersionNotHigherError
          // both extend ValidationError, so they must be matched before it.
          if (err instanceof UnpushedChangesError) this.errorCode = "unsaved-changes";
          else if (err instanceof ModIdConflictError) this.errorCode = "id-conflict";
          else if (err instanceof VersionNotHigherError) this.errorCode = "version-not-higher";
          else if (err instanceof GitAuthenticationError) this.errorCode = "auth-failed";
          else if (err instanceof ManifestError || err instanceof ValidationError) this.errorCode = "invalid-manifest";
          this.errorDetail = (err as Error)?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }
}

export const publishFlow = new PublishFlow();
