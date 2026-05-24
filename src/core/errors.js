/**
 * Typed error classes for core functions.
 * CLI commands catch these and print user-friendly messages.
 * The Creator GUI catches them and shows dialogs.
 */

export class ManifestError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "ManifestError";
    this.field = field;
  }
}

export class ManifestNotFoundError extends ManifestError {
  constructor(dir) {
    super("file", `No ebr-mod.json found in ${dir}`);
    this.name = "ManifestNotFoundError";
    this.dir = dir;
  }
}

export class ManifestParseError extends ManifestError {
  constructor(dir) {
    super("file", `ebr-mod.json contains invalid JSON.`);
    this.name = "ManifestParseError";
    this.dir = dir;
  }
}

export class GitError extends Error {
  constructor(operation, message) {
    super(message);
    this.name = "GitError";
    this.operation = operation;
  }
}

export class NotARepoError extends GitError {
  constructor(dir) {
    super("status", `Not a git repository: ${dir}`);
    this.name = "NotARepoError";
    this.dir = dir;
  }
}

export class MergeConflictError extends GitError {
  constructor(conflictedFiles) {
    super("merge", "Merge resulted in conflicts that must be resolved manually.");
    this.name = "MergeConflictError";
    this.conflictedFiles = conflictedFiles;
  }
}

export class NothingToCommitError extends GitError {
  constructor() {
    super("commit", "Nothing to commit — working tree clean.");
    this.name = "NothingToCommitError";
  }
}

export class DirtyWorkingTreeError extends GitError {
  /**
   * Thrown when a merge cannot proceed because uncommitted local changes
   * would be overwritten.
   * @param {string[]} files - Paths that would be overwritten.
   */
  constructor(files) {
    super("merge", "Cannot merge because you have unsaved changes that would be overwritten.");
    this.name = "DirtyWorkingTreeError";
    this.files = files;
  }
}

export class BaseRemoteMissingError extends GitError {
  /**
   * Thrown when a base-content operation runs in a repo that has no `base` remote.
   * @param {string} dir - Repository directory.
   */
  constructor(dir) {
    super(
      "base-remote",
      `No "base" remote configured in ${dir}. Add one pointing to ebr-mod-base-content (e.g. via "ebr new" or "git remote add base <url>").`,
    );
    this.name = "BaseRemoteMissingError";
    this.dir = dir;
  }
}

export class UnpushedChangesError extends GitError {
  /**
   * @param {object} details
   * @param {boolean} details.dirty - Working tree has uncommitted changes.
   * @param {number} details.ahead - Commits ahead of remote.
   * @param {string[]} details.files - Changed file paths (uncommitted).
   */
  constructor({ dirty, ahead, files }) {
    const parts = [];
    if (dirty) parts.push(`${files.length} uncommitted file(s)`);
    if (ahead > 0) parts.push(`${ahead} unpushed commit(s)`);
    super("publish", `Cannot publish: ${parts.join(" and ")}. Push your changes first, or use --force to publish anyway.`);
    this.name = "UnpushedChangesError";
    this.dirty = dirty;
    this.ahead = ahead;
    this.files = files;
  }
}

export class IndexNotCleanError extends GitError {
  /**
   * Thrown when an operation that stages files into the index (e.g.
   * `ebr include`) refuses to proceed because the index already contains
   * staged changes. Bundling those into a merge commit would silently mix
   * unrelated work; the user must commit or unstage first.
   * @param {string[]} staged - Paths of files already in the index.
   */
  constructor(staged) {
    const list = staged.length > 3
      ? `${staged.slice(0, 3).join(", ")}, and ${staged.length - 3} more`
      : staged.join(", ");
    super(
      "include",
      `Cannot proceed with staged changes in the index (${list}). Commit or unstage them first, then re-run.`,
    );
    this.name = "IndexNotCleanError";
    this.staged = staged;
  }
}

