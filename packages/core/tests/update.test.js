import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProgressCollector } from "./helpers.js";

// --- Mock git.js at the module level ---

const gitMocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  hasRemote: vi.fn(),
  fetchRemote: vi.fn(),
  isAncestor: vi.fn(),
  mergeBase: vi.fn(),
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

vi.mock("../src/git.js", () => gitMocks);
vi.mock("../src/manifest.js", () => manifestMocks);

// Import AFTER mocks are set up
import {
  checkBaseUpdate,
  applyBaseUpdate,
  checkIncludedCampaignsUpdates,
} from "../src/workflows.js";
import { NotARepoError, BaseRemoteMissingError, ManifestNotFoundError } from "../src/errors.js";
import { OFFICIAL_CAMPAIGNS } from "../src/catalogs.js";

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

const SHELL_REF = "base/main";

/** Strip the remote campaign-branch prefix (and any merge-base marker) to an id. */
function idFromRef(ref) {
  return ref.replace(/^mb:/, "").replace("base/campaign/", "");
}

/**
 * Model a repo in which `merged` campaigns are present in HEAD and `upToDate`
 * campaigns are merged all the way to the current branch tip.
 *
 * Inclusion is derived from ancestry, not the manifest: the merge-base of HEAD
 * and a campaign branch lies beyond the shell `main` exactly when that campaign
 * was merged in, so `isAncestor(mergeBase, base/main)` is false for a merged
 * campaign and true for one that was never taken.
 */
