import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProgressCollector } from "../helpers.js";

// --- Mock git.js and manifest.js at the module level ---

const gitMocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  hasRemote: vi.fn(),
  fetchRemote: vi.fn(),
  isAncestor: vi.fn(),
  merge: vi.fn(),
  revparseRef: vi.fn(),
  stageByExtensions: vi.fn(),
  stageFile: vi.fn(),
  commit: vi.fn(),
  getStatus: vi.fn(),
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

// Import AFTER mocks
import {
  includeCampaign,
  resolveCampaignSource,
  upsertIncludedCampaign,
} from "../../src/core/workflows.js";
import {
  NotARepoError,
  BaseRemoteMissingError,
  IncludeRefNotFoundError,
  IndexNotCleanError,
  ValidationError,
  MergeConflictError,
  ManifestNotFoundError,
  NothingToCommitError,
} from "../../src/core/errors.js";

const DIR = "/tmp/some-mod";
const SHA = "a".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.isRepo.mockResolvedValue(true);
  gitMocks.hasRemote.mockResolvedValue(true);
  gitMocks.fetchRemote.mockResolvedValue(undefined);
  gitMocks.merge.mockResolvedValue(undefined);
  gitMocks.revparseRef.mockResolvedValue(SHA);
  gitMocks.stageByExtensions.mockResolvedValue(undefined);
  gitMocks.stageFile.mockResolvedValue(undefined);
  gitMocks.commit.mockResolvedValue(undefined);
  gitMocks.getStatus.mockResolvedValue({
    isClean: true,
    modified: [],
    staged: [],
    conflicted: [],
    created: [],
  });
  manifestMocks.readManifest.mockResolvedValue({
    name: "Test",
    id: "test",
    version: "0.1.0",
    type: "enhancement",
  });
  manifestMocks.writeManifest.mockResolvedValue(undefined);
});

// --- resolveCampaignSource ---

describe("resolveCampaignSource", () => {
  it("accepts a bare campaign id", () => {
    expect(resolveCampaignSource("lure-of-the-valley")).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
    });
  });

  it("accepts a full campaign/<id> ref", () => {
    expect(resolveCampaignSource("campaign/spire-in-bloom")).toEqual({
      campaignId: "spire-in-bloom",
      branch: "campaign/spire-in-bloom",
    });
  });

  it("trims whitespace", () => {
    expect(resolveCampaignSource("  lure-of-the-valley  ")).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
    });
  });

  it("rejects empty strings", () => {
    expect(() => resolveCampaignSource("")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("   ")).toThrow(ValidationError);
  });

  it("rejects non-strings", () => {
    expect(() => resolveCampaignSource(undefined)).toThrow(ValidationError);
    expect(() => resolveCampaignSource(null)).toThrow(ValidationError);
    expect(() => resolveCampaignSource(42)).toThrow(ValidationError);
  });

  it("rejects sources with unrecognized prefixes containing a slash", () => {
    expect(() => resolveCampaignSource("mod/foo")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("https://github.com/x/y")).toThrow(ValidationError);
  });

  it("rejects an empty campaign id from a bare 'campaign/' input", () => {
    expect(() => resolveCampaignSource("campaign/")).toThrow(ValidationError);
  });

  it("rejects a campaign/<id> source where the id contains a slash", () => {
    expect(() => resolveCampaignSource("campaign/foo/bar")).toThrow(ValidationError);
  });

  it("rejects ids that are not in OFFICIAL_CAMPAIGNS", () => {
    expect(() => resolveCampaignSource("not-a-real-campaign")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("Foo Bar")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("campaign/totally-fake")).toThrow(ValidationError);
  });

  it("error message lists the known campaign ids when an id is unknown", () => {
    let err;
    try { resolveCampaignSource("not-a-real-campaign"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("lure-of-the-valley");
    expect(err.message).toContain("shadow-of-the-storm");
  });
});

// --- upsertIncludedCampaign ---

