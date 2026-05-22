import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import {
  checkBaseUpdate,
  applyBaseUpdate,
  checkIncludedCampaignsUpdates,
  includeCampaign,
} from "../core/workflows.js";
import {
  ManifestError,
  ManifestNotFoundError,
  GitError,
  NotARepoError,
  MergeConflictError,
  BaseRemoteMissingError,
  IncludeRefNotFoundError,
  IndexNotCleanError,
  DirtyWorkingTreeError,
  ValidationError,
} from "../core/errors.js";

export const updateCommand = new Command("update")
  .description("Check for and merge updates from base content and included campaigns")
  .action(updateAction);

async function updateAction() {
  const dir = process.cwd();
  const onProgress = (p) => console.log(p.message);

  // Track outcomes for the final summary so the user sees what landed
  // and what they still need to deal with.
  const summary = {
    baseUpdated: false,
    baseSkipped: false,
    updated: [],
    skipped: [],
    upToDate: [],
    missing: [],
    conflicted: null, // { id, branch, files } if a conflict aborted the loop
    notAttempted: [],
  };

  try {
    // 1. Shell main
    const { updateAvailable } = await checkBaseUpdate({ dir }, { onProgress });

    if (!updateAvailable) {
      console.log("\nYour mod is up to date with the latest base content.");
    } else {
      console.log("\nA base content update is available.");
      const proceed = await confirm({
        message: "Pull the latest base content into your mod?",
        default: true,
      });
      if (proceed) {
        await applyBaseUpdate({ dir }, { onProgress });
        console.log("\nUpdated to the latest base content.");
        summary.baseUpdated = true;
      } else {
        console.log("Skipped the base content update.");
        summary.baseSkipped = true;
      }
    }

    // 2. Included campaigns
    const { updates } = await checkIncludedCampaignsUpdates({ dir }, { onProgress });

    if (updates.length === 0) {
      console.log("\nYour mod doesn't include any campaigns yet.");
      printSummary(summary);
      return;
    }

    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];

      if (u.missing) {
        console.warn(`\nCampaign "${u.id}" wasn't found in the official base content - skipping.`);
        summary.missing.push(u.id);
        continue;
      }

      if (!u.updateAvailable) {
        console.log(`\nCampaign "${u.id}" is up to date.`);
        summary.upToDate.push(u.id);
        continue;
      }

      console.log(`\nCampaign "${u.id}" has an update available.`);
      const yes = await confirm({
        message: `Pull this update into your mod?`,
        default: true,
      });
      if (!yes) {
        summary.skipped.push(u.id);
        continue;
      }

      try {
        const result = await includeCampaign(
          { dir, source: u.branch },
          { onProgress },
        );
        if (result.alreadyUpToDate) {
          summary.upToDate.push(u.id);
        } else {
          summary.updated.push(u.id);
          console.log(`Pulled in the update for "${u.id}".`);
        }
      } catch (err) {
        if (err instanceof MergeConflictError) {
          summary.conflicted = { id: u.id, branch: u.branch, files: err.conflictedFiles };
          // Process one update at a time so conflicts can be resolved
          // incrementally; everything after this is left for the next run.
          for (const remaining of updates.slice(i + 1)) {
            summary.notAttempted.push(remaining.id);
          }
          break;
        }
        // Any other error from includeCampaign: rethrow so the catch
        // block below renders consistent error output.
        throw err;
      }
    }

    printSummary(summary);

    if (summary.conflicted) {
      console.error(`\nA conflict came up while pulling in "${summary.conflicted.id}". The following files need you to pick which version to keep:`);
      for (const f of summary.conflicted.files) {
        console.error(`  - ${f}`);
      }
      console.error("\nOpen each file in Obsidian and look for the `<<<<<<<` markers.");
      console.error("Pick the version you want to keep, save the file, then run:");
      console.error("\n  git merge --continue");
      console.error("\nIf you'd rather back out and try again later, run:");
      console.error("\n  git merge --abort");
      console.error("\nOnce the conflict is resolved, run `ebr update` again to pick up any remaining campaigns.");
      process.exitCode = 1;
      return;
    }

    if (summary.baseUpdated || summary.updated.length > 0) {
      console.log("\nReview the changes and run `ebr save` when ready.");
    }
  } catch (err) {
    if (err instanceof ManifestNotFoundError) {
      console.error("No ebr-mod.json found in the current directory.");
      console.error("Run this command from the root of your mod.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof ValidationError) {
      console.error(`\n${err.message}`);
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
    if (err instanceof IncludeRefNotFoundError) {
      console.error(`\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (err instanceof IndexNotCleanError) {
      console.error(`\n${err.message}`);
      console.error("Staged files:");
      for (const f of err.staged) {
        console.error(`  - ${f}`);
      }
      console.error("\nCommit them with `ebr save` (or unstage with `git reset`) before updating.");
      process.exitCode = 1;
      return;
    }
    if (err instanceof MergeConflictError) {
      console.error("\nA conflict came up. The following files need you to pick which version to keep:");
      for (const f of err.conflictedFiles) {
        console.error(`  - ${f}`);
      }
      console.error("\nOpen each file in Obsidian and look for the `<<<<<<<` markers.");
      console.error("Pick the version you want to keep, save the file, then run:");
      console.error("\n  git merge --continue");
      console.error("\nIf you'd rather back out and try again later, run:");
      console.error("\n  git merge --abort");
      process.exitCode = 1;
      return;
    }
    if (err instanceof ManifestError) {
      console.error(`Manifest error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (err instanceof DirtyWorkingTreeError) {
      console.error("\nCannot update because you have unsaved local changes that would be overwritten.");
      if (err.files.length > 0) {
        console.error("Files affected:");
        for (const f of err.files) {
          console.error(`  - ${f}`);
        }
      }
      console.error("\nRun `ebr save` to commit your changes, then re-run `ebr update`.");
      console.error("(Git-savvy? You can also stash or reset the files manually.)");
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

function printSummary(s) {
  const lines = ["\n--- Summary ---"];
  if (s.baseUpdated) lines.push("Base content: updated");
  else if (s.baseSkipped) lines.push("Base content: skipped (update was available)");
  if (s.updated.length > 0) lines.push(`Campaigns updated: ${s.updated.join(", ")}`);
  if (s.upToDate.length > 0) lines.push(`Already up to date: ${s.upToDate.join(", ")}`);
  if (s.skipped.length > 0) lines.push(`Skipped (you said no): ${s.skipped.join(", ")}`);
  if (s.missing.length > 0) lines.push(`Skipped (not in official base content): ${s.missing.join(", ")}`);
  if (s.conflicted) lines.push(`Conflict: ${s.conflicted.id}`);
  if (s.notAttempted.length > 0) lines.push(`Not attempted (after the conflict): ${s.notAttempted.join(", ")}`);
  if (lines.length === 1) lines.push("Nothing to update.");
  console.log(lines.join("\n"));
}
