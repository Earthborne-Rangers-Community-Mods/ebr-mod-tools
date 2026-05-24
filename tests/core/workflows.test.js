import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";
import { scaffoldMod, scaffoldModIntoClone, saveMod, getModBranchName } from "../../src/core/workflows.js";
import { readManifest, buildManifest, toId } from "../../src/core/manifest.js";
import { initRepo, addRemote, stageAll, commit, getCurrentBranch, push } from "../../src/core/git.js";
import { ManifestError, NothingToCommitError, GitError, ValidationError, ForkOutOfSyncError } from "../../src/core/errors.js";
import { createTempDir, validManifest, writeManifestFile, createProgressCollector } from "../helpers.js";

// --- Helpers ---

const BASE_OPTIONS = {
  name: "Expanded Boulder Field",
  author: "TestCreator",
  description: "Adds new encounters to Boulder Field.",
  type: "enhancement",
  campaigns: ["lure-of-the-valley"],
  requiredProducts: ["core-set", "spire-in-bloom"],
  safeToAddMidCampaign: true,
  language: "en",
};

async function initTestRepo(dir) {
  await initRepo(dir);
  const git = simpleGit(dir);
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
}

async function createBareRemote() {
  const bareDir = await createTempDir("ebr-bare-");
  await simpleGit(bareDir).init(true);
  return bareDir;
}

async function commitFile(dir, filename, content, message) {
  await writeFile(join(dir, filename), content);
  await stageAll(dir);
  await commit(dir, message);
}

// --- toId ---

describe("toId", () => {
  it("converts name to kebab-case", () => {
    expect(toId("My Cool Mod")).toBe("my-cool-mod");
  });

  it("collapses multiple spaces and special characters", () => {
    expect(toId("The  Best---Mod  Ever!!!")).toBe("the-best-mod-ever");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toId("  --My Mod--  ")).toBe("my-mod");
  });
});

// --- buildManifest ---

describe("buildManifest", () => {
  it("builds manifest with required fields and defaults", () => {
    const manifest = buildManifest(BASE_OPTIONS);

    expect(manifest.name).toBe("Expanded Boulder Field");
    expect(manifest.id).toBe("expanded-boulder-field");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.type).toBe("enhancement");
    expect(manifest.description).toBe("Adds new encounters to Boulder Field.");
    expect(manifest.author).toBe("TestCreator");
    expect(manifest.campaigns).toEqual(["lure-of-the-valley"]);
    expect(manifest.requiredProducts).toEqual(["core-set", "spire-in-bloom"]);
    expect(manifest.safeToAddMidCampaign).toBe(true);
    expect(manifest.language).toBe("en");
    expect(manifest.tags).toEqual([]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.repoUrl).toBe("");
  });

  it("derives id from name", () => {
    const manifest = buildManifest({ ...BASE_OPTIONS, name: "My Cool Mod" });
    expect(manifest.id).toBe("my-cool-mod");
  });

  it("preserves explicit id when provided", () => {
    const manifest = buildManifest({ ...BASE_OPTIONS, id: "custom-id" });
    expect(manifest.id).toBe("custom-id");
  });

  it("includes optional fields when provided", () => {
    const manifest = buildManifest({
      ...BASE_OPTIONS,
      authorDiscord: "creator#1234",
      optionalProducts: ["stewards-of-the-valley"],
      midCampaignNotes: "Safe before day 15.",
      icon: "🌲",
    });

    expect(manifest.authorDiscord).toBe("creator#1234");
    expect(manifest.optionalProducts).toEqual(["stewards-of-the-valley"]);
    expect(manifest.midCampaignNotes).toBe("Safe before day 15.");
    expect(manifest.icon).toBe("🌲");
  });

  it("omits optional fields when not provided", () => {
    const manifest = buildManifest(BASE_OPTIONS);
    expect(manifest).not.toHaveProperty("authorDiscord");
    expect(manifest).not.toHaveProperty("optionalProducts");
    expect(manifest).not.toHaveProperty("midCampaignNotes");
    expect(manifest.icon).toBe("🏔️");
  });

  it("includes empty includedMods for collection type", () => {
    const manifest = buildManifest({ ...BASE_OPTIONS, type: "collection" });
    expect(manifest.includedMods).toEqual([]);
  });

  it("preserves existing version", () => {
    const manifest = buildManifest({ ...BASE_OPTIONS, version: "1.2.3" });
    expect(manifest.version).toBe("1.2.3");
  });
});

