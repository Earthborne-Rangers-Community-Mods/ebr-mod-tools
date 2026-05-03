import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import open from "open";
import { getGithubToken } from "../core/config.js";
import { publishMod } from "../core/workflows.js";
import { ManifestError, ManifestNotFoundError, GithubError, AuthenticationError, InsufficientScopeError, GitError, UnpushedChangesError, ModIdConflictError } from "../core/errors.js";

export const publishCommand = new Command("publish")
  .description("Submit or update the mod in the registry via GitHub PR")
  .option("--force", "Skip unpushed changes check")
  .action(publishAction);

async function publishAction(opts) {
    const dir = process.cwd();

    try {
      // Check for stored token
      const token = await getGithubToken();
      if (!token) {
        console.error("No GitHub token found. Run `ebr setup` first.");
        process.exitCode = 1;
        return;
      }

      const result = await publishMod(
        { dir, token, force: opts.force },
        { onProgress: (p) => console.log(p.message) },
      );

      // Report includedMods warnings
      if (result.includedModWarnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.includedModWarnings) {
          console.log(`  ⚠ ${w.message}`);
        }
      }

      // Report result
      if (result.existingPr) {
        console.log(`\nExisting PR updated: ${result.existingPr.url}`);
        console.log("The branch has been refreshed with your latest changes.");
      } else {
        console.log("\nOpening GitHub to create your pull request...");
        await open(result.compareUrl, { wait: true });
        console.log("If the browser didn't open, visit:");
        console.log(`  ${result.compareUrl}`);
      }

      console.log(`\nCommit: ${result.commitHash.slice(0, 7)}`);
      console.log("A registry maintainer will review and merge your PR.");
    } catch (err) {
      if (err instanceof ManifestNotFoundError) {
        console.error("No ebr-mod.json found in the current directory.");
        console.error("Run this command from the root of your mod.");
        process.exitCode = 1;
        return;
      }
      if (err instanceof AuthenticationError) {
        console.error("GitHub authentication failed. Run `ebr setup` to update your token.");
        process.exitCode = 1;
        return;
      }
      if (err instanceof InsufficientScopeError) {
        console.error("Your GitHub token is missing one or more required permissions.");
        console.error("Publishing requires all of the following (Read and write):");
        console.error("  - Contents");
        console.error("  - Pull requests");
        console.error("  - Workflows  (because the registry contains a GitHub Actions workflow file)");
        console.error("Run `ebr setup --token` to create a new token with the correct settings.");
        process.exitCode = 1;
        return;
      }
      if (err instanceof ModIdConflictError) {
        console.error(`\nMod ID conflict: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (err instanceof ManifestError) {
        console.error(`Manifest error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (err instanceof UnpushedChangesError) {
        console.error(`\n${err.message}`);
        if (err.files.length > 0) {
          console.error("\nUncommitted files:");
          for (const f of err.files) {
            console.error(`  - ${f}`);
          }
        }
        if (err.ahead > 0) {
          console.error(`\n${err.ahead} commit(s) not pushed to remote.`);
        }

        const proceed = await confirm({ message: "Publish anyway?" });
        if (proceed) {
          return publishAction({ ...opts, force: true });
        }

        process.exitCode = 1;
        return;
      }
      if (err instanceof GitError) {
        console.error(`Git error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (err instanceof GithubError) {
        console.error(`GitHub error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
}
