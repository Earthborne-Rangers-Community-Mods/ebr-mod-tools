/**
 * High-level mod lifecycle workflows.
 *
 * Each function orchestrates a complete user action (scaffold, save, publish)
 * by composing primitives from git.js, github.js, manifest.js, and registry.js.
 * CLI commands and the Creator GUI call these directly.
 */

import { mkdir, readdir } from "node:fs/promises";
import { readManifest, writeManifest, validateManifest, formatValidationErrors, updateManifest } from "./manifest.js";
import { isRepo, initRepo, addRemote, cloneRepo, fetchRemote, createLocalBranch, checkout, setUpstreamBranch, stageAll, stageByExtensions, commit, push, getHeadCommit, getRemoteUrl, getCurrentBranch, getStatus, getAheadBehind } from "./git.js";
import {
  getFileContent,
  createOrUpdateFileContent,
  createBranch,
  updateBranchRef,
  getRefSha,
  createPullRequest,
  listPullRequests,
  getAuthenticatedUser,
  normalizeGithubUrl,
} from "./github.js";
import { ManifestError, GithubError, GithubFileNotFoundError, ModIdConflictError, UnpushedChangesError, ValidationError } from "./errors.js";
import { checkIncludedMods, buildRegistryEntry } from "./registry.js";
import { ALLOWED_EXTENSIONS } from "./catalogs.js";

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

  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, "origin/main");

  onProgress?.({ step: "manifest", message: "Writing ebr-mod.json..." });
  await writeManifest(dir, manifest);

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
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback ({ step, message }).
 * @returns {Promise<{ modDir: string, manifest: object, branch: string }>}
 * @throws {ManifestError} If directory contains unexpected files.
 */
export async function scaffoldMod({ dir, manifest, forkUrl }, { onProgress } = {}) {
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
  await addRemote(dir, "base", BASE_REPO_URL);

  // Create mod branch from main
  onProgress?.({ step: "branch", message: `Creating branch ${modBranch}...` });
  await createLocalBranch(dir, modBranch, "main");

  // Write manifest
  onProgress?.({ step: "manifest", message: "Writing ebr-mod.json..." });
  await writeManifest(dir, manifest);

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
 * 10. Create a branch in the fork from upstream's latest main.
 * 11. Write the mod file (`mods/<mod-id>.json`) to the branch.
 * 12. Open a PR (or report an existing one).
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
 * @returns {Promise<{pr: {number, url}|null, existingPr: {number, url}|null, entry: object, commitHash: string, isUpdate: boolean, includedModWarnings: Array}>}
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

  // 10. Create branch in fork from upstream's main
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

  // 11. Write mod file to the branch
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

  // 12. Open PR (or find existing one)
  onProgress?.({ step: "pr", message: "Opening pull request..." });
  const head = `${forkOwner}:${branchName}`;

  const existingPRs = await listPullRequests(token, {
    owner: registryOwner, repo: registryRepo, head, state: "open",
  });

  let pr = null;
  let existingPr = null;

  if (existingPRs.length > 0) {
    existingPr = existingPRs[0];
  } else {
    const prTitle = isUpdate
      ? `Update: ${manifest.name} v${manifest.version}`
      : `New mod: ${manifest.name} v${manifest.version}`;

    pr = await createPullRequest(token, {
      owner: registryOwner, repo: registryRepo,
      title: prTitle, body: buildPrBody(manifest, commitHash, isUpdate),
      head, base: REGISTRY_BASE_BRANCH,
    });
  }

  return { pr, existingPr, entry, commitHash, isUpdate, includedModWarnings };
}
