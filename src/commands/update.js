import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { checkBaseUpdate, applyBaseUpdate } from "../core/workflows.js";
import {
  ManifestError,
  ManifestNotFoundError,
  GitError,
  NotARepoError,
  MergeConflictError,
  BaseRemoteMissingError,
} from "../core/errors.js";

export const updateCommand = new Command("update")
  .description("Check for and merge newer base content into the current mod")
  .action(updateAction);

async function updateAction() {
  const dir = process.cwd();

  try {
    const onProgress = (p) => console.log(p.message);

    const { updateAvailable } = await checkBaseUpdate({ dir }, { onProgress });

    if (!updateAvailable) {
      console.log("\nUp to date with base/main.");
      return;
    }

    console.log("\nBase content updates are available.");

    const proceed = await confirm({
      message: "Merge base/main into the current branch?",
      default: true,
    });
    if (!proceed) {
      console.log("Skipped. Run `ebr update` again when you're ready.");
      return;
    }

    await applyBaseUpdate({ dir }, { onProgress });
    console.log("\nMerged base/main. Review the changes and run `ebr save` when ready.");
  } catch (err) {
    if (err instanceof ManifestNotFoundError) {
      console.error("No ebr-mod.json found in the current directory.");
      console.error("Run this command from the root of your mod.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof BaseRemoteMissingError) {
      console.error(`\n${err.message}`);
      console.error("Hint: mods scaffolded with `ebr new` add this remote automatically.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof NotARepoError) {
      console.error(`Not a git repository: ${err.dir}`);
      console.error("Run this command from the root of your mod.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof MergeConflictError) {
      console.error("\nMerge produced conflicts. Resolve them in Obsidian (or `git mergetool`, if you have one set up):");
      for (const f of err.conflictedFiles) {
        console.error(`  - ${f}`);
      }
      console.error("\nLook for `<<<<<<<` markers, choose which version to keep, save,");
      console.error("then run `git merge --continue` to finalize. To bail out,");
      console.error("run `git merge --abort`.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof ManifestError) {
      console.error(`Manifest error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (err instanceof GitError) {
      console.error(`Git error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
