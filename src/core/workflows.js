/**
 * High-level mod lifecycle workflows.
 *
 * Each function orchestrates a complete user action (scaffold, save, publish)
 * by composing primitives from git.js, github.js, manifest.js, and registry.js.
 * CLI commands and the Creator GUI call these directly.
 */

import { mkdir, mkdtemp, readdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { listFilesRecursive, sanitizePathSegment, realPathSafe, realPathOfDestination, isPathInside } from "./filesystem.js";
import { readManifest, writeManifest, validateManifest, formatValidationErrors, updateManifest, compareVersions } from "./manifest.js";
import { isRepo, initRepo, addRemote, cloneRepo, cloneBranchShallow, fetchRemote, createLocalBranch, checkout, setUpstreamBranch, stageAll, stageByExtensions, stageFile, commit, push, getHeadCommit, getRemoteUrl, getCurrentBranch, getStatus, getAheadBehind, createTag, hasRemote, isAncestor, merge, revparseRef, mergeBase } from "./git.js";
import {
  getFileContent,
  createOrUpdateFileContent,
  createBranch,
  updateBranchRef,
  getRefSha,
  listPullRequests,
  getAuthenticatedUser,
  syncFork,
  normalizeGithubUrl,
} from "./github.js";
import { ManifestError, GithubError, GithubFileNotFoundError, ModIdConflictError, UnpushedChangesError, ValidationError, NotARepoError, BaseRemoteMissingError, InsufficientScopeError, IncludeRefNotFoundError, IndexNotCleanError, NothingToCommitError, MergeConflictError, ForkOutOfSyncError, ScaffoldRefNotFoundError, IncludeModNotFoundError, VersionNotHigherError } from "./errors.js";
import { checkIncludedMods, buildRegistryEntry, fetchRegistry } from "./registry.js";
import { ALLOWED_EXTENSIONS, OFFICIAL_CAMPAIGNS, SCAFFOLD_NAME_TOKEN, KNOWN_SCAFFOLDS, SCAFFOLD_SKIP_FILES } from "./catalogs.js";

// --- Constants ---

const BASE_REPO_URL = "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-base-content.git";
const DEFAULT_REGISTRY_OWNER = "Earthborne-Rangers-Community-Mods";
const DEFAULT_REGISTRY_REPO = "ebr-mod-registry";
const REGISTRY_FILE = "registry.json";
const MODS_DIR = "mods";
const REGISTRY_BASE_BRANCH = "main";
const DEFAULT_PR_WORKER_URL = "https://ebr-mod-pr.ebr-mods.workers.dev/create-pr";

/**
 * Derive the git branch name for a mod from its ID.
 * @param {string} modId
 * @returns {string}
 */
export function getModBranchName(modId) {
  return `mod/${modId}`;
}

// --- scaffoldMod ---

/**
 * Create a new mod branch in an existing fork clone.
 *
 * Fetches the latest from `origin`, creates a `mod/<mod-id>` branch from
 * `origin/main`, and writes the manifest. The caller (CLI) is responsible
 * for warning the user and confirming before calling this.
 *
 * @param {object} params
 * @param {string} params.dir - Directory containing the existing clone.
 * @param {object} params.manifest - Complete manifest object to write.
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message }).
 * @returns {Promise<{ modDir: string, manifest: object, branch: string }>}
 */
export async function scaffoldModIntoClone({ dir, manifest }, { onProgress } = {}) {
  const modBranch = getModBranchName(manifest.id);

  onProgress?.({ step: "fetch", message: "Fetching latest from origin..." });
  await fetchRemote(dir, "origin");

  // If the clone has a `base` remote, verify the fork still shares history
  // with upstream. Mirrors the check in scaffoldMod for the cloned-fresh path.
  if (await hasRemote(dir, "base")) {
    onProgress?.({ step: "verify-fork", message: "Verifying fork shares history with upstream..." });
    await fetchRemote(dir, "base", { onProgress });
    const sharedBase = await mergeBase(dir, "origin/main", "base/main");
    if (!sharedBase) {
      throw new ForkOutOfSyncError({
        forkBranch: "origin/main",
        baseBranch: "base/main",
      });
    }
  }

  // Branch from the latest upstream content when available. If the clone
  // has no base remote, fall back to origin/main (best we can do).
  const branchFrom = (await hasRemote(dir, "base")) ? "base/main" : "origin/main";
  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, branchFrom);

  onProgress?.({ step: "manifest", message: "Writing ebr-mod.json..." });
  await writeManifest(dir, manifest);

  // Commit the manifest so the working tree is clean and `ebr-mod.json` exists
  // in HEAD. Without this, later `ebr include` runs that stage the manifest
  // before merging hit a misleading "local changes would be overwritten"
  // error from git's safety check on staged-but-not-in-HEAD files.
  onProgress?.({ step: "commit", message: "Committing initial manifest..." });
  await stageFile(dir, "ebr-mod.json");
  await commit(dir, `Initialize ${manifest.id} mod`);

  return { modDir: dir, manifest, branch: modBranch };
}

/**
 * Scaffold a new mod by cloning the creator's fork.
 *
 * Clones the user's fork of `ebr-mod-base-content` into the target
 * directory, creates a `mod/<mod-id>` branch from `main`, writes the
 * manifest, and commits.
 *
 * @param {object} params
 * @param {string} params.dir - Directory to scaffold into (must be empty or not exist).
 * @param {object} params.manifest - Complete manifest object to write.
 * @param {string} params.forkUrl - HTTPS URL of the user's fork (e.g. "https://github.com/user/ebr-mod-base-content").
 * @param {string} [params.baseRepoUrl] - Override the upstream base-content URL (tests).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message }).
 * @returns {Promise<{ modDir: string, manifest: object, branch: string }>}
 * @throws {ManifestError} If directory contains unexpected files.
 */
export async function scaffoldMod({ dir, manifest, forkUrl, baseRepoUrl = BASE_REPO_URL }, { onProgress } = {}) {
  const modBranch = getModBranchName(manifest.id);

  // Ensure parent directory exists
  await mkdir(dir, { recursive: true });

  // Require an empty directory for cloning
  const entries = await readdir(dir);
  if (entries.length > 0) {
    throw new ValidationError(
      `Directory is not empty: ${dir}`,
    );
  }

  // Clone the fork
  onProgress?.({ step: "clone", message: "Cloning fork..." });
  await cloneRepo(forkUrl, dir);

  // Add base remote pointing to upstream
  onProgress?.({ step: "remote", message: "Adding base content remote..." });
  await addRemote(dir, "base", baseRepoUrl);

  // Fetch base and verify the fork shares history with upstream. If the
  // user's fork was made before an upstream history rewrite, every later
  // `ebr include` would fail with "unrelated histories"; catch that here
  // before we make a mod branch off a doomed root.
  onProgress?.({ step: "verify-fork", message: "Verifying fork shares history with upstream..." });
  await fetchRemote(dir, "base", { onProgress });
  const sharedBase = await mergeBase(dir, "origin/main", "base/main");
  if (!sharedBase) {
    throw new ForkOutOfSyncError({
      forkBranch: "origin/main",
      baseBranch: "base/main",
      forkUrl,
    });
  }

  // Create mod branch from the latest upstream content, not the fork's
  // potentially-stale main. base/main was just fetched above.
  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, "base/main");

  // Write manifest
  onProgress?.({ step: "manifest", message: "Writing ebr-mod.json..." });
  await writeManifest(dir, manifest);

  // Commit the manifest so the working tree is clean and `ebr-mod.json` exists
  // in HEAD. Without this, later `ebr include` runs that stage the manifest
  // before merging hit a misleading "local changes would be overwritten"
  // error from git's safety check on staged-but-not-in-HEAD files.
  onProgress?.({ step: "commit", message: "Committing initial manifest..." });
  await stageFile(dir, "ebr-mod.json");
  await commit(dir, `Initialize ${manifest.id} mod`);

  return { modDir: dir, manifest, branch: modBranch };
}

