/**
 * Git operations wrapper using simple-git.
 */

import simpleGit from "simple-git";
import { GitError, NotARepoError, MergeConflictError, NothingToCommitError } from "./errors.js";

/**
 * Create a simple-git instance for a directory.
 * @param {string} dir
 */
function git(dir, { onProgress } = {}) {
  const options = { baseDir: dir };
  if (onProgress) {
    options.progress = ({ method, stage, progress }) => {
      onProgress({ step: method, stage, percent: progress });
    };
  }
  return simpleGit(options);
}

/**
 * Wrap a simple-git error into a typed GitError (or subclass).
 * Checks for known error patterns and throws the appropriate subclass.
 */
function wrapError(operation, err) {
  const msg = err?.message || String(err);

  if (msg.includes("not a git repository")) {
    return new NotARepoError(msg);
  }

  return new GitError(operation, msg);
}

/**
 * Check if a directory is a git repository.
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function isRepo(dir) {
  try {
    return await git(dir).checkIsRepo();
  } catch (err) {
    throw wrapError("isRepo", err);
  }
}

/**
 * Clone a remote repository into a target directory.
 * @param {string} url - Remote URL to clone.
 * @param {string} dir - Target directory.
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback.
 */
export async function cloneRepo(url, dir, { onProgress } = {}) {
  try {
    await simpleGit({ progress: onProgress ? ({ method, stage, progress }) => {
      onProgress({ step: method, stage, percent: progress });
    } : undefined }).clone(url, dir);
  } catch (err) {
    throw wrapError("clone", err);
  }
}

/**
 * Create a new local branch and check it out.
 * @param {string} dir
 * @param {string} branch - Branch name to create.
 * @param {string} [startPoint] - Ref to branch from (defaults to HEAD).
 */
export async function createLocalBranch(dir, branch, startPoint) {
  try {
    const args = [branch];
    if (startPoint) args.push(startPoint);
    await git(dir).checkoutBranch(branch, startPoint || "HEAD");
  } catch (err) {
    throw wrapError("createLocalBranch", err);
  }
}

/**
 * Check out an existing branch.
 * @param {string} dir
 * @param {string} branch - Branch name to check out.
 */
export async function checkout(dir, branch) {
  try {
    await git(dir).checkout(branch);
  } catch (err) {
    throw wrapError("checkout", err);
  }
}

/**
 * Set the upstream tracking branch for the current branch.
 * @param {string} dir
 * @param {string} remote - Remote name (e.g., "origin").
 * @param {string} branch - Remote branch name.
 */
export async function setUpstreamBranch(dir, remote, branch) {
  try {
    await git(dir).branch(["--set-upstream-to", `${remote}/${branch}`]);
  } catch (err) {
    throw wrapError("setUpstreamBranch", err);
  }
}

/**
 * Initialize a new git repository.
 * Safe to call on an existing repo (no-op).
 * @param {string} dir
 */
export async function initRepo(dir) {
  try {
    await git(dir).init();
  } catch (err) {
    throw wrapError("init", err);
  }
}

/**
 * Add a named remote to the repository.
 * @param {string} dir
 * @param {string} name - Remote name (e.g., "origin", "base").
 * @param {string} url - Remote URL.
 */
export async function addRemote(dir, name, url) {
  try {
    await git(dir).addRemote(name, url);
  } catch (err) {
    throw wrapError("addRemote", err);
  }
}

/**
 * Check if a remote with the given name exists.
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function hasRemote(dir, name) {
  const remotes = await getRemotes(dir);
  return remotes.some((r) => r.name === name);
}

/**
 * List all remotes in the repository.
 * @param {string} dir
 * @returns {Promise<Array<{name: string, refs: {fetch: string, push: string}}>>}
 */
export async function getRemotes(dir) {
  try {
    return await git(dir).getRemotes(true);
  } catch (err) {
    throw wrapError("getRemotes", err);
  }
}

/**
 * Fetch from a named remote.
 * @param {string} dir
 * @param {string} remoteName
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback.
 */
export async function fetchRemote(dir, remoteName, { onProgress } = {}) {
  try {
    await git(dir, { onProgress }).fetch(remoteName, { "--tags": null });
  } catch (err) {
    throw wrapError("fetch", err);
  }
}

/**
 * Stage all changes (git add -A).
 * @param {string} dir
 */
export async function stageAll(dir) {
  try {
    await git(dir).add("-A");
  } catch (err) {
    throw wrapError("stageAll", err);
  }
}

/**
 * Stage changes filtered by extension: new/modified files must match the
 * allowlist, but deletions are always staged (so bad files can be cleaned up).
 * @param {string} dir
 * @param {string[]} extensions - Array of extensions including the dot (e.g. [".md", ".json"]).
 */
export async function stageByExtensions(dir, extensions) {
  try {
    const extSet = new Set(extensions.map(e => e.toLowerCase()));
    const status = await git(dir).status();

    const hasAllowedExt = (f) => {
      const dot = f.lastIndexOf(".");
      return dot !== -1 && extSet.has(f.substring(dot).toLowerCase());
    };

    // New and modified files: filter by allowed extensions
    const addOrModify = [
      ...status.not_added.filter(hasAllowedExt),
      ...status.modified.filter(hasAllowedExt),
    ];

    // Deletions: always stage (lets creators clean up bad files)
    const deletions = status.deleted;

    const toStage = [...addOrModify, ...deletions];
    if (toStage.length > 0) {
      await git(dir).add(toStage);
    }
  } catch (err) {
    throw wrapError("stageByExtensions", err);
  }
}

/**
 * Commit staged changes.
 * @param {string} dir
 * @param {string} message - Commit message.
 * @throws {NothingToCommitError} If working tree is clean.
 */
