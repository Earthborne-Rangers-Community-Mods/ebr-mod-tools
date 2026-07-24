/**
 * Typed error classes for core functions.
 * CLI commands catch these and print user-friendly messages.
 * The Creator GUI catches them and shows dialogs.
 */

export class ManifestError extends Error {
  field: string;
  /**
   * @param field - Manifest field the error relates to.
   * @param message - Human-readable message.
   */
  constructor(field: string, message: string) {
    super(message);
    this.name = "ManifestError";
    this.field = field;
  }
}

export class ManifestNotFoundError extends ManifestError {
  dir: string;
  /** @param dir - Directory searched for ebr-mod.json. */
  constructor(dir: string) {
    super("file", `No ebr-mod.json found in ${dir}`);
    this.name = "ManifestNotFoundError";
    this.dir = dir;
  }
}

export class ManifestParseError extends ManifestError {
  dir: string;
  /** @param dir - Directory whose ebr-mod.json failed to parse. */
  constructor(dir: string) {
    super("file", `ebr-mod.json contains invalid JSON.`);
    this.name = "ManifestParseError";
    this.dir = dir;
  }
}

export class GitError extends Error {
  operation: string;
  /**
   * @param operation - Git operation that failed.
   * @param message - Human-readable message.
   */
  constructor(operation: string, message: string) {
    super(message);
    this.name = "GitError";
    this.operation = operation;
  }
}

export class NotARepoError extends GitError {
  dir: string;
  /** @param dir - Directory that is not a git repository. */
  constructor(dir: string) {
    super("status", `Not a git repository: ${dir}`);
    this.name = "NotARepoError";
    this.dir = dir;
  }
}

export class GitAuthenticationError extends GitError {
  /**
   * @param operation - Git operation that failed authentication.
   * @param message - Human-readable message.
   */
  constructor(operation: string, message?: string) {
    super(operation, message || "Git authentication failed.");
    this.name = "GitAuthenticationError";
  }
}

export class MergeConflictError extends GitError {
  conflictedFiles: string[];
  // Optional include-context, attached by the include workflows when a
  // merge conflict interrupts a campaign or mod include.
  campaignId?: string;
  branch?: string;
  commitHash?: string;
  modId?: string;
  /** @param conflictedFiles - Paths with merge conflicts. */
  constructor(conflictedFiles: string[]) {
    super("merge", "Merge resulted in conflicts that must be resolved manually.");
    this.name = "MergeConflictError";
    this.conflictedFiles = conflictedFiles;
    this.campaignId = undefined;
    this.branch = undefined;
    this.commitHash = undefined;
    this.modId = undefined;
  }
}

export class NothingToCommitError extends GitError {
  constructor() {
    super("commit", "Nothing to commit — working tree clean.");
    this.name = "NothingToCommitError";
  }
}

export class DirtyWorkingTreeError extends GitError {
  files: string[];
  /**
   * Thrown when a merge cannot proceed because uncommitted local changes
   * would be overwritten.
   * @param files - Paths that would be overwritten.
   */
  constructor(files: string[]) {
    super("merge", "Cannot merge because you have unsaved changes that would be overwritten.");
    this.name = "DirtyWorkingTreeError";
    this.files = files;
  }
}

export class BaseRemoteMissingError extends GitError {
  dir: string;
  /**
   * Thrown when a base-content operation runs in a repo that has no `base` remote.
   * @param dir - Repository directory.
   */
  constructor(dir: string) {
    super(
      "base-remote",
      `No "base" remote configured in ${dir}. Add one pointing to ebr-mod-base-content (e.g. via "ebr new" or "git remote add base <url>").`,
    );
    this.name = "BaseRemoteMissingError";
    this.dir = dir;
  }
}

