import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import {
  isRepo,
  initRepo,
  addRemote,
  hasRemote,
  getRemotes,
  stageAll,
  stageByExtensions,
  commit,
  getHeadCommit,
  getCurrentBranch,
  push,
  merge,
  abortMerge,
  getStatus,
  fetchRemote,
  getRemoteUrl,
} from "../../src/core/git.js";
import {
  GitError,
  NotARepoError,
  MergeConflictError,
  NothingToCommitError,
} from "../../src/core/errors.js";

// --- Helpers ---

async function createTempDir() {
  return mkdtemp(join(tmpdir(), "ebr-git-test-"));
}

/** Initialize a repo with user config so commits work. */
async function initTestRepo(dir) {
  await initRepo(dir);
  const git = simpleGit(dir);
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
}

/** Create a bare repo to act as a remote. */
async function createBareRemote() {
  const bareDir = await createTempDir();
  await simpleGit(bareDir).init(true);
  return bareDir;
}

/** Create a file, stage, and commit in one step. */
async function commitFile(dir, filename, content, message) {
  await writeFile(join(dir, filename), content);
  await stageAll(dir);
  await commit(dir, message);
}

// --- isRepo ---

describe("isRepo", () => {
  let tmpDir;
  beforeEach(async () => { tmpDir = await createTempDir(); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("returns false for a plain directory", async () => {
    expect(await isRepo(tmpDir)).toBe(false);
  });

  it("returns true for a git repo", async () => {
    await initTestRepo(tmpDir);
    expect(await isRepo(tmpDir)).toBe(true);
  });

  it("throws GitError for a nonexistent directory", async () => {
    const { join } = await import("node:path");
    await expect(isRepo(join(tmpDir, "nonexistent"))).rejects.toThrow(GitError);
  });
});

// --- initRepo ---

describe("initRepo", () => {
  let tmpDir;
  beforeEach(async () => { tmpDir = await createTempDir(); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("initializes a new git repository", async () => {
    await initRepo(tmpDir);
    expect(await isRepo(tmpDir)).toBe(true);
  });

  it("does not throw when called on an existing repo", async () => {
    await initRepo(tmpDir);
    await expect(initRepo(tmpDir)).resolves.not.toThrow();
  });
});

// --- addRemote / hasRemote / getRemotes ---

describe("addRemote / hasRemote / getRemotes", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("adds a remote", async () => {
    await addRemote(tmpDir, "origin", "https://github.com/test/repo.git");
    expect(await hasRemote(tmpDir, "origin")).toBe(true);
  });

  it("hasRemote returns false for a missing remote", async () => {
    expect(await hasRemote(tmpDir, "origin")).toBe(false);
  });

  it("getRemotes returns all remotes", async () => {
    await addRemote(tmpDir, "origin", "https://github.com/test/repo.git");
    await addRemote(tmpDir, "upstream", "https://github.com/other/repo.git");
    const remotes = await getRemotes(tmpDir);
    expect(remotes).toHaveLength(2);
    const names = remotes.map((r) => r.name);
    expect(names).toContain("origin");
    expect(names).toContain("upstream");
  });

  it("getRemotes returns empty array for a repo with no remotes", async () => {
    const remotes = await getRemotes(tmpDir);
    expect(remotes).toEqual([]);
  });
});

// --- stageAll / commit / getHeadCommit ---

describe("stageAll / commit / getHeadCommit", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("stages and commits a file", async () => {
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
    const sha = await getHeadCommit(tmpDir);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("throws NothingToCommitError when working tree is clean", async () => {
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
    await expect(commit(tmpDir, "empty commit")).rejects.toThrow(NothingToCommitError);
  });

  it("NothingToCommitError is instanceof GitError", async () => {
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
    try {
      await commit(tmpDir, "empty commit");
    } catch (err) {
      expect(err).toBeInstanceOf(NothingToCommitError);
      expect(err).toBeInstanceOf(GitError);
      expect(err.operation).toBe("commit");
    }
  });
});

// --- stageByExtensions ---

describe("stageByExtensions", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "readme.md", "initial", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("stages files with allowed extensions", async () => {
    await writeFile(join(tmpDir, "content.md"), "hello");
    await writeFile(join(tmpDir, "style.css"), "body {}");

    await stageByExtensions(tmpDir, [".md", ".css"]);
    const status = await simpleGit(tmpDir).status();

    expect(status.staged).toContain("content.md");
    expect(status.staged).toContain("style.css");
  });

  it("skips files with disallowed extensions", async () => {
    await writeFile(join(tmpDir, "content.md"), "hello");
    await writeFile(join(tmpDir, "script.exe"), "bad");
    await writeFile(join(tmpDir, "notes.bat"), "bad");

    await stageByExtensions(tmpDir, [".md"]);
    const status = await simpleGit(tmpDir).status();

    expect(status.staged).toContain("content.md");
    expect(status.not_added).toContain("script.exe");
    expect(status.not_added).toContain("notes.bat");
  });

  it("stages files in subdirectories", async () => {
    const subDir = join(tmpDir, "locations");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, "cave.md"), "a dark cave");

    await stageByExtensions(tmpDir, [".md"]);
    const status = await simpleGit(tmpDir).status();

    expect(status.staged).toContain("locations/cave.md");
  });

  it("stages deletions even for disallowed extensions", async () => {
    await writeFile(join(tmpDir, "oops.exe"), "bad file");
    await stageAll(tmpDir);
    await commit(tmpDir, "add bad file");

    await rm(join(tmpDir, "oops.exe"));

    await stageByExtensions(tmpDir, [".md"]);
    const status = await simpleGit(tmpDir).status();

    expect(status.deleted).toContain("oops.exe");
  });
});

// --- getCurrentBranch ---

describe("getCurrentBranch", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("returns the current branch name", async () => {
    const branch = await getCurrentBranch(tmpDir);
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });
});

