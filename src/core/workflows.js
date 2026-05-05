/**
 * High-level mod lifecycle workflows.
 *
 * Each function orchestrates a complete user action (scaffold, save, publish)
 * by composing primitives from git.js, github.js, manifest.js, and registry.js.
 * CLI commands and the Creator GUI call these directly.
 */

import { mkdir, readdir } from "node:fs/promises";
import { readManifest, writeManifest, validateManifest, formatValidationErrors, updateManifest } from "./manifest.js";
import { isRepo, initRepo, addRemote, cloneRepo, fetchRemote, createLocalBranch, checkout, setUpstreamBranch, stageAll, stageByExtensions, stageFile, commit, push, getHeadCommit, getRemoteUrl, getCurrentBranch, getStatus, getAheadBehind, createTag, hasRemote, isAncestor, merge, revparseRef, mergeBase } from "./git.js";
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
import { ManifestError, GithubError, GithubFileNotFoundError, ModIdConflictError, UnpushedChangesError, ValidationError, NotARepoError, BaseRemoteMissingError, InsufficientScopeError, IncludeRefNotFoundError, IndexNotCleanError, NothingToCommitError, MergeConflictError, ForkOutOfSyncError } from "./errors.js";
import { checkIncludedMods, buildRegistryEntry } from "./registry.js";
import { ALLOWED_EXTENSIONS, OFFICIAL_CAMPAIGNS } from "./catalogs.js";

// --- Constants ---

const BASE_REPO_URL = "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-base-content.git";
const DEFAULT_REGISTRY_OWNER = "Earthborne-Rangers-Community-Mods";
const DEFAULT_REGISTRY_REPO = "ebr-mod-registry";
const REGISTRY_FILE = "registry.json";
const MODS_DIR = "mods";
const REGISTRY_BASE_BRANCH = "main";

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

  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, "origin/main");

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

  // Create mod branch from main
  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, "main");

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
  const params = new URLSearchParams({ expand: "1", title, body });
  return `https://github.com/${registryOwner}/${registryRepo}/compare/${base}...${head}?${params}`;
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
 *    different author/repoUrl, abort with ModIdConflictError.
 * 9. Build the registry entry.
 * 10. Sync fork with upstream.
 * 11. Create a branch in the fork from upstream's latest main.
 * 12. Write the mod file (`mods/<mod-id>.json`) to the branch.
 * 13. Check for existing PR or build a compare URL for the user to open.
 *
 * The registry fork is assumed to already exist (set up during `ebr setup`).
 *
 * @param {object} options
 * @param {string} options.dir - Mod directory containing ebr-mod.json.
 * @param {string} options.token - GitHub personal access token.
 * @param {string} [options.registryOwner] - Upstream registry repo owner.
 * @param {string} [options.registryRepo] - Upstream registry repo name.
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message }).
 * @returns {Promise<{existingPr: {number, url}|null, compareUrl: string, entry: object, commitHash: string, isUpdate: boolean, includedModWarnings: Array}>}
 */
export async function publishMod(
  { dir, token, force = false, registryOwner = DEFAULT_REGISTRY_OWNER, registryRepo = DEFAULT_REGISTRY_REPO },
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

  const compareUrl = buildCompareUrl({
    registryOwner, registryRepo, base: REGISTRY_BASE_BRANCH,
    head: `${forkOwner}:${branchName}`,
    title: prTitle, body: buildPrBody(manifest, commitHash, isUpdate),
  });

  return { existingPr, compareUrl, entry, commitHash, isUpdate, includedModWarnings };
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

// --- includeCampaign ---

const CAMPAIGN_BRANCH_PREFIX = "campaign/";

/**
 * Resolve an `ebr include` source string into a campaign branch name.
 *
 * Accepts either a full `campaign/<id>` ref or a bare campaign id.
 *
 * @param {string} source
 * @returns {{ campaignId: string, branch: string }}
 * @throws {ValidationError} If source is empty or not a recognizable campaign reference.
 */
export function resolveCampaignSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new ValidationError("Include source must be a non-empty string.");
  }
  const trimmed = source.trim();

  let campaignId;
  if (trimmed.startsWith(CAMPAIGN_BRANCH_PREFIX)) {
    campaignId = trimmed.slice(CAMPAIGN_BRANCH_PREFIX.length);
  } else if (!trimmed.includes("/") && !trimmed.includes(":")) {
    campaignId = trimmed;
  } else {
    throw new ValidationError(
      `Unrecognized include source "${source}". Expected a campaign id (e.g. "lure-of-the-valley") or a "campaign/<id>" branch ref.`,
    );
  }

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
 * @param {string} params.source - Campaign id or `campaign/<id>` branch ref.
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