function campaignRepo({ merged = [], upToDate = [] } = {}) {
  const mergedSet = new Set(merged);
  const upToDateSet = new Set(upToDate);

  gitMocks.mergeBase.mockImplementation((_dir, head, ref) => {
    expect(head).toBe("HEAD");
    return Promise.resolve(`mb:${ref}`);
  });

  gitMocks.isAncestor.mockImplementation((_dir, ref, target) => {
    if (target === SHELL_REF) {
      return Promise.resolve(!mergedSet.has(idFromRef(ref)));
    }
    expect(target).toBe("HEAD");
    return Promise.resolve(upToDateSet.has(idFromRef(ref)));
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
  gitMocks.mergeBase.mockResolvedValue(null);
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
  const SHA_NEW = "a".repeat(40);

  it("throws NotARepoError when dir is not a git repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBeInstanceOf(
      NotARepoError,
    );
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws BaseRemoteMissingError when the base remote is not configured", async () => {
    gitMocks.hasRemote.mockImplementation((_dir, name) =>
      Promise.resolve(name !== "base"),
    );
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBeInstanceOf(
      BaseRemoteMissingError,
    );
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("never reads the manifest - inclusion comes from git history", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"], upToDate: ["lure-of-the-valley"] });

    await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(manifestMocks.readManifest).not.toHaveBeenCalled();
  });

  it("returns no updates when no campaign has been merged", async () => {
    campaignRepo({ merged: [] });

    const result = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(result).toEqual({ updates: [] });
  });

  it("fetches the base remote exactly once", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"], upToDate: ["lure-of-the-valley"] });

    await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(gitMocks.fetchRemote).toHaveBeenCalledTimes(1);
    expect(gitMocks.fetchRemote).toHaveBeenCalledWith(DIR, "base", expect.any(Object));
  });

  it("reports updateAvailable=false when the campaign branch tip is already an ancestor of HEAD", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"], upToDate: ["lure-of-the-valley"] });
    gitMocks.revparseRef.mockResolvedValue(SHA_NEW);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toEqual([
      {
        id: "lure-of-the-valley",
        branch: "campaign/lure-of-the-valley",
        newCommitHash: SHA_NEW,
        updateAvailable: false,
      },
    ]);
    // revparseRef and isAncestor must use the same ref string so a future
    // change to one cannot silently desync from the other.
    expect(gitMocks.isAncestor).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
      "HEAD",
    );
    expect(gitMocks.revparseRef).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
    );
  });

  it("reports updateAvailable=true when the campaign branch tip is ahead of HEAD", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"], upToDate: [] });
    gitMocks.revparseRef.mockResolvedValue(SHA_NEW);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "lure-of-the-valley",
      updateAvailable: true,
      newCommitHash: SHA_NEW,
    });
  });

  it("decides inclusion by merge-base against the shell main, not the branch tip", async () => {
    // A campaign merged at an older commit is still included even though its
    // tip is not an ancestor of HEAD - that is precisely the update case.
    campaignRepo({ merged: ["spire-in-bloom"], upToDate: [] });

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates.map((u) => u.id)).toEqual(["spire-in-bloom"]);
    expect(gitMocks.mergeBase).toHaveBeenCalledWith(
      DIR,
      "HEAD",
      "base/campaign/spire-in-bloom",
    );
    expect(gitMocks.isAncestor).toHaveBeenCalledWith(
      DIR,
      "mb:base/campaign/spire-in-bloom",
      SHELL_REF,
    );
  });

  it("treats a campaign with no shared history as not merged", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"] });
    gitMocks.mergeBase.mockResolvedValue(null);

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toEqual([]);
  });

  it("reports every merged campaign, in catalog order", async () => {
    campaignRepo({
      merged: ["spire-in-bloom", "lure-of-the-valley"],
      upToDate: ["lure-of-the-valley"],
    });

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    const catalogOrder = OFFICIAL_CAMPAIGNS.map((c) => c.id).filter((id) =>
      ["lure-of-the-valley", "spire-in-bloom"].includes(id),
    );
    expect(updates.map((u) => u.id)).toEqual(catalogOrder);
    expect(updates.find((u) => u.id === "lure-of-the-valley").updateAvailable).toBe(false);
    expect(updates.find((u) => u.id === "spire-in-bloom").updateAvailable).toBe(true);
  });

  it("skips a campaign whose branch is absent from the remote", async () => {
    // Nothing to compare against and nothing to update from, so it drops out
    // of the walk rather than being reported.
    campaignRepo({ merged: ["lure-of-the-valley", "spire-in-bloom"], upToDate: [] });
    gitMocks.revparseRef.mockImplementation((_dir, ref) => {
      if (ref.endsWith("/spire-in-bloom")) return Promise.reject(new Error("bad ref"));
      return Promise.resolve(SHA_NEW);
    });

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates.map((u) => u.id)).toEqual(["lure-of-the-valley"]);
    // A branch missing on the remote must not abort the walk.
    expect(updates[0].updateAvailable).toBe(true);
  });

  it("does not consult ancestry for a branch that is absent from the remote", async () => {
    campaignRepo({ merged: [] });
    gitMocks.revparseRef.mockRejectedValue(new Error("bad ref"));

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates).toEqual([]);
    expect(gitMocks.mergeBase).not.toHaveBeenCalled();
    expect(gitMocks.isAncestor).not.toHaveBeenCalled();
  });

  it("invokes onProgress with fetch and per-campaign check steps", async () => {
    campaignRepo({ merged: ["lure-of-the-valley"], upToDate: ["lure-of-the-valley"] });
    const progress = createProgressCollector();

    await checkIncludedCampaignsUpdates({ dir: DIR }, { onProgress: progress.fn });

    const steps = progress.steps();
    expect(steps).toContain("fetch");
    expect(steps.filter((s) => s === "check")).toHaveLength(OFFICIAL_CAMPAIGNS.length);
    progress.assertValid();
  });

  it("forwards onProgress to fetchRemote", async () => {
    campaignRepo({ merged: [] });
    const progress = createProgressCollector();

    await checkIncludedCampaignsUpdates({ dir: DIR }, { onProgress: progress.fn });

    const [, , opts] = gitMocks.fetchRemote.mock.calls[0];
    expect(typeof opts?.onProgress).toBe("function");
  });

  it("works when no callbacks object is passed", async () => {
    campaignRepo({ merged: [] });
    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).resolves.toEqual({
      updates: [],
    });
  });

  it("propagates errors from isAncestor unchanged", async () => {
    const err = new Error("bad ref: base/campaign/lure-of-the-valley");
    gitMocks.mergeBase.mockResolvedValue("mb");
    gitMocks.isAncestor.mockRejectedValue(err);

    await expect(checkIncludedCampaignsUpdates({ dir: DIR })).rejects.toBe(err);
  });

  it("a campaign absorbed transitively via includeMod counts as merged and is offered an update", async () => {
    // A campaign whose commits arrived in HEAD via 'ebr include <mod>' -- where
    // that mod had itself included the campaign -- has the same git ancestry
    // signature as a direct include.
    campaignRepo({ merged: ["spire-in-bloom"], upToDate: [] });

    const { updates } = await checkIncludedCampaignsUpdates({ dir: DIR });

    expect(updates.map((u) => u.id)).toContain("spire-in-bloom");
    expect(updates.find((u) => u.id === "spire-in-bloom").updateAvailable).toBe(true);
    // Pure git-history detection: manifest is never consulted.
    expect(manifestMocks.readManifest).not.toHaveBeenCalled();
  });
});

