import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTempDir, validManifest, writeManifestFile, createProgressCollector } from "../helpers.js";

// --- Mock github.js and git.js at the module level ---

const githubMocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getFileContent: vi.fn(),
  createOrUpdateFileContent: vi.fn(),
  createBranch: vi.fn(),
  updateBranchRef: vi.fn(),
  getRefSha: vi.fn(),
  listPullRequests: vi.fn(),
  syncFork: vi.fn(),
}));

const gitMocks = vi.hoisted(() => ({
  getHeadCommit: vi.fn(),
  getStatus: vi.fn(),
  getAheadBehind: vi.fn(),
  createTag: vi.fn(),
}));

vi.mock("../../src/core/github.js", () => githubMocks);
vi.mock("../../src/core/git.js", () => gitMocks);

// Import AFTER mocks are set up
import { publishMod } from "../../src/core/workflows.js";
import { buildRegistryEntry } from "../../src/core/registry.js";
import { ManifestError, GithubError, GithubFileNotFoundError, UnpushedChangesError, ModIdConflictError, InsufficientScopeError } from "../../src/core/errors.js";

// --- Helpers ---

const TOKEN = "ghp_test_token_123";
const COMMIT_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

function emptyRegistry() {
  return { schemaVersion: 1, mods: [] };
}

function registryWithMod(manifest) {
  return {
    schemaVersion: 1,
    mods: [buildRegistryEntry(manifest, "oldcommithash1234567890oldcommithash12345678")],
  };
}

/**
 * Set up default mocks for the publish flow.
 * @param {object} [options]
 * @param {object} [options.registry] - Combined registry.json content.
 * @param {boolean} [options.modFileExists] - Whether the per-mod file already exists in upstream.
 */
function setupGithubMocks({ registry = emptyRegistry(), modFileExists = false, existingModEntry = null } = {}) {
  githubMocks.getAuthenticatedUser.mockResolvedValue({ login: "test-user", name: "Test User" });
  githubMocks.getRefSha.mockResolvedValue("upstream-main-sha-1234567890");

  // getFileContent is called twice: once for registry.json, once for mods/<id>.json
  githubMocks.getFileContent.mockImplementation((_token, { path }) => {
    if (path === "registry.json") {
      return Promise.resolve({
        content: JSON.stringify(registry),
        sha: "registry-file-sha-abc123",
      });
    }
    // Per-mod file
    if (modFileExists) {
      // Return a proper existing entry with author/repoUrl so ownership check passes
      const content = existingModEntry || { author: "TestAuthor", repoUrl: "https://github.com/test/ebr-test-mod" };
      return Promise.resolve({
        content: JSON.stringify(content),
        sha: "existing-mod-file-sha-456",
      });
    }
    return Promise.reject(new GithubFileNotFoundError("getFileContent", `mods/${path.split("/").pop()}`));
  });

  githubMocks.createBranch.mockResolvedValue(undefined);
  githubMocks.updateBranchRef.mockResolvedValue(undefined);
  githubMocks.syncFork.mockResolvedValue(undefined);
  githubMocks.createOrUpdateFileContent.mockResolvedValue({ commitSha: "new-commit-sha" });
  githubMocks.listPullRequests.mockResolvedValue([]);
  gitMocks.getHeadCommit.mockResolvedValue(COMMIT_SHA);
  gitMocks.getStatus.mockResolvedValue({ isClean: true, modified: [], staged: [], created: [], conflicted: [] });
  gitMocks.getAheadBehind.mockResolvedValue({ ahead: 0, behind: 0, trackingBranch: "origin/main" });
  gitMocks.createTag.mockResolvedValue(undefined);
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  // Default: PR worker unreachable, so publish falls back to the compare URL.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
});

// --- publishMod ---