// --- modBranchName ---

describe("modBranchName", () => {
  it("prefixes the mod id with mod/", () => {
    expect(getModBranchName("expanded-boulder-field")).toBe("mod/expanded-boulder-field");
  });

  it("handles ids with multiple hyphens", () => {
    expect(getModBranchName("my-cool-new-mod")).toBe("mod/my-cool-new-mod");
  });
});

// --- scaffoldMod ---

describe("scaffoldMod", () => {
  let tmpDir;
  let forkDir;  // Bare repo simulating the user's fork
  let baseDir;  // Bare repo simulating upstream base-content; shares root with forkDir

  beforeEach(async () => {
    tmpDir = await createTempDir();

    // Create a working repo with one commit; clone twice as bare so the
    // fork and upstream share the same root commit (i.e. the fork is in
    // sync with upstream).
    forkDir = await createTempDir("ebr-fork-");
    baseDir = await createTempDir("ebr-base-");
    const workDir = await createTempDir("ebr-fork-work-");
    const g = simpleGit(workDir);
    await g.init();
    await g.addConfig("user.name", "Test User");
    await g.addConfig("user.email", "test@example.com");
    await writeFile(join(workDir, "README.md"), "# Base content\n");
    await g.add("-A");
    await g.commit("Initial commit");
    // Rename default branch to main
    await g.branch(["-M", "main"]);
    // Clone as bare into both forkDir and baseDir
    await rm(forkDir, { recursive: true, force: true });
    await rm(baseDir, { recursive: true, force: true });
    await simpleGit().clone(workDir, forkDir, ["--bare"]);
    await simpleGit().clone(workDir, baseDir, ["--bare"]);
    await rm(workDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(forkDir, { recursive: true, force: true });
    await rm(baseDir, { recursive: true, force: true });
  });

  it("clones the fork and writes manifest to disk", async () => {
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });
    const onDisk = await readManifest(subDir);
    expect(onDisk.name).toBe("Expanded Boulder Field");
    expect(onDisk.id).toBe("expanded-boulder-field");
  });

  it("creates a git repository with the fork as origin", async () => {
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });
    const git = simpleGit(subDir);
    expect(await git.checkIsRepo()).toBe(true);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    expect(origin).toBeDefined();
  });

  it("adds the base content remote", async () => {
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });
    const git = simpleGit(subDir);
    const remotes = await git.getRemotes(true);
    const base = remotes.find((r) => r.name === "base");
    expect(base).toBeDefined();
    // The base remote points to whatever we passed via baseRepoUrl (in the
    // production path, that's the canonical base-content URL).
    expect(base.refs.fetch).toBe(baseDir);
  });

  it("creates a mod/<mod-id> branch and checks it out", async () => {
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    const result = await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });
    expect(result.branch).toBe("mod/expanded-boulder-field");

    const git = simpleGit(subDir);
    const branch = await git.branchLocal();
    expect(branch.current).toBe("mod/expanded-boulder-field");
  });

  it("returns modDir, manifest, and branch", async () => {
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    const result = await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });
    expect(result.modDir).toBe(subDir);
    expect(result.manifest).toBe(manifest);
    expect(result.branch).toBe("mod/expanded-boulder-field");
  });

  it("commits the initial manifest so the working tree is clean", async () => {
    // Without this commit, a subsequent `ebr include` would fail with
    // git's "local changes would be overwritten" error when staging the
    // not-yet-in-HEAD manifest before merging.
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });

    const g = simpleGit(subDir);
    const status = await g.status();
    expect(status.isClean()).toBe(true);
    // ebr-mod.json should be tracked at HEAD now.
    const tracked = await g.raw(["ls-tree", "HEAD", "--name-only", "ebr-mod.json"]);
    expect(tracked.trim()).toBe("ebr-mod.json");
  });

  it("throws ValidationError if directory is not empty", async () => {
    await writeFile(join(tmpDir, "some-file.txt"), "hello");
    const manifest = buildManifest(BASE_OPTIONS);
    await expect(
      scaffoldMod({ dir: tmpDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir }),
    ).rejects.toThrow(ValidationError);
  });

  it("calls onProgress with step names", async () => {
    const subDir = join(tmpDir, "my-mod");
    const progress = createProgressCollector();
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir }, {
      onProgress: progress.fn,
    });
    expect(progress.steps()).toContain("clone");
    expect(progress.steps()).toContain("branch");
    expect(progress.steps()).toContain("manifest");
    progress.assertValid();
  });

  it("throws GitError when forkUrl is not provided (missing config)", async () => {
    const subDir = join(tmpDir, "no-fork");
    const manifest = buildManifest(BASE_OPTIONS);
    await expect(
      scaffoldMod({ dir: subDir, manifest, forkUrl: undefined }),
    ).rejects.toThrow(GitError);
  });

  it("throws ForkOutOfSyncError when fork and base share no history", async () => {
    // Build an unrelated upstream: fresh repo with its own root commit, no
    // shared history with `forkDir`.
    const unrelatedBase = await createTempDir("ebr-base-unrelated-");
    const unrelatedWork = await createTempDir("ebr-base-unrelated-work-");
    const ug = simpleGit(unrelatedWork);
    await ug.init();
    await ug.addConfig("user.name", "Test");
    await ug.addConfig("user.email", "test@example.com");
    await writeFile(join(unrelatedWork, "DIFFERENT.md"), "# unrelated\n");
    await ug.add("-A");
    await ug.commit("Different root commit");
    await ug.branch(["-M", "main"]);
    await rm(unrelatedBase, { recursive: true, force: true });
    await simpleGit().clone(unrelatedWork, unrelatedBase, ["--bare"]);
    await rm(unrelatedWork, { recursive: true, force: true });

    try {
      const subDir = join(tmpDir, "my-mod");
      const manifest = buildManifest(BASE_OPTIONS);
      await expect(
        scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: unrelatedBase }),
      ).rejects.toBeInstanceOf(ForkOutOfSyncError);
    } finally {
      await rm(unrelatedBase, { recursive: true, force: true });
    }
  });

  it("branches from base/main when fork main is behind upstream", async () => {
    // Push a new commit to baseDir (upstream) so it's ahead of forkDir.
    const upstreamWork = await createTempDir("ebr-upstream-work-");
    await simpleGit().clone(baseDir, upstreamWork);
    const ug = simpleGit(upstreamWork);
    await ug.addConfig("user.name", "Upstream");
    await ug.addConfig("user.email", "upstream@example.com");
    await writeFile(join(upstreamWork, "NEW_FILE.md"), "new upstream content\n");
    await ug.add("-A");
    await ug.commit("Add new file upstream");
    await ug.push("origin", "main");
    await rm(upstreamWork, { recursive: true, force: true });

    // Now scaffoldMod: fork is 1 commit behind upstream.
    const subDir = join(tmpDir, "my-mod");
    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldMod({ dir: subDir, manifest, forkUrl: forkDir, baseRepoUrl: baseDir });

    // The mod branch should contain the new upstream file.
    const g = simpleGit(subDir);
    const files = await g.raw(["ls-tree", "--name-only", "HEAD"]);
    expect(files).toContain("NEW_FILE.md");
  });
});

