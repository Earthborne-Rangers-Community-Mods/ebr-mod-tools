/**
 * Git operations wrapper using simple-git.
 */

import simpleGit from "simple-git";
import { GitError, NotARepoError, GitAuthenticationError, MergeConflictError, NothingToCommitError, DirtyWorkingTreeError } from "./errors.js";

/**
 * Build a human-readable message from a simple-git progress event.
 * @param {string} method - Git method name (e.g. "clone", "fetch").
 * @param {string} stage - Progress stage (e.g. "receiving", "resolving").
 * @param {number} percent - Completion percentage (0-100).
 * @returns {string}
 */
function progressMessage(method, stage, percent) {
  return `${method}: ${stage} ${percent}%`;
}

/**
 * Create a simple-git instance for a directory.
 * @param {string} dir
 */
function git(dir, { onProgress } = {}) {
  const options = { baseDir: dir };
  if (onProgress) {
    options.progress = ({ method, stage, progress }) => {
      onProgress({ step: method, message: progressMessage(method, stage, progress), stage, percent: progress });
    };
  }
  return simpleGit(options);
}

/**
 * Recognize whether a git error message is an authentication/authorization
 * failure (bad or missing credentials, expired token, no push permission),
 * across both HTTPS (Git Credential Manager) and SSH transports.
 * @param {string} message
 * @returns {boolean}
 */
export function isGitAuthError(message) {
  if (!message) return false;
  return [
    /authentication failed/i,
    /invalid username or password/i,
    /support for password authentication was removed/i,
    /could not read (username|password)/i,
    /terminal prompts disabled/i,
    /permission denied \(publickey\)/i,
    /remote: permission to .+ denied/i,
    /the requested url returned error: 40[13]/i,
  ].some((re) => re.test(message));
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

  if (isGitAuthError(msg)) {
    return new GitAuthenticationError(operation, msg);
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
      onProgress({ step: method, message: progressMessage(method, stage, progress), stage, percent: progress });
    } : undefined }).clone(url, dir);
  } catch (err) {
    throw wrapError("clone", err);
  }
}

/**
 * Clone a single branch of a remote repository at depth 1.
 *
 * Used for scaffold template fetches where we want only the latest tree of
 * one branch and have no use for history. Fails if the branch does not exist
 * on the remote.
 *
 * @param {string} url - Remote URL to clone.
 * @param {string} dir - Target directory.
 * @param {string} branch - Branch name to fetch (e.g. "map/river-valley").
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback.
 */