export class UnpushedChangesError extends GitError {
  dirty: boolean;
  ahead: number;
  files: string[];
  /**
   * @param details.dirty - Working tree has uncommitted changes.
   * @param details.ahead - Commits ahead of remote.
   * @param details.files - Changed file paths (uncommitted).
   */
  constructor({ dirty, ahead, files }: { dirty: boolean; ahead: number; files: string[] }) {
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
  staged: string[];
  /**
   * Thrown when an operation that stages files into the index (e.g.
   * `ebr include`) refuses to proceed because the index already contains
   * staged changes. Bundling those into a merge commit would silently mix
   * unrelated work; the user must commit or unstage first.
   * @param staged - Paths of files already in the index.
   */
  constructor(staged: string[]) {
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
  forkBranch: string;
  baseBranch: string;
  forkUrl?: string;
  /**
   * Thrown when the user's base-content fork shares no commit history with
   * the upstream base-content repo. This happens when the upstream `main`
   * branch was rebased/rewritten after the fork was created, leaving the
   * fork on a detached history. Every campaign include from `base` will
   * fail with "unrelated histories" until the fork is reset.
   *
   * @param details.forkBranch - e.g. "origin/main".
   * @param details.baseBranch - e.g. "base/main".
   * @param details.forkUrl - HTTPS URL of the fork (optional, for the message).
   */
  constructor({ forkBranch, baseBranch, forkUrl }: { forkBranch: string; baseBranch: string; forkUrl?: string }) {
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
  ref: string;
  /**
   * Thrown when `ebr include` cannot resolve the campaign branch on the
   * `base` remote (e.g. typo in source, branch missing on the fork, or the
   * remote hasn't been fetched yet).
   * @param ref - The unresolved ref (e.g. "base/campaign/foo").
   */
  constructor(ref: string) {
    super(
      "include",
      `Could not resolve "${ref}" on the base remote. Verify the campaign id and that your fork has the campaign branch.`,
    );
    this.name = "IncludeRefNotFoundError";
    this.ref = ref;
  }
}

export class ScaffoldRefNotFoundError extends GitError {
  branch: string;
  repoUrl?: string;
  /**
   * Thrown when `ebr include <type>/<name>` cannot find the scaffold branch
   * on the `ebr-mod-scaffold` repo (e.g. typo in source, branch not yet
   * authored upstream).
   * @param branch - The unresolved scaffold branch (e.g. "map/foo").
   * @param repoUrl - The scaffold repo URL that was queried.
   */
  constructor(branch: string, repoUrl?: string) {
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
  operation: string;
  /**
   * @param operation - Config operation that failed.
   * @param message - Human-readable message.
   */
  constructor(operation: string, message: string) {
    super(message);
    this.name = "ConfigError";
    this.operation = operation;
  }
}

export class GithubError extends Error {
  operation: string;
  httpStatus: number | null;
  /**
   * @param operation - GitHub operation that failed.
   * @param message - Human-readable message.
   * @param httpStatus - HTTP status code, when applicable.
   */
  constructor(operation: string, message: string, httpStatus?: number | null) {
    super(message);
    this.name = "GithubError";
    this.operation = operation;
    this.httpStatus = httpStatus ?? null;
  }
}

export class AuthenticationError extends GithubError {
  constructor() {
    super(
      "auth",
      "GitHub authentication failed. The tools use your local git credentials - make sure you're signed in to GitHub.",
      401,
    );
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends Error {
  /** @param message - Human-readable message. */
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ModIdConflictError extends ValidationError {
  modId: string;
  existingAuthor: string;
  existingRepoUrl: string;
  /**
   * @param modId - The conflicting mod ID.
   * @param existingAuthor - The author who currently owns the ID.
   * @param existingRepoUrl - The repo URL of the existing mod.
   */
  constructor(modId: string, existingAuthor: string, existingRepoUrl: string) {
    super(
      `Mod ID "${modId}" is already claimed by "${existingAuthor}" (${existingRepoUrl}). Choose a different ID in your ebr-mod.json.`,
    );
    this.name = "ModIdConflictError";
    this.modId = modId;
    this.existingAuthor = existingAuthor;
    this.existingRepoUrl = existingRepoUrl;
  }
}

export class VersionNotHigherError extends ValidationError {
  modId: string;
  attemptedVersion: string;
  publishedVersion: string;
  /**
   * Thrown by `ebr publish` when the manifest version is not strictly higher
   * than the version already published in the registry.
   * @param modId - The mod ID being published.
   * @param attemptedVersion - The version in the local manifest.
   * @param publishedVersion - The version currently in the registry.
   */
  constructor(modId: string, attemptedVersion: string, publishedVersion: string) {
    super(
      `Version ${attemptedVersion} is not higher than the published version ${publishedVersion} for mod "${modId}". Bump the version in ebr-mod.json (e.g. via \`ebr save --bump\`) before publishing.`,
    );
    this.name = "VersionNotHigherError";
    this.modId = modId;
    this.attemptedVersion = attemptedVersion;
    this.publishedVersion = publishedVersion;
  }
}

export class IncludeModNotFoundError extends ValidationError {
  source: string;
  /**
   * Thrown when `ebr include <mod>` cannot resolve the source to a mod in the
   * public registry. Mods are included by their registry id; the registry
   * supplies the pinned `commitHash` and the fork `repoUrl` to merge from.
   * @param source - The unresolved source (mod id).
   */
  constructor(source: string) {
    super(
      `Could not find a mod matching "${source}" in the registry. Mods are included by their registry id (e.g. "ultimate-valley-experience"); verify the id is published.`,
    );
    this.name = "IncludeModNotFoundError";
    this.source = source;
  }
}
