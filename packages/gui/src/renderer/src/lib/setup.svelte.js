/**
 * Reactive store for the creator's GitHub setup - the GUI equivalent of
 * `ebr setup`. Holds the detected GitHub account, the two creator fork URLs, and
 * the author defaults, all persisted to `~/.ebr/` via the core `config` module.
 *
 * `init()` reads config only (no network), so app launch stays fast and the
 * account header can render offline. The active operations (`checkStatus`,
 * `runSetup`) borrow the git credential and reach GitHub; they are driven by
 * explicit user action on the Setup page.
 */
import {
  getForkUrls,
  setForkUrls,
  clearForkUrls,
  getAuthorDefaults,
  setAuthorDefaults,
  clearAuthorDefaults,
  resolveCredentialLogin,
  ensureFork,
  forkUrlFor,
  forkOwnerFromUrl,
  remoteExists,
  clearCredential,
} from "core";
import { runGuarded } from "./guarded.js";

/** @typedef {import('core/types.js').ProgressEvent} ProgressEvent */

/** Upstream org and repos the creator forks. Mirrors the CLI `setup` command. */
const ORG = "Earthborne-Rangers-Community-Mods";
const BASE_CONTENT_REPO = "ebr-mod-base-content";
const REGISTRY_REPO = "ebr-mod-registry";

/** Browser URLs for the manual "Create fork" fallback when the API call fails. */
export const BROWSER_FORK_URLS = Object.freeze({
  [BASE_CONTENT_REPO]: `https://github.com/${ORG}/${BASE_CONTENT_REPO}/fork`,
  [REGISTRY_REPO]: `https://github.com/${ORG}/${REGISTRY_REPO}/fork`,
});

class SetupStore {
  /** GitHub login confirmed by an active credential probe (null until probed). */
  detectedLogin = $state(/** @type {string|null} */ (null));
  /** Whether the last active probe confirmed a working git credential. */
  credentialsChecked = $state(false);
  /** Configured fork URLs, read from `~/.ebr/`. */
  forks = $state(/** @type {{baseContent: string|null, registry: string|null}} */ ({ baseContent: null, registry: null }));
  /** Reachability of each fork after an active status check (null = unchecked). */
  baseForkReachable = $state(/** @type {boolean|null} */ (null));
  registryForkReachable = $state(/** @type {boolean|null} */ (null));
  /** Author defaults (bound to the form inputs on the Setup page). */
  author = $state("");
  authorDiscord = $state("");
  /** Last-persisted author defaults, for detecting unsaved edits in the inputs above. */
  savedAuthor = $state("");
  savedAuthorDiscord = $state("");
  /** True while an async operation is running. */
  busy = $state(false);
  /** True only while the passive status check is running (drives the dot's neutral 'checking' state). */
  checkingStatus = $state(false);
  /** True only while `runSetup` is creating/verifying the forks (drives the forks dot's in-progress state). */
  settingUpForks = $state(false);
  /** Live progress message during `runSetup`. */
  progress = $state(/** @type {string|null} */ (null));
  /** Error code from the last operation (localized by the component), or null. */
  errorCode = $state(/** @type {string|null} */ (null));
  /** Repos that could not be forked automatically and need the browser flow. */
  manualForks = $state(/** @type {Array<{repo: string, browserUrl: string}>} */ ([]));
  #initialized = false;

  /**
   * GitHub login to display: the actively-probed login when available,
   * otherwise derived offline from a configured fork URL.
   * @returns {string|null}
   */
  get displayLogin() {
    return (
      this.detectedLogin ??
      (this.forks.baseContent ? forkOwnerFromUrl(this.forks.baseContent) : null) ??
      (this.forks.registry ? forkOwnerFromUrl(this.forks.registry) : null)
    );
  }

  /** Whether the last active probe found a usable git credential. */
  get credentialsOk() {
    return Boolean(this.detectedLogin);
  }

  /** Both forks are configured. This is the "setup done" signal used at launch. */
  get completed() {
    return Boolean(this.forks.baseContent && this.forks.registry);
  }

  /** Whether the author inputs differ from what is persisted (unsaved edits). */
  get authorDirty() {
    return this.author !== this.savedAuthor || this.authorDiscord !== this.savedAuthorDiscord;
  }

  /** Whether a non-empty author name is saved. Its absence is the "red" state. */
  get hasAuthorDefault() {
    return this.savedAuthor.trim().length > 0;
  }