describe("upsertIncludedCampaign", () => {
  const ENTRY = { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: SHA };

  it("adds an entry to an empty/undefined list", () => {
    expect(upsertIncludedCampaign(undefined, ENTRY)).toEqual([ENTRY]);
    expect(upsertIncludedCampaign([], ENTRY)).toEqual([ENTRY]);
  });

  it("appends a new entry when id is not present", () => {
    const existing = [{ id: "spire-in-bloom", branch: "campaign/spire-in-bloom", commitHash: "b".repeat(40) }];
    const result = upsertIncludedCampaign(existing, ENTRY);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(ENTRY);
  });

  it("replaces an existing entry with the same id (preserving order)", () => {
    const stale = { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "0".repeat(40) };
    const sibling = { id: "spire-in-bloom", branch: "campaign/spire-in-bloom", commitHash: "b".repeat(40) };
    const result = upsertIncludedCampaign([stale, sibling], ENTRY);
    expect(result).toEqual([ENTRY, sibling]);
  });

  it("does not mutate the input array", () => {
    const existing = [{ id: "spire-in-bloom", branch: "campaign/spire-in-bloom", commitHash: "b".repeat(40) }];
    const snapshot = JSON.stringify(existing);
    upsertIncludedCampaign(existing, ENTRY);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("tolerates non-array existing values", () => {
    expect(upsertIncludedCampaign(null, ENTRY)).toEqual([ENTRY]);
    expect(upsertIncludedCampaign("nope", ENTRY)).toEqual([ENTRY]);
  });

  it("replaces only the first match when input contains duplicate ids (documents current behavior)", () => {
    const dup1 = { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "0".repeat(40) };
    const dup2 = { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "1".repeat(40) };
    const result = upsertIncludedCampaign([dup1, dup2], ENTRY);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(ENTRY);
    expect(result[1]).toEqual(dup2);
  });
});

// --- includeCampaign ---

describe("includeCampaign", () => {
  it("throws ValidationError when source is malformed (before touching git)", async () => {
    await expect(includeCampaign({ dir: DIR, source: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(gitMocks.isRepo).not.toHaveBeenCalled();
  });

  it("throws NotARepoError when dir is not a git repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(NotARepoError);
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws BaseRemoteMissingError when the base remote is not configured", async () => {
    gitMocks.hasRemote.mockImplementation((_dir, name) => Promise.resolve(name !== "base"));
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(BaseRemoteMissingError);
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws IndexNotCleanError when there are already staged changes", async () => {
    gitMocks.getStatus.mockResolvedValue({
      isClean: false,
      modified: [],
      staged: ["content/encounters/foo.md"],
      conflicted: [],
      created: [],
    });
    let err;
    try {
      await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IndexNotCleanError);
    expect(err.staged).toEqual(["content/encounters/foo.md"]);
    // Critical: bail out before reading manifest, fetching, staging, or merging.
    expect(manifestMocks.readManifest).not.toHaveBeenCalled();
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).not.toHaveBeenCalled();
    expect(gitMocks.merge).not.toHaveBeenCalled();
  });

  it("propagates ManifestNotFoundError from readManifest", async () => {
    manifestMocks.readManifest.mockRejectedValue(new ManifestNotFoundError(DIR));
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(ManifestNotFoundError);
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws IncludeRefNotFoundError when revparseRef fails", async () => {
    gitMocks.revparseRef.mockRejectedValue(new Error("bad ref"));
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(IncludeRefNotFoundError);
    expect(gitMocks.merge).not.toHaveBeenCalled();
  });

  it("propagates MergeConflictError; manifest is written and staged in the conflict path so `git merge --continue` includes it", async () => {
    const conflict = new MergeConflictError(["content/foo.md"]);
    gitMocks.merge.mockRejectedValue(conflict);

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBe(conflict);

    // Manifest is written + staged so `git merge --continue` rolls it into
    // the merge commit.
    expect(manifestMocks.writeManifest).toHaveBeenCalledTimes(1);
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
    // No success-path commit on the conflict path.
    expect(gitMocks.commit).not.toHaveBeenCalled();
  });

  it("attaches campaignId/branch/commitHash to MergeConflictError so the CLI can render a recovery hint", async () => {
    const conflict = new MergeConflictError(["content/foo.md"]);
    gitMocks.merge.mockRejectedValue(conflict);

    const err = await includeCampaign({ dir: DIR, source: "lure-of-the-valley" }).catch((e) => e);

    expect(err).toBe(conflict);
    expect(err.campaignId).toBe("lure-of-the-valley");
    expect(err.branch).toBe("campaign/lure-of-the-valley");
    expect(err.commitHash).toBe(SHA);
  });

  it("performs fetch -> resolve -> merge -> write -> stage -> commit in order (merge before manifest)", async () => {
    const order = [];
    gitMocks.fetchRemote.mockImplementation(() => { order.push("fetch"); return Promise.resolve(); });
    gitMocks.revparseRef.mockImplementation(() => { order.push("resolve"); return Promise.resolve(SHA); });
    gitMocks.merge.mockImplementation(() => { order.push("merge"); return Promise.resolve(); });
    manifestMocks.writeManifest.mockImplementation(() => { order.push("write"); return Promise.resolve(); });
    gitMocks.stageFile.mockImplementation(() => { order.push("stage"); return Promise.resolve(); });
    gitMocks.commit.mockImplementation(() => { order.push("commit"); return Promise.resolve(); });

    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(order).toEqual(["fetch", "resolve", "merge", "write", "stage", "commit"]);
  });

  it("merges with noCommit=true so the manifest update lands in the same merge commit", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });
    const opts = gitMocks.merge.mock.calls[0][2];
    expect(opts).toMatchObject({ noCommit: true });
  });

  it("does not write or stage the manifest on a non-conflict merge failure", async () => {
    gitMocks.merge.mockRejectedValue(new Error("some non-conflict failure"));

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toThrow();

    // Manifest hasn't been touched - aborting the merge restores everything.
    expect(manifestMocks.writeManifest).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).not.toHaveBeenCalled();
    expect(gitMocks.commit).not.toHaveBeenCalled();
  });

  it("merges base/campaign/<id> against the resolved branch", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });
    expect(gitMocks.merge).toHaveBeenCalledWith(
      DIR,
      "base/campaign/lure-of-the-valley",
      expect.any(Object),
    );
    expect(gitMocks.revparseRef).toHaveBeenCalledWith(DIR, "base/campaign/lure-of-the-valley");
  });

  it("accepts a full campaign/<id> source", async () => {
    await includeCampaign({ dir: DIR, source: "campaign/spire-in-bloom" });
    expect(gitMocks.merge).toHaveBeenCalledWith(
      DIR,
      "base/campaign/spire-in-bloom",
      expect.any(Object),
    );
  });

  it("appends a new includedCampaigns entry on first include", async () => {
    manifestMocks.readManifest.mockResolvedValue({ id: "test" });

    const result = await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(result).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
      commitHash: SHA,
      alreadyUpToDate: false,
    });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.includedCampaigns).toEqual([
      { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: SHA },
    ]);
  });

  it("replaces an existing includedCampaigns entry with a new commitHash", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "0".repeat(40) },
        { id: "spire-in-bloom", branch: "campaign/spire-in-bloom", commitHash: "b".repeat(40) },
      ],
    });

    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.includedCampaigns).toEqual([
      { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: SHA },
      { id: "spire-in-bloom", branch: "campaign/spire-in-bloom", commitHash: "b".repeat(40) },
    ]);
  });

  it("commits with a message that references the branch and short SHA", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
    const [, message] = gitMocks.commit.mock.calls[0];
    expect(message).toContain("campaign/lure-of-the-valley");
    expect(message).toContain(SHA.slice(0, 7));
  });

  it("stages only ebr-mod.json (not all .json files)", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
    expect(gitMocks.stageByExtensions).not.toHaveBeenCalled();
  });

  it("returns alreadyUpToDate=true when commit fails with NothingToCommitError (no-op re-include)", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      includedCampaigns: [
        { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: SHA },
      ],
    });
    gitMocks.commit.mockRejectedValue(new NothingToCommitError());

    const result = await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(result).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
      commitHash: SHA,
      alreadyUpToDate: true,
    });
  });

  it("propagates non-NothingToCommitError commit failures", async () => {
    const boom = new Error("disk full");
    gitMocks.commit.mockRejectedValue(boom);

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBe(boom);
  });

  it("invokes onProgress with the expected steps", async () => {
    const progress = createProgressCollector();
    await includeCampaign(
      { dir: DIR, source: "lure-of-the-valley" },
      { onProgress: progress.fn },
    );

    const steps = progress.steps();
    for (const step of ["fetch", "resolve", "merge", "manifest", "commit"]) {
      expect(steps).toContain(step);
    }
    progress.assertValid();
  });

  it("forwards onProgress to fetchRemote and merge", async () => {
    const progress = createProgressCollector();
    await includeCampaign(
      { dir: DIR, source: "lure-of-the-valley" },
      { onProgress: progress.fn },
    );

    const fetchOpts = gitMocks.fetchRemote.mock.calls[0][2];
    expect(typeof fetchOpts?.onProgress).toBe("function");
    const mergeOpts = gitMocks.merge.mock.calls[0][2];
    expect(typeof mergeOpts?.onProgress).toBe("function");
  });

  it("works when no callbacks object is passed", async () => {
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).resolves.toMatchObject({ campaignId: "lure-of-the-valley", alreadyUpToDate: false });
  });
});
