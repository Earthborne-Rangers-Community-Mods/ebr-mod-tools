import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProgressCollector } from "../helpers.js";

// --- Mock git.js at the module level ---

const gitMocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  hasRemote: vi.fn(),
  fetchRemote: vi.fn(),
  isAncestor: vi.fn(),
  merge: vi.fn(),
  revparseRef: vi.fn(),
}));

const manifestMocks = vi.hoisted(() => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  validateManifest: vi.fn(() => []),
  formatValidationErrors: vi.fn(() => []),
  updateManifest: vi.fn(),
}));

vi.mock("../../src/core/git.js", () => gitMocks);
vi.mock("../../src/core/manifest.js", () => manifestMocks);

// Import AFTER mocks are set up
import {
  checkBaseUpdate,
  applyBaseUpdate,
  checkIncludedCampaignsUpdates,
} from "../../src/core/workflows.js";
import { NotARepoError, BaseRemoteMissingError, ManifestNotFoundError } from "../../src/core/errors.js";

// --- Helpers ---

const DIR = "/tmp/some-mod";

/**
 * Configure isAncestor to return true for any ref in `merged` and false otherwise.
 * @param {string[]} merged - Refs that should be reported as ancestors of HEAD.
 */
function ancestorsOfHead(merged) {
  const set = new Set(merged);
  gitMocks.isAncestor.mockImplementation((_dir, ref, head) => {
    expect(head).toBe("HEAD");
    return Promise.resolve(set.has(ref));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: valid repo with a base remote.
  gitMocks.isRepo.mockResolvedValue(true);
  gitMocks.hasRemote.mockResolvedValue(true);
  gitMocks.fetchRemote.mockResolvedValue(undefined);
  gitMocks.merge.mockResolvedValue(undefined);
  gitMocks.revparseRef.mockResolvedValue("a".repeat(40));
  manifestMocks.readManifest.mockResolvedValue({ id: "test" });
});

// --- checkBaseUpdate ---

describe("checkBaseUpdate", () => {
  it("throws NotARepoError when dir is not a git repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(checkBaseUpdate({ dir: DIR })).rejects.toBeInstanceOf(NotARepoError);
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws BaseRemoteMissingError when the base remote is not configured", async () => {
    gitMocks.hasRemote.mockImplementation((_dir, name) =>
      Promise.resolve(name !== "base"),
    );
    await expect(checkBaseUpdate({ dir: DIR })).rejects.toBeInstanceOf(
      BaseRemoteMissingError,
    );
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("propagates errors from fetchRemote", async () => {
    const err = new Error("network timeout");
    gitMocks.fetchRemote.mockRejectedValue(err);

    await expect(checkBaseUpdate({ dir: DIR })).rejects.toBe(err);
    expect(gitMocks.isAncestor).not.toHaveBeenCalled();
  });

  it("propagates errors from isAncestor", async () => {
    const err = new Error("bad ref: base/main");
    gitMocks.isAncestor.mockRejectedValue(err);

    await expect(checkBaseUpdate({ dir: DIR })).rejects.toBe(err);
  });

  it("checks specifically for the `base` remote", async () => {
    ancestorsOfHead(["base/main"]);
    await checkBaseUpdate({ dir: DIR });
    expect(gitMocks.hasRemote).toHaveBeenCalledWith(DIR, "base");
  });

  it("returns updateAvailable=false when base/main is already an ancestor of HEAD", async () => {
    ancestorsOfHead(["base/main"]);

    const result = await checkBaseUpdate({ dir: DIR });

    expect(result).toEqual({ updateAvailable: false });
  });

  it("returns updateAvailable=true when base/main is not an ancestor of HEAD", async () => {
    ancestorsOfHead([]);

    const result = await checkBaseUpdate({ dir: DIR });

    expect(result).toEqual({ updateAvailable: true });
  });

  it("fetches the base remote before checking ancestry", async () => {
    const callOrder = [];
    gitMocks.fetchRemote.mockImplementation(() => {
      callOrder.push("fetch");
      return Promise.resolve();
    });
    gitMocks.isAncestor.mockImplementation(() => {
      callOrder.push("isAncestor");
      return Promise.resolve(true);
    });

    await checkBaseUpdate({ dir: DIR });

    expect(callOrder).toEqual(["fetch", "isAncestor"]);
    expect(gitMocks.fetchRemote).toHaveBeenCalledWith(
      DIR,
      "base",
      expect.any(Object),
    );
  });

  it("invokes onProgress with the fetch step", async () => {
    ancestorsOfHead(["base/main"]);
    const progress = createProgressCollector();

    await checkBaseUpdate({ dir: DIR }, { onProgress: progress.fn });

    expect(progress.steps()).toContain("fetch");
    progress.assertValid();
  });

  it("forwards onProgress to fetchRemote", async () => {
    ancestorsOfHead(["base/main"]);
    const progress = createProgressCollector();

    await checkBaseUpdate({ dir: DIR }, { onProgress: progress.fn });

    const [, , opts] = gitMocks.fetchRemote.mock.calls[0];
    expect(opts).toBeDefined();
    expect(typeof opts.onProgress).toBe("function");
  });

  it("works when no callbacks object is passed", async () => {
    ancestorsOfHead(["base/main"]);
    await expect(checkBaseUpdate({ dir: DIR })).resolves.toEqual({
      updateAvailable: false,
    });
  });
});

// --- applyBaseUpdate ---

describe("applyBaseUpdate", () => {
  it("throws NotARepoError when dir is not a git repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(applyBaseUpdate({ dir: DIR })).rejects.toBeInstanceOf(
      NotARepoError,
    );
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws BaseRemoteMissingError when the base remote is not configured", async () => {
    gitMocks.hasRemote.mockImplementation((_dir, name) =>
      Promise.resolve(name !== "base"),
    );
    await expect(applyBaseUpdate({ dir: DIR })).rejects.toBeInstanceOf(
      BaseRemoteMissingError,
    );
    expect(gitMocks.merge).not.toHaveBeenCalled();
  });

  it("merges base/main and returns { merged: true }", async () => {
    const result = await applyBaseUpdate({ dir: DIR });

    expect(result).toEqual({ merged: true });
    expect(gitMocks.merge).toHaveBeenCalledWith(
      DIR,
      "base/main",
      expect.any(Object),
    );
  });

  it("invokes onProgress with the merge step", async () => {
    const progress = createProgressCollector();

    await applyBaseUpdate({ dir: DIR }, { onProgress: progress.fn });

    expect(progress.steps()).toContain("merge");
    progress.assertValid();
  });

  it("forwards onProgress to merge", async () => {
    const progress = createProgressCollector();

    await applyBaseUpdate({ dir: DIR }, { onProgress: progress.fn });

    const [, , opts] = gitMocks.merge.mock.calls[0];
    expect(opts).toBeDefined();
    expect(typeof opts.onProgress).toBe("function");
  });

  it("propagates errors from merge unchanged", async () => {
    class FakeMergeConflict extends Error {
      constructor() {
        super("conflict");
        this.name = "MergeConflictError";
      }
    }
    const err = new FakeMergeConflict();
    gitMocks.merge.mockRejectedValue(err);

    await expect(applyBaseUpdate({ dir: DIR })).rejects.toBe(err);
  });

  it("works when no callbacks object is passed", async () => {
    await expect(applyBaseUpdate({ dir: DIR })).resolves.toEqual({
      merged: true,
    });
  });
});

