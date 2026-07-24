import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { includeScaffold, computeMissingScaffoldProduct } from "core/workflows.js";
import { readManifest, writeManifest } from "core/manifest.js";
import { stageFile, commit } from "core/git.js";
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
 * add it (or to skip). On accept, writes the manifest, stages it, and
 * commits with `Add products for <branch>`. Silent no-op when the scaffold
 * has no catalog entry or the manifest already covers the product.
 */
async function reconcileScaffoldProducts(dir: string, branch: string) {
  const manifest = await readManifest(dir);
  const product = computeMissingScaffoldProduct(branch, manifest);
  if (!product) return;

  const choice = await select({
    message: `Scaffold "${branch}" uses "${product}", which isn't in your manifest. Add it?`,
    default: "required",
    choices: [
      { name: `Add to requiredProducts`, value: "required" },
      { name: `Add to optionalProducts`, value: "optional" },
      { name: `Skip`, value: "skip" },
    ],
  });
  if (choice === "skip") return;

  if (choice === "required") {
    manifest.requiredProducts = mergeUnique(manifest.requiredProducts, [product]);
  } else {
    manifest.optionalProducts = mergeUnique(manifest.optionalProducts, [product]);
  }
  await writeManifest(dir, manifest);
  await stageFile(dir, "ebr-mod.json");
  await commit(dir, `Add products for ${branch}`);
  console.log(`  Added "${product}" to ${choice === "required" ? "requiredProducts" : "optionalProducts"}.`);
}

/**
 * Merge two arrays of strings, dropping duplicates, preserving order.
 * Returns a new array; never mutates inputs.
 */
function mergeUnique(existing: string[] | undefined, additions: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (v: string) => {
    if (typeof v === "string" && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  if (Array.isArray(existing)) existing.forEach(push);
  if (Array.isArray(additions)) additions.forEach(push);
  return out;
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