// --- saveMod ---

/**
 * Save mod changes: optionally bump version, stage all, commit, and push.
 *
 * This is the high-level workflow behind `ebr save`. The CLI wrapper resolves
 * the desired version (via bump or explicit flag) and passes it here.
 *
 * @param {object} options
 * @param {string} options.dir - Mod directory containing ebr-mod.json.
 * @param {string} options.commitMessage - Commit message.
 * @param {string} [options.version] - Target version to set (omit or null to skip).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback.
 * @returns {Promise<{commitHash: string, manifestChanges: Array<{field: string, oldValue: *, newValue: *}>}>}
 * @throws {NothingToCommitError} If there are no changes to commit.
 */
export async function saveMod({ dir, commitMessage, version }, { onProgress } = {}) {
  // 1. Detect repoUrl from origin remote
  const remoteUrl = await getRemoteUrl(dir, "origin");
  const repoUrl = normalizeGithubUrl(remoteUrl);

  // 2. Update manifest (version + repoUrl)
  const manifestResult = await updateManifest({ dir, version, repoUrl }, { onProgress });

  // 3. Stage changes (only allowed file types)
  onProgress?.({ step: "stage", message: "Staging changes..." });
  await stageByExtensions(dir, ALLOWED_EXTENSIONS);

  // 4. Commit
  onProgress?.({ step: "commit", message: "Committing..." });
  await commit(dir, commitMessage);

  // 5. Auto-set upstream tracking branch if not already set
  const currentBranch = await getCurrentBranch(dir);
  const tracking = await getAheadBehind(dir);
  if (!tracking) {
    onProgress?.({ step: "upstream", message: "Setting upstream tracking branch..." });
    await push(dir, { remote: "origin", branch: currentBranch });
    await setUpstreamBranch(dir, "origin", currentBranch);
  } else {
    // 6. Push
    onProgress?.({ step: "push", message: "Pushing to remote..." });
    await push(dir);
  }

  const commitHash = await getHeadCommit(dir);
  return {
    commitHash,
    manifestChanges: manifestResult?.changes ?? [],
  };
}

// --- publishMod ---

/**
 * Build the PR body markdown.
 * @param {object} manifest
 * @param {string} commitHash
 * @param {boolean} isUpdate
 * @returns {string}
 */
function buildPrBody(manifest, commitHash, isUpdate) {
  const lines = [
    `## ${isUpdate ? "Mod Update" : "New Mod Submission"}`,
    "",
    `**Mod:** ${manifest.name}`,
    `**ID:** \`${manifest.id}\``,
    `**Version:** ${manifest.version}`,
    `**Type:** ${manifest.type}`,
    `**Author:** ${manifest.author}`,
    `**Repo:** ${manifest.repoUrl}`,
    `**Commit:** [\`${commitHash.slice(0, 7)}\`](${manifest.repoUrl}/commit/${commitHash})`,
    "",
    `> ${manifest.description}`,
  ];
  return lines.join("\n");
}

/**
 * Build a GitHub compare URL that pre-fills a PR form.
 *
 * Asterisks are percent-encoded explicitly: URLSearchParams leaves `*` literal,
 * and many terminals treat it as a URL boundary, so a markdown body with `**`
 * truncates the clickable link mid-string. Encoding them keeps the full body
 * and a fully clickable URL.
 * @param {object} options
 * @param {string} options.registryOwner
 * @param {string} options.registryRepo
 * @param {string} options.base - Target branch (e.g., "main").
 * @param {string} options.head - Source ref (e.g., "user:publish/mod-id").
 * @param {string} options.title - Pre-filled PR title.
 * @param {string} options.body - Pre-filled PR body.
 * @returns {string}
 */
function buildCompareUrl({ registryOwner, registryRepo, base, head, title, body }) {
  const params = new URLSearchParams({ expand: "1", title, body }).toString().replace(/\*/g, "%2A");
  return `https://github.com/${registryOwner}/${registryRepo}/compare/${base}...${head}?${params}`;
}

/**
 * Ask the GitHub App worker to open the registry PR on the user's behalf.
 *
 * Returns the created PR on success, or null on any failure (worker down,
 * non-2xx, malformed response, fetch threw). Returning null lets the caller
 * fall back to the browser compare-URL flow so `ebr publish` always works.
 *
 * @param {object} options
 * @param {string} options.workerUrl - POST /create-pr endpoint.
 * @param {string} options.token - Caller's GitHub token (worker verifies it owns the fork).
 * @param {string} options.forkOwner
 * @param {string} options.branch
 * @param {string} options.title
 * @param {string} options.body
 * @returns {Promise<{number: number, url: string}|null>}
 */
async function requestPrViaWorker({ workerUrl, token, forkOwner, branch, title, body }, onProgress) {
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ forkOwner, branch, title, body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      onProgress?.({ step: "create-pr-failed", message: `Auto-PR failed (HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}); falling back to compare URL.` });
      return null;
    }
    const data = await res.json();
    if (!data || typeof data.url !== "string") {
      onProgress?.({ step: "create-pr-failed", message: "Auto-PR failed (unexpected worker response); falling back to compare URL." });
      return null;
    }
    return { number: data.number, url: data.url };
  } catch (err) {
    onProgress?.({ step: "create-pr-failed", message: `Auto-PR failed (${err.message}); falling back to compare URL.` });
    return null;
  }
}

/**
 * Publish or update a mod in the registry.
 *
 * 1. Read and validate ebr-mod.json.
 * 2. Check for uncommitted/unpushed changes.
 * 3. Capture the current git HEAD commit hash.
 * 4. Verify authentication and get username.
 * 5. Read registry.json for includedMods validation.
 * 6. Check includedMods against the registry (warn for delisted mods).
 * 7. Check if mod file already exists (determines new vs update).
 * 8. **Mod ID ownership check:** If the mod file exists and belongs to a
 *    different author/repoUrl, abort with ModIdConflictError. If it belongs to
 *    the same author, abort with VersionNotHigherError unless the manifest
 *    version is strictly higher than the published version.
 * 9. Build the registry entry.
 * 10. Sync fork with upstream.
 * 11. Create a branch in the fork from upstream's latest main.
 * 12. Write the mod file (`mods/<mod-id>.json`) to the branch.
 * 13. Check for an existing PR; if none, ask the GitHub App worker to open one,
 *     falling back to a compare URL when the worker is unreachable.
 *
 * The registry fork is assumed to already exist (set up during `ebr setup`).
 *
 * @param {object} options
 * @param {string} options.dir - Mod directory containing ebr-mod.json.
 * @param {string} options.token - GitHub personal access token.
 * @param {string} [options.registryOwner] - Upstream registry repo owner.
 * @param {string} [options.registryRepo] - Upstream registry repo name.
 * @param {string|null} [options.prWorkerUrl] - GitHub App PR worker endpoint. Pass null to skip the worker and always use the compare URL.
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message }).
 * @returns {Promise<{existingPr: {number, url}|null, createdPr: {number, url}|null, compareUrl: string, entry: object, commitHash: string, isUpdate: boolean, includedModWarnings: Array}>}
 */
