import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import {
  checkBaseUpdate,
  applyBaseUpdate,
  checkIncludedCampaignsUpdates,
  includeCampaign,
  checkIncludedModsUpdates,
  includeMod,
} from "core/workflows.js";
import { renderCliError } from "./render-error.js";
import {
  MergeConflictError,
  IncludeRefNotFoundError,
  GithubError,
} from "core/errors.js";

export const updateCommand = new Command("update")
  .description("Check for and merge updates from base content, included campaigns, and included mods")
  .action(updateAction);

async function updateAction() {
  const dir = process.cwd();
  const onProgress = (p) => console.log(p.message);

  // Track outcomes for the final summary so the user sees what landed
  // and what they still need to deal with.
  const summary = {
    base: { updated: false, skipped: false },
    campaigns: {
      updated: [],
      skipped: [],
      upToDate: [],
      missing: [],
      notAttempted: [],
    },
    mods: {
      updated: [],
      skipped: [],
      upToDate: [],
      missing: [],
      ahead: [],
      notAttempted: [],
    },
    conflicted: null, // { id, files } if a conflict aborted either loop
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
        summary.base.updated = true;
      } else {
        console.log("Skipped the base content update.");
        summary.base.skipped = true;
      }
    }

    // 2. Included campaigns
    const { updates } = await checkIncludedCampaignsUpdates({ dir }, { onProgress });

    if (updates.length === 0) {
      console.log("\nYour mod doesn't include any campaigns.");
    } else {
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];

        if (u.missing) {
          console.warn(`\nCampaign "${u.id}" wasn't found in the official base content - skipping.`);
          summary.campaigns.missing.push(u.id);
          continue;
        }

        if (!u.updateAvailable) {
          console.log(`\nCampaign "${u.id}" is up to date.`);
          summary.campaigns.upToDate.push(u.id);
          continue;
        }

        console.log(`\nCampaign "${u.id}" has an update available.`);
        const yes = await confirm({
          message: `Pull this update into your mod?`,
          default: true,
        });
        if (!yes) {
          summary.campaigns.skipped.push(u.id);
          continue;
        }

        try {
          const result = await includeCampaign(
            { dir, source: u.branch },
            { onProgress },
          );
          if (result.alreadyUpToDate) {
            summary.campaigns.upToDate.push(u.id);
          } else {
            summary.campaigns.updated.push(u.id);
            console.log(`Pulled in the update for "${u.id}".`);
          }
        } catch (err) {
          if (err instanceof MergeConflictError) {
            summary.conflicted = { id: u.id, files: err.conflictedFiles };
            // Process one update at a time so conflicts can be resolved
            // incrementally; everything after this is left for the next run.
            for (const remaining of updates.slice(i + 1)) {
              summary.campaigns.notAttempted.push(remaining.id);
            }
            break;
          }
          // Any other error from includeCampaign: rethrow so the catch
          // block below renders consistent error output.
          throw err;
        }
      }
    }

    // 3. Included mods. Skipped entirely when a campaign conflict has left the
    // working tree mid-merge - the user must resolve that before any new merge.
    if (!summary.conflicted) {
      // checkIncludedModsUpdates reads the manifest first and returns early
      // (no registry fetch) when there are no included mods, so a mod without
      // any includes never touches the network. When there are mods it fetches
      // the registry once and hands it back for the merge loop to reuse.
      let modResult;
      try {
        modResult = await checkIncludedModsUpdates({ dir }, { onProgress });
      } catch (err) {
        if (err instanceof GithubError) {
          // The registry is the source of truth for mod versions; if it is
          // unreachable we warn and skip the included-mod phase rather than
          // abort the whole run, leaving any earlier base/campaign work intact.
          // Only reached when there are mods to check - an empty list never
          // fetches.
          console.warn("\nCould not reach the registry - skipping included-mod updates.");
        } else {
          throw err;
        }
      }

      if (modResult) {
        const { updates: modUpdates, registry } = modResult;

        if (modUpdates.length === 0) {
          console.log("\nYour mod doesn't include any other mods.");
        } else {
          for (let i = 0; i < modUpdates.length; i++) {
            const m = modUpdates[i];

            if (m.missing) {
              console.warn(`\nMod "${m.id}" is no longer in the registry - skipping. Your copy stays as-is.`);
              summary.mods.missing.push(m.id);
              continue;
            }

            if (m.manifestAhead) {
              console.warn(`\nMod "${m.id}" is recorded at v${m.currentVersion}, newer than the registry's v${m.registryVersion} - skipping. The registry may have rolled back.`);
              summary.mods.ahead.push(m.id);
              continue;
            }

            if (!m.updateAvailable) {
              console.log(`\nMod "${m.id}" is up to date.`);
              summary.mods.upToDate.push(m.id);
              continue;
            }

            console.log(`\nMod "${m.id}" has an update available (v${m.currentVersion} -> v${m.registryVersion}).`);
            const yes = await confirm({
              message: `Pull this update into your mod?`,
              default: true,
            });
            if (!yes) {
              summary.mods.skipped.push(m.id);
              continue;
            }

            try {
              const result = await includeMod(
                { dir, source: m.id, registry },
                { onProgress },
              );
              if (result.alreadyUpToDate) {
                summary.mods.upToDate.push(m.id);
              } else {
                summary.mods.updated.push(m.id);
                console.log(`Pulled in the update for "${m.id}".`);
              }
            } catch (err) {
              if (err instanceof MergeConflictError) {
                summary.conflicted = { id: m.id, files: err.conflictedFiles };
                for (const remaining of modUpdates.slice(i + 1)) {
                  summary.mods.notAttempted.push(remaining.id);
                }
                break;
              }
              throw err;
            }
          }
        }
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
      console.error("\nOnce the conflict is resolved, run `ebr update` again to pick up any remaining items.");
      process.exitCode = 1;
      return;
    }

    if (summary.base.updated || summary.campaigns.updated.length > 0 || summary.mods.updated.length > 0) {
      console.log("\nReview the changes and run `ebr save` when ready.");
    }
  } catch (err) {
    if (err instanceof IncludeRefNotFoundError) {
      console.error(`\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (renderCliError(err, { command: "ebr update" })) {
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function printSummary(s) {
  const lines = ["\n--- Summary ---"];
  if (s.base.updated) lines.push("Base content: updated");
  else if (s.base.skipped) lines.push("Base content: skipped (update was available)");
  if (s.campaigns.updated.length > 0) lines.push(`Campaigns updated: ${s.campaigns.updated.join(", ")}`);
  if (s.campaigns.upToDate.length > 0) lines.push(`Already up to date: ${s.campaigns.upToDate.join(", ")}`);
  if (s.campaigns.skipped.length > 0) lines.push(`Skipped (you said no): ${s.campaigns.skipped.join(", ")}`);
  if (s.campaigns.missing.length > 0) lines.push(`Skipped (not in official base content): ${s.campaigns.missing.join(", ")}`);
  if (s.mods.updated.length > 0) lines.push(`Mods updated: ${s.mods.updated.join(", ")}`);
  if (s.mods.upToDate.length > 0) lines.push(`Mods already up to date: ${s.mods.upToDate.join(", ")}`);
  if (s.mods.skipped.length > 0) lines.push(`Mods skipped (you said no): ${s.mods.skipped.join(", ")}`);
  if (s.mods.missing.length > 0) lines.push(`Mods skipped (delisted from registry): ${s.mods.missing.join(", ")}`);
  if (s.mods.ahead.length > 0) lines.push(`Mods skipped (newer than registry): ${s.mods.ahead.join(", ")}`);
  if (s.conflicted) lines.push(`Conflict: ${s.conflicted.id}`);
  if (s.campaigns.notAttempted.length > 0) lines.push(`Campaigns not attempted (after the conflict): ${s.campaigns.notAttempted.join(", ")}`);
  if (s.mods.notAttempted.length > 0) lines.push(`Mods not attempted (after the conflict): ${s.mods.notAttempted.join(", ")}`);
  if (lines.length === 1) lines.push("Nothing to update.");
  console.log(lines.join("\n"));
}
