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