export async function publishMod(
  { dir, token, force = false, registryOwner = DEFAULT_REGISTRY_OWNER, registryRepo = DEFAULT_REGISTRY_REPO, prWorkerUrl = DEFAULT_PR_WORKER_URL },
  { onProgress } = {},
) {
  // 1. Read and validate manifest
  onProgress?.({ step: "validate", message: "Validating ebr-mod.json..." });
  const manifest = await readManifest(dir);

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    const messages = formatValidationErrors(errors);
    throw new ManifestError(
      "validation",
      `Manifest validation failed:\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    );
  }

  if (!manifest.repoUrl) {
    throw new ManifestError(
      "repoUrl",
      "repoUrl must be set before publishing. Update ebr-mod.json with your GitHub repo URL.",
    );
  }

  // 2. Check for uncommitted or unpushed changes
  if (!force) {
    onProgress?.({ step: "check", message: "Checking for unpushed changes..." });
    const status = await getStatus(dir);
    const aheadBehind = await getAheadBehind(dir);
    const dirty = !status.isClean;
    const ahead = aheadBehind?.ahead ?? 0;

    if (dirty || ahead > 0) {
      const files = [...status.modified, ...status.staged, ...status.created];
      throw new UnpushedChangesError({ dirty, ahead, files });
    }
  }

  // 3. Get HEAD commit hash
  onProgress?.({ step: "commit", message: "Getting current commit hash..." });
  const commitHash = await getHeadCommit(dir);

  // 4. Verify authentication and get username (needed for cross-repo PR head ref)
  onProgress?.({ step: "auth", message: "Verifying authentication..." });
  const user = await getAuthenticatedUser(token);
  const forkOwner = user.login;

  // 5. Get upstream main SHA and read registry.json (for includedMods validation)
  onProgress?.({ step: "sync", message: "Reading current registry..." });
  const upstreamSha = await getRefSha(token, {
    owner: registryOwner, repo: registryRepo, ref: REGISTRY_BASE_BRANCH,
  });

  const { content: registryRaw } = await getFileContent(token, {
    owner: registryOwner, repo: registryRepo, path: REGISTRY_FILE,
  });

  let registry;
  try {
    registry = JSON.parse(registryRaw);
  } catch {
    throw new GithubError("publish", "Registry contains invalid JSON.");
  }

  // 6. Check includedMods against registry
  const includedModWarnings = checkIncludedMods(manifest.includedMods, registry);

  // 7. Check if mod file already exists (determines new vs update)
  const modFilePath = `${MODS_DIR}/${manifest.id}.json`;
  let existingFileSha = null;
  let isUpdate = false;
  let existingEntry = null;

  try {
    const { content: existingContent, sha } = await getFileContent(token, {
      owner: registryOwner, repo: registryRepo, path: modFilePath,
    });
    existingFileSha = sha;
    isUpdate = true;
    try {
      existingEntry = JSON.parse(existingContent);
    } catch {
      // Existing file has invalid JSON - treat as new (overwrite)
    }
  } catch (err) {
    // 404 means the file doesn't exist yet - this is a new mod submission.
    if (!(err instanceof GithubFileNotFoundError)) {
      throw err;
    }
  }

  // 8. Mod ID ownership check - abort if the ID is claimed by a different author
  if (existingEntry) {
    const sameAuthor = existingEntry.author === manifest.author;
    const sameRepo = existingEntry.repoUrl === manifest.repoUrl;
    if (!sameAuthor || !sameRepo) {
      throw new ModIdConflictError(manifest.id, existingEntry.author, existingEntry.repoUrl);
    }

    // Version gate - the new version must be strictly higher than the one
    // already published. compareVersions returns null when either value is
    // unparseable; treat that as "cannot compare" and skip rather than block.
    if (existingEntry.latestVersion) {
      const cmp = compareVersions(manifest.version, existingEntry.latestVersion);
      if (cmp !== null && cmp <= 0) {
        throw new VersionNotHigherError(manifest.id, manifest.version, existingEntry.latestVersion);
      }
    }
  }

  // 9. Build entry
  onProgress?.({ step: "build", message: "Building registry entry..." });
  const entry = buildRegistryEntry(manifest, commitHash);
  const entryJson = JSON.stringify(entry, null, 2) + "\n";

  // 10. Sync fork with upstream so the SHA exists in the fork
  onProgress?.({ step: "sync-fork", message: "Syncing fork with upstream..." });
  try {
    await syncFork(token, { owner: forkOwner, repo: registryRepo, branch: REGISTRY_BASE_BRANCH });
  } catch (err) {
    // 422 "without `workflow` scope" = PAT lacks Workflows permission (upstream
    // has a .github/workflows/ file). The same permission block applies to all write paths.
    if (err instanceof GithubError && err.httpStatus === 422 &&
        /without `workflow` scope/i.test(err.message)) {
      throw new InsufficientScopeError("syncFork");
    }
    // 409 = merge conflict, 422 = fork diverged (other reasons).
    // Force-reset the fork's default branch to upstream.
    if (err instanceof GithubError && (err.httpStatus === 409 || err.httpStatus === 422)) {
      await updateBranchRef(token, {
        owner: forkOwner, repo: registryRepo,
        branch: REGISTRY_BASE_BRANCH, sha: upstreamSha,
      });
    } else {
      throw err;
    }
  }

  // 11. Create branch in fork from upstream's main
  onProgress?.({ step: "branch", message: "Creating publish branch..." });
  const branchName = `publish/${manifest.id}`;

  try {
    await createBranch(token, {
      owner: forkOwner, repo: registryRepo,
      branch: branchName, sha: upstreamSha,
    });
  } catch (err) {
    // Branch exists from a previous publish attempt - force-update to latest upstream
    if (err instanceof GithubError && err.message.includes("already exists")) {
      await updateBranchRef(token, {
        owner: forkOwner, repo: registryRepo,
        branch: branchName, sha: upstreamSha,
      });
    } else {
      throw err;
    }
  }

  // 12. Write mod file to the branch
  onProgress?.({ step: "write", message: "Writing mod entry..." });
  await createOrUpdateFileContent(token, {
    owner: forkOwner, repo: registryRepo, path: modFilePath,
    content: entryJson,
    message: isUpdate
      ? `Update ${manifest.name} to v${manifest.version}`
      : `Add ${manifest.name} v${manifest.version}`,
    ...(existingFileSha && { sha: existingFileSha }),
    branch: branchName,
  });

  // 13. Convenience tag on the local mod repo
  try {
    await createTag(dir, `v${manifest.version}`);
  } catch {
    onProgress?.({ step: "tag-warning", message: `Could not create tag v${manifest.version} (it may already exist).` });
  }

  // 14. Check for existing PR or build compare URL for the user to open
  onProgress?.({ step: "pr", message: "Checking for existing pull request..." });
  const head = `${forkOwner}:${branchName}`;

  let existingPr = null;
  try {
    const existingPRs = await listPullRequests(token, {
      owner: registryOwner, repo: registryRepo, head, state: "open",
    });
    if (existingPRs.length > 0) {
      existingPr = existingPRs[0];
    }
  } catch {
    // Listing PRs on upstream may fail with fine-grained PATs - not critical
  }

  const prTitle = isUpdate
    ? `Update: ${manifest.name} v${manifest.version}`
    : `New mod: ${manifest.name} v${manifest.version}`;
  const prBody = buildPrBody(manifest, commitHash, isUpdate);

  const compareUrl = buildCompareUrl({
    registryOwner, registryRepo, base: REGISTRY_BASE_BRANCH,
    head: `${forkOwner}:${branchName}`,
    title: prTitle, body: prBody,
  });

  // 15. Try the GitHub App worker to open the PR automatically. Skip if a PR
  // already exists or no worker is configured.
  let createdPr = null;
  if (!existingPr && prWorkerUrl) {
    onProgress?.({ step: "create-pr", message: "Opening pull request..." });
    createdPr = await requestPrViaWorker({
      workerUrl: prWorkerUrl, token, forkOwner, branch: branchName,
      title: prTitle, body: prBody,
    }, onProgress);
  }

  return { existingPr, createdPr, compareUrl, entry, commitHash, isUpdate, includedModWarnings };
}

// --- Base-content update workflows ---

const BASE_REMOTE_NAME = "base";
const BASE_REF = `${BASE_REMOTE_NAME}/main`;

/**
 * Check whether the `base` remote has commits on `main` that aren't yet
 * merged into the current branch.
 *
 * Fetches the `base` remote, then reports whether `base/main` is an
 * ancestor of HEAD. If it is, the branch is up to date; otherwise an
 * update is available.
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory (must be a git repo with a `base` remote).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message, ... }).
 * @returns {Promise<{ updateAvailable: boolean }>}
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {BaseRemoteMissingError} If no `base` remote is configured.
 * @throws {GitError} For other git failures.
 */
export async function checkBaseUpdate({ dir }, { onProgress } = {}) {
  await assertBaseRepo(dir);

  onProgress?.({ step: "fetch", message: "Fetching base content..." });
  await fetchRemote(dir, BASE_REMOTE_NAME, { onProgress });

  const updateAvailable = !(await isAncestor(dir, BASE_REF, "HEAD"));
  return { updateAvailable };
}

/**
 * Merge `base/main` into the current branch.
 *
 * Thin wrapper around `git merge`.
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory.
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ merged: true }>}
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {BaseRemoteMissingError} If no `base` remote is configured.
 * @throws {MergeConflictError} If the merge produces conflicts.
 * @throws {GitError} For other git failures.
 */
export async function applyBaseUpdate({ dir }, { onProgress } = {}) {
  await assertBaseRepo(dir);

  onProgress?.({ step: "merge", message: "Merging base content..." });
  await merge(dir, BASE_REF, { onProgress });

  return { merged: true };
}

/** Precondition guard: ensures {@link dir} is a git repo with the base-content remote configured. */
async function assertBaseRepo(dir) {
  if (!(await isRepo(dir))) {
    throw new NotARepoError(dir);
  }
  if (!(await hasRemote(dir, BASE_REMOTE_NAME))) {
    throw new BaseRemoteMissingError(dir);
  }
}

/**
 * Walk every entry in `manifest.includedCampaigns` and report which ones
 * have new commits available on `base/<branch>`.
 *
 * Reuses the existing `base` remote (added by `ebr new`). Fetches once,
 * then per-entry checks whether the remote branch tip is already an
 * ancestor of HEAD - same shape as {@link checkBaseUpdate}.
 *
 * Entries whose branch cannot be resolved on the remote (deleted or
 * renamed upstream) are returned with `missing: true` so the caller can
 * warn-and-skip rather than abort the whole walk.
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory (must be a git repo with a `base` remote).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ updates: Array<{ id: string, branch: string, oldCommitHash: string, newCommitHash: string|null, updateAvailable: boolean, missing: boolean }> }>}
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {BaseRemoteMissingError} If no `base` remote is configured.
 * @throws {ManifestError} If the manifest is missing or invalid.
 */
export async function checkIncludedCampaignsUpdates({ dir }, { onProgress } = {}) {
  await assertBaseRepo(dir);

  const manifest = await readManifest(dir);
  const entries = Array.isArray(manifest.includedCampaigns) ? manifest.includedCampaigns : [];

  if (entries.length === 0) {
    return { updates: [] };
  }

  onProgress?.({ step: "fetch", message: `Fetching ${BASE_REMOTE_NAME}...` });
  await fetchRemote(dir, BASE_REMOTE_NAME, { onProgress });

  const updates = [];
  for (const entry of entries) {
    const remoteRef = `${BASE_REMOTE_NAME}/${entry.branch}`;
    onProgress?.({ step: "check", message: `Checking ${entry.branch}...` });

    let latestSha;
    try {
      latestSha = await revparseRef(dir, remoteRef);
    } catch {
      updates.push({
        id: entry.id,
        branch: entry.branch,
        oldCommitHash: entry.commitHash,
        newCommitHash: null,
        updateAvailable: false,
        missing: true,
      });
      continue;
    }

    const upToDate = await isAncestor(dir, remoteRef, "HEAD");
    updates.push({
      id: entry.id,
      branch: entry.branch,
      oldCommitHash: entry.commitHash,
      newCommitHash: latestSha,
      updateAvailable: !upToDate,
      missing: false,
    });
  }

  return { updates };
}

// --- includeCampaign ---

const CAMPAIGN_BRANCH_PREFIX = "campaign/";

/**
 * Resolve an `ebr include` campaign source into a campaign id and its branch.
 *
 * @param {string} source
 * @returns {{ campaignId: string, branch: string }}
 * @throws {ValidationError} If source is empty or not a known campaign id.
 */
export function resolveCampaignSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new ValidationError("Include source must be a non-empty string.");
  }
  const campaignId = source.trim();

  // Validate against the canonical OFFICIAL_CAMPAIGNS catalog. `ebr include`
  // only handles official campaign branches; custom-campaign mods don't get
  // included via this path. A typo fails here with a clear ValidationError
  // listing the known ids instead of a downstream "branch missing on remote".
  const known = OFFICIAL_CAMPAIGNS.find((c) => c.id === campaignId);
  if (!known) {
    const knownIds = OFFICIAL_CAMPAIGNS.map((c) => c.id).join(", ");
    throw new ValidationError(
      `Unknown campaign "${campaignId}". Known campaigns: ${knownIds}.`,
    );
  }

  return { campaignId, branch: `${CAMPAIGN_BRANCH_PREFIX}${campaignId}` };
}

/**
 * Insert or replace an entry in `includedCampaigns` keyed by `id`.
 * Pure helper - exported for tests.
 *
 * @param {Array<{id: string, branch: string, commitHash: string}>|undefined} existing
 * @param {{id: string, branch: string, commitHash: string}} entry
 * @returns {Array<{id: string, branch: string, commitHash: string}>}
 */
export function upsertIncludedCampaign(existing, entry) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const idx = list.findIndex((e) => e && e.id === entry.id);
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return list;
}

/**
 * Include an official campaign branch into the current mod.
 *
 * Order of operations is deliberate: we merge first, then write the
 * manifest. That way an aborted merge or unrelated git failure leaves the
 * manifest untouched.
 *
 * 1. Validate (clean index, manifest readable, base remote present).
 * 2. Fetch base, resolve `base/campaign/<id>` to a commit hash.
 * 3. `git merge --no-commit` the campaign ref.
 *    - On {@link MergeConflictError}: write the manifest update and stage it
 *      so the user's `git merge --continue` produces a merge commit that
 *      includes both the campaign content and the includedCampaigns update.
 *      Rethrow with `campaignId`/`branch`/`commitHash` attached.
 *    - On any other error: rethrow unchanged. The manifest hasn't been
 *      touched and `git merge --abort` (if needed) restores the tree.
 * 4. Merge succeeded. Write+stage the manifest update and commit. If the
 *    merge produced no changes AND the manifest was byte-identical (the
 *    re-include case), the commit fails with NothingToCommitError; we
 *    swallow it and return `alreadyUpToDate: true`.
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory.
 * @param {string} params.source - Official campaign id (e.g. "lure-of-the-valley").
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ campaignId: string, branch: string, commitHash: string, alreadyUpToDate: boolean }>}
 * @throws {ValidationError} If `source` is malformed.
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {BaseRemoteMissingError} If no `base` remote is configured.
 * @throws {IndexNotCleanError} If the index has staged changes when the workflow starts.
 * @throws {IncludeRefNotFoundError} If the campaign branch cannot be resolved on `base`.
 * @throws {MergeConflictError} If the merge produces conflicts.
 * @throws {GitError} For other git failures.
 * @throws {ManifestError} If the manifest is missing or invalid.
 */
export async function includeCampaign({ dir, source }, { onProgress } = {}) {
  const { campaignId, branch } = resolveCampaignSource(source);
  const remoteRef = `${BASE_REMOTE_NAME}/${branch}`;

  await assertBaseRepo(dir);

  // Refuse to proceed if the index already has staged changes. The merge's
  // pre-flight check would catch most of these, but some surface as confusing
  // "your local changes would be overwritten" errors; failing here gives a
  // clearer message.
  const status = await getStatus(dir);
  if (status.staged.length > 0) {
    throw new IndexNotCleanError(status.staged);
  }

  // Read manifest up front so a missing/invalid manifest fails before we touch git.
  const manifest = await readManifest(dir);

  onProgress?.({ step: "fetch", message: `Fetching ${BASE_REMOTE_NAME}...` });
  await fetchRemote(dir, BASE_REMOTE_NAME, { onProgress });

  onProgress?.({ step: "resolve", message: `Resolving ${remoteRef}...` });
  let commitHash;
  try {
    commitHash = await revparseRef(dir, remoteRef);
  } catch {
    throw new IncludeRefNotFoundError(remoteRef);
  }

  const entry = { id: campaignId, branch, commitHash };
  const shortSha = commitHash.slice(0, 7);

  onProgress?.({ step: "merge", message: `Merging ${remoteRef}...` });
  try {
    await merge(dir, remoteRef, { onProgress, noCommit: true });
  } catch (err) {
    if (err instanceof MergeConflictError) {
      // Conflict path: write+stage the manifest so `git merge --continue`
      // includes it in the resulting merge commit. The user resolves
      // conflicts on the campaign content, then runs `--continue`.
      onProgress?.({ step: "manifest", message: "Updating includedCampaigns..." });
      manifest.includedCampaigns = upsertIncludedCampaign(manifest.includedCampaigns, entry);
      await writeManifest(dir, manifest);
      await stageFile(dir, "ebr-mod.json");

      err.campaignId = campaignId;
      err.branch = branch;
      err.commitHash = commitHash;
      throw err;
    }
    // Any other failure: manifest is untouched, working tree is clean
    // (or whatever git left it in). Bail cleanly without rollback.
    throw err;
  }

  // Merge succeeded (real merge with MERGE_HEAD set, or a no-op when the
  // campaign was already merged at this exact commit hash). Write+stage the
  // manifest and finalize with a commit.
  onProgress?.({ step: "manifest", message: "Updating includedCampaigns..." });
  manifest.includedCampaigns = upsertIncludedCampaign(manifest.includedCampaigns, entry);
  await writeManifest(dir, manifest);
  await stageFile(dir, "ebr-mod.json");

  onProgress?.({ step: "commit", message: "Committing include..." });
  try {
    // With MERGE_HEAD set, this produces the merge commit (combining merge
    // changes + our staged manifest). Without it (re-include of an already-
    // merged campaign with byte-identical manifest), this is a regular
    // commit that throws NothingToCommitError.
    await commit(dir, `Include ${branch} at ${shortSha}`);
    return { campaignId, branch, commitHash, alreadyUpToDate: false };
  } catch (err) {
    if (err instanceof NothingToCommitError) {
      return { campaignId, branch, commitHash, alreadyUpToDate: true };
    }
    throw err;
  }
}

// --- includeMod ---

/**
 * Classify an `ebr include` source as a campaign or a mod.
 *
 * A campaign source is a bare official campaign id (from
 * {@link OFFICIAL_CAMPAIGNS}). Everything else routes to the mod path.
 *
 * @param {string} source
 * @returns {"campaign"|"mod"}
 */
export function classifyIncludeSource(source) {
  const trimmed = typeof source === "string" ? source.trim() : "";
  if (trimmed && OFFICIAL_CAMPAIGNS.some((c) => c.id === trimmed)) {
    return "campaign";
  }
  return "mod";
}

/**
 * Derive a stable, git-safe remote name for a mod fork's repo URL.
 *
 * Every mod by an author lives as a branch in the same fork, so keying the
 * remote by the fork's `owner/repo` (not by mod id) means multiple includes
 * from the same author reuse one remote.
 *
 * @param {string} repoUrl
 * @returns {string}
 * @throws {ValidationError} If `repoUrl` is not a recognizable GitHub URL.
 */
export function remoteNameForRepoUrl(repoUrl) {
  const normalized = normalizeGithubUrl(repoUrl);
  const match = normalized && normalized.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    throw new ValidationError(
      `Cannot derive a remote name from repo URL "${repoUrl}". Expected a GitHub URL like https://github.com/<owner>/<repo>.`,
    );
  }
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `inc-${slug(match[1])}-${slug(match[2])}`;
}

