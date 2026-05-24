import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import simpleGit from "simple-git";
import { createProgressCollector } from "../helpers.js";

// --- Mocks for the unit-style cases (product math) ---
// These are pure functions; no mocks needed for those describes.

import {
  computeMissingScaffoldProduct,
  includeScaffold,
} from "../../src/core/workflows.js";
import {
  ValidationError,
  NotARepoError,
  IndexNotCleanError,
  ScaffoldRefNotFoundError,
  ManifestNotFoundError,
  NothingToCommitError,
} from "../../src/core/errors.js";
import { SCAFFOLD_NAME_TOKEN } from "../../src/core/catalogs.js";

// --- computeMissingScaffoldProduct ---

describe("computeMissingScaffoldProduct", () => {
  it("returns null for branches not in the KNOWN_SCAFFOLDS catalog (silent skip)", () => {
    const manifest = { requiredProducts: [], optionalProducts: [] };
    expect(computeMissingScaffoldProduct("map/never-heard-of-it", manifest)).toBeNull();
  });

  it("tolerates non-array requiredProducts/optionalProducts (no throw)", () => {
    // Treat malformed product lists as empty so the workflow can keep going.
    const catalog = [{ branch: "map/foo", name: "Foo", product: "stewards" }];
    const manifest = { requiredProducts: null, optionalProducts: undefined };
    expect(computeMissingScaffoldProduct("map/foo", manifest, catalog)).toBe("stewards");
  });

  it("returns null when a catalog entry has no product field", () => {
    const catalog = [{ branch: "map/no-product", name: "No product" }];
    const manifest = { requiredProducts: [], optionalProducts: [] };
    expect(computeMissingScaffoldProduct("map/no-product", manifest, catalog)).toBeNull();
  });

  it("uses an injected catalog", () => {
    const catalog = [
      { branch: "map/foo", name: "Foo map", product: "stewards" },
      { branch: "map/already-have", name: "Already have", product: "core-set" },
      { branch: "map/optional-covers", name: "Optional covers", product: "dlc-1" },
    ];
    const manifest = {
      requiredProducts: ["core-set"],
      optionalProducts: ["dlc-1"],
    };
    // Missing product -> returned by name.
    expect(computeMissingScaffoldProduct("map/foo", manifest, catalog)).toBe("stewards");
    // Product already in requiredProducts -> null.
    expect(computeMissingScaffoldProduct("map/already-have", manifest, catalog)).toBeNull();
    // Product already in optionalProducts -> null (either list counts).
    expect(computeMissingScaffoldProduct("map/optional-covers", manifest, catalog)).toBeNull();
    // Branch not in injected catalog -> null.
    expect(computeMissingScaffoldProduct("map/bar", manifest, catalog)).toBeNull();
  });
});

// --- includeScaffold (filesystem + git integration) ---

/**
 * Build a tiny "scaffold remote" git repo in a temp dir with the given
 * branch name and tree. Returns the absolute path; pass it as
 * `scaffoldRepoUrl` to includeScaffold to bypass the real network call.
 */
async function buildScaffoldRemote({ branch, files }) {
  const dir = await mkdtemp(join(tmpdir(), "ebr-scaffold-remote-"));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "Scaffold Bot");
  await git.addConfig("user.email", "scaffold@example.com");
  // Initial commit on the default branch so we can branch off it. The marker
  // file is removed on the scaffold branch so it doesn't pollute the stamp.
  await writeFile(join(dir, ".scaffold-marker"), "marker\n");
  await git.add(["-A"]);
  await git.commit("init");
  await git.checkoutLocalBranch(branch);
  await rm(join(dir, ".scaffold-marker"));
  for (const [relPath, content] of Object.entries(files)) {
    const parts = relPath.split("/");
    if (parts.length > 1) {
      await mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true });
    }
    await writeFile(join(dir, ...parts), content);
  }
  await git.add(["-A"]);
  await git.commit(`scaffold ${branch}`);
  return dir;
}