// --- checkIncludedCampaignsUpdates ---

describe("checkIncludedCampaignsUpdates", () => {
  const SHA_OLD = "0".repeat(40);
  const SHA_NEW = "a".repeat(40);

  function entry(id, branch, commitHash = SHA_OLD) {
    return { id, branch, commitHash };
  }

  it("throws NotARepoError when dir is not a git repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBeInstanceOf(
      NotARepoError,
    );
    expect(manifestMocks.readManifest).not.toHaveBeenCalled();
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws BaseRemoteMissingError when the base remote is not configured", async () => {
    gitMocks.hasRemote.mockImplementation((_dir, name) =>
      Promise.resolve(name !== "base"),
    );
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBeInstanceOf(
      BaseRemoteMissingError,
    );
    expect(manifestMocks.readManifest).not.toHaveBeenCalled();
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("propagates ManifestNotFoundError from readManifest", async () => {
    manifestMocks.readManifest.mockRejectedValue(new ManifestNotFoundError(DIR));
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBeInstanceOf(
      ManifestNotFoundError,
    );
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("returns empty updates when manifest has no includedCampaigns and skips fetch", async () => {
    manifestMocks.readManifest.mockResolvedValue({ id: "test" });

    const result = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(result).toEqual({ updates: [] });
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    expect(gitMocks.revparseRef).not.toHaveBeenCalled();
    expect(gitMocks.isAncestor).not.toHaveBeenCalled();
  });

  it("treats a non-array includedCampaigns as empty", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: "not-an-array",
    });

    const result = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(result).toEqual({ updates: [] });
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("fetches the base remote once before checking entries", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        entry("lure-of-the-valley", "campaign/lure-of-the-valley"),
        entry("spire-in-bloom", "campaign/spire-in-bloom"),
      ],
    });
    gitMocks.isAncestor.mockResolvedValue(true);

    await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(gitMocks.fetchRemote).toHaveBeenCalledTimes(1);
    expect(gitMocks.fetchRemote).toHaveBeenCalledWith(DIR, "base", expect.any(Object));
  });

  it("reports updateAvailable=false when the campaign branch tip is already an ancestor of HEAD", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [entry("lure-of-the-valley", "campaign/lure-of-the-valley")],
    });
    gitMocks.revparseRef.mockResolvedValue(SHA_NEW);
    gitMocks.isAncestor.mockResolvedValue(true);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toEqual([
      {
        id: "lure-of-the-valley",
        branch: "campaign/lure-of-the-valley",
        oldCommitHash: SHA_OLD,
        newCommitHash: SHA_NEW,
        updateAvailable: false,
        missing: false,
      },
    ]);
    // Mirrors the shell-main check: ref vs HEAD, not the recorded hash.
    expect(gitMocks.isAncestor).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
      "HEAD",
    );
    // revparseRef and isAncestor must use the same ref string so a future
    // change to one cannot silently desync from the other.
    expect(gitMocks.revparseRef).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
    );
  });

  it("reports updateAvailable=true when the campaign branch tip is ahead of HEAD", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [entry("lure-of-the-valley", "campaign/lure-of-the-valley")],
    });
    gitMocks.revparseRef.mockResolvedValue(SHA_NEW);
    gitMocks.isAncestor.mockResolvedValue(false);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "lure-of-the-valley",
      updateAvailable: true,
      newCommitHash: SHA_NEW,
      oldCommitHash: SHA_OLD,
      missing: false,
    });
  });

  it("walks every entry in includedCampaigns and preserves order", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        entry("lure-of-the-valley", "campaign/lure-of-the-valley", "1".repeat(40)),
        entry("spire-in-bloom", "campaign/spire-in-bloom", "2".repeat(40)),
      ],
    });
    // Lure tip already in HEAD (up to date); Spire tip ahead (update available).
    gitMocks.revparseRef.mockImplementation((_dir, ref) =>
      Promise.resolve(ref.endsWith("/lure-of-the-valley") ? "a".repeat(40) : "b".repeat(40)),
    );
    gitMocks.isAncestor.mockImplementation((_dir, ref) =>
      Promise.resolve(ref.endsWith("/lure-of-the-valley")),
    );

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates.map((u) => u.id)).toEqual(["lure-of-the-valley", "spire-in-bloom"]);
    expect(updates[0].updateAvailable).toBe(false);
    expect(updates[1].updateAvailable).toBe(true);
  });

  it("marks an entry missing when the campaign branch cannot be resolved on base", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        entry("ghost-campaign", "campaign/ghost-campaign", "deadbeef".padEnd(40, "0")),
        entry("lure-of-the-valley", "campaign/lure-of-the-valley"),
      ],
    });
    gitMocks.revparseRef.mockImplementation((_dir, ref) => {
      if (ref.endsWith("/ghost-campaign")) return Promise.reject(new Error("bad ref"));
      return Promise.resolve(SHA_NEW);
    });
    gitMocks.isAncestor.mockResolvedValue(false);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      id: "ghost-campaign",
      missing: true,
      updateAvailable: false,
      newCommitHash: null,
    });
    // A missing branch must not abort the walk.
    expect(updates[1]).toMatchObject({
      id: "lure-of-the-valley",
      missing: false,
      updateAvailable: true,
    });
    // isAncestor is not called for the missing entry.
    expect(gitMocks.isAncestor).toHaveBeenCalledTimes(1);
    expect(gitMocks.isAncestor).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
      "HEAD",
    );
  });

  it("invokes onProgress with fetch and per-entry check steps", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        entry("lure-of-the-valley", "campaign/lure-of-the-valley"),
        entry("spire-in-bloom", "campaign/spire-in-bloom"),
      ],
    });
    gitMocks.isAncestor.mockResolvedValue(true);
    const progress = createProgressCollector();

    await checkIncludedCampaignsUpdates({ dir: DIR }, { onProgress: progress.fn });

    const steps = progress.steps();
    expect(steps).toContain("fetch");
    expect(steps.filter((s) => s === "check")).toHaveLength(2);
    progress.assertValid();
  });

  it("forwards onProgress to fetchRemote", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [entry("lure-of-the-valley", "campaign/lure-of-the-valley")],
    });
    gitMocks.isAncestor.mockResolvedValue(true);
    const progress = createProgressCollector();

    await checkIncludedCampaignsUpdates({ dir: DIR }, { onProgress: progress.fn });

    const [, , opts] = gitMocks.fetchRemote.mock.calls[0];
    expect(typeof opts?.onProgress).toBe("function");
  });

  it("works when no callbacks object is passed", async () => {
    manifestMocks.readManifest.mockResolvedValue({ id: "test" });
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).resolves.toEqual({
      updates: [],
    });
  });

  it("propagates errors from isAncestor unchanged", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [entry("lure-of-the-valley", "campaign/lure-of-the-valley")],
    });
    const err = new Error("bad ref: base/campaign/lure-of-the-valley");
    gitMocks.isAncestor.mockRejectedValue(err);

    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBe(err);
  });

  it("does not call isAncestor at all when every entry is missing on base", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        entry("ghost-one", "campaign/ghost-one"),
        entry("ghost-two", "campaign/ghost-two"),
      ],
    });
    gitMocks.revparseRef.mockRejectedValue(new Error("bad ref"));

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toHaveLength(2);
    expect(updates.every((u) => u.missing === true)).toBe(true);
    expect(gitMocks.isAncestor).not.toHaveBeenCalled();
  });
});