/**
 * Resolve an `ebr include <mod>` source into the registry entry that pins the
 * mod's published `commitHash` and fork `repoUrl`. Mod includes are
 * registry-driven: the registry is the source of truth for which commit a mod
 * version corresponds to.
 *
 * The source is a bare mod id, matched against `registry.mods[].id`. Repo URLs
 * are not accepted - one fork hosts every mod by an author, so a URL cannot
 * identify a single mod.
 *
 * @param {string} source
 * @param {{mods?: Array<object>}} registry - Parsed browse-tier registry.
 * @returns {{ modId: string, entry: object }}
 * @throws {ValidationError} If `source` is empty.
 * @throws {IncludeModNotFoundError} If no registry entry matches.
 */
export function resolveModSource(source, registry) {
  if (typeof source !== "string" || !source.trim()) {
    throw new ValidationError("Include source must be a non-empty string.");
  }
  const trimmed = source.trim();
  const mods = Array.isArray(registry?.mods) ? registry.mods : [];

  const entry = mods.find((m) => m.id === trimmed);
  if (!entry) {
    throw new IncludeModNotFoundError(trimmed);
  }
  return { modId: trimmed, entry };
}

/**
 * Insert or replace an entry in `includedMods` keyed by `id`.
 * Pure helper - exported for tests.
 *
 * @param {Array<{id: string, name: string, author: string, version: string, repoUrl: string}>|undefined} existing
 * @param {{id: string, name: string, author: string, version: string, repoUrl: string}} entry
 * @returns {Array<object>}
 */
