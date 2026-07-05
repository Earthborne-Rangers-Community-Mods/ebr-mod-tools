import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTempDir, validManifest, writeManifestFile, createProgressCollector } from "../helpers.js";

// git.js is fully mocked so the git-based registry write performs no real git
// operations. The filesystem writes in writeRegistryEntry still run, so
// the entry file lands in a temp cloneDir and can be read back in assertions.
const gitMocks = vi.hoisted(() => ({
  getHeadCommit: vi.fn(),
  getStatus: vi.fn(),
  getAheadBehind: vi.fn(),
  createTag: vi.fn(),
  isRepo: vi.fn(),
  cloneRepo: vi.fn(),
  addRemote: vi.fn(),
  hasRemote: vi.fn(),
  setRemoteUrl: vi.fn(),
  fetchRemote: vi.fn(),
  checkoutResetBranch: vi.fn(),
  resetHardAndClean: vi.fn(),
  stageFile: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../../src/core/git.js", () => gitMocks);

// Import AFTER mocks are set up
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { publishMod } from "../../src/core/workflows.js";
import { buildRegistryEntry } from "../../src/core/registry.js";
import { ManifestError, GithubError, UnpushedChangesError, ModIdConflictError, VersionNotHigherError } from "../../src/core/errors.js";

// --- Constants ---

const FORK_URL = "https://github.com/test-user/ebr-mod-registry";
const COMMIT_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const WORKER_URL = "https://ebr-mod-pr.ebr-mods.workers.dev/create-pr";

// --- Registry fixtures ---

function emptyRegistry() {
  return { schemaVersion: 1, mods: [] };
}

function registryWithMod(manifest) {
  return {
    schemaVersion: 1,
    mods: [buildRegistryEntry(manifest, "oldcommithash1234567890oldcommithash12345678")],
  };
}

/** Existing published entry for the standard test manifest (same author/repoUrl). */
function ownEntry(overrides = {}) {
  return { author: "TestAuthor", repoUrl: "https://github.com/test/ebr-test-mod", ...overrides };
}

// --- Fetch mock ---

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Build an injectable fetch. Routes by method and URL:
 * - POST (any url) -> the worker call. `worker` is a Response, or "down" to throw.
 * - GET .../mods/<id>.json -> the published entry, or 404 when `modEntry` is null.
 * - GET .../registry.json -> the browse-tier registry (for includedMods checks).
 */
function makeFetch({ modEntry = null, registry = emptyRegistry(), worker = "down" } = {}) {
  return vi.fn(async (url, opts) => {
    if (opts?.method === "POST") {
      if (worker === "down") throw new Error("network down");
      return worker;
    }
    const u = String(url);
    if (u.includes("/mods/")) {
      return modEntry ? jsonResponse(200, modEntry) : jsonResponse(404, {});
    }
    if (u.endsWith("registry.json")) {
      return jsonResponse(200, registry);
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}

function setupGitMocks() {
  gitMocks.getHeadCommit.mockResolvedValue(COMMIT_SHA);
  gitMocks.getStatus.mockResolvedValue({ isClean: true, modified: [], staged: [], created: [], conflicted: [] });
  gitMocks.getAheadBehind.mockResolvedValue({ ahead: 0, behind: 0, trackingBranch: "origin/main" });
  gitMocks.createTag.mockResolvedValue(undefined);
  gitMocks.isRepo.mockResolvedValue(false);
  gitMocks.cloneRepo.mockResolvedValue(undefined);
  gitMocks.addRemote.mockResolvedValue(undefined);
  gitMocks.hasRemote.mockResolvedValue(false);
  gitMocks.setRemoteUrl.mockResolvedValue(undefined);
  gitMocks.fetchRemote.mockResolvedValue(undefined);
  gitMocks.checkoutResetBranch.mockResolvedValue(undefined);
  gitMocks.resetHardAndClean.mockResolvedValue(undefined);
  gitMocks.stageFile.mockResolvedValue(undefined);
  gitMocks.commit.mockResolvedValue(undefined);
  gitMocks.push.mockResolvedValue(undefined);
}

/** Standard publishMod options with an injected fetch and a temp clone dir. */
async function publishOpts(dir, { fetchImpl, cloneDir, ...rest } = {}) {
  return {
    dir,
    registryForkUrl: FORK_URL,
    cloneDir: cloneDir || (await createTempDir("ebr-clone-")),
    fetchImpl: fetchImpl || makeFetch(),
    ...rest,
  };
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishMod", () => {
  it("publishes a new mod to an empty registry", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir));

    expect(result.isUpdate).toBe(false);
    expect(result.commitHash).toBe(COMMIT_SHA);
    expect(result.compareUrl).toContain("https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/compare/main...test-user:publish/test-mod");
    expect(result.compareUrl).toContain("expand=1");
    expect(result.compareUrl).toContain("title=New+mod");
    expect(result.createdPr).toBeNull();
    expect(result.prAlreadyExists).toBe(false);
    expect(result.entry.id).toBe("test-mod");
    expect(result.entry.latestVersion).toBe("1.0.0");
    expect(result.includedModWarnings).toEqual([]);
  });

  it("writes the entry into the clone on the publish branch and pushes it", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const cloneDir = await createTempDir("ebr-clone-");

    await publishMod(await publishOpts(dir, { cloneDir }));

    // Branch reset from upstream/main, entry written, staged, committed, force-pushed.
    expect(gitMocks.checkoutResetBranch).toHaveBeenCalledWith(cloneDir, "publish/test-mod", "upstream/main");
    expect(gitMocks.stageFile).toHaveBeenCalledWith(cloneDir, "mods/test-mod.json");
    expect(gitMocks.commit).toHaveBeenCalledTimes(1);
    expect(gitMocks.push).toHaveBeenCalledWith(cloneDir, { remote: "origin", branch: "publish/test-mod", force: true });

    const written = JSON.parse(await readFile(join(cloneDir, "mods", "test-mod.json"), "utf-8"));
    expect(written.id).toBe("test-mod");
    expect(written.latestVersion).toBe("1.0.0");
  });

  it("reuses an existing clone instead of re-cloning", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.isRepo.mockResolvedValue(true);
    const cloneDir = await createTempDir("ebr-clone-");

    await publishMod(await publishOpts(dir, { cloneDir }));

    expect(gitMocks.cloneRepo).not.toHaveBeenCalled();
    expect(gitMocks.setRemoteUrl).toHaveBeenCalledWith(cloneDir, "origin", `${FORK_URL}.git`);
  });

  it("reuses an existing upstream remote instead of adding it", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.hasRemote.mockResolvedValue(true);
    const cloneDir = await createTempDir("ebr-clone-");

    await publishMod(await publishOpts(dir, { cloneDir }));

    expect(gitMocks.addRemote).not.toHaveBeenCalled();
    expect(gitMocks.setRemoteUrl).toHaveBeenCalledWith(
      cloneDir, "upstream", "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry.git",
    );
  });

  it("re-clones when the reused clone is unusable, then publishes", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.isRepo.mockResolvedValue(true);
    // Preparing the reused clone fails once (e.g. partial/corrupt clone), which
    // must trigger a discard-and-reclone rather than aborting the publish.
    gitMocks.setRemoteUrl.mockRejectedValueOnce(new Error("not a git repository"));
    const cloneDir = await createTempDir("ebr-clone-");

    const result = await publishMod(await publishOpts(dir, { cloneDir }));

    // Healed by re-cloning once, then completed the publish.
    expect(gitMocks.cloneRepo).toHaveBeenCalledTimes(1);
    expect(gitMocks.cloneRepo).toHaveBeenCalledWith(`${FORK_URL}.git`, cloneDir, expect.anything());
    expect(gitMocks.checkoutResetBranch).toHaveBeenCalledWith(cloneDir, "publish/test-mod", "upstream/main");
    expect(gitMocks.push).toHaveBeenCalledWith(cloneDir, { remote: "origin", branch: "publish/test-mod", force: true });
    expect(result.compareUrl).toBeTruthy();
  });

  it("propagates when re-cloning also fails, preserving the original error as cause", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.isRepo.mockResolvedValue(true);
    const firstErr = new Error("corrupt clone");
    gitMocks.setRemoteUrl.mockRejectedValueOnce(firstErr);   // first prepare fails -> reclone
    const healErr = new Error("network down");
    gitMocks.fetchRemote.mockRejectedValueOnce(healErr);     // second prepare also fails
    const cloneDir = await createTempDir("ebr-clone-");

    const err = await publishMod(await publishOpts(dir, { cloneDir })).catch((e) => e);

    expect(err).toBe(healErr);
    expect(err.cause).toBe(firstErr);
    // Only one reclone attempt - no retry loop.
    expect(gitMocks.cloneRepo).toHaveBeenCalledTimes(1);
  });

  it("cleans the working tree before switching to the publish branch", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.isRepo.mockResolvedValue(true);
    const cloneDir = await createTempDir("ebr-clone-");

    await publishMod(await publishOpts(dir, { cloneDir }));

    // Reused clones are reset+cleaned so stale files cannot leak into the PR.
    expect(gitMocks.resetHardAndClean).toHaveBeenCalledWith(cloneDir);
    // The scrub must precede the branch reset, or a dirty tree could still leak
    // in (or make `checkout -B` fail nondeterministically).
    const resetOrder = gitMocks.resetHardAndClean.mock.invocationCallOrder[0];
    const checkoutOrder = gitMocks.checkoutResetBranch.mock.invocationCallOrder[0];
    expect(resetOrder).toBeLessThan(checkoutOrder);
  });

  it("throws GithubError when the registry read fails with a non-404 status", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/mods/")) return jsonResponse(500, {});
      throw new Error("unexpected");
    });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
  });

  it("throws GithubError when the registry read throws (network failure)", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/mods/")) throw new Error("network down");
      throw new Error("unexpected");
    });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
  });

  it("throws GithubError when the published entry is not valid JSON", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/mods/")) {
        return { ok: true, status: 200, json: async () => { throw new Error("bad json"); }, text: async () => "not json" };
      }
      throw new Error("unexpected");
    });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
  });

  it("updates an existing mod in the registry", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "2.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.isUpdate).toBe(true);
    expect(result.entry.latestVersion).toBe("2.0.0");
  });

  it("derives the fork owner from the registry fork URL", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir));

    expect(result.compareUrl).toContain("main...test-user:publish/test-mod");
  });

  it("throws when no registry fork URL is configured", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const err = await publishMod({ dir, registryForkUrl: null, fetchImpl: makeFetch() }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
  });

  it("throws ModIdConflictError when mod ID is claimed by a different author", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch({
      modEntry: { author: "OtherAuthor", repoUrl: "https://github.com/other/ebr-mod-base-content" },
    });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(ModIdConflictError);
    expect(err.modId).toBe("test-mod");
    expect(err.existingAuthor).toBe("OtherAuthor");
  });

  it("throws VersionNotHigherError when version equals the published version", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "1.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(VersionNotHigherError);
    expect(err.attemptedVersion).toBe("1.0.0");
    expect(err.publishedVersion).toBe("1.0.0");
  });

  it("throws VersionNotHigherError when version is lower than the published version", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "0.9.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    const err = await publishMod(await publishOpts(dir, { fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(VersionNotHigherError);
  });

  it("allows publishing a strictly higher version", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "2.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));
    expect(result.isUpdate).toBe(true);
    expect(result.entry.latestVersion).toBe("2.0.0");
  });

  it("skips the version gate when the published entry has no latestVersion", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "1.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry() });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));
    expect(result.isUpdate).toBe(true);
  });

  it("skips the version gate when the published latestVersion is unparseable", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "1.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "not-a-version" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));
    expect(result.isUpdate).toBe(true);
  });

  it("writes the higher version into the entry when updating", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "2.0.0" }));
    setupGitMocks();
    const cloneDir = await createTempDir("ebr-clone-");
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    await publishMod(await publishOpts(dir, { fetchImpl, cloneDir }));

    expect(gitMocks.stageFile).toHaveBeenCalledWith(cloneDir, "mods/test-mod.json");
    const written = JSON.parse(await readFile(join(cloneDir, "mods", "test-mod.json"), "utf-8"));
    expect(written.latestVersion).toBe("2.0.0");
  });

  it("compare URL contains new-mod title for new mod", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir));

    expect(result.compareUrl).toContain("title=New+mod");
    expect(result.compareUrl).toContain("New+Mod+Submission");
  });

  it("compare URL contains update title for existing mod", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ version: "2.0.0" }));
    setupGitMocks();
    const fetchImpl = makeFetch({ modEntry: ownEntry({ latestVersion: "1.0.0" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.compareUrl).toContain("title=Update");
  });

  it("throws ManifestError when manifest is invalid", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, { name: "Bad Mod" });
    setupGitMocks();

    await expect(publishMod(await publishOpts(dir))).rejects.toThrow(ManifestError);
  });

  it("throws ManifestError when repoUrl is empty", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest({ repoUrl: "" }));
    setupGitMocks();

    await expect(publishMod(await publishOpts(dir))).rejects.toThrow(ManifestError);
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
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir));

    expect(result.includedModWarnings).toHaveLength(1);
    expect(result.includedModWarnings[0].modId).toBe("does-not-exist");
  });

  it("calls onProgress throughout the flow", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const progress = createProgressCollector();

    await publishMod(await publishOpts(dir), { onProgress: progress.fn });

    expect(progress.steps()).toContain("validate");
    expect(progress.steps()).toContain("check");
    expect(progress.steps()).toContain("commit");
    expect(progress.steps()).toContain("sync");
    expect(progress.steps()).toContain("build");
    expect(progress.steps()).toContain("branch");
    expect(progress.steps()).toContain("write");
    expect(progress.steps()).toContain("push");
    progress.assertValid();
  });

  it("includes the full body in the compare URL with asterisks encoded", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir));

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
    setupGitMocks();
    gitMocks.getStatus.mockResolvedValue({
      isClean: false, modified: ["src/cards.json"], staged: [], created: ["new-file.txt"], conflicted: [],
    });

    const err = await publishMod(await publishOpts(dir)).catch((e) => e);
    expect(err).toBeInstanceOf(UnpushedChangesError);
    expect(err.dirty).toBe(true);
    expect(err.files).toEqual(["src/cards.json", "new-file.txt"]);
  });

  it("throws UnpushedChangesError when commits are ahead of remote", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.getAheadBehind.mockResolvedValue({ ahead: 3, behind: 0, trackingBranch: "origin/main" });

    const err = await publishMod(await publishOpts(dir)).catch((e) => e);
    expect(err).toBeInstanceOf(UnpushedChangesError);
    expect(err.ahead).toBe(3);
  });

  it("bypasses unpushed check when force is true", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.getStatus.mockResolvedValue({
      isClean: false, modified: ["dirty.txt"], staged: [], created: [], conflicted: [],
    });
    gitMocks.getAheadBehind.mockResolvedValue({ ahead: 2, behind: 0, trackingBranch: "origin/main" });

    const result = await publishMod(await publishOpts(dir, { force: true }));

    expect(result.compareUrl).toBeTruthy();
    expect(gitMocks.getStatus).not.toHaveBeenCalled();
    expect(gitMocks.getAheadBehind).not.toHaveBeenCalled();
  });

  it("proceeds when no tracking branch exists and working tree is clean", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    gitMocks.getAheadBehind.mockResolvedValue(null);

    const result = await publishMod(await publishOpts(dir));

    expect(result.compareUrl).toBeTruthy();
  });
});

