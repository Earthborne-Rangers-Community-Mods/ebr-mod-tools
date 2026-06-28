import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import { readManifest, bumpVersion } from "../core/manifest.js";
import { saveMod } from "../core/workflows.js";
import { renderCliError } from "./render-error.js";
import { ManifestNotFoundError, NothingToCommitError } from "../core/errors.js";

export const saveCommand = new Command("save")
  .description("Update manifest, stage all changes, commit, and push")
  .option("--bump <type>", "Version bump type: patch, minor, or major")
  .option("--version <ver>", "Set an explicit version (semver, e.g. 2.0.0)")
  .option("--message <msg>", "Commit message")
  .action(async (opts) => {
    const dir = process.cwd();

    // Read manifest so we can show the current version in the prompt
    let manifest;
    try {
      manifest = await readManifest(dir);
    } catch (err) {
      if (err instanceof ManifestNotFoundError) {
        console.error("No ebr-mod.json found in the current directory.");
        console.error("Run this command from the root of your mod.");
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // Resolve target version: explicit --version, --bump, prompt, or skip
    let version = opts.version || null;
    if (!version) {
      let bumpType = opts.bump || null;
      if (!bumpType) {
        bumpType = await select({
          message: `Current version: ${manifest.version}. How would you like to bump it?`,
          choices: [
            { name: "Patch (tweaks and fixes)", value: "patch" },
            { name: "Minor (new stuff)", value: "minor" },
            { name: "Major (big overhaul)", value: "major" },
            { name: "Skip version bump", value: null },
          ],
        });
      }
      if (bumpType) {
        version = bumpVersion(manifest.version, bumpType);
      }
    }

    // Prompt for commit message if not specified via flag
    const commitMessage = opts.message || await input({
      message: "What changed?",
      default: "Updated mod content",
    });

    try {
      const result = await saveMod(
        { dir, version, commitMessage },
        { onProgress: (p) => console.log(p.message) },
      );

      if (result.manifestChanges.length > 0) {
        console.log("\nChanges:");
        for (const change of result.manifestChanges) {
          console.log(`  ${change.field}: ${change.oldValue} → ${change.newValue}`);
        }
      }

      console.log(`\nSaved and pushed. Commit: ${result.commitHash.slice(0, 7)}`);
    } catch (err) {
      if (err instanceof NothingToCommitError) {
        console.error("Nothing to save (working tree is clean).");
        process.exitCode = 1;
        return;
      }
      if (renderCliError(err, { command: "ebr save" })) {
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  });
