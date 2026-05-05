import { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import { includeCampaign } from "../core/workflows.js";
import { OFFICIAL_CAMPAIGNS } from "../core/catalogs.js";
import {
  ManifestError,
  ManifestNotFoundError,
  GitError,
  NotARepoError,
  MergeConflictError,
  BaseRemoteMissingError,
  IncludeRefNotFoundError,
  IndexNotCleanError,
  ValidationError,
} from "../core/errors.js";

export const includeCommand = new Command("include")
  .description("Include one or more official campaign branches into the current mod")
  .argument("[source]", "Campaign id (e.g. 'lure-of-the-valley') or 'campaign/<id>'. Omit to pick from a checklist.")
  .action(includeAction);

async function includeAction(source) {
  const dir = process.cwd();

  // Resolve sources: either the explicit positional arg, or a multi-select prompt.
  let sources;
  if (source) {
    sources = [source];
  } else {
    const selected = await checkbox({
      message: "Select campaigns to include (space to toggle, enter to confirm):",
      choices: OFFICIAL_CAMPAIGNS.map((c) => ({
        name: c.oneDayMission ? `${c.name} (one-day mission)` : c.name,
        value: c.id,
      })),
    });
    if (selected.length === 0) {
      console.log("No campaigns selected.");
      return;
    }
    sources = selected;
  }

  const onProgress = (p) => console.log(p.message);
  const completed = [];

  for (let i = 0; i < sources.length; i++) {
    const current = sources[i];
    if (sources.length > 1) {
      console.log(`\n=== Including ${current} (${i + 1}/${sources.length}) ===`);
    }

    try {
      const result = await includeCampaign({ dir, source: current }, { onProgress });

      if (result.alreadyUpToDate) {
        console.log(`\n${result.branch} is already up to date at ${result.commitHash.slice(0, 7)}.`);
      } else {
        console.log(`\nMerged ${result.branch} at ${result.commitHash.slice(0, 7)}.`);
        console.log("Recorded in includedCampaigns.");
      }
      completed.push(current);
    } catch (err) {
      const remaining = sources.slice(i + 1);
      handleIncludeError(err);
      if (sources.length > 1) {
        printMultiSummary(completed, current, remaining);
      }
      return;
    }
  }

  if (sources.length > 1) {
    console.log(`\nIncluded ${completed.length} campaign(s). Review the changes and run \`ebr save\` when ready.`);
  } else if (completed.length === 1) {
    console.log("\nReview the changes and run `ebr save` when ready.");
  }
}

/**
 * Map a typed error to user-facing output and set process.exitCode.
 * Returns nothing; caller decides whether to continue or abort.
 */
function handleIncludeError(err) {
  if (err instanceof ValidationError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
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
    console.error("\nCommit them with `ebr save` (or unstage with `git reset`) before including a campaign.");
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

function printMultiSummary(completed, failedAt, remaining) {
  console.error("\n--- Summary ---");
  if (completed.length > 0) {
    console.error(`Included: ${completed.join(", ")}`);
  }
  console.error(`Failed at: ${failedAt}`);
  if (remaining.length > 0) {
    console.error(`Skipped: ${remaining.join(", ")}`);
    console.error("Re-run `ebr include` for the remaining campaigns once the failure is resolved.");
  }
}