export async function commit(dir, message) {
  try {
    const result = await git(dir).commit(message);
    // simple-git returns a CommitResult; if nothing was committed, summary is empty
    if (!result.commit) {
      throw new NothingToCommitError();
    }
    return result;
  } catch (err) {
    if (err instanceof NothingToCommitError) {
      throw err;
    }
    const msg = err?.message || String(err);
    if (msg.includes("nothing to commit") || msg.includes("nothing added to commit")) {
      throw new NothingToCommitError();
    }
    throw wrapError("commit", err);
  }
}

/**
 * Push to a remote.
 * @param {string} dir
 * @param {object} [options]
 * @param {string} [options.remote] - Remote name (e.g., "origin").
 * @param {string} [options.branch] - Branch name to push.
 * @param {function} [options.onProgress] - Progress callback.
 */
export async function push(dir, { remote, branch, onProgress } = {}) {
  try {
    const g = git(dir, { onProgress });
    if (remote && branch) {
      await g.push(remote, branch);
    } else if (remote) {
      await g.push(remote);
    } else {
      await g.push();
    }
  } catch (err) {
    throw wrapError("push", err);
  }
}

/**
 * Get the HEAD commit SHA-1 hash.
 * @param {string} dir
 * @returns {Promise<string>} 40-character hex SHA.
 */
export async function getHeadCommit(dir) {
  try {
    const sha = await git(dir).revparse(["HEAD"]);
    return sha.trim();
  } catch (err) {
    throw wrapError("getHeadCommit", err);
  }
}

/**
 * Get the current branch name.
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function getCurrentBranch(dir) {
  try {
    const result = await git(dir).branchLocal();
    return result.current;
  } catch (err) {
    throw wrapError("getCurrentBranch", err);
  }
}

/**
 * Merge a ref (branch, tag, or commit) into the current branch.
 * @param {string} dir
 * @param {string} ref - The ref to merge (e.g., "feature", "base/main").
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback.
 * @throws {MergeConflictError} If the merge results in conflicts.
 */
export async function merge(dir, ref, { onProgress } = {}) {
  try {
    onProgress?.({ step: "merge", stage: `Merging ${ref}` });
    await git(dir).merge([ref]);
  } catch (err) {
    // Check if the failure is due to merge conflicts
    const status = await git(dir).status();
    if (status.conflicted.length > 0) {
      throw new MergeConflictError(status.conflicted);
    }
    throw wrapError("merge", err);
  }
}

/**
 * Abort an in-progress merge.
 * @param {string} dir
 */
export async function abortMerge(dir) {
  try {
    await git(dir).merge(["--abort"]);
  } catch (err) {
    throw wrapError("abortMerge", err);
  }
}

/**
 * Get the working tree status.
 * @param {string} dir
 * @returns {Promise<{isClean: boolean, modified: string[], staged: string[], conflicted: string[], created: string[]}>}
 */
export async function getStatus(dir) {
  try {
    const status = await git(dir).status();
    return {
      isClean: status.isClean(),
      modified: status.modified,
      staged: status.staged,
      conflicted: status.conflicted,
      created: status.not_added,
    };
  } catch (err) {
    throw wrapError("getStatus", err);
  }
}

/**
 * Check how many commits the current branch is ahead/behind its upstream tracking branch.
 * Returns null if there's no tracking branch configured (e.g., never pushed).
 * @param {string} dir
 * @param {string} [remote="origin"] - Remote name to check against.
 * @returns {Promise<{ahead: number, behind: number, trackingBranch: string}|null>}
 */
export async function getAheadBehind(dir, remote = "origin") {
  try {
    const branch = await getCurrentBranch(dir);
    const trackingBranch = `${remote}/${branch}`;
    // Verify the remote ref exists
    const result = await git(dir).raw(["rev-list", "--left-right", "--count", `${trackingBranch}...HEAD`]);
    const [behind, ahead] = result.trim().split(/\s+/).map(Number);
    return { ahead, behind, trackingBranch };
  } catch {
    // No tracking branch or remote ref doesn't exist
    return null;
  }
}

/**
 * Get the latest tag by version sort.
 * Returns null if no tags exist.
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
export async function getLatestTag(dir) {
  try {
    const result = await git(dir).tag(["--list", "--sort=-v:refname"]);
    const tags = result.trim().split("\n").filter(Boolean);
    return tags.length > 0 ? tags[0] : null;
  } catch (err) {
    throw wrapError("getLatestTag", err);
  }
}

/**
 * Get the fetch URL for a named remote.
 * Returns null if the remote doesn't exist.
 * @param {string} dir
 * @param {string} remoteName
 * @returns {Promise<string|null>}
 */
export async function getRemoteUrl(dir, remoteName) {
  const remotes = await getRemotes(dir);
  const remote = remotes.find((r) => r.name === remoteName);
  return remote?.refs?.fetch || null;
}

/**
 * List tags from a specific remote via `git ls-remote --tags`.
 * Does not require a prior fetch - queries the remote directly.
 * @param {string} dir - Repository directory.
 * @param {string} remoteName - Remote name (e.g., "base").
 * @returns {Promise<string[]>} Array of tag names (without refs/tags/ prefix).
 */
export async function getRemoteTags(dir, remoteName) {
  try {
    const output = await git(dir).listRemote(["--tags", remoteName]);
    if (!output.trim()) return [];
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")[1])
      .filter((ref) => ref && !ref.endsWith("^{}"))
      .map((ref) => ref.replace("refs/tags/", ""));
  } catch (err) {
    throw wrapError("getRemoteTags", err);
  }
}
