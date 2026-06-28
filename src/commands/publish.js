import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import open from "open";
import { getGithubToken } from "../core/config.js";
import { publishMod } from "../core/workflows.js";
import { readManifest, writeManifest, validateManifest, formatValidationError, applyMissingProductFix, VALIDATION_CODES } from "../core/manifest.js";
import { OFFICIAL_PRODUCTS } from "../core/catalogs.js";
import { renderCliError } from "./render-error.js";
import { GithubError, AuthenticationError, InsufficientScopeError, UnpushedChangesError, ModIdConflictError } from "../core/errors.js";

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

      // Pre-validate so we can offer to auto-fix common manifest mistakes
      // before kicking off the publish workflow. publishMod re-validates,
      // so anything we don't fix here will still be caught.
      const fixed = await maybeAutoFixManifest(dir);
      if (fixed === "aborted") {
        process.exitCode = 1;
        return;
      }
      if (fixed === "wrote-fix") {
        console.log("\nUpdated ebr-mod.json. Review the changes, then run `ebr save`");
        console.log("to commit and push them, then re-run `ebr publish`.");
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
        console.log("\nWe'll open GitHub so you can create a pull request.");
        console.log("Click \"Create pull request\" on the page that opens.");
        console.log(`\n  ${result.compareUrl}\n`);
        const openPr = await confirm({ message: "Ready to open the compare page?" });
        if (openPr) {
          await open(result.compareUrl).catch(() => {});
        }
      }

      console.log(`\nCommit: ${result.commitHash.slice(0, 7)}`);
      console.log("A registry maintainer will review and merge your PR.");
    } catch (err) {
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
      if (err instanceof GithubError) {
        console.error(`GitHub error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (renderCliError(err, { command: "ebr publish" })) {
        process.exitCode = 1;
        return;
      }
      throw err;
    }
}

/**
 * Pre-publish validation hook. Reads the manifest, runs validation, and
 * offers to auto-fix the subset of errors that are safe to repair from a
 * prompt. Currently auto-fixable:
 *
 * - `CAMPAIGN_MISSING_PRODUCT`: a selected campaign requires a product not
 *   listed in `requiredProducts` or `optionalProducts`. Offer to add all
 *   missing products to one bucket or the other.
 *
 * Returns:
 * - `"clean"` - manifest passed validation; caller should proceed.
 * - `"unfixable"` - manifest has validation errors but none of them are
 *   safely auto-fixable from a prompt. Caller should proceed and let
 *   `publishMod` surface the formatted errors.
 * - `"wrote-fix"` - manifest was rewritten on disk; caller should ask
 *   the user to commit and re-run rather than continuing the publish.
 * - `"aborted"` - user explicitly aborted at the auto-fix prompt.
 *
 * If the manifest can't be read at all (missing or unparseable), the error
 * is rethrown so the outer handler can print its standard message.
 *
 * @param {string} dir - Mod directory.
 * @returns {Promise<"clean"|"unfixable"|"wrote-fix"|"aborted">}
 */
async function maybeAutoFixManifest(dir) {
  const manifest = await readManifest(dir);
  const errors = validateManifest(manifest);
  if (errors.length === 0) return "clean";

  const fixable = errors.filter((e) => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT);
  const unfixable = errors.filter((e) => e.code !== VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT);

  if (fixable.length === 0) {
    // Nothing we can fix automatically - let publishMod surface the full error.
    return "unfixable";
  }

  // If the product fields are malformed (not arrays), don't try to auto-fix
  // on top of broken data - we'd quietly corrupt the manifest. Let publishMod
  // surface the full validation error instead.
  const productFieldsBroken = unfixable.some(
    (e) => e.code === VALIDATION_CODES.FIELD_NOT_ARRAY &&
      (e.field === "requiredProducts" || e.field === "optionalProducts"),
  );
  if (productFieldsBroken) {
    return "unfixable";
  }

  // Print the full picture so the user knows what's outstanding either way.
  console.log("\nManifest validation found problems:");
  for (const err of errors) {
    console.log(`  - ${formatValidationError(err)}`);
  }

  const productLabel = (id) => {
    const p = OFFICIAL_PRODUCTS.find((p) => p.id === id);
    return p ? `${p.name} (${id})` : id;
  };
  const missingProducts = [...new Set(fixable.map((e) => e.value))];

  console.log(
    `\n${missingProducts.length} product(s) are required by your selected campaigns ` +
      `but missing from requiredProducts/optionalProducts:`,
  );
  for (const id of missingProducts) {
    console.log(`  - ${productLabel(id)}`);
  }

  const choice = await select({
    message: "How should I handle them?",
    choices: [
      { name: "Add all to requiredProducts (players must own them)", value: "required" },
      { name: "Add all to optionalProducts (players may own them)", value: "optional" },
      { name: "Abort - I'll fix the manifest by hand", value: "abort" },
    ],
  });

  if (choice === "abort") return "aborted";

  applyMissingProductFix(manifest, missingProducts, choice);
  await writeManifest(dir, manifest);
  console.log(`\nMoved ${missingProducts.length} product(s) into ${choice}Products.`);

  if (unfixable.length > 0) {
    console.log("\nThe following problems still need to be fixed by hand:");
    for (const err of unfixable) {
      console.log(`  - ${formatValidationError(err)}`);
    }
  }

  return "wrote-fix";
}
