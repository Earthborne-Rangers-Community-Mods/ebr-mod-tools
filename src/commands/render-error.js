import {
  ManifestError,
  ManifestNotFoundError,
  GitError,
  NotARepoError,
  MergeConflictError,
  BaseRemoteMissingError,
  IndexNotCleanError,
  DirtyWorkingTreeError,
  ValidationError,
  GithubError,
} from "../core/errors.js";

/**
 * Render a shared core typed error to stderr and set process.exitCode.
 *
 * Lives in commands/ (never core/) because it owns console + process.exitCode,
 * which must not leak toward the GUI-importable core. Commands handle their own
 * command-specific errors first, then delegate the shared tail here.
 *
 * @param {unknown} err - The caught error.
 * @param {object} [opts]
 * @param {string} [opts.command] - Command name for re-run hints (e.g. "ebr include").
 * @returns {boolean} true if the error was recognized and rendered; false if the
 *   caller should rethrow. The caller sets process.exitCode on a true result.
 */
export function renderCliError(err, { command } = {}) {
  if (err instanceof ValidationError) {
    console.error(`\n${err.message}`);
    return true;
  }
  if (err instanceof ManifestNotFoundError) {
    console.error("No ebr-mod.json found in the current directory.");
    console.error("Run this command from the root of your mod.");
    return true;
  }
  if (err instanceof BaseRemoteMissingError) {
    console.error(`\n${err.message}`);
    console.error("Hint: mods scaffolded with `ebr new` add this remote automatically.");
    return true;
  }
  if (err instanceof NotARepoError) {
    console.error(`Not a git repository: ${err.dir}`);
    console.error("Run this command from the root of your mod.");
    return true;
  }
  if (err instanceof IndexNotCleanError) {
    console.error(`\n${err.message}`);
    console.error("Staged files:");
    for (const f of err.staged) {
      console.error(`  - ${f}`);
    }
    console.error(`\nCommit them with \`ebr save\` (or unstage with \`git reset\`) before continuing.`);
    return true;
  }
  if (err instanceof MergeConflictError) {
    console.error("\nMerge produced conflicts. Resolve them in Obsidian (or `git mergetool`, if you have one set up):");
    for (const f of err.conflictedFiles) {
      console.error(`  - ${f}`);
    }
    console.error("\nLook for `<<<<<<<` markers, choose which version to keep, save,");
    console.error("then run `git merge --continue` to finalize. To bail out,");
    console.error("run `git merge --abort`.");
    return true;
  }
  if (err instanceof DirtyWorkingTreeError) {
    const what = command ? `\`${command}\`` : "this command";
    console.error(`\nCannot run ${what} because you have unsaved local changes that would be overwritten.`);
    if (err.files.length > 0) {
      console.error("Files affected:");
      for (const f of err.files) {
        console.error(`  - ${f}`);
      }
    }
    console.error(`\nRun \`ebr save\` to commit your changes, then re-run ${what}.`);
    console.error("(Git-savvy? You can also stash or reset the files manually.)");
    return true;
  }
  if (err instanceof GithubError) {
    console.error(`\nCould not reach the registry: ${err.message}`);
    console.error("Check your network connection and try again.");
    return true;
  }
  if (err instanceof ManifestError) {
    console.error(`Manifest error: ${err.message}`);
    return true;
  }
  if (err instanceof GitError) {
    console.error(`Git error: ${err.message}`);
    return true;
  }
  return false;
}