export function upsertIncludedMod(existing, entry) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const idx = list.findIndex((e) => e && e.id === entry.id);
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return list;
}

/**
 * Include another mod into the current one (the merge behind collections and
 * any mod that builds on upstream work). The source is resolved through the
 * registry, which pins the exact published `commitHash` to merge - the same
 * commit-pinning the app downloads, so a collection author merges the reviewed
 * version rather than whatever happens to be on the mod's branch tip.
 *
 * Unlike {@link includeCampaign}, this does not require a `base` remote; it
 * adds (or reuses) a remote for the source's fork `repoUrl`.
 *
 * The current mod's `ebr-mod.json` and the source's are both rooted at the
 * repo root, so merging two distinct mods produces a guaranteed add/add (or
 * modify/modify) conflict on the manifest. This is resolved automatically by
 * always keeping OUR manifest plus the new `includedMods` entry; the include
 * never changes the current mod's identity. Genuine content conflicts on other
 * files are left for the author to resolve by hand (manifest already staged so
 * `git merge --continue` rolls it into the merge commit).
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory.
 * @param {string} params.source - Mod id.
 * @param {object} [params.registry] - Pre-fetched browse-tier registry. Fetched
 *   anonymously when omitted (avoids a redundant fetch when the caller, e.g.
 *   `ebr update`, already has it).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ modId: string, includedEntry: object, commitHash: string, alreadyUpToDate: boolean }>}
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {IndexNotCleanError} If the index has staged changes when the workflow starts.
 * @throws {ValidationError} If `source` is malformed.
 * @throws {IncludeModNotFoundError} If the source matches no registry entry.
 * @throws {MergeConflictError} If the merge produces conflicts beyond the manifest.
 * @throws {GithubError} If the registry cannot be fetched.
 * @throws {GitError} For other git failures.
 * @throws {ManifestError} If the current manifest is missing or invalid.
 */