  /**
   * Load fork URLs and author defaults from config. Reads disk only - no
   * credential probe, no network - so it is safe to await at app launch. Runs
   * once.
   */
  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    await this.#loadConfig();
  }

  /** Re-read fork URLs and author defaults from config into state. */
  async #loadConfig() {
    this.forks = await getForkUrls();
    const defaults = await getAuthorDefaults();
    this.author = defaults.author ?? "";
    this.authorDiscord = defaults.authorDiscord ?? "";
    this.savedAuthor = this.author;
    this.savedAuthorDiscord = this.authorDiscord;
  }

  /**
   * Passive status check: probe the git credential (never prompting) and verify
   * each configured fork resolves on GitHub. Mirrors `ebr setup --status`.
   */
  async checkStatus() {
    await runGuarded(
      this,
      "status-failed",
      async () => {
        this.checkingStatus = true;
        this.progress = null;
        this.detectedLogin = await resolveCredentialLogin({ interactive: false });
        this.credentialsChecked = true;
        await this.#loadConfig();
        this.baseForkReachable = this.forks.baseContent
          ? await remoteExists(this.forks.baseContent)
          : null;
        this.registryForkReachable = this.forks.registry
          ? await remoteExists(this.forks.registry)
          : null;
      },
      { finalize: () => { this.checkingStatus = false; } },
    );
  }

  /**
   * Interactive setup: sign in (prompting if needed), then ensure both forks
   * exist, creating them via the borrowed credential. Forks that cannot be
   * created automatically land in `manualForks` for the browser fallback; a
   * second `runSetup` after the user creates them finds them and completes.
   * Mirrors the interactive `ebr setup` flow.
   */
  async runSetup() {
    await runGuarded(
      this,
      "setup-failed",
      async () => {
        this.settingUpForks = true;
        this.progress = null;
        this.manualForks = [];
        const login = await resolveCredentialLogin({ interactive: true });
        this.credentialsChecked = true;
        this.detectedLogin = login;
        if (!login) {
          this.errorCode = "no-sign-in";
          return;
        }

        const manual = [];
        for (const repo of [BASE_CONTENT_REPO, REGISTRY_REPO]) {
          const result = await ensureFork(
            { owner: ORG, repo, login },
            { onProgress: (/** @type {ProgressEvent} */ p) => (this.progress = p.message ?? null) },
          );
          if (result.status === "manual") {
            manual.push({ repo, browserUrl: /** @type {Record<string, string>} */ (BROWSER_FORK_URLS)[repo] });
          }
        }

        // Manual forks drive their own instructional block in the UI; a re-run
        // after the user creates them finds them via ensureFork and completes.
        if (manual.length > 0) {
          this.manualForks = manual;
          this.progress = null;
          return;
        }

        await setForkUrls({
          baseContent: forkUrlFor(login, BASE_CONTENT_REPO),
          registry: forkUrlFor(login, REGISTRY_REPO),
        });
        await this.#loadConfig();
        this.baseForkReachable = true;
        this.registryForkReachable = true;
        this.progress = null;

        // Seed the author default from the login when nothing is stored yet
        if (!this.author) {
          this.author = login;
          try {
            await setAuthorDefaults({ author: login });
            this.savedAuthor = login;
          } catch {
            // Non-fatal: leave the seeded name as an unsaved edit to save by hand.
          }
        }
      },
      { finalize: () => { this.settingUpForks = false; } },
    );
  }

  /** Persist the author name and Discord handle. Mirrors `ebr setup --author`. */
  async saveAuthorDefaults() {
    await runGuarded(this, "save-failed", async () => {
      const author = this.author.trim();
      const discord = this.authorDiscord.trim();
      await setAuthorDefaults({
        author: author || null,
        authorDiscord: discord || null,
      });
      this.author = author;
      this.authorDiscord = discord;
      this.savedAuthor = author;
      this.savedAuthorDiscord = discord;
    });
  }

  /** Clear stored fork URLs and author defaults. Mirrors `ebr setup --clear`. */
  async clearStoredSetup() {
    await runGuarded(this, "clear-failed", async () => {
      await clearForkUrls();
      await clearAuthorDefaults();
      this.forks = { baseContent: null, registry: null };
      this.author = "";
      this.authorDiscord = "";
      this.savedAuthor = "";
      this.savedAuthorDiscord = "";
      this.detectedLogin = null;
      this.credentialsChecked = false;
      this.baseForkReachable = null;
      this.registryForkReachable = null;
      this.manualForks = [];
    });
  }

  /**
   * Forget the saved GitHub credential so the next setup can sign in as a
   * different account. Mirrors the CLI's "switch account" affordance.
   */
  async switchAccount() {
    await runGuarded(this, "switch-failed", async () => {
      const cleared = await clearCredential();
      this.detectedLogin = null;
      this.credentialsChecked = false;
      if (!cleared) {
        this.errorCode = "switch-manual";
      }
    });
  }
}

export const setupStore = new SetupStore();