// --- scaffoldModIntoClone ---

describe("scaffoldModIntoClone", () => {
  let tmpDir;
  let forkDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();

    // Create a bare repo with a main branch to simulate the user's fork
    forkDir = await createTempDir("ebr-fork-");
    const workDir = await createTempDir("ebr-fork-work-");
    const g = simpleGit(workDir);
    await g.init();
    await g.addConfig("user.name", "Test User");
    await g.addConfig("user.email", "test@example.com");
    await writeFile(join(workDir, "README.md"), "# Base content\n");
    await g.add("-A");
    await g.commit("Initial commit");
    await g.branch(["-M", "main"]);
    await rm(forkDir, { recursive: true, force: true });
    await simpleGit().clone(workDir, forkDir, ["--bare"]);
    await rm(workDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(forkDir, { recursive: true, force: true });
  });

  it("fetches origin and creates branch from origin/main when no base remote", async () => {
    const existingDir = await createTempDir("ebr-existing-");
    await simpleGit().clone(forkDir, existingDir);
    const g = simpleGit(existingDir);
    await g.addConfig("user.name", "Test User");
    await g.addConfig("user.email", "test@example.com");

    const progress = createProgressCollector();
    const manifest = buildManifest(BASE_OPTIONS);
    const result = await scaffoldModIntoClone({ dir: existingDir, manifest }, {
      onProgress: progress.fn,
    });

    expect(progress.steps()).toContain("fetch");
    expect(progress.steps()).toContain("branch");
    expect(progress.steps()).toContain("manifest");
    expect(progress.steps()).not.toContain("clone");
    progress.assertValid();

    expect(result.branch).toBe("mod/expanded-boulder-field");
    const branch = await g.branchLocal();
    expect(branch.current).toBe("mod/expanded-boulder-field");

    const onDisk = await readManifest(existingDir);
    expect(onDisk.name).toBe("Expanded Boulder Field");

    await rm(existingDir, { recursive: true, force: true });
  });

  it("throws when branch already exists (duplicate mod id)", async () => {
    // Clone fork, then create a branch - second call with same id should fail
    const cloneDir = await createTempDir("ebr-clone-");
    await simpleGit().clone(forkDir, cloneDir);
    const g = simpleGit(cloneDir);
    await g.addConfig("user.name", "Test User");
    await g.addConfig("user.email", "test@example.com");

    const manifest = buildManifest(BASE_OPTIONS);
    await scaffoldModIntoClone({ dir: cloneDir, manifest });

    const manifest2 = buildManifest(BASE_OPTIONS);
    await expect(
      scaffoldModIntoClone({ dir: cloneDir, manifest: manifest2 }),
    ).rejects.toThrow(/branch/i);

    await rm(cloneDir, { recursive: true, force: true });
  });
});