// --- push ---

describe("push", () => {
  let tmpDir;
  let bareDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    bareDir = await createBareRemote();
    await initTestRepo(tmpDir);
    await addRemote(tmpDir, "origin", bareDir);
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(bareDir, { recursive: true, force: true });
  });

  it("pushes to a bare remote", async () => {
    const branch = await getCurrentBranch(tmpDir);
    await push(tmpDir, { remote: "origin", branch });
    // Verify the bare repo received the commit
    const log = await simpleGit(bareDir).log();
    expect(log.latest.message).toBe("initial commit");
  });
});

// --- merge ---

describe("merge", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "shared.txt", "original content", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("merges a branch cleanly", async () => {
    const git = simpleGit(tmpDir);
    await git.checkoutLocalBranch("feature");
    await commitFile(tmpDir, "new-file.txt", "feature content", "feature commit");
    await git.checkout("-");

    await merge(tmpDir, "feature");

    const content = await readFile(join(tmpDir, "new-file.txt"), "utf-8");
    expect(content).toBe("feature content");
  });

  it("throws MergeConflictError on conflicting changes", async () => {
    const git = simpleGit(tmpDir);
    await git.checkoutLocalBranch("feature");
    await commitFile(tmpDir, "shared.txt", "feature version", "feature change");
    await git.checkout("-");
    await commitFile(tmpDir, "shared.txt", "main version", "main change");

    await expect(merge(tmpDir, "feature")).rejects.toThrow(MergeConflictError);
  });

  it("MergeConflictError includes all conflicted files", async () => {
    const git = simpleGit(tmpDir);
    // Create a second file on main so both branches have it
    await commitFile(tmpDir, "other.txt", "original other", "add other.txt");

    await git.checkoutLocalBranch("feature");
    await writeFile(join(tmpDir, "shared.txt"), "feature version");
    await writeFile(join(tmpDir, "other.txt"), "feature other");
    await stageAll(tmpDir);
    await commit(tmpDir, "feature changes");

    await git.checkout("-");
    await writeFile(join(tmpDir, "shared.txt"), "main version");
    await writeFile(join(tmpDir, "other.txt"), "main other");
    await stageAll(tmpDir);
    await commit(tmpDir, "main changes");

    try {
      await merge(tmpDir, "feature");
    } catch (err) {
      expect(err).toBeInstanceOf(MergeConflictError);
      expect(err).toBeInstanceOf(GitError);
      expect(err.conflictedFiles).toContain("shared.txt");
      expect(err.conflictedFiles).toContain("other.txt");
      expect(err.conflictedFiles).toHaveLength(2);
    }
  });
});

// --- abortMerge ---

describe("abortMerge", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "shared.txt", "original content", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("aborts an in-progress merge and restores the working tree", async () => {
    const git = simpleGit(tmpDir);
    await git.checkoutLocalBranch("feature");
    await commitFile(tmpDir, "shared.txt", "feature version", "feature change");
    await git.checkout("-");
    await commitFile(tmpDir, "shared.txt", "main version", "main change");

    // Start a conflicted merge
    try { await merge(tmpDir, "feature"); } catch { /* expected */ }

    await abortMerge(tmpDir);

    const content = await readFile(join(tmpDir, "shared.txt"), "utf-8");
    expect(content).toBe("main version");
  });
});

// --- getStatus ---

describe("getStatus", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("reports a clean working tree", async () => {
    const status = await getStatus(tmpDir);
    expect(status.isClean).toBe(true);
    expect(status.conflicted).toEqual([]);
  });

  it("reports modified files", async () => {
    await writeFile(join(tmpDir, "test.txt"), "modified");
    const status = await getStatus(tmpDir);
    expect(status.isClean).toBe(false);
  });

  it("reports conflicted files during a merge", async () => {
    const git = simpleGit(tmpDir);
    await git.checkoutLocalBranch("feature");
    await commitFile(tmpDir, "test.txt", "feature version", "feature change");
    await git.checkout("-");
    await commitFile(tmpDir, "test.txt", "main version", "main change");

    try { await merge(tmpDir, "feature"); } catch { /* expected */ }

    const status = await getStatus(tmpDir);
    expect(status.conflicted).toContain("test.txt");
  });
});

// --- error wrapping ---

describe("error wrapping", () => {
  let tmpDir;
  beforeEach(async () => { tmpDir = await createTempDir(); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("throws NotARepoError for git operations on a non-repo", async () => {
    await expect(getHeadCommit(tmpDir)).rejects.toThrow(NotARepoError);
  });

  it("NotARepoError is instanceof GitError", async () => {
    try {
      await getHeadCommit(tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(NotARepoError);
      expect(err).toBeInstanceOf(GitError);
    }
  });
});

// --- getRemoteUrl ---

describe("getRemoteUrl", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await createTempDir();
    await initTestRepo(tmpDir);
    await commitFile(tmpDir, "test.txt", "hello", "initial commit");
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("returns the fetch URL of a named remote", async () => {
    await addRemote(tmpDir, "origin", "https://github.com/test/my-mod.git");
    const url = await getRemoteUrl(tmpDir, "origin");
    expect(url).toBe("https://github.com/test/my-mod.git");
  });

  it("returns null for a remote that does not exist", async () => {
    const url = await getRemoteUrl(tmpDir, "nonexistent");
    expect(url).toBeNull();
  });
});
