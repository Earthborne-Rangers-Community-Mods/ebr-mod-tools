import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { includeScaffold, computeMissingScaffoldProduct, addScaffoldProduct } from "core/workflows.js";
import { readManifest } from "core/manifest.js";
import { KNOWN_SCAFFOLDS, SCAFFOLD_TYPES } from "core/catalogs.js";
import { renderCliError } from "./render-error.js";
import {
  NothingToCommitError,
  ScaffoldRefNotFoundError,
} from "core/errors.js";
import type { ProgressEvent } from "core/types.js";

export const scaffoldCommand = new Command("scaffold")
  .description("Stamp a scaffold template into the current mod")
  .argument("[branch]", `Scaffold branch ref (e.g. '${SCAFFOLD_TYPES[0]}/<name>'). Omit to pick from a list of known scaffolds.`)
  .action(scaffoldAction);

async function scaffoldAction(branchArg: string | undefined) {
  const dir = process.cwd();

  // Resolve the branch: either the explicit positional arg or an interactive
  // pick from KNOWN_SCAFFOLDS. Authors can stamp an unlisted branch by
  // passing it explicitly; the catalog is for discovery only.
  let branch;
  if (typeof branchArg === "string" && branchArg.trim()) {
    branch = branchArg.trim();
  } else {
    branch = await select({
      message: "Select a scaffold to stamp:",
      choices: KNOWN_SCAFFOLDS.map((s) => ({
        name: s.name,
        value: s.branch,
      })),
    });
  }

  const onProgress = (p: ProgressEvent) => console.log(p.message);

  try {
    const stampResult = await includeScaffold(
      { dir, source: branch },
      { onProgress },
    );
    const skipped = stampResult.filesSkipped ? ` (${stampResult.filesSkipped} skipped)` : "";
    console.log(`\nStamped ${stampResult.branch} at ${stampResult.scaffoldCommitHash.slice(0, 7)} (${stampResult.filesAdded} file(s)${skipped}).`);

    await reconcileScaffoldProducts(dir, stampResult.branch);
    console.log("\nReview the changes and run `ebr save` when ready.");
  } catch (err) {
    handleScaffoldError(err);
  }
}

/**
 * Courtesy product reconciliation for the scaffold that was just stamped.
 *
 * If the scaffold has a catalog entry and its product is not already in
 * either `requiredProducts` or `optionalProducts`, asks the user where to
 * add it (or to skip). On accept, delegates the manifest write and commit to
 * core `addScaffoldProduct`. Silent no-op when the scaffold has no catalog
 * entry or the manifest already covers the product.
 */
async function reconcileScaffoldProducts(dir: string, branch: string) {
  const manifest = await readManifest(dir);
  const product = computeMissingScaffoldProduct(branch, manifest);
  if (!product) return;

  const choice = await select<"required" | "optional" | "skip">({
    message: `Scaffold "${branch}" uses "${product}", which isn't in your manifest. Add it?`,
    default: "required",
    choices: [
      { name: `Add to requiredProducts`, value: "required" },
      { name: `Add to optionalProducts`, value: "optional" },
      { name: `Skip`, value: "skip" },
    ],
  });
  if (choice === "skip") return;

  const result = await addScaffoldProduct({ dir, branch, list: choice });
  if (result.added) {
    console.log(`  Added "${result.product}" to ${result.list === "required" ? "requiredProducts" : "optionalProducts"}.`);
  }
}

/**
 * Map a typed error to user-facing output and set process.exitCode.
 */
function handleScaffoldError(err: unknown) {
  if (err instanceof ScaffoldRefNotFoundError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (err instanceof NothingToCommitError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (renderCliError(err, { command: "ebr scaffold" })) {
    process.exitCode = 1;
    return;
  }
  throw err;
}
