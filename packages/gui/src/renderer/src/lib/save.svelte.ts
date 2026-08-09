/**
 * Reactive store behind the save control - the GUI equivalent of `ebr save`.
 *
 * The control opens this flow for a mod; the flow drives a modal that (for
 * uncommitted work) collects a version bump and commit message, then runs the
 * core `saveMod` workflow. When the working tree is clean but the branch has
 * unpushed commits, it pushes them instead (`pushMod`) with no version/message
 * prompt. On success it refreshes the mod's cached manifest and git status.
 *
 * The pure logic lives in `core`; this is the front-end orchestration layer.
 */
import { saveMod, pushMod, bumpVersion, getStatus, validateVersion, previewIdentityOverride, NothingToCommitError } from "core";
import type { ProgressEvent, IdentityOverridePreview } from "core/types.js";
import { runGuarded } from "./guarded.js";
import { FlowStore } from "./flowstore.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { setupStore } from "./setup.svelte.js";

/** Whether the flow commits new work or only pushes already-committed work. */
export type SaveMode = "commit" | "push";
export type BumpType = "patch" | "minor" | "major";
/**
 * Version selection in the save dialog: a semver bump, or an explicit custom
 * version (leave Custom at the current version to keep it unchanged).
 */
export type VersionChoice = BumpType | "custom";

const DEFAULT_MESSAGE = "Updated mod content";

class SaveFlow extends FlowStore {
  /** Whether the open flow commits changes or only pushes. */
  mode = $state<SaveMode>("commit");
  /** Version on disk when the flow opened. */
  currentVersion = $state("0.0.0");
  /** How the version is set on save. */
  versionChoice = $state<VersionChoice>("patch");
  /** Explicit version, used only when versionChoice is "custom". */
  customVersion = $state("");
  /** Commit message for the save. */
  commitMessage = $state(DEFAULT_MESSAGE);
  /**
   * Set when the stored commit identity (from Setup) would stamp the commit
   * differently than the local git config would.
   */
  identityOverride = $state<IdentityOverridePreview | null>(null);

  /** The version a commit-mode save would write. */
  get nextVersion() {
    if (this.mode !== "commit") return this.currentVersion;
    if (this.versionChoice === "custom") return this.customVersion.trim() || this.currentVersion;
    try {
      return bumpVersion(this.currentVersion, this.versionChoice);
    } catch {
      return this.currentVersion;
    }
  }

  /** True when "custom" is selected but the typed version is not valid semver. */
  get customVersionInvalid() {
    return this.versionChoice === "custom" && validateVersion(this.customVersion.trim()) !== true;
  }

  /**
   * Open the flow for a mod. `mode` decides the dialog shape: "commit" prompts
   * for a version bump and message; "push" just confirms the push.
   */
  start(dir: string, { currentVersion, mode }: { currentVersion: string; mode: SaveMode }) {
    if (this.busy) return;
    this.dir = dir;
    this.mode = mode;
    this.currentVersion = currentVersion || "0.0.0";
    this.versionChoice = "patch";
    this.customVersion = this.currentVersion;
    this.commitMessage = DEFAULT_MESSAGE;
    this.identityOverride = null;
    this.resetStatus();
    if (mode === "commit") this.#loadIdentityOverride(dir);
  }

  /** Close the dialog. No-op while a run is in flight. */
  cancel() {
    if (this.busy) return;
    this.dir = null;
    this.resetStatus();
  }

  /** Select how the version is set on save. */
  setVersionChoice(choice: VersionChoice) {
    this.versionChoice = choice;
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

  /**
   * Run the save, honoring the operation the dialog showed. In commit
   * mode it commits then pushes (or, if the tree is already clean because a prior
   * attempt committed but the push failed, just pushes the existing commit). In
   * push mode it only pushes. On success refreshes the cached manifest and git
   * status, then closes.
   */
  async submit() {
    const dir = this.dir;
    if (!dir) return;
    // Capture the mode the user is looking at so it can't change underfoot
    const mode = this.mode;

    await runGuarded(
      this,
      "save-failed",
      async () => {
        const onProgress = (p: ProgressEvent) => (this.progress = p.message ?? null);
        if (mode === "commit") {
          // Commit mode normally commits then pushes. But if the tree is already
          // clean - e.g. a prior attempt committed and only the push failed - just
          // push the existing commit so a retry does not hit "nothing to commit".
          const status = await getStatus(dir);
          if (status.isClean) {
            await pushMod(dir, { onProgress });
          } else {
            const version =
              this.versionChoice === "custom"
                ? this.customVersion.trim()
                : bumpVersion(this.currentVersion, this.versionChoice);
            const commitMessage = this.commitMessage.trim() || DEFAULT_MESSAGE;
            const { login, noReplyEmail } = setupStore.identity;
            const identity = login && noReplyEmail ? { name: login, email: noReplyEmail } : null;
            await saveMod({ dir, commitMessage, version, identity }, { onProgress });
          }
        } else {
          // Push mode only ever pushes. If the tree became dirty since the dialog
          // opened, the uncommitted changes are left in place.
          await pushMod(dir, { onProgress });
        }
        // The git operation landed: close the dialog. Refreshing the cached
        // manifest and status is best-effort.
        this.dir = null;
        try {
          await openMods.reload(dir);
          await gitStatus.refresh(dir);
        } catch {
          // Non-fatal: the save/push succeeded; the cached view may lag until the
          // next refresh.
        }
      },
      {
        onError: (err) => {
          if (err instanceof NothingToCommitError) this.errorCode = "nothing-to-commit";
          this.errorDetail = (err as Error)?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }
}

export const saveFlow = new SaveFlow();