export async function cloneBranchShallow(url, dir, branch, { onProgress } = {}) {
  try {
    const progressOpt = onProgress ? ({ method, stage, progress }) => {
      onProgress({ step: method, message: progressMessage(method, stage, progress), stage, percent: progress });
    } : undefined;
    await simpleGit({ progress: progressOpt }).clone(url, dir, [
      "--branch", branch,
      "--single-branch",
      "--depth", "1",
    ]);
  } catch (err) {
    throw wrapError("cloneBranchShallow", err);
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
    // Use .raw() because simple-git's .fetch(remote, options) silently drops
    // the remote name when no branch is provided (v3.35.2 bug).
    await git(dir, { onProgress }).raw(["fetch", remoteName, "--tags"]);
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
 * @param {boolean} [options.force] - Pass `--force` (used for publish branches).
 * @param {function} [options.onProgress] - Progress callback.
 */
export async function push(dir, { remote, branch, force = false, onProgress } = {}) {
  try {
    const g = git(dir, { onProgress });
    const opts = force ? ["--force"] : undefined;
    if (remote && branch) {
      await g.push(remote, branch, opts);
    } else if (remote) {
      await g.push(remote, undefined, opts);
    } else {
      await g.push(opts);
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
 * @param {boolean} [options.noCommit] - If true, pass `--no-commit --no-ff` so
 *   the merge result lands in the index without auto-committing. Lets the
 *   caller stage additional changes before producing the merge commit and
 *   ensures a conflict-resolution `git merge --continue` includes them.
 * @throws {MergeConflictError} If the merge results in conflicts.
 */
export async function merge(dir, ref, { onProgress, noCommit = false } = {}) {
  try {
    onProgress?.({ step: "merge", message: `Merging ${ref}...` });
    const args = noCommit ? ["--no-commit", "--no-ff", ref] : [ref];
    await git(dir).merge(args);
  } catch (err) {
    const msg = err?.message || String(err);

    // Detect "local changes would be overwritten by merge" before checking
    // for conflicts -- git aborts before starting the merge in this case.
    if (msg.includes("would be overwritten by merge")) {
      // Git indents file paths with a tab; message lines are flush-left.
      const files = msg
        .split("\n")
        .filter((l) => /^\s+\S/.test(l))
        .map((l) => l.trim());
      throw new DirtyWorkingTreeError(files);
    }

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
 * @returns {Promise<{isClean: boolean, modified: string[], staged: string[], conflicted: string[], created: string[], deleted: string[]}>}
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
      deleted: status.deleted,
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
 * Check whether `ancestor` is an ancestor commit of `descendant`.
 * Uses `git merge-base --is-ancestor` semantics.
 * Returns false if either ref does not resolve.
 *
 * @param {string} dir
 * @param {string} ancestor - Ref expected to be an ancestor (e.g. a tag).
 * @param {string} descendant - Ref expected to be the descendant (e.g. "HEAD").
 * @returns {Promise<boolean>}
 */
export async function isAncestor(dir, ancestor, descendant) {
  try {
    // simple-git .raw() doesn't throw on exit code 1, so we can't rely on
    // --is-ancestor's exit code.  Instead, compute the merge-base and check
    // whether it resolves to the same commit as `ancestor`.
    const g = git(dir);
    const [mergeBase, ancestorSha] = await Promise.all([
      g.raw(["merge-base", ancestor, descendant]),
      g.raw(["rev-parse", "--verify", ancestor]),
    ]);
    return mergeBase.trim() === ancestorSha.trim();
  } catch {
    return false;
  }
}

/**
 * Find the common ancestor of two refs. Returns the merge-base SHA, or
 * `null` if the two refs share no history (independent root commits).
 *
 * @param {string} dir
 * @param {string} refA
 * @param {string} refB
 * @returns {Promise<string|null>}
 */
export async function mergeBase(dir, refA, refB) {
  try {
    const out = await git(dir).raw(["merge-base", refA, refB]);
    const sha = out.trim();
    return sha || null;
  } catch {
    // `git merge-base` exits non-zero when there is no common ancestor.
    return null;
  }
}

/**
 * Resolve a ref (branch, tag, or commit) to its full 40-character SHA.
 * Throws GitError if the ref cannot be resolved.
 *
 * @param {string} dir
 * @param {string} ref - Any ref (e.g. "base/main", "HEAD~1", "v1.0.0").
 * @returns {Promise<string>}
 */
export async function revparseRef(dir, ref) {
  try {
    const sha = await git(dir).raw(["rev-parse", "--verify", `${ref}^{commit}`]);
    return sha.trim();
  } catch (err) {
    throw wrapError("revparseRef", err);
  }
}

/**
 * Stage a single file by path (relative to the repo root).
 * @param {string} dir
 * @param {string} relativePath
 */
export async function stageFile(dir, relativePath) {
  try {
    await git(dir).add([relativePath]);
  } catch (err) {
    throw wrapError("stageFile", err);
  }
}

/**
 * Unstage a single file (remove it from the index, leaving the working tree
 * unchanged). Equivalent to `git reset HEAD -- <path>`. Works for both
 * previously-tracked files (which become "modified") and files staged for the
 * first time (which become "untracked").
 * @param {string} dir
 * @param {string} relativePath
 */
export async function unstageFile(dir, relativePath) {
  try {
    await git(dir).raw(["reset", "HEAD", "--", relativePath]);
  } catch (err) {
    throw wrapError("unstageFile", err);
  }
}

/**
 * Undo the most recent commit on the current branch. Equivalent to
 * `git reset --mixed HEAD~1`: the commit is removed from history, the index
 * is reset to match the new HEAD, and the working tree is left alone.
 * Use to roll back a commit while preserving any unstaged user changes.
 * @param {string} dir
 */
export async function undoLastCommit(dir) {
  try {
    await git(dir).raw(["reset", "--mixed", "HEAD~1"]);
  } catch (err) {
    throw wrapError("undoLastCommit", err);
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
 * Check whether a remote repository is reachable.
 *
 * Runs `git ls-remote <url> HEAD`, which reads public repositories without any
 * credential and needs no local repo context. Returns `true` when the remote
 * is visible, `false` on any failure (missing, private-without-auth, network,
 * bad URL). A `true` result confirms the repo exists and is visible; it does
 * not by itself prove push access.
 *
 * @param {string} url - HTTPS clone URL (or any git-reachable path).
 * @returns {Promise<boolean>}
 */
export async function remoteExists(url) {
  try {
    await simpleGit().listRemote([url, "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a lightweight tag at the current HEAD.
 * @param {string} dir
 * @param {string} tagName - Tag name (e.g. "v1.2.3").
 */
export async function createTag(dir, tagName) {
  try {
    await git(dir).tag([tagName]);
  } catch (err) {
    throw wrapError("createTag", err);
  }
}

/**
 * Create or reset a branch to a start point and check it out.
 * Equivalent to `git checkout -B <branch> <startPoint>`: creates the branch if
 * it does not exist, or force-moves it onto `startPoint` if it does.
 * @param {string} dir
 * @param {string} branch - Branch name.
 * @param {string} startPoint - Ref to point the branch at (e.g. "upstream/main").
 */
export async function checkoutResetBranch(dir, branch, startPoint) {
  try {
    await git(dir).raw(["checkout", "-B", branch, startPoint]);
  } catch (err) {
    throw wrapError("checkoutResetBranch", err);
  }
}

/**
 * Set the URL of an existing remote (`git remote set-url`).
 * @param {string} dir
 * @param {string} name - Remote name.
 * @param {string} url - New URL.
 */
export async function setRemoteUrl(dir, name, url) {
  try {
    await git(dir).remote(["set-url", name, url]);
  } catch (err) {
    throw wrapError("setRemoteUrl", err);
  }
}

/**
 * Discard all local changes and untracked files, returning the working tree to
 * a pristine state (`git reset --hard` + `git clean -fd`).
 * @param {string} dir
 */
export async function resetHardAndClean(dir) {
  try {
    await git(dir).raw(["reset", "--hard"]);
    await git(dir).raw(["clean", "-fd"]);
  } catch (err) {
    throw wrapError("resetHardAndClean", err);
  }
}