// --- Automated PR creation via worker ---

describe("publishMod PR worker", () => {
  it("sends a tokenless payload and returns createdPr when the worker opens the PR", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch({
      worker: jsonResponse(201, { number: 42, url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/42" }),
    });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.createdPr).toEqual({
      number: 42,
      url: "https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-registry/pull/42",
    });
    expect(result.prAlreadyExists).toBe(false);
    expect(result.compareUrl).toBeTruthy();

    const postCall = fetchImpl.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall[0]).toBe(WORKER_URL);
    // Tokenless: the request carries no Authorization header.
    expect(postCall[1].headers.Authorization).toBeUndefined();
    const sent = JSON.parse(postCall[1].body);
    expect(sent.forkOwner).toBe("test-user");
    expect(sent.branch).toBe("publish/test-mod");
    expect(sent.title).toContain("New mod");
    expect(sent.body).toContain(COMMIT_SHA.slice(0, 7));
    expect(sent.body).toContain("https://github.com/test/ebr-test-mod/commit/");
  });

  it("falls back to compareUrl when the worker is unreachable", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();

    const result = await publishMod(await publishOpts(dir, { fetchImpl: makeFetch({ worker: "down" }) }));

    expect(result.createdPr).toBeNull();
    expect(result.compareUrl).toBeTruthy();
  });

  it("falls back to compareUrl when the worker returns non-2xx", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch({ worker: jsonResponse(502, { error: "boom" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.createdPr).toBeNull();
    expect(result.compareUrl).toBeTruthy();
  });

  it("reports the worker failure reason via onProgress", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const worker = { ok: false, status: 502, text: async () => "boom", json: async () => ({}) };
    const fetchImpl = makeFetch({ worker });
    const progress = { fn: vi.fn() };

    const result = await publishMod(await publishOpts(dir, { fetchImpl }), { onProgress: progress.fn });

    expect(result.createdPr).toBeNull();
    const failed = progress.fn.mock.calls.find((c) => c[0].step === "create-pr-failed");
    expect(failed).toBeTruthy();
    expect(failed[0].message).toContain("502");
    expect(failed[0].message).toContain("boom");
  });

  it("falls back when the worker returns a malformed body", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch({ worker: jsonResponse(200, { unexpected: true }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.createdPr).toBeNull();
  });

  it("reports prAlreadyExists when the worker returns 409", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch({ worker: jsonResponse(409, { error: "A pull request already exists for this branch" }) });

    const result = await publishMod(await publishOpts(dir, { fetchImpl }));

    expect(result.createdPr).toBeNull();
    expect(result.prAlreadyExists).toBe(true);
    expect(result.compareUrl).toBeTruthy();
  });

  it("skips the worker when prWorkerUrl is null", async () => {
    const dir = await createTempDir();
    await writeManifestFile(dir, validManifest());
    setupGitMocks();
    const fetchImpl = makeFetch();

    const result = await publishMod(await publishOpts(dir, { fetchImpl, prWorkerUrl: null }));

    expect(result.createdPr).toBeNull();
    const postCall = fetchImpl.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall).toBeUndefined();
  });
});