describe("publishMod", () => {
  it("publishes a new mod to an empty registry", async () => {
    const dir = await createTempDir();
    const manifest = validManifest();
    await writeManifestFile(dir, manifest);
    setupGithubMocks();

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.isUpdate).toBe(false);
    expect(result.commitHash).toBe(COMMIT_SHA);
    expect(result.compareUrl).toContain("https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/compare/main...test-user:publish/test-mod");
    expect(result.compareUrl).toContain("expand=1");
    expect(result.compareUrl).toContain("title=New+mod");
    expect(result.existingPr).toBeNull();
    expect(result.entry.id).toBe("test-mod");
    expect(result.entry.latestVersion).toBe("1.0.0");
    expect(result.includedModWarnings).toEqual([]);
  });

  it("updates an existing mod in the registry", async () => {
    const dir = await createTempDir();
    const manifest = validManifest({ version: "2.0.0" });
    await writeManifestFile(dir, manifest);
    setupGithubMocks({ registry: registryWithMod(validManifest({ version: "1.0.0" })), modFileExists: true });

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.isUpdate).toBe(true);
    expect(result.entry.latestVersion).toBe("2.0.0");
  });

  it("uses authenticated user as fork owner for branch creation", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    await publishMod({ dir, token: TOKEN });

    expect(githubMocks.createBranch).toHaveBeenCalledWith(TOKEN, {
      owner: "test-user", repo: "ebr-mod-registry",
      branch: "publish/test-mod", sha: "upstream-main-sha-1234567890",
    });
  });

  it("throws ModIdConflictError when mod ID is claimed by a different author", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks({
      modFileExists: true,
      existingModEntry: { author: "OtherAuthor", repoUrl: "https://github.com/other/ebr-mod-base-content" },
    });

    const err = await publishMod({ dir, token: TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(ModIdConflictError);
    expect(err.modId).toBe("test-mod");
    expect(err.existingAuthor).toBe("OtherAuthor");
  });

  it("creates a branch named publish/<mod-id>", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    await publishMod({ dir, token: TOKEN });

    expect(githubMocks.createBranch).toHaveBeenCalledWith(TOKEN, {
      owner: "test-user", repo: "ebr-mod-registry",
      branch: "publish/test-mod", sha: "upstream-main-sha-1234567890",
    });
  });

  it("writes per-mod file to the branch for a new mod", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    await publishMod({ dir, token: TOKEN });

    expect(githubMocks.createOrUpdateFileContent).toHaveBeenCalledTimes(1);
    const call = githubMocks.createOrUpdateFileContent.mock.calls[0];
    expect(call[0]).toBe(TOKEN);
    expect(call[1].owner).toBe("test-user");
    expect(call[1].repo).toBe("ebr-mod-registry");
    expect(call[1].path).toBe("mods/test-mod.json");
    expect(call[1].branch).toBe("publish/test-mod");
    expect(call[1].sha).toBeUndefined();

    // Verify content is valid JSON with the mod entry
    const written = JSON.parse(call[1].content);
    expect(written.id).toBe("test-mod");
    expect(written.latestVersion).toBe("1.0.0");
  });

  it("passes existing file SHA when updating a mod", async () => {
    const dir = await createTempDir();
    const manifest = validManifest({ version: "2.0.0" });
    await writeManifestFile(dir, manifest);
    setupGithubMocks({ registry: registryWithMod(validManifest()), modFileExists: true });

    await publishMod({ dir, token: TOKEN });

    const call = githubMocks.createOrUpdateFileContent.mock.calls[0];
    expect(call[1].path).toBe("mods/test-mod.json");
    expect(call[1].sha).toBe("existing-mod-file-sha-456");
  });

  it("compare URL contains new-mod title for new mod", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.compareUrl).toContain("title=New+mod");
    expect(result.compareUrl).toContain("New+Mod+Submission");
  });

  it("compare URL contains update title for existing mod", async () => {
    const dir = await createTempDir();
    const manifest = validManifest({ version: "2.0.0" });
    await writeManifestFile(dir, manifest);
    setupGithubMocks({ registry: registryWithMod(validManifest()), modFileExists: true });

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.compareUrl).toContain("title=Update");
  });

  it("returns existing PR when one already exists", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    githubMocks.listPullRequests.mockResolvedValue([{
      number: 99, title: "Existing PR", url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/99", state: "open",
    }]);

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.existingPr).toEqual({
      number: 99, title: "Existing PR",
      url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/99", state: "open",
    });
    // compareUrl is still generated even when a PR exists
    expect(result.compareUrl).toBeTruthy();
  });

  it("force-updates branch ref if branch already exists", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    // createBranch fails with "already exists"
    githubMocks.createBranch
      .mockRejectedValueOnce(new GithubError("createBranch", "Reference already exists"));

    const result = await publishMod({ dir, token: TOKEN });

    expect(githubMocks.updateBranchRef).toHaveBeenCalledTimes(1);
    expect(githubMocks.updateBranchRef).toHaveBeenCalledWith(TOKEN, {
      owner: "test-user", repo: "ebr-mod-registry",
      branch: "publish/test-mod", sha: "upstream-main-sha-1234567890",
    });
    expect(githubMocks.createBranch).toHaveBeenCalledTimes(1);
    expect(result.compareUrl).toBeTruthy();
  });

  it("throws ManifestError when manifest is invalid", async () => {
    const dir = await createTempDir();
    // Missing required fields
    await writeManifestFile(dir, { name: "Bad Mod" });
    setupGithubMocks();

    await expect(publishMod({ dir, token: TOKEN })).rejects.toThrow(ManifestError);
  });

  it("throws ManifestError when repoUrl is empty", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ repoUrl: "" }));
    setupGithubMocks();

    await expect(publishMod({ dir, token: TOKEN })).rejects.toThrow(ManifestError);
  });

  it("returns warnings for delisted includedMods", async () => {
    const dir = await createTempDir();
    const manifest = validManifest({
      type: "collection",
      includedMods: [
        { id: "does-not-exist", name: "Ghost Mod", author: "X", version: "1.0.0", repoUrl: "https://github.com/x/y" },
      ],
    });
    await writeManifestFile(dir, manifest);
    setupGithubMocks();

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.includedModWarnings).toHaveLength(1);
    expect(result.includedModWarnings[0].modId).toBe("does-not-exist");
  });

  it("calls onProgress throughout the flow", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    const progress = createProgressCollector();

    await publishMod({ dir, token: TOKEN }, { onProgress: progress.fn });

    expect(progress.steps()).toContain("validate");
    expect(progress.steps()).toContain("check");
    expect(progress.steps()).toContain("commit");
    expect(progress.steps()).toContain("auth");
    expect(progress.steps()).toContain("sync");
    expect(progress.steps()).toContain("build");
    expect(progress.steps()).toContain("branch");
    expect(progress.steps()).toContain("write");
    expect(progress.steps()).toContain("create-pr");
    expect(progress.steps()).toContain("pr");
    progress.assertValid();
  });

  it("includes the full body in the compare URL with asterisks encoded", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    const result = await publishMod({ dir, token: TOKEN });

    const url = new URL(result.compareUrl);
    const body = url.searchParams.get("body");
    expect(body).toBeTruthy();
    expect(body).toContain(COMMIT_SHA.slice(0, 7));
    // Literal asterisks break terminal linkification, so they must be encoded.
    expect(result.compareUrl).not.toContain("*");
    expect(result.compareUrl).toContain("%2A");
    expect(url.searchParams.get("title")).toBeTruthy();
  });

  it("throws UnpushedChangesError when working tree is dirty", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    gitMocks.getStatus.mockResolvedValue({
      isClean: false, modified: ["src/cards.json"], staged: [], created: ["new-file.txt"], conflicted: [],
    });

    const err = await publishMod({ dir, token: TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(UnpushedChangesError);
    expect(err.dirty).toBe(true);
    expect(err.files).toEqual(["src/cards.json", "new-file.txt"]);
  });

  it("throws UnpushedChangesError when commits are ahead of remote", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    gitMocks.getAheadBehind.mockResolvedValue({ ahead: 3, behind: 0, trackingBranch: "origin/main" });

    const err = await publishMod({ dir, token: TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(UnpushedChangesError);
    expect(err.ahead).toBe(3);
  });

  it("bypasses unpushed check when force is true", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    gitMocks.getStatus.mockResolvedValue({
      isClean: false, modified: ["dirty.txt"], staged: [], created: [], conflicted: [],
    });
    gitMocks.getAheadBehind.mockResolvedValue({ ahead: 2, behind: 0, trackingBranch: "origin/main" });

    const result = await publishMod({ dir, token: TOKEN, force: true });

    expect(result.compareUrl).toBeTruthy();
    expect(gitMocks.getStatus).not.toHaveBeenCalled();
    expect(gitMocks.getAheadBehind).not.toHaveBeenCalled();
  });

  it("proceeds when no tracking branch exists and working tree is clean", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    gitMocks.getAheadBehind.mockResolvedValue(null);

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.compareUrl).toBeTruthy();
  });

  it("reports 'check' step in onProgress", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    const progress = createProgressCollector();

    await publishMod({ dir, token: TOKEN }, { onProgress: progress.fn });

    expect(progress.steps()).toContain("check");
    progress.assertValid();
  });

  it("throws InsufficientScopeError when syncFork returns 403", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    githubMocks.syncFork.mockRejectedValue(new InsufficientScopeError("syncFork"));

    const err = await publishMod({ dir, token: TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientScopeError);
  });

  it("throws InsufficientScopeError when syncFork fallback updateBranchRef returns 403", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    // syncFork fails with 409 (fork diverged), triggering the updateBranchRef fallback
    githubMocks.syncFork.mockRejectedValue(new GithubError("syncFork", "Conflict", 409));
    // updateBranchRef fails with 403 (no write access)
    githubMocks.updateBranchRef.mockRejectedValue(new InsufficientScopeError("updateBranchRef"));

    const err = await publishMod({ dir, token: TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientScopeError);
  });
});