export class ForkOutOfSyncError extends GitError {
  /**
   * Thrown when the user's base-content fork shares no commit history with
   * the upstream base-content repo. This happens when the upstream `main`
   * branch was rebased/rewritten after the fork was created, leaving the
   * fork on a detached history. Every campaign include from `base` will
   * fail with "unrelated histories" until the fork is reset.
   *
   * @param {object} details
   * @param {string} details.forkBranch - e.g. "origin/main".
   * @param {string} details.baseBranch - e.g. "base/main".
   * @param {string} [details.forkUrl] - HTTPS URL of the fork (optional, for the message).
   */
  constructor({ forkBranch, baseBranch, forkUrl }) {
    const lines = [
      `Your fork's history (${forkBranch}) does not share any commits with upstream (${baseBranch}).`,
      "This usually means upstream rewrote its main branch after you forked.",
      "Reset your fork to upstream before continuing:",
      "",
      "  git fetch base",
      "  git checkout main",
      "  git reset --hard base/main",
      "  git push --force origin main",
    ];
    if (forkUrl) {
      lines.unshift(`Fork: ${forkUrl}`);
    }
    super("fork-out-of-sync", lines.join("\n"));
    this.name = "ForkOutOfSyncError";
    this.forkBranch = forkBranch;
    this.baseBranch = baseBranch;
    this.forkUrl = forkUrl;
  }
}

export class IncludeRefNotFoundError extends GitError {
  /**
   * Thrown when `ebr include` cannot resolve the campaign branch on the
   * `base` remote (e.g. typo in source, branch missing on the fork, or the
   * remote hasn't been fetched yet).
   * @param {string} ref - The unresolved ref (e.g. "base/campaign/foo").
   */
  constructor(ref) {
    super(
      "include",
      `Could not resolve "${ref}" on the base remote. Verify the campaign id and that your fork has the campaign branch.`,
    );
    this.name = "IncludeRefNotFoundError";
    this.ref = ref;
  }
}

export class ScaffoldRefNotFoundError extends GitError {
  /**
   * Thrown when `ebr include <type>/<name>` cannot find the scaffold branch
   * on the `ebr-mod-scaffold` repo (e.g. typo in source, branch not yet
   * authored upstream).
   * @param {string} branch - The unresolved scaffold branch (e.g. "map/foo").
   * @param {string} [repoUrl] - The scaffold repo URL that was queried.
   */
  constructor(branch, repoUrl) {
    const where = repoUrl ? ` on ${repoUrl}` : "";
    super(
      "include-scaffold",
      `Could not find scaffold branch "${branch}"${where}. Verify the scaffold name and that the branch exists upstream.`,
    );
    this.name = "ScaffoldRefNotFoundError";
    this.branch = branch;
    this.repoUrl = repoUrl;
  }
}

export class ConfigError extends Error {
  constructor(operation, message) {
    super(message);
    this.name = "ConfigError";
    this.operation = operation;
  }
}

export class GithubError extends Error {
  constructor(operation, message, httpStatus) {
    super(message);
    this.name = "GithubError";
    this.operation = operation;
    this.httpStatus = httpStatus ?? null;
  }
}

export class AuthenticationError extends GithubError {
  constructor() {
    super("auth", "GitHub authentication failed. Check your token.", 401);
    this.name = "AuthenticationError";
  }
}

export class InsufficientScopeError extends GithubError {
  constructor(operation) {
    super(
      operation,
      "Your GitHub token does not have the required permissions for this operation.",
      403,
    );
    this.name = "InsufficientScopeError";
  }
}

export class GithubFileNotFoundError extends GithubError {
  constructor(operation, path) {
    super(operation, `File not found: ${path}`, 404);
    this.name = "GithubFileNotFoundError";
    this.path = path;
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ModIdConflictError extends ValidationError {
  /**
   * @param {string} modId - The conflicting mod ID.
   * @param {string} existingAuthor - The author who currently owns the ID.
   * @param {string} existingRepoUrl - The repo URL of the existing mod.
   */
  constructor(modId, existingAuthor, existingRepoUrl) {
    super(
      `Mod ID "${modId}" is already claimed by "${existingAuthor}" (${existingRepoUrl}). Choose a different ID in your ebr-mod.json.`,
    );
    this.name = "ModIdConflictError";
    this.modId = modId;
    this.existingAuthor = existingAuthor;
    this.existingRepoUrl = existingRepoUrl;
  }
}