export async function includeMod({ dir, source, registry }, { onProgress } = {}) {
  if (!(await isRepo(dir))) {
    throw new NotARepoError(dir);
  }

  // Refuse to proceed with a dirty index, mirroring includeCampaign: bundling
  // unrelated staged work into a merge commit would silently mix concerns.
  const status = await getStatus(dir);
  if (status.staged.length > 0) {
    throw new IndexNotCleanError(status.staged);
  }

  // Read our manifest up front (before any merge can touch it). This is the
  // identity we always keep.
  const manifest = await readManifest(dir);

  onProgress?.({ step: "registry", message: "Looking up mod in the registry..." });
  const reg = registry ?? (await fetchRegistry());
  const { modId, entry: regEntry } = resolveModSource(source, reg);

  const repoUrl = regEntry.repoUrl;
  const commitHash = regEntry.commitHash;
  const remoteName = remoteNameForRepoUrl(repoUrl);

  // The registry entry is a faithful mirror of the source manifest at this
  // exact commit (publish builds it from that manifest), so it carries the
  // id/name/author/version actually being merged without a second round-trip.
  const includedEntry = {
    id: regEntry.id,
    name: regEntry.name,
    author: regEntry.author,
    version: regEntry.latestVersion,
    repoUrl,
  };
  const shortSha = commitHash.slice(0, 7);

  // Ensure a remote for the fork exists, then fetch so `commitHash` is local.
  if (!(await hasRemote(dir, remoteName))) {
    onProgress?.({ step: "remote", message: `Adding remote ${remoteName}...` });
    await addRemote(dir, remoteName, repoUrl);
  }
  onProgress?.({ step: "fetch", message: `Fetching ${remoteName}...` });
  await fetchRemote(dir, remoteName, { onProgress });

  onProgress?.({ step: "merge", message: `Merging ${shortSha}...` });
  try {
    await merge(dir, commitHash, { onProgress, noCommit: true });
  } catch (err) {
    if (err instanceof MergeConflictError) {
      // Always resolve OUR manifest: the include must not change our identity.
      // Staging it means a `git merge --continue` (for any remaining content
      // conflicts) folds the includedMods update into the merge commit.
      onProgress?.({ step: "manifest", message: "Updating includedMods..." });
      manifest.includedMods = upsertIncludedMod(manifest.includedMods, includedEntry);
      await writeManifest(dir, manifest);
      await stageFile(dir, "ebr-mod.json");

      const otherConflicts = err.conflictedFiles.filter((f) => f !== "ebr-mod.json");
      if (otherConflicts.length === 0) {
        // The manifest was the only conflict (the common case for two mods
        // off the same shell). Finalize the merge ourselves - the author
        // never sees it.
        onProgress?.({ step: "commit", message: "Committing include..." });
        await commit(dir, `Include mod ${includedEntry.id} v${includedEntry.version} at ${shortSha}`);
        return { modId: includedEntry.id, includedEntry, commitHash, alreadyUpToDate: false };
      }

      // Real content conflicts remain. Hand them to the author with the
      // manifest already resolved and staged.
      err.conflictedFiles = otherConflicts;
      err.modId = includedEntry.id;
      err.commitHash = commitHash;
      throw err;
    }
    // Any other failure: manifest untouched, merge aborts cleanly.
    throw err;
  }

  // Clean merge (re-include of an already-merged mod, or a content-only merge
  // with no manifest collision). Enforce our manifest + entry, then commit.
  onProgress?.({ step: "manifest", message: "Updating includedMods..." });
  manifest.includedMods = upsertIncludedMod(manifest.includedMods, includedEntry);
  await writeManifest(dir, manifest);
  await stageFile(dir, "ebr-mod.json");

  onProgress?.({ step: "commit", message: "Committing include..." });
  try {
    await commit(dir, `Include mod ${includedEntry.id} v${includedEntry.version} at ${shortSha}`);
    return { modId: includedEntry.id, includedEntry, commitHash, alreadyUpToDate: false };
  } catch (err) {
    if (err instanceof NothingToCommitError) {
      return { modId: includedEntry.id, includedEntry, commitHash, alreadyUpToDate: true };
    }
    throw err;
  }
}

