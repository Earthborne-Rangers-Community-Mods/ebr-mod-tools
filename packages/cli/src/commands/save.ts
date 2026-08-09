import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import { readManifest, bumpVersion } from "core/manifest.js";
import { saveMod, previewIdentityOverride } from "core/workflows.js";
import { getGithubIdentity } from "core/config.js";
import { renderCliError } from "./render-error.js";
import { ManifestNotFoundError, NothingToCommitError } from "core/errors.js";
import type { ProgressEvent } from "core/types.js";

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

    // Resolve target version: explicit --version, --bump, prompt, or skip.
    // A manifest with no version (malformed / hand-edited) is treated as 0.0.0.
    const currentVersion = manifest.version ?? "0.0.0";
    let version = opts.version || null;
    if (!version) {
      let bumpType = opts.bump || null;
      if (!bumpType) {
        bumpType = await select({
          message: `Current version: ${currentVersion}. How would you like to bump it?`,
          choices: [
            { name: "Patch (tweaks and fixes)", value: "patch" },
            { name: "Minor (new stuff)", value: "minor" },
            { name: "Major (big overhaul)", value: "major" },
            { name: "Skip version bump", value: null },
          ],
        });
      }
      if (bumpType) {
        version = bumpVersion(currentVersion, bumpType);
      }
    }

    // Resolve the stored commit identity (set during `ebr setup`) and warn if
    // it will override what the local git config would otherwise stamp on
    // this commit.
    const storedIdentity = await getGithubIdentity();
    const identity = storedIdentity.login && storedIdentity.noReplyEmail
      ? { name: storedIdentity.login, email: storedIdentity.noReplyEmail }
      : null;
    const override = await previewIdentityOverride({ dir, identity });
    if (override) {
      console.log("\x1b[33m");
      console.log(`\u26A0 This commit will be attributed to ${override.name} <${override.email}>,`);
      console.log(`  not your local git config (${override.localName ?? "unset"} <${override.localEmail ?? "unset"}>).`);
      console.log(`  Run \`ebr setup\` again if this isn't the account you expect.\x1b[0m`);
    }

    // Prompt for commit message if not specified via flag
    const commitMessage = opts.message || await input({
      message: "What changed?",
      default: "Updated mod content",
    });

    try {
      const result = await saveMod(
        { dir, version, commitMessage, identity },
        { onProgress: (p: ProgressEvent) => console.log(p.message) },
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