// --- Automated PR creation via worker ---

describe("publishMod PR worker", () => {
  function mockWorker(response) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  }

  it("includes commit link in the worker PR body", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    mockWorker({ ok: true, json: async () => ({ number: 42, url: "https://github.com/x/y/pull/42" }) });

    await publishMod({ dir, token: TOKEN });

    // The full body is sent to the worker, not stuffed into the compare URL.
    const [, opts] = fetch.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.body).toContain(`${COMMIT_SHA.slice(0, 7)}`);
    expect(sent.body).toContain("https://github.com/test/ebr-test-mod/commit/");
  });

  it("returns createdPr when the worker opens the PR", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    mockWorker({
      ok: true,
      json: async () => ({ number: 42, url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/42" }),
    });

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.createdPr).toEqual({
      number: 42,
      url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/42",
    });
    expect(result.existingPr).toBeNull();
    // compareUrl is still provided as a fallback regardless.
    expect(result.compareUrl).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "https://ebr-mod-pr.ebr-mods.workers.dev/create-pr",
      expect.objectContaining({ method: "POST" }),
    );
    // The POST body is the security-relevant contract with the worker.
    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(opts.body);
    expect(sent.forkOwner).toBe("test-user");
    expect(sent.branch).toBe("publish/test-mod");
    expect(sent.title).toContain("New mod");
  });

  it("falls back to compareUrl when the worker is unreachable", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    // beforeEach already stubs fetch to reject.

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.createdPr).toBeNull();
    expect(result.compareUrl).toBeTruthy();
  });

  it("falls back to compareUrl when the worker returns non-2xx", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    mockWorker({ ok: false, json: async () => ({ error: "boom" }) });

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.createdPr).toBeNull();
    expect(result.compareUrl).toBeTruthy();
  });

  it("reports the worker failure reason via onProgress", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    mockWorker({ ok: false, status: 404, text: async () => "Fork branch not found", json: async () => ({}) });
    const progress = { fn: vi.fn() };

    const result = await publishMod({ dir, token: TOKEN }, { onProgress: progress.fn });

    expect(result.createdPr).toBeNull();
    const failed = progress.fn.mock.calls.find((c) => c[0].step === "create-pr-failed");
    expect(failed).toBeTruthy();
    expect(failed[0].message).toContain("404");
    expect(failed[0].message).toContain("Fork branch not found");
  });

  it("falls back when the worker returns a malformed body", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    mockWorker({ ok: true, json: async () => ({ unexpected: true }) });

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.createdPr).toBeNull();
  });

  it("skips the worker when prWorkerUrl is null", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();

    const result = await publishMod({ dir, token: TOKEN, prWorkerUrl: null });

    expect(result.createdPr).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips the worker when a PR already exists", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGithubMocks();
    githubMocks.listPullRequests.mockResolvedValue([
      { number: 7, url: "https://github.com/x/pull/7", state: "open" },
    ]);
    vi.stubGlobal("fetch", vi.fn());

    const result = await publishMod({ dir, token: TOKEN });

    expect(result.createdPr).toBeNull();
    expect(result.existingPr).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