/**
 * Walk every entry in `manifest.includedMods` and report which ones have a
 * newer published version available, using the registry as the source of
 * truth.
 *
 * For each entry: look up its id in the registry. The registry's `commitHash`
 * is checked for ancestry against HEAD (so the relevant remote is fetched
 * first). Two conditions are reported for warn-and-skip rather than treated as
 * updates:
 * - `missing: true` - the mod is no longer in the registry (delisted).
 * - `manifestAhead: true` - `includedMods[].version` is newer than the
 *   registry's published version (manifest ahead of registry, e.g. after a
 *   registry rollback).
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory (must be a git repo).
 * @param {object} [params.registry] - Pre-fetched browse-tier registry. Fetched
 *   anonymously when omitted - but only when there are included mods to check,
 *   so a mod with an empty `includedMods` never touches the network.
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ updates: Array<{ id: string, name: string, missing: boolean, manifestAhead: boolean, updateAvailable: boolean, currentVersion: string, registryVersion: string|null, repoUrl: string, commitHash: string|null }>, registry: object|null }>} The walk results plus the registry that was used (the passed-in one, the freshly fetched one, or `null` when there were no mods to check), so the caller can drive merges without fetching again.
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {GithubError} If the registry cannot be fetched.
 * @throws {ManifestError} If the manifest is missing or invalid.
 */
export async function checkIncludedModsUpdates({ dir, registry }, { onProgress } = {}) {
  if (!(await isRepo(dir))) {
    throw new NotARepoError(dir);
  }

  const manifest = await readManifest(dir);
  const entries = Array.isArray(manifest.includedMods) ? manifest.includedMods : [];

  if (entries.length === 0) {
    return { updates: [], registry: registry ?? null };
  }

  const reg = registry ?? (await fetchRegistry());
  const regById = new Map(
    (Array.isArray(reg?.mods) ? reg.mods : []).map((m) => [m.id, m]),
  );

  const updates = [];
  for (const entry of entries) {
    const regEntry = regById.get(entry.id);

    if (!regEntry) {
      updates.push({
        id: entry.id,
        name: entry.name,
        missing: true,
        manifestAhead: false,
        updateAvailable: false,
        currentVersion: entry.version,
        registryVersion: null,
        repoUrl: entry.repoUrl,
        commitHash: null,
      });
      continue;
    }

    if (compareVersions(entry.version, regEntry.latestVersion) === 1) {
      updates.push({
        id: entry.id,
        name: entry.name,
        missing: false,
        manifestAhead: true,
        updateAvailable: false,
        currentVersion: entry.version,
        registryVersion: regEntry.latestVersion,
        repoUrl: regEntry.repoUrl,
        commitHash: regEntry.commitHash,
      });
      continue;
    }

    const remoteName = remoteNameForRepoUrl(regEntry.repoUrl);
    if (!(await hasRemote(dir, remoteName))) {
      onProgress?.({ step: "remote", message: `Adding remote ${remoteName}...` });
      await addRemote(dir, remoteName, regEntry.repoUrl);
    }
    onProgress?.({ step: "fetch", message: `Fetching ${remoteName}...` });
    await fetchRemote(dir, remoteName, { onProgress });

    const upToDate = await isAncestor(dir, regEntry.commitHash, "HEAD");
    updates.push({
      id: entry.id,
      name: entry.name,
      missing: false,
      manifestAhead: false,
      updateAvailable: !upToDate,
      currentVersion: entry.version,
      registryVersion: regEntry.latestVersion,
      repoUrl: regEntry.repoUrl,
      commitHash: regEntry.commitHash,
    });
  }

  return { updates, registry: reg };
}

// --- scaffold ---

/**
 * URL of the public `ebr-mod-scaffold` repo. Cloned anonymously over HTTPS;
 * no fork or authentication is required because scaffolds are templates and
 * the repo is read-only from the tool's perspective.
 */
const SCAFFOLD_REPO_URL = "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-scaffold.git";

/**
 * Substitute the scaffold name token in a path with the mod's name.
 * Operates on POSIX-style paths (`/` separator); callers convert as needed.
 *
 * @param {string} relPath
 * @param {string} modName
 * @returns {string}
 */
function substituteScaffoldPath(relPath, modName) {
  return relPath.split(SCAFFOLD_NAME_TOKEN).join(modName);
}

/**
 * Look up the scaffold's product in the catalog and return it if it is not
 * already present in the manifest's `requiredProducts` or `optionalProducts`.
 * Returns `null` if the scaffold has no catalog entry (silent skip) or its
 * product is already covered by the manifest.
 *
 * @param {string} branch - Scaffold branch (e.g. "map/river-valley").
 * @param {object} manifest
 * @param {ReadonlyArray<{branch: string, product: string}>} [catalog]
 * @returns {string | null}
 */
export function computeMissingScaffoldProduct(branch, manifest, catalog = KNOWN_SCAFFOLDS) {
  const entry = Array.isArray(catalog)
    ? catalog.find((s) => s && s.branch === branch)
    : null;
  if (!entry || typeof entry.product !== "string") return null;
  const have = new Set([
    ...(Array.isArray(manifest.requiredProducts) ? manifest.requiredProducts : []),
    ...(Array.isArray(manifest.optionalProducts) ? manifest.optionalProducts : []),
  ]);
  if (have.has(entry.product)) return null;
  return entry.product;
}

/**
 * Stamp a scaffold template branch into the mod's working tree.
 *
 * Clones `ebr-mod-scaffold` shallowly at the target branch, substitutes the
 * mod's `name` field into `__MOD_NAME__` path placeholders, copies the tree
 * into the working directory, stages the changes, and commits with the
 * branch name. Manifest reconciliation against the scaffold's product
 * requirements (if any) is the caller's responsibility -- see
 * {@link computeMissingScaffoldProduct}.
 *
 * Scaffolds are one-shot copies: no manifest tracking (`includedScaffolds`
 * does not exist), no update path. The commit message records the branch
 * so creators can grep history for stamps they applied.
 *
 * Files that already exist in the working tree are skipped (not overwritten).
 * The caller is notified via `onProgress` with step `"conflict"` and can
 * surface the warning to the user. If ALL scaffold files conflict, throws
 * {@link NothingToCommitError}.
 *
 * @param {object} params
 * @param {string} params.dir - Mod directory.
 * @param {string} params.source - Scaffold source (e.g. `map/lure-of-the-valley`).
 * @param {string} [params.scaffoldRepoUrl] - Override the scaffold repo URL (tests).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress]
 * @returns {Promise<{ branch: string, scaffoldCommitHash: string, filesAdded: number, filesSkipped: number }>}
 * @throws {ValidationError} If `source` is malformed or the manifest lacks a `name`.
 * @throws {NotARepoError} If `dir` is not a git repository.
 * @throws {IndexNotCleanError} If the index has staged changes when the workflow starts.
 * @throws {ScaffoldRefNotFoundError} If the scaffold branch cannot be cloned.
 * @throws {NothingToCommitError} If every scaffold file already exists (nothing to stamp).
 * @throws {ManifestError} If the manifest is missing or invalid.
 */
