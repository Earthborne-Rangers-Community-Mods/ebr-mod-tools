import { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import { includeCampaign, includeMod, classifyIncludeSource } from "../core/workflows.js";
import { fetchRegistry } from "../core/registry.js";
import { OFFICIAL_CAMPAIGNS } from "../core/catalogs.js";
import { renderCliError } from "./render-error.js";
import {
  IncludeRefNotFoundError,
  IncludeModNotFoundError,
} from "../core/errors.js";

export const includeCommand = new Command("include")
  .description("Include an official campaign branch or another mod into the current mod")
  .argument("[sources...]", "Campaign id(s) (e.g. 'lure-of-the-valley'), or mod id(s). Omit to pick campaigns from a checklist.")
  .action(includeAction);

async function includeAction(sourcesArg) {
  const dir = process.cwd();

  // commander gives an empty array when no positional args were passed.
  const passed = Array.isArray(sourcesArg) ? sourcesArg : (sourcesArg ? [sourcesArg] : []);

  // Resolve sources: explicit positional args, or a multi-select prompt.
  // The interactive picker is for campaigns-only - mods are too numerous to
  // enumerate without a registry round-trip, so they must be named explicitly.
  let sources;
  if (passed.length > 0) {
    sources = passed;
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

  // The browse-tier registry is fetched once, lazily, the first time a mod
  // source appears - campaign-only runs never touch the network for it.
  let registry;

  for (let i = 0; i < sources.length; i++) {
    const current = sources[i];
    if (sources.length > 1) {
      console.log(`\n=== Including ${current} (${i + 1}/${sources.length}) ===`);
    }

    try {
      if (classifyIncludeSource(current) === "mod") {
        if (!registry) {
          console.log("Fetching registry...");
          registry = await fetchRegistry();
        }
        const result = await includeMod({ dir, source: current, registry }, { onProgress });
        if (result.alreadyUpToDate) {
          console.log(`\n${result.modId} is already included at ${result.commitHash.slice(0, 7)}.`);
        } else {
          console.log(`\nIncluded mod ${result.modId} v${result.includedEntry.version} at ${result.commitHash.slice(0, 7)}.`);
          console.log("Recorded in includedMods.");
        }
      } else {
        const result = await includeCampaign({ dir, source: current }, { onProgress });
        if (result.alreadyUpToDate) {
          console.log(`\n${result.branch} is already up to date at ${result.commitHash.slice(0, 7)}.`);
        } else {
          console.log(`\nMerged ${result.branch} at ${result.commitHash.slice(0, 7)}.`);
          console.log("Recorded in includedCampaigns.");
        }
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
    console.log(`\nIncluded ${completed.length} item(s). Review the changes and run \`ebr save\` when ready.`);
  } else if (completed.length === 1) {
    console.log("\nReview the changes and run `ebr save` when ready.");
  }
}

/**
 * Map a typed error to user-facing output and set process.exitCode.
 * Returns nothing; caller decides whether to continue or abort.
 */
function handleIncludeError(err) {
  if (err instanceof IncludeModNotFoundError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (err instanceof IncludeRefNotFoundError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (renderCliError(err, { command: "ebr include" })) {
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
    console.error("Re-run `ebr include` for the remaining items once the failure is resolved.");
  }
}