/**
 * Build a destination mod repo (initialized, with a manifest committed).
 */
async function buildModRepo({ manifest }) {
  const dir = await mkdtemp(join(tmpdir(), "ebr-mod-"));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "Mod Author");
  await git.addConfig("user.email", "mod@example.com");
  await writeFile(join(dir, "ebr-mod.json"), JSON.stringify(manifest, null, 2) + "\n");
  await git.add(["-A"]);
  await git.commit("initial manifest");
  return dir;
}

const cleanup = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function track(dir) {
  cleanup.push(dir);
  return dir;
}

const VALID_MANIFEST = {
  schemaVersion: 1,
  name: "My Custom Campaign",
  id: "my-custom-campaign",
  version: "0.1.0",
  type: "campaign",
  description: "Test mod.",
  author: "Tester",
  campaigns: ["my-custom-campaign"],
  requiredProducts: ["core-set"],
  safeToAddMidCampaign: false,
  language: "en",
  repoUrl: "",
};

describe("includeScaffold", () => {
  it("throws NotARepoError when dir is not a git repo", async () => {
    const dir = track(await mkdtemp(join(tmpdir(), "ebr-not-repo-")));
    await expect(
      includeScaffold({ dir, source: "map/foo", scaffoldRepoUrl: "ignored" }),
    ).rejects.toBeInstanceOf(NotARepoError);
  });

  it("throws IndexNotCleanError when there are staged changes", async () => {
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    // Stage an unrelated file to dirty the index.
    await writeFile(join(dir, "leftover.md"), "wip\n");
    await simpleGit(dir).add(["leftover.md"]);
    await expect(
      includeScaffold({ dir, source: "map/foo", scaffoldRepoUrl: "ignored" }),
    ).rejects.toBeInstanceOf(IndexNotCleanError);
  });

  it("throws ManifestNotFoundError when ebr-mod.json is missing", async () => {
    const dir = track(await mkdtemp(join(tmpdir(), "ebr-no-manifest-")));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig("user.name", "X");
    await git.addConfig("user.email", "x@example.com");
    await writeFile(join(dir, ".keep"), "");
    await git.add(["-A"]);
    await git.commit("init");
    await expect(
      includeScaffold({ dir, source: "map/foo", scaffoldRepoUrl: "ignored" }),
    ).rejects.toBeInstanceOf(ManifestNotFoundError);
  });

  it("throws ValidationError when manifest.name is missing or blank", async () => {
    const dir = track(await buildModRepo({
      manifest: { ...VALID_MANIFEST, name: "   " },
    }));
    await expect(
      includeScaffold({ dir, source: "map/foo", scaffoldRepoUrl: "ignored" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ScaffoldRefNotFoundError when the scaffold branch cannot be cloned", async () => {
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    // Point at a path that exists but doesn't have the requested branch.
    const remote = track(await buildScaffoldRemote({
      branch: "map/exists",
      files: { "x.md": "hi\n" },
    }));
    await expect(
      includeScaffold({ dir, source: "map/does-not-exist", scaffoldRepoUrl: remote }),
    ).rejects.toBeInstanceOf(ScaffoldRefNotFoundError);
  });

  it("stamps a scaffold tree, substituting __MOD_NAME__ in paths, and commits", async () => {
    const branch = "map/river-valley";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        [`Custom Campaigns/${SCAFFOLD_NAME_TOKEN}/Maps/River Valley/01 Entry.md`]: "# Entry\n",
        [`Custom Campaigns/${SCAFFOLD_NAME_TOKEN}/Maps/River Valley/02 Camp.md`]: "# Camp\n",
        "Trackers/Weather.md": "Weather tracker\n",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));

    const progress = createProgressCollector();
    const result = await includeScaffold(
      { dir, source: branch, scaffoldRepoUrl: remote },
      { onProgress: progress.fn },
    );

    expect(result.kind ?? "scaffold").toBe("scaffold"); // tolerant of shape variants
    expect(result.branch).toBe(branch);
    expect(result.filesAdded).toBe(3);
    expect(typeof result.scaffoldCommitHash).toBe("string");
    expect(result.scaffoldCommitHash).toMatch(/^[0-9a-f]{40}$/);

    // Files exist with the substituted path.
    const entry = await readFile(
      join(dir, "Custom Campaigns", "My Custom Campaign", "Maps", "River Valley", "01 Entry.md"),
      "utf8",
    );
    expect(entry).toBe("# Entry\n");
    const tracker = await readFile(join(dir, "Trackers", "Weather.md"), "utf8");
    expect(tracker).toBe("Weather tracker\n");

    // The original placeholder path should NOT exist.
    await expect(
      readFile(join(dir, "Custom Campaigns", SCAFFOLD_NAME_TOKEN, "Maps", "River Valley", "01 Entry.md")),
    ).rejects.toThrow();

    // A commit landed; HEAD message references the branch.
    const log = await simpleGit(dir).log();
    expect(log.latest.message).toContain(branch);

    progress.assertValid();
  });

  it("skips conflicting files without overwriting them", async () => {
    const branch = "map/river-valley";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        [`Custom Campaigns/${SCAFFOLD_NAME_TOKEN}/intro.md`]: "from scaffold\n",
        [`Custom Campaigns/${SCAFFOLD_NAME_TOKEN}/new.md`]: "new content\n",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));

    // Pre-create one destination so it conflicts.
    await mkdir(join(dir, "Custom Campaigns", "My Custom Campaign"), { recursive: true });
    await writeFile(join(dir, "Custom Campaigns", "My Custom Campaign", "intro.md"), "hand-written\n");

    const progress = [];
    const result = await includeScaffold(
      { dir, source: branch, scaffoldRepoUrl: remote },
      { onProgress: (p) => progress.push(p) },
    );

    // The conflicting file is skipped, not overwritten.
    expect(result.filesAdded).toBe(1);
    expect(result.filesSkipped).toBe(1);
    const intro = await readFile(
      join(dir, "Custom Campaigns", "My Custom Campaign", "intro.md"),
      "utf8",
    );
    expect(intro).toBe("hand-written\n");

    // The non-conflicting file is stamped.
    const newFile = await readFile(
      join(dir, "Custom Campaigns", "My Custom Campaign", "new.md"),
      "utf8",
    );
    expect(newFile).toBe("new content\n");

    // onProgress reported the conflict.
    const conflictStep = progress.find((p) => p.step === "conflict");
    expect(conflictStep).toBeDefined();
    expect(conflictStep.paths).toContain("Custom Campaigns/My Custom Campaign/intro.md");
  });

  it("throws NothingToCommitError when all scaffold files conflict", async () => {
    const branch = "map/all-conflict";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        [`Custom Campaigns/${SCAFFOLD_NAME_TOKEN}/intro.md`]: "from scaffold\n",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));

    // Pre-create the only destination.
    await mkdir(join(dir, "Custom Campaigns", "My Custom Campaign"), { recursive: true });
    await writeFile(join(dir, "Custom Campaigns", "My Custom Campaign", "intro.md"), "hand-written\n");

    await expect(
      includeScaffold({ dir, source: branch, scaffoldRepoUrl: remote }),
    ).rejects.toBeInstanceOf(NothingToCommitError);

    // Working tree untouched.
    const intro = await readFile(
      join(dir, "Custom Campaigns", "My Custom Campaign", "intro.md"),
      "utf8",
    );
    expect(intro).toBe("hand-written\n");
  });

  it("does not stamp scaffold housekeeping files (README.md, .gitkeep)", async () => {
    const branch = "map/with-housekeeping";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        "doc.md": "real content\n",
        "README.md": "scaffold author docs - do not stamp\n",
        ".gitkeep": "",
        "subdir/nested.md": "nested\n",
        "subdir/.gitkeep": "",
        "subdir/README.md": "nested readme - also skipped\n",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));

    const result = await includeScaffold(
      { dir, source: branch, scaffoldRepoUrl: remote },
    );
    // Only the two real content files land in the working tree.
    expect(result.filesAdded).toBe(2);
    const lastCommitFiles = await simpleGit(dir).raw([
      "show", "--name-only", "--pretty=format:", "HEAD",
    ]);
    expect(lastCommitFiles).toContain("doc.md");
    expect(lastCommitFiles).toContain("subdir/nested.md");
    expect(lastCommitFiles).not.toContain("README.md");
    expect(lastCommitFiles).not.toContain(".gitkeep");
  });

  it("never stamps the scaffold's .git directory", async () => {
    // Explicit assertion that skipDotTopLevel filters .git -- complements
    // the implicit `filesAdded` math in the other integration tests.
    const branch = "map/git-skip";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: { "only.md": "x\n" },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    const result = await includeScaffold(
      { dir, source: branch, scaffoldRepoUrl: remote },
    );
    expect(result.filesAdded).toBe(1);
    const lastCommitFiles = await simpleGit(dir).raw([
      "show", "--name-only", "--pretty=format:", "HEAD",
    ]);
    expect(lastCommitFiles).not.toMatch(/(^|\/)\.git\//);
  });

  it("never stamps dot-prefixed top-level dirs like .github", async () => {
    // Regression test: multiple scaffolds sharing .github/CODEOWNERS would
    // conflict on the second stamp. skipDotTopLevel excludes all dot-prefixed
    // top-level entries from the scaffold.
    const branch = "set/dot-skip";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        ".github/CODEOWNERS": "* @earthborne-games/mod-team\n",
        "content/card.md": "card data\n",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    const result = await includeScaffold(
      { dir, source: branch, scaffoldRepoUrl: remote },
    );
    expect(result.filesAdded).toBe(1);
    const lastCommitFiles = await simpleGit(dir).raw([
      "show", "--name-only", "--pretty=format:", "HEAD",
    ]);
    expect(lastCommitFiles).toContain("content/card.md");
    expect(lastCommitFiles).not.toContain(".github");
  });

  it("propagates NothingToCommitError when every scaffold file is housekeeping-filtered", async () => {
    // Documents current behavior: a scaffold whose entire content is
    // README.md / .gitkeep produces no stamped files, so the final commit
    // step throws NothingToCommitError.
    const branch = "map/all-housekeeping";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: {
        "README.md": "scaffold author docs\n",
        ".gitkeep": "",
        "subdir/.gitkeep": "",
      },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    await expect(
      includeScaffold({ dir, source: branch, scaffoldRepoUrl: remote }),
    ).rejects.toBeInstanceOf(NothingToCommitError);
  });

  it("rejects manifest.name containing path separators (path traversal guard)", async () => {
    const branch = "map/traversal";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: { [`${SCAFFOLD_NAME_TOKEN}/file.md`]: "x\n" },
    }));
    const dir = track(await buildModRepo({
      manifest: { ...VALID_MANIFEST, name: "../escape" },
    }));
    await expect(
      includeScaffold({ dir, source: branch, scaffoldRepoUrl: remote }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a working tree with unstaged modifications", async () => {
    const branch = "map/dirty-tree";
    const remote = track(await buildScaffoldRemote({
      branch,
      files: { "ok.md": "ok\n" },
    }));
    const dir = track(await buildModRepo({ manifest: VALID_MANIFEST }));
    // Modify the committed manifest without staging.
    await writeFile(join(dir, "ebr-mod.json"), "{}\n");
    await expect(
      includeScaffold({ dir, source: branch, scaffoldRepoUrl: remote }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