export async function includeScaffold({ dir, source, scaffoldRepoUrl = SCAFFOLD_REPO_URL }, { onProgress } = {}) {
  if (typeof source !== "string" || !source.trim()) {
    throw new ValidationError("Scaffold source must be a non-empty string.");
  }
  const branch = source.trim();

  // Precondition: dir must be a git repo. (No `base` remote requirement --
  // scaffolds are not pulled through `base`.)
  if (!(await isRepo(dir))) {
    throw new NotARepoError(dir);
  }

  // Refuse to proceed if there's any dirty *tracked* state in the working
  // tree. Staged changes get their own typed error; modifications,
  // deletions, and merge conflicts on tracked files are all reasons to
  // bail before touching the working tree. Untracked (`created`) files are
  // intentionally NOT included here -- they're handled by the destination
  // collision pre-flight below, which skips conflicting paths and warns.
  const status = await getStatus(dir);
  if (status.staged.length > 0) {
    throw new IndexNotCleanError(status.staged);
  }
  const trackedDirty = [...status.modified, ...status.deleted, ...status.conflicted];
  if (trackedDirty.length > 0) {
    const preview = trackedDirty.slice(0, 5).join(", ");
    const tail = trackedDirty.length > 5 ? `, and ${trackedDirty.length - 5} more` : "";
    throw new ValidationError(
      `Cannot stamp scaffold with uncommitted changes to tracked files (e.g. ${preview}${tail}). Run ebr save first.`,
    );
  }

  // Read manifest up front so a missing/invalid manifest fails before we
  // touch the network.
  const manifest = await readManifest(dir);
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new ValidationError(
      `Cannot stamp scaffold: ebr-mod.json is missing a "name" field. The scaffold needs a name to substitute into path placeholders.`,
    );
  }
  // Sanitize the substituted name so it can't escape the working tree via
  // path separators or `..` segments. Mod names with `/` or `\\` collapse to
  // a single safe segment; if the result is empty or `.`/`..`, refuse.
  const safeModName = sanitizePathSegment(manifest.name);
  if (!safeModName) {
    throw new ValidationError(
      `Cannot stamp scaffold: ebr-mod.json "name" field "${manifest.name}" does not contain any safe path characters.`,
    );
  }

  // Clone the scaffold branch into a temp directory.
  const tmpRoot = await mkdtemp(join(tmpdir(), "ebr-scaffold-"));
  let scaffoldCommitHash;
  let stamped = [];
  let conflicts = [];
  try {
    onProgress?.({ step: "clone", message: `Cloning scaffold ${branch}...` });
    try {
      await cloneBranchShallow(scaffoldRepoUrl, tmpRoot, branch, { onProgress });
    } catch (err) {
      // Branch-not-found is the common user mistake; map it to the typed
      // error so the CLI can render a focused hint. Anything else (network
      // failure, bad URL, auth, local git problem) is left as a GitError so
      // the user sees the underlying message rather than a misleading
      // "branch not found" claim.
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("remote branch") && msg.includes("not found")) {
        throw new ScaffoldRefNotFoundError(branch, scaffoldRepoUrl);
      }
      if (msg.includes("couldn't find remote ref") || msg.includes("could not find remote ref")) {
        throw new ScaffoldRefNotFoundError(branch, scaffoldRepoUrl);
      }
      throw err;
    }

    onProgress?.({ step: "resolve", message: `Resolving ${branch}...` });
    scaffoldCommitHash = await revparseRef(tmpRoot, "HEAD");

    // Enumerate files, applying path substitution.
    onProgress?.({ step: "plan", message: "Planning scaffold stamp..." });
    const sourceFiles = await listFilesRecursive(tmpRoot, {
      skipFiles: SCAFFOLD_SKIP_FILES,
      skipDotTopLevel: true,
    });
    stamped = sourceFiles.map((rel) => ({
      src: rel,
      dest: substituteScaffoldPath(rel, safeModName),
    }));

    // Resolve every destination to an absolute path and assert it stays
    // under `dir`. This is a defense in depth on top of the
    // sanitizePathSegment() check on `manifest.name`: even with a clean
    // name, a scaffold authored upstream that contains `..` segments in its
    // own paths -- or an intermediate symlink in the working tree -- must
    // not be allowed to escape it.
    const dirReal = await realPathSafe(dir);
    for (const { dest } of stamped) {
      const absDest = join(dir, ...dest.split("/"));
      const realDest = await realPathOfDestination(absDest);
      if (!isPathInside(realDest, dirReal)) {
        throw new ValidationError(
          `Scaffold path "${dest}" resolves outside the mod directory. Refusing to stamp.`,
        );
      }
    }

    // Pre-flight: detect destinations that already exist. Rather than
    // aborting the entire stamp, skip conflicting files and warn the caller
    // so the remaining scaffold content can still land.
    for (const { dest } of stamped) {
      const absDest = join(dir, ...dest.split("/"));
      try {
        await stat(absDest);
        conflicts.push(dest);
      } catch (err) {
        if (err && err.code !== "ENOENT") {
          // A stat failure that isn't "missing" (e.g. EACCES, ENOTDIR on a
          // path through a regular file) is a real problem; surface it
          // rather than treating the path as safe to write.
          throw err;
        }
        // ENOENT means the path is free to write.
      }
    }
    if (conflicts.length > 0) {
      onProgress?.({ step: "conflict", message: `Skipping ${conflicts.length} file(s) that already exist`, paths: conflicts });
      stamped = stamped.filter(({ dest }) => !conflicts.includes(dest));
    }
    if (stamped.length === 0) {
      throw new NothingToCommitError();
    }

    // Copy files into the working tree.
    onProgress?.({ step: "copy", message: `Copying ${stamped.length} file(s)...` });
    for (const { src, dest } of stamped) {
      const absSrc = join(tmpRoot, ...src.split("/"));
      const absDest = join(dir, ...dest.split("/"));
      await mkdir(dirname(absDest), { recursive: true });
      const data = await readFile(absSrc);
      await writeFile(absDest, data);
    }
  } finally {
    // Always clean up the temp clone, even on failure.
    try {
      await rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup -- ignore failures (e.g. Windows file locks).
    }
  }

  // Stage exactly the files we wrote. Avoids `stageByExtensions(dir, ...)`
  // because that would also pick up any unrelated unstaged file the
  // working tree might have, even though we required a clean tree above
  // (race conditions and editor temp files are still possible).
  onProgress?.({ step: "stage", message: "Staging scaffold files..." });
  for (const { dest } of stamped) {
    await stageFile(dir, dest);
  }

  // Commit. The stamp normally produces at least one new file. The narrow
  // exception is a scaffold branch whose entire content matches
  // SCAFFOLD_SKIP_FILES (only README.md / .gitkeep, etc.); in that case
  // every entry is filtered out, the copy and stage loops are no-ops, and
  // commit() throws NothingToCommitError, which the CLI surfaces as a
  // generic git error.
  onProgress?.({ step: "commit", message: "Committing scaffold..." });
  await commit(dir, `Add ${branch}`);

  return {
    branch,
    scaffoldCommitHash,
    filesAdded: stamped.length,
    filesSkipped: conflicts.length,
  };
}

