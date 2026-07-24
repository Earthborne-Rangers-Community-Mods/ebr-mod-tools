/**
 * Build the published CLI into dist/.
 *
 * The esbuild bundles src/cli.js into dist/cli.js, inlining first-party code:
 * the private, unpublished `core` workspace package and the CLI's own source.
 * Core's declared dependencies are propagated into the generated dist/package.json,
 * merged with the CLI's own.
 *
 * The publishable artifact is dist/ (bundle + generated manifest); publish with
 * `npm run release`.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(cliRoot, "dist");
const cliPkg = readJson(join(cliRoot, "package.json"));
const corePkg = readJson(join(cliRoot, "..", "core", "package.json"));

const coreDeps = corePkg.dependencies ?? {};
const cliDeps = cliPkg.dependencies ?? {};
const overlap = Object.keys(cliDeps).filter((name) => name in coreDeps);
if (overlap.length > 0) {
  throw new Error(
    `CLI re-declares core-owned dependencies: ${overlap.join(", ")}. ` +
      `Shared dependencies must be declared once, on core.`,
  );
}
const runtimeDeps = { ...coreDeps, ...cliDeps };
const external = Object.keys(runtimeDeps);

rmSync(distDir, { recursive: true, force: true });

await build({
  entryPoints: [join(cliRoot, "src", "cli.ts")],
  outfile: join(distDir, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  // Bake the version in so the published bundle does not read package.json at
  // runtime (its manifest sits beside the bundle at the package root, not one
  // level up as in the source tree).
  define: { "process.env.EBR_CLI_VERSION": JSON.stringify(cliPkg.version) },
});

writePublishedManifest();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Write dist/package.json - the manifest that actually ships. It is the CLI's
 * manifest with core's runtime deps merged into its own (core is unpublished,
 * so the product that bundles it must declare those deps). Build-only and
 * source-only fields are dropped, the bin path is rebased to the dist root, and
 * `private` is removed so the artifact is publishable.
 */
function writePublishedManifest() {
  const { devDependencies, scripts, files, private: _private, ...rest } = cliPkg;
  const manifest = {
    ...rest,
    bin: { ebr: "./cli.js" },
    dependencies: sortKeys(runtimeDeps),
  };
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
  console.log(`Wrote dist/package.json (${external.length} runtime dependencies).`);
}

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}