// --- saveMod ---

describe("saveMod", () => {
  let tmpDir;
  let bareDir;

  beforeEach(async () => {
    bareDir = await createBareRemote();
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await writeManifestFile(tmpDir, validManifest());
    await commitFile(tmpDir, "readme.txt", "initial", "initial commit");
    // Push initial commit to set up tracking
    await addRemote(tmpDir, "origin", bareDir);
    const branch = await getCurrentBranch(tmpDir);
    await push(tmpDir, { remote: "origin", branch });
    await simpleGit(tmpDir).branch([`--set-upstream-to=origin/${branch}`]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(bareDir, { recursive: true, force: true });
  });

  it("stages, commits, and pushes changes", async () => {
    await writeFile(join(tmpDir, "new-file.md"), "new content");

    const result = await saveMod({ dir: tmpDir, commitMessage: "Add new file" });

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(result.manifestChanges).toEqual([]);

    // Verify the bare remote received the commit
    const log = await simpleGit(bareDir).log();
    expect(log.latest.message).toBe("Add new file");
  });

  it("updates version before committing when version is provided", async () => {
    await writeFile(join(tmpDir, "content.md"), "some content");

    const result = await saveMod({
      dir: tmpDir,
      commitMessage: "Update content",
      version: "1.1.0",
    });

    expect(result.manifestChanges).toEqual([
      { field: "version", oldValue: "1.0.0", newValue: "1.1.0" },
    ]);

    // Verify the manifest on disk was updated
    const manifest = await readManifest(tmpDir);
    expect(manifest.version).toBe("1.1.0");

    // Verify the updated manifest was included in the commit
    const log = await simpleGit(bareDir).log();
    expect(log.latest.message).toBe("Update content");
  });

  it("throws NothingToCommitError when working tree is clean", async () => {
    await expect(
      saveMod({ dir: tmpDir, commitMessage: "empty save" }),
    ).rejects.toThrow(NothingToCommitError);
  });

  it("can save with only a version change and no other changes", async () => {
    const result = await saveMod({
      dir: tmpDir,
      commitMessage: "Bump version",
      version: "1.0.1",
    });

    expect(result.manifestChanges).toEqual([
      { field: "version", oldValue: "1.0.0", newValue: "1.0.1" },
    ]);

    const log = await simpleGit(bareDir).log();
    expect(log.latest.message).toBe("Bump version");
  });

  it("sets an explicit version", async () => {
    const result = await saveMod({
      dir: tmpDir,
      commitMessage: "Release 3.0.0",
      version: "3.0.0",
    });

    expect(result.manifestChanges).toEqual([
      { field: "version", oldValue: "1.0.0", newValue: "3.0.0" },
    ]);

    const manifest = await readManifest(tmpDir);
    expect(manifest.version).toBe("3.0.0");
  });

  it("rejects invalid version", async () => {
    const err = await saveMod({ dir: tmpDir, commitMessage: "bad", version: "nope" }).catch((e) => e);
    expect(err).toBeInstanceOf(ManifestError);
    expect(err.message).toContain("semver");
  });

  it("calls onProgress at each step", async () => {
    await writeFile(join(tmpDir, "file.md"), "content");
    const progress = createProgressCollector();

    await saveMod(
      { dir: tmpDir, commitMessage: "progress test" },
      { onProgress: progress.fn },
    );

    expect(progress.steps()).toContain("stage");
    expect(progress.steps()).toContain("commit");
    expect(progress.steps()).toContain("push");
    progress.assertValid();
  });

  it("only stages files with allowed extensions", async () => {
    await writeFile(join(tmpDir, "content.md"), "hello");
    await writeFile(join(tmpDir, "script.exe"), "bad");

    await saveMod({ dir: tmpDir, commitMessage: "filtered save" });

    // The exe should still be untracked in the working tree
    const status = await simpleGit(tmpDir).status();
    expect(status.not_added).toContain("script.exe");

    // The commit should only contain the .md file
    const log = await simpleGit(bareDir).log();
    expect(log.latest.message).toBe("filtered save");
    const show = await simpleGit(bareDir).show(["--name-only", "--format=", log.latest.hash]);
    expect(show).toContain("content.md");
    expect(show).not.toContain("script.exe");
  });

  it("does not touch repoUrl when origin is a non-GitHub remote", async () => {
    await writeFile(join(tmpDir, "file.md"), "content");

    const result = await saveMod({ dir: tmpDir, commitMessage: "local origin" });

    // bareDir is a local path, not a GitHub URL - no repoUrl change
    expect(result.manifestChanges).toEqual([]);
    const manifest = await readManifest(tmpDir);
    expect(manifest.repoUrl).toBe("https://github.com/test/ebr-test-mod");
  });

  it("updates repoUrl when origin is a GitHub URL", async () => {
    // Change origin URL to a GitHub URL (push already happened via bare remote,
    // so we swap the URL to test detection - the push target stays the same)
    await simpleGit(tmpDir).remote(["set-url", "origin", "https://github.com/creator/my-mod.git"]);
    // Re-add the bare remote as a separate pushable remote
    await addRemote(tmpDir, "bare", bareDir);
    // Point push to the bare remote so push succeeds, but keep origin URL as GitHub
    await simpleGit(tmpDir).remote(["set-url", "--push", "origin", bareDir]);

    await writeFile(join(tmpDir, "file.md"), "content");

    const result = await saveMod({ dir: tmpDir, commitMessage: "github origin" });

    expect(result.manifestChanges).toContainEqual({
      field: "repoUrl",
      oldValue: "https://github.com/test/ebr-test-mod",
      newValue: "https://github.com/creator/my-mod",
    });
    const manifest = await readManifest(tmpDir);
    expect(manifest.repoUrl).toBe("https://github.com/creator/my-mod");
  });
});
