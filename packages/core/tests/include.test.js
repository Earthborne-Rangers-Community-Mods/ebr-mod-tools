import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProgressCollector } from "./helpers.js";

// --- Mock git.js (full), manifest.js (partial), registry.js (partial), and fs readFile ---

const gitMocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  hasRemote: vi.fn(),
  addRemote: vi.fn(),
  fetchRemote: vi.fn(),
  isAncestor: vi.fn(),
  merge: vi.fn(),
  revparseRef: vi.fn(),
  stageByExtensions: vi.fn(),
  stageFile: vi.fn(),
  commit: vi.fn(),
  getStatus: vi.fn(),
  predictMerge: vi.fn(),
  checkoutConflictSide: vi.fn(),
  commitMerge: vi.fn(),
}));

const manifestMocks = vi.hoisted(() => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  fetchRegistry: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock("../src/git.js", () => gitMocks);

// Keep compareVersions (and the rest) real; only readManifest/writeManifest are mocked.
vi.mock("../src/manifest.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readManifest: manifestMocks.readManifest, writeManifest: manifestMocks.writeManifest };
});

// Keep checkIncludedMods/buildRegistryEntry real; only fetchRegistry is mocked.
vi.mock("../src/registry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchRegistry: registryMocks.fetchRegistry };
});

// Mock only readFile; the rest of node:fs/promises stays real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFile: fsMocks.readFile };
});

// Import AFTER mocks
import {
  includeCampaign,
  predictCampaignInclude,
  finishMerge,
  resolveCampaignSource,
  upsertCampaignTarget,
  computeMissingCampaignProducts,
  classifyIncludeSource,
  remoteNameForRepoUrl,
  extractModId,
  resolveModSource,
  upsertIncludedMod,
  includeMod,
  predictModInclude,
  checkIncludedModsUpdates,
} from "../src/workflows.js";
import {
  NotARepoError,
  BaseRemoteMissingError,
  IncludeRefNotFoundError,
  IndexNotCleanError,
  ValidationError,
  MergeConflictError,
  ManifestNotFoundError,
  NothingToCommitError,
  IncludeModNotFoundError,
} from "../src/errors.js";

const DIR = "/tmp/some-mod";
const SHA = "a".repeat(40);
const MERGE_SHA = "b".repeat(40);
const ALICE_FORK = "https://github.com/alice/ebr-mod-base-content";
const BOB_FORK = "https://github.com/bob/ebr-fork";
const HASH_BOULDER = "c".repeat(40);
const HASH_OTHER = "d".repeat(40);
const HASH_SOLO = "e".repeat(40);

/** A getStatus result with the given conflicted paths and an otherwise clean tree. */
function statusWith(conflicted) {
  return { isClean: false, modified: [], staged: [], conflicted, created: [], deleted: [] };
}

/** A browse-tier registry where Alice's fork hosts two mods, Bob's hosts one. */
function makeRegistry() {
  return {
    mods: [
      {
        id: "expanded-boulder-field",
        name: "Expanded Boulder Field",
        author: "Alice",
        repoUrl: ALICE_FORK,
        latestVersion: "1.2.0",
        commitHash: HASH_BOULDER,
      },
      {
        id: "other-mod",
        name: "Other Mod",
        author: "Alice",
        repoUrl: ALICE_FORK,
        latestVersion: "0.5.0",
        commitHash: HASH_OTHER,
      },
      {
        id: "solo-mod",
        name: "Solo Mod",
        author: "Bob",
        repoUrl: BOB_FORK,
        latestVersion: "2.0.0",
        commitHash: HASH_SOLO,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.isRepo.mockResolvedValue(true);
  gitMocks.hasRemote.mockResolvedValue(true);
  gitMocks.addRemote.mockResolvedValue(undefined);
  gitMocks.fetchRemote.mockResolvedValue(undefined);
  gitMocks.isAncestor.mockResolvedValue(false);
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
  // Campaign-suite default; the included-mods suites override this in their
  // own beforeEach.
  manifestMocks.readManifest.mockResolvedValue({
    name: "Test",
    id: "test",
    version: "0.1.0",
    type: "enhancement",
  });
  manifestMocks.writeManifest.mockResolvedValue(undefined);
  registryMocks.fetchRegistry.mockResolvedValue(makeRegistry());
  gitMocks.predictMerge.mockResolvedValue({ conflicts: [] });
  gitMocks.checkoutConflictSide.mockResolvedValue(undefined);
  gitMocks.commitMerge.mockResolvedValue(MERGE_SHA);
  fsMocks.readFile.mockResolvedValue("no markers here\n");
});

// --- resolveCampaignSource ---

describe("resolveCampaignSource", () => {
  it("accepts a bare campaign id", () => {
    expect(resolveCampaignSource("lure-of-the-valley")).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
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

  it("rejects ids that are not in OFFICIAL_CAMPAIGNS", () => {
    expect(() => resolveCampaignSource("not-a-real-campaign")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("Foo Bar")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("mod/foo")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("https://github.com/x/y")).toThrow(ValidationError);
    expect(() => resolveCampaignSource("campaign/lure-of-the-valley")).toThrow(ValidationError);
  });

  it("error message lists the known campaign ids when an id is unknown", () => {
    let err;
    try { resolveCampaignSource("not-a-real-campaign"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("lure-of-the-valley");
    expect(err.message).toContain("shadow-of-the-storm");
  });
});

// --- upsertCampaignTarget ---

describe("upsertCampaignTarget", () => {
  const ID = "lure-of-the-valley";

  it("adds an id to an empty or undefined list", () => {
    expect(upsertCampaignTarget(undefined, ID)).toEqual([ID]);
    expect(upsertCampaignTarget([], ID)).toEqual([ID]);
  });

  it("appends a new id, preserving order", () => {
    expect(upsertCampaignTarget(["spire-in-bloom"], ID)).toEqual(["spire-in-bloom", ID]);
  });

  it("returns the original array when the id is already present", () => {
    // Reference equality is how callers detect a no-op and skip the write.
    const existing = [ID, "spire-in-bloom"];
    expect(upsertCampaignTarget(existing, ID)).toBe(existing);
  });

  it("does not mutate the input array", () => {
    const existing = ["spire-in-bloom"];
    upsertCampaignTarget(existing, ID);
    expect(existing).toEqual(["spire-in-bloom"]);
  });

  it("tolerates a non-array existing value", () => {
    expect(upsertCampaignTarget(null, ID)).toEqual([ID]);
    expect(upsertCampaignTarget("nope", ID)).toEqual([ID]);
  });
});

// --- computeMissingCampaignProducts ---

describe("computeMissingCampaignProducts", () => {
  it("returns the campaign's products that the manifest does not list", () => {
    expect(computeMissingCampaignProducts("spire-in-bloom", { id: "m" })).toEqual([
      "core-set",
      "spire-in-bloom",
    ]);
  });

  it("ignores products already in requiredProducts", () => {
    expect(
      computeMissingCampaignProducts("spire-in-bloom", { id: "m", requiredProducts: ["core-set"] }),
    ).toEqual(["spire-in-bloom"]);
  });

  it("counts optionalProducts as covered too", () => {
    expect(
      computeMissingCampaignProducts("spire-in-bloom", {
        id: "m",
        requiredProducts: ["core-set"],
        optionalProducts: ["spire-in-bloom"],
      }),
    ).toEqual([]);
  });

  it("returns empty for a campaign that is not in the catalog", () => {
    expect(computeMissingCampaignProducts("not-a-campaign", { id: "m" })).toEqual([]);
  });

  it("returns empty for a catalog entry with no products", () => {
    expect(
      computeMissingCampaignProducts("x", { id: "m" }, [{ id: "x" }]),
    ).toEqual([]);
  });
});

// --- includeCampaign ---

describe("includeCampaign", () => {
  it("throws ValidationError when source is malformed (before touching git)", async () => {
    await expect(includeCampaign({ dir: DIR, source: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(gitMocks.isRepo).not.toHaveBeenCalled();
  });

  it("throws ValidationError for the campaign/<id> prefix form - git branch convention is internal, not user input", async () => {
    await expect(
      includeCampaign({ dir: DIR, source: "campaign/lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(gitMocks.merge).not.toHaveBeenCalled();
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

  it("records the campaign in the manifest's campaigns list and stages it", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.campaigns).toEqual(["lure-of-the-valley"]);
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
  });

  it("writes nothing when the campaign is already targeted and no products were asked for", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      campaigns: ["spire-in-bloom", "lure-of-the-valley"],
    });

    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(manifestMocks.writeManifest).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).not.toHaveBeenCalled();
  });

  it("writes nothing when the campaign is already targeted and all its products are already covered, even when addProductsTo is passed", async () => {
    // spire-in-bloom requires core-set and spire-in-bloom (the product); both already
    // present in requiredProducts.  Nothing would change -> no write, no stage.
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      campaigns: ["spire-in-bloom"],
      requiredProducts: ["core-set", "spire-in-bloom"],
    });

    await includeCampaign({ dir: DIR, source: "spire-in-bloom", addProductsTo: "required" });

    expect(manifestMocks.writeManifest).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).not.toHaveBeenCalled();
  });

  it("stages the manifest into a conflicted merge so `git merge --continue` folds it in", async () => {
    // The staged edit rides along in the index rather than being committed
    // separately, and `git merge --abort` would discard it with the merge.
    const conflict = new MergeConflictError(["content/foo.md"]);
    gitMocks.merge.mockRejectedValue(conflict);

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBe(conflict);

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.campaigns).toEqual(["lure-of-the-valley"]);
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
    // Still no success-path commit on the conflict path.
    expect(gitMocks.commit).not.toHaveBeenCalled();
  });

  it("leaves products alone unless the caller asks for them", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.requiredProducts).toBeUndefined();
    expect(written.optionalProducts).toBeUndefined();
  });

  it("adds the campaign's missing products to requiredProducts when asked", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley", addProductsTo: "required" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.requiredProducts).toContain("core-set");
  });

  it("adds all required products for a multi-product campaign", async () => {
    // Exercises the full wiring: computeMissingCampaignProducts -> applyMissingProductFix
    // for a catalog entry with two products, neither already present.
    await includeCampaign({ dir: DIR, source: "spire-in-bloom", addProductsTo: "required" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.requiredProducts).toEqual(["core-set", "spire-in-bloom"]);
  });

  it("adds them to optionalProducts when asked", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley", addProductsTo: "optional" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.optionalProducts).toContain("core-set");
    expect(written.requiredProducts ?? []).not.toContain("core-set");
  });

  it("does not duplicate a product the manifest already lists", async () => {
    manifestMocks.readManifest.mockResolvedValue({
      id: "test",
      requiredProducts: ["core-set"],
    });

    await includeCampaign({ dir: DIR, source: "lure-of-the-valley", addProductsTo: "required" });

    const written = manifestMocks.writeManifest.mock.calls[0][1];
    expect(written.requiredProducts).toEqual(["core-set"]);
  });

  it("throws IncludeRefNotFoundError when revparseRef fails", async () => {
    gitMocks.revparseRef.mockRejectedValue(new Error("bad ref"));
    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBeInstanceOf(IncludeRefNotFoundError);
    expect(gitMocks.merge).not.toHaveBeenCalled();
  });

  it("propagates MergeConflictError", async () => {
    const conflict = new MergeConflictError(["content/foo.md"]);
    gitMocks.merge.mockRejectedValue(conflict);

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toBe(conflict);

    expect(gitMocks.commit).not.toHaveBeenCalled();
  });

  it("performs fetch -> resolve -> merge -> commit in order", async () => {
    const order = [];
    gitMocks.fetchRemote.mockImplementation(() => { order.push("fetch"); return Promise.resolve(); });
    gitMocks.revparseRef.mockImplementation(() => { order.push("resolve"); return Promise.resolve(SHA); });
    gitMocks.merge.mockImplementation(() => { order.push("merge"); return Promise.resolve(); });
    gitMocks.commit.mockImplementation(() => { order.push("commit"); return Promise.resolve(); });

    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(order).toEqual(["fetch", "resolve", "merge", "commit"]);
  });

  it("merges with noCommit=true so the include lands as a single merge commit", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });
    const opts = gitMocks.merge.mock.calls[0][2];
    expect(opts).toMatchObject({ noCommit: true });
  });

  it("does not commit on a non-conflict merge failure", async () => {
    gitMocks.merge.mockRejectedValue(new Error("some non-conflict failure"));

    await expect(
      includeCampaign({ dir: DIR, source: "lure-of-the-valley" }),
    ).rejects.toThrow();

    expect(gitMocks.commit).not.toHaveBeenCalled();
    expect(manifestMocks.writeManifest).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).not.toHaveBeenCalled();
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

  it("returns the campaign, branch and resolved commit on a successful include", async () => {
    const result = await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    expect(result).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
      commitHash: SHA,
      alreadyUpToDate: false,
    });
  });

  it("commits with a message that references the branch and short SHA", async () => {
    await includeCampaign({ dir: DIR, source: "lure-of-the-valley" });

    const [, message] = gitMocks.commit.mock.calls[0];
    expect(message).toContain("campaign/lure-of-the-valley");
    expect(message).toContain(SHA.slice(0, 7));
  });

  it("returns alreadyUpToDate=true when commit fails with NothingToCommitError (no-op re-include)", async () => {
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
    for (const step of ["fetch", "resolve", "merge", "commit"]) {
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

// --- Included mods (ebr include <mod-id>) ---
//
// These suites exercise the mod path, which reads the *including* mod's own
// manifest (id "my-mod") rather than a campaign manifest, so they override the
// campaign-suite readManifest default.

describe("included mods", () => {
  beforeEach(() => {
    manifestMocks.readManifest.mockResolvedValue({ id: "my-mod", name: "My Mod", version: "1.0.0" });
  });

  // --- classifyIncludeSource ---

  describe("classifyIncludeSource", () => {
    it("classifies a bare official campaign id as a campaign", () => {
      expect(classifyIncludeSource("lure-of-the-valley")).toBe("campaign");
      expect(classifyIncludeSource("  spire-in-bloom  ")).toBe("campaign");
    });

    it("classifies a non-campaign bare id as a mod", () => {
      expect(classifyIncludeSource("expanded-boulder-field")).toBe("mod");
    });

    it("classifies a repo URL as a mod", () => {
      expect(classifyIncludeSource("https://github.com/alice/ebr-mod-base-content")).toBe("mod");
      expect(classifyIncludeSource("git@github.com:alice/ebr-mod-base-content.git")).toBe("mod");
    });
  });

  // --- remoteNameForRepoUrl ---

  describe("remoteNameForRepoUrl", () => {
    it("derives a stable, git-safe remote name from a fork URL", () => {
      expect(remoteNameForRepoUrl(ALICE_FORK)).toBe("inc-alice-ebr-mod-base-content");
    });

    it("derives the same remote name regardless of .git suffix or SSH form", () => {
      expect(remoteNameForRepoUrl("https://github.com/alice/ebr-mod-base-content.git")).toBe(
        "inc-alice-ebr-mod-base-content",
      );
      expect(remoteNameForRepoUrl("git@github.com:alice/ebr-mod-base-content.git")).toBe(
        "inc-alice-ebr-mod-base-content",
      );
    });

    it("keys the remote by the fork (owner/repo), so two mods from one fork share a remote", () => {
      expect(remoteNameForRepoUrl(ALICE_FORK)).toBe(remoteNameForRepoUrl(ALICE_FORK));
      expect(remoteNameForRepoUrl(ALICE_FORK)).not.toBe(remoteNameForRepoUrl(BOB_FORK));
    });

    it("throws ValidationError on an unparseable URL", () => {
      expect(() => remoteNameForRepoUrl("not-a-url")).toThrow(ValidationError);
      expect(() => remoteNameForRepoUrl("https://gitlab.com/a/b")).toThrow(ValidationError);
    });
  });

  // --- extractModId ---

  describe("extractModId", () => {
    it("returns a bare id unchanged", () => {
      expect(extractModId("expanded-boulder-field")).toBe("expanded-boulder-field");
    });

    it("trims surrounding whitespace on a bare id", () => {
      expect(extractModId("  expanded-boulder-field  ")).toBe("expanded-boulder-field");
    });

    it("extracts the id from a Mod Manager site URL", () => {
      expect(
        extractModId("https://earthborne-rangers-community-mods.github.io/ebr-mod-manager/mods/familiar-ground"),
      ).toBe("familiar-ground");
    });

    it("extracts the id from a GitHub branch URL", () => {
      expect(
        extractModId("https://github.com/SunberryKeeper/ebr-mod-base-content/tree/mod/special-delivery"),
      ).toBe("special-delivery");
    });

    it("ignores a trailing slash", () => {
      expect(
        extractModId("https://earthborne-rangers-community-mods.github.io/ebr-mod-manager/mods/familiar-ground/"),
      ).toBe("familiar-ground");
    });

    it("ignores a query string or hash after the id", () => {
      expect(extractModId("https://example.com/mods/familiar-ground?tab=details")).toBe("familiar-ground");
      expect(extractModId("https://example.com/mods/familiar-ground#readme")).toBe("familiar-ground");
    });

    it("returns an empty string for empty or whitespace-only input", () => {
      expect(extractModId("")).toBe("");
      expect(extractModId("   ")).toBe("");
    });

    it("decodes a percent-encoded last segment", () => {
      expect(extractModId("https://example.com/mods/familiar%20ground")).toBe("familiar ground");
    });

    it("falls back to the raw segment when percent-decoding fails", () => {
      expect(extractModId("https://example.com/mods/familiar-ground%")).toBe("familiar-ground%");
    });
  });

  // --- resolveModSource ---

  describe("resolveModSource", () => {
    it("resolves a bare mod id to its registry entry", () => {
      const { modId, entry } = resolveModSource("expanded-boulder-field", makeRegistry());
      expect(modId).toBe("expanded-boulder-field");
      expect(entry.commitHash).toBe(HASH_BOULDER);
    });

    it("throws IncludeModNotFoundError for an unknown id", () => {
      expect(() => resolveModSource("no-such-mod", makeRegistry())).toThrow(IncludeModNotFoundError);
    });

    it("rejects a repo URL - mods are included by id, not URL", () => {
      // A fork hosts every mod by an author, so a URL cannot identify one mod.
      // URLs are not special-cased; they simply match no id and are not found.
      expect(() => resolveModSource(ALICE_FORK, makeRegistry())).toThrow(IncludeModNotFoundError);
      expect(() => resolveModSource(BOB_FORK, makeRegistry())).toThrow(IncludeModNotFoundError);
    });

    it("throws ValidationError on empty/non-string sources", () => {
      expect(() => resolveModSource("", makeRegistry())).toThrow(ValidationError);
      expect(() => resolveModSource("   ", makeRegistry())).toThrow(ValidationError);
      expect(() => resolveModSource(undefined, makeRegistry())).toThrow(ValidationError);
    });
  });

  // --- upsertIncludedMod ---

  describe("upsertIncludedMod", () => {
    const ENTRY = { id: "expanded-boulder-field", name: "Expanded Boulder Field", author: "Alice", version: "1.2.0", repoUrl: ALICE_FORK };

    it("adds an entry to an empty/undefined list", () => {
      expect(upsertIncludedMod(undefined, ENTRY)).toEqual([ENTRY]);
      expect(upsertIncludedMod([], ENTRY)).toEqual([ENTRY]);
    });

    it("appends when the id is not present", () => {
      const existing = [{ id: "solo-mod", name: "Solo", author: "Bob", version: "2.0.0", repoUrl: BOB_FORK }];
      const result = upsertIncludedMod(existing, ENTRY);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(ENTRY);
    });

    it("replaces an existing entry with the same id, preserving order", () => {
      const stale = { id: "expanded-boulder-field", name: "Old", author: "Alice", version: "1.0.0", repoUrl: ALICE_FORK };
      const sibling = { id: "solo-mod", name: "Solo", author: "Bob", version: "2.0.0", repoUrl: BOB_FORK };
      const result = upsertIncludedMod([stale, sibling], ENTRY);
      expect(result).toEqual([ENTRY, sibling]);
    });

    it("does not mutate the input array", () => {
      const existing = [{ id: "solo-mod", name: "Solo", author: "Bob", version: "2.0.0", repoUrl: BOB_FORK }];
      const snapshot = JSON.stringify(existing);
      upsertIncludedMod(existing, ENTRY);
      expect(JSON.stringify(existing)).toBe(snapshot);
    });

    it("tolerates non-array existing values", () => {
      expect(upsertIncludedMod(null, ENTRY)).toEqual([ENTRY]);
      expect(upsertIncludedMod("nope", ENTRY)).toEqual([ENTRY]);
    });
  });

  // --- includeMod ---

  describe("includeMod", () => {
    it("throws NotARepoError when dir is not a git repo", async () => {
      gitMocks.isRepo.mockResolvedValue(false);
      await expect(
        includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() }),
      ).rejects.toBeInstanceOf(NotARepoError);
      expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    });

    it("throws IndexNotCleanError when there are already staged changes", async () => {
      gitMocks.getStatus.mockResolvedValue({
        isClean: false,
        modified: [],
        staged: ["content/foo.md"],
        conflicted: [],
        created: [],
      });
      let err;
      try {
        await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(IndexNotCleanError);
      expect(err.staged).toEqual(["content/foo.md"]);
      expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
      expect(gitMocks.merge).not.toHaveBeenCalled();
    });

    it("fetches the provided registry rather than the network when registry is passed", async () => {
      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(registryMocks.fetchRegistry).not.toHaveBeenCalled();
    });

    it("falls back to fetchRegistry when no registry is provided", async () => {
      await includeMod({ dir: DIR, source: "expanded-boulder-field" });
      expect(registryMocks.fetchRegistry).toHaveBeenCalledTimes(1);
    });

    it("adds the fork remote when missing, then fetches it", async () => {
      gitMocks.hasRemote.mockResolvedValue(false);
      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(gitMocks.addRemote).toHaveBeenCalledWith(DIR, "inc-alice-ebr-mod-base-content", ALICE_FORK);
      expect(gitMocks.fetchRemote).toHaveBeenCalledWith(
        DIR,
        "inc-alice-ebr-mod-base-content",
        expect.any(Object),
      );
    });

    it("reuses an existing remote without re-adding it", async () => {
      gitMocks.hasRemote.mockResolvedValue(true);
      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(gitMocks.addRemote).not.toHaveBeenCalled();
      expect(gitMocks.fetchRemote).toHaveBeenCalled();
    });

    it("merges the registry-pinned commitHash with noCommit=true", async () => {
      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(gitMocks.merge).toHaveBeenCalledWith(DIR, HASH_BOULDER, expect.objectContaining({ noCommit: true }));
    });

    it("on a clean merge writes our manifest with the included entry, stages, and commits", async () => {
      manifestMocks.readManifest.mockResolvedValue({ id: "my-mod", name: "My Mod", version: "1.0.0" });

      const result = await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      const written = manifestMocks.writeManifest.mock.calls[0][1];
      expect(written.id).toBe("my-mod"); // our identity is preserved
      expect(written.includedMods).toEqual([
        { id: "expanded-boulder-field", name: "Expanded Boulder Field", author: "Alice", version: "1.2.0", repoUrl: ALICE_FORK },
      ]);
      expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
      expect(gitMocks.commit).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ modId: "expanded-boulder-field", commitHash: HASH_BOULDER, alreadyUpToDate: false });
    });

    it("auto-resolves a manifest-only conflict by keeping our manifest and committing", async () => {
      gitMocks.merge.mockRejectedValue(new MergeConflictError(["ebr-mod.json"]));

      const result = await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      // Our manifest is written + staged, and the merge is finalized for the user.
      const written = manifestMocks.writeManifest.mock.calls[0][1];
      expect(written.id).toBe("my-mod");
      expect(written.includedMods).toHaveLength(1);
      expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
      expect(gitMocks.commit).toHaveBeenCalledTimes(1);
      expect(result.alreadyUpToDate).toBe(false);
    });

    it("also auto-resolves a conflicting 'About this Mod.md' by keeping ours, then commits", async () => {
      gitMocks.merge.mockRejectedValue(new MergeConflictError(["ebr-mod.json", "About this Mod.md"]));

      const result = await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      expect(gitMocks.checkoutConflictSide).toHaveBeenCalledWith(DIR, "About this Mod.md", "ours");
      expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
      expect(gitMocks.commit).toHaveBeenCalledTimes(1);
      expect(result.alreadyUpToDate).toBe(false);
    });

    it("does not touch 'About this Mod.md' when it is not among the conflicted files", async () => {
      gitMocks.merge.mockRejectedValue(new MergeConflictError(["ebr-mod.json"]));

      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      expect(gitMocks.checkoutConflictSide).not.toHaveBeenCalled();
    });

    it("re-throws with non-manifest conflicts remaining, after staging our resolved manifest", async () => {
      gitMocks.merge.mockRejectedValue(new MergeConflictError(["ebr-mod.json", "content/foo.md"]));

      let err;
      try {
        await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(MergeConflictError);
      // The manifest conflict is resolved + staged so `git merge --continue` folds it in.
      expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "ebr-mod.json");
      // Our identity is kept even on the re-throw path - a `git merge --continue`
      // by the author must not commit someone else's manifest id.
      const written = manifestMocks.writeManifest.mock.calls[0][1];
      expect(written.id).toBe("my-mod");
      expect(written.includedMods[0].id).toBe("expanded-boulder-field");
      // Only the genuine content conflicts are surfaced.
      expect(err.conflictedFiles).toEqual(["content/foo.md"]);
      // No success-path commit when real conflicts remain.
      expect(gitMocks.commit).not.toHaveBeenCalled();
    });

    it("re-throws with non-identity conflicts remaining after resolving both auto-kept files", async () => {
      gitMocks.merge.mockRejectedValue(
        new MergeConflictError(["ebr-mod.json", "About this Mod.md", "content/foo.md"]),
      );

      let err;
      try {
        await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(MergeConflictError);
      expect(gitMocks.checkoutConflictSide).toHaveBeenCalledWith(DIR, "About this Mod.md", "ours");
      // Only the genuine content conflict is surfaced.
      expect(err.conflictedFiles).toEqual(["content/foo.md"]);
      expect(gitMocks.commit).not.toHaveBeenCalled();
    });



    it("does not touch the manifest on a non-conflict merge failure", async () => {
      gitMocks.merge.mockRejectedValue(new Error("network died mid-merge"));

      await expect(
        includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() }),
      ).rejects.toThrow();

      expect(manifestMocks.writeManifest).not.toHaveBeenCalled();
      expect(gitMocks.stageFile).not.toHaveBeenCalled();
      expect(gitMocks.commit).not.toHaveBeenCalled();
    });

    it("returns alreadyUpToDate when a clean merge has nothing to commit", async () => {
      gitMocks.commit.mockRejectedValue(new NothingToCommitError());

      const result = await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      expect(result.alreadyUpToDate).toBe(true);
    });

    it("never changes our mod identity (id stays ours even when the included mod has a different id)", async () => {
      manifestMocks.readManifest.mockResolvedValue({ id: "my-mod", name: "My Mod", version: "1.0.0" });
      await includeMod({ dir: DIR, source: "solo-mod", registry: makeRegistry() });
      const written = manifestMocks.writeManifest.mock.calls[0][1];
      expect(written.id).toBe("my-mod");
      expect(written.includedMods[0].id).toBe("solo-mod");
    });

    it("appends to an existing includedMods list rather than replacing it", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        name: "My Mod",
        version: "1.0.0",
        includedMods: [
          { id: "solo-mod", name: "Solo Mod", author: "Bob", version: "2.0.0", repoUrl: BOB_FORK },
        ],
      });

      await includeMod({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });

      const written = manifestMocks.writeManifest.mock.calls[0][1];
      expect(written.includedMods).toEqual([
        { id: "solo-mod", name: "Solo Mod", author: "Bob", version: "2.0.0", repoUrl: BOB_FORK },
        { id: "expanded-boulder-field", name: "Expanded Boulder Field", author: "Alice", version: "1.2.0", repoUrl: ALICE_FORK },
      ]);
    });
  });

  // --- predictModInclude ---

  describe("predictModInclude", () => {
    it("throws NotARepoError when dir is not a git repo", async () => {
      gitMocks.isRepo.mockResolvedValue(false);
      await expect(
        predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() }),
      ).rejects.toBeInstanceOf(NotARepoError);
      expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    });

    it("throws IncludeModNotFoundError for an unknown mod id", async () => {
      await expect(
        predictModInclude({ dir: DIR, source: "no-such-mod", registry: makeRegistry() }),
      ).rejects.toBeInstanceOf(IncludeModNotFoundError);
    });

    it("adds the fork remote when missing, then fetches it", async () => {
      gitMocks.hasRemote.mockResolvedValue(false);
      await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(gitMocks.addRemote).toHaveBeenCalledWith(DIR, "inc-alice-ebr-mod-base-content", ALICE_FORK);
      expect(gitMocks.fetchRemote).toHaveBeenCalledWith(
        DIR,
        "inc-alice-ebr-mod-base-content",
        expect.any(Object),
      );
    });

    it("reports alreadyUpToDate when the registry commit is already in HEAD, without a dry-run merge", async () => {
      gitMocks.isAncestor.mockResolvedValue(true);
      const result = await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(result).toEqual({ modId: "expanded-boulder-field", commitHash: HASH_BOULDER, conflicts: [], alreadyUpToDate: true });
      expect(gitMocks.isAncestor).toHaveBeenCalledWith(DIR, HASH_BOULDER, "HEAD");
      expect(gitMocks.predictMerge).not.toHaveBeenCalled();
    });

    it("filters ebr-mod.json out of the predicted conflicts (includeMod always auto-resolves it)", async () => {
      gitMocks.predictMerge.mockResolvedValue({ conflicts: ["ebr-mod.json", "content/foo.md"] });
      const result = await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(result.conflicts).toEqual(["content/foo.md"]);
      expect(result.alreadyUpToDate).toBe(false);
    });

    it("also filters 'About this Mod.md' out of the predicted conflicts", async () => {
      gitMocks.predictMerge.mockResolvedValue({
        conflicts: ["ebr-mod.json", "About this Mod.md", "content/foo.md"],
      });
      const result = await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(result.conflicts).toEqual(["content/foo.md"]);
    });

    it("reports no real conflicts for a clean merge", async () => {
      gitMocks.predictMerge.mockResolvedValue({ conflicts: ["ebr-mod.json"] });
      const result = await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(result.conflicts).toEqual([]);
    });

    it("only filters the root manifest path, not a same-named file in a subfolder", async () => {
      gitMocks.predictMerge.mockResolvedValue({ conflicts: ["ebr-mod.json", "content/ebr-mod.json"] });
      const result = await predictModInclude({ dir: DIR, source: "expanded-boulder-field", registry: makeRegistry() });
      expect(result.conflicts).toEqual(["content/ebr-mod.json"]);
    });

    it("falls back to fetchRegistry when no registry is provided", async () => {
      await predictModInclude({ dir: DIR, source: "expanded-boulder-field" });
      expect(registryMocks.fetchRegistry).toHaveBeenCalledTimes(1);
    });
  });

  // --- checkIncludedModsUpdates ---

  describe("checkIncludedModsUpdates", () => {
    it("throws NotARepoError when dir is not a git repo", async () => {
      gitMocks.isRepo.mockResolvedValue(false);
      await expect(checkIncludedModsUpdates({ dir: DIR })).rejects.toBeInstanceOf(NotARepoError);
    });

    it("returns no updates when there are no included mods", async () => {
      manifestMocks.readManifest.mockResolvedValue({ id: "my-mod" });
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates).toEqual([]);
      expect(registryMocks.fetchRegistry).not.toHaveBeenCalled();
    });

    it("does not fetch the registry at all when there are no included mods", async () => {
      // The whole point: a mod with an empty includedMods must never hit the
      // network, even when no registry was pre-supplied by the caller.
      manifestMocks.readManifest.mockResolvedValue({ id: "my-mod", includedMods: [] });
      const { updates, registry } = await checkIncludedModsUpdates({ dir: DIR });
      expect(updates).toEqual([]);
      expect(registry).toBeNull();
      expect(registryMocks.fetchRegistry).not.toHaveBeenCalled();
    });

    it("hands back a pre-supplied registry even when there are no included mods", async () => {
      const reg = makeRegistry();
      manifestMocks.readManifest.mockResolvedValue({ id: "my-mod", includedMods: [] });
      const { updates, registry } = await checkIncludedModsUpdates({ dir: DIR, registry: reg });
      expect(updates).toEqual([]);
      expect(registry).toBe(reg);
      expect(registryMocks.fetchRegistry).not.toHaveBeenCalled();
    });

    it("flags a delisted mod as missing without fetching its remote", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "gone-mod", name: "Gone", author: "Z", version: "1.0.0", repoUrl: BOB_FORK }],
      });
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates).toEqual([
        expect.objectContaining({ id: "gone-mod", missing: true, updateAvailable: false }),
      ]);
      expect(gitMocks.addRemote).not.toHaveBeenCalled();
      expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    });

    it("flags a manifest version newer than the registry as manifestAhead (warn-and-skip)", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "9.9.9", repoUrl: ALICE_FORK }],
      });
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates[0]).toMatchObject({
        id: "expanded-boulder-field",
        manifestAhead: true,
        updateAvailable: false,
        currentVersion: "9.9.9",
        registryVersion: "1.2.0",
      });
      expect(gitMocks.addRemote).not.toHaveBeenCalled();
      expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
    });

    it("reports updateAvailable=false when the registry commit is already an ancestor of HEAD", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "1.1.0", repoUrl: ALICE_FORK }],
      });
      gitMocks.isAncestor.mockResolvedValue(true);
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates[0]).toMatchObject({ id: "expanded-boulder-field", updateAvailable: false, missing: false, manifestAhead: false });
      expect(gitMocks.isAncestor).toHaveBeenCalledWith(DIR, HASH_BOULDER, "HEAD");
    });

    it("reports updateAvailable=true when the registry commit is not yet in HEAD", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "1.1.0", repoUrl: ALICE_FORK }],
      });
      gitMocks.isAncestor.mockResolvedValue(false);
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates[0]).toMatchObject({ id: "expanded-boulder-field", updateAvailable: true });
    });

    it("ensures the fork remote exists (adds it) before checking ancestry", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "solo-mod", name: "Solo", author: "Bob", version: "1.5.0", repoUrl: BOB_FORK }],
      });
      gitMocks.hasRemote.mockResolvedValue(false);
      await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(gitMocks.addRemote).toHaveBeenCalledWith(DIR, "inc-bob-ebr-fork", BOB_FORK);
      expect(gitMocks.fetchRemote).toHaveBeenCalledWith(DIR, "inc-bob-ebr-fork", expect.any(Object));
    });

    it("falls back to fetchRegistry when no registry is provided", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "1.1.0", repoUrl: ALICE_FORK }],
      });
      const { registry } = await checkIncludedModsUpdates({ dir: DIR });
      expect(registryMocks.fetchRegistry).toHaveBeenCalledTimes(1);
      // The fetched registry is handed back so the caller can drive merges
      // without fetching again.
      expect(registry).toEqual(makeRegistry());
    });

    it("hands back the pre-supplied registry it was given", async () => {
      const reg = makeRegistry();
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [{ id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "1.1.0", repoUrl: ALICE_FORK }],
      });
      const { registry } = await checkIncludedModsUpdates({ dir: DIR, registry: reg });
      expect(registry).toBe(reg);
      expect(registryMocks.fetchRegistry).not.toHaveBeenCalled();
    });

    it("walks every entry without short-circuiting (mixed states)", async () => {
      manifestMocks.readManifest.mockResolvedValue({
        id: "my-mod",
        includedMods: [
          { id: "gone-mod", name: "Gone", author: "Z", version: "1.0.0", repoUrl: BOB_FORK },
          { id: "expanded-boulder-field", name: "EBF", author: "Alice", version: "1.1.0", repoUrl: ALICE_FORK },
          { id: "solo-mod", name: "Solo", author: "Bob", version: "9.9.9", repoUrl: BOB_FORK },
        ],
      });
      gitMocks.isAncestor.mockResolvedValue(false); // EBF has an update available
      const { updates } = await checkIncludedModsUpdates({ dir: DIR, registry: makeRegistry() });
      expect(updates).toHaveLength(3);
      expect(updates[0]).toMatchObject({ id: "gone-mod", missing: true });
      expect(updates[1]).toMatchObject({ id: "expanded-boulder-field", updateAvailable: true });
      expect(updates[2]).toMatchObject({ id: "solo-mod", manifestAhead: true });
    });
  });
});

// --- predictCampaignInclude ---

describe("predictCampaignInclude", () => {
  it("returns the resolved branch, commit, and predicted conflicts", async () => {
    gitMocks.predictMerge.mockResolvedValue({ conflicts: ["a.md", "b.md"] });
    const result = await predictCampaignInclude({ dir: DIR, source: "lure-of-the-valley" });
    expect(result).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
      commitHash: SHA,
      conflicts: ["a.md", "b.md"],
      alreadyUpToDate: false,
    });
    expect(gitMocks.predictMerge).toHaveBeenCalledWith(DIR, "base/campaign/lure-of-the-valley");
  });

  it("reports no conflicts for a clean merge", async () => {
    const result = await predictCampaignInclude({ dir: DIR, source: "spire-in-bloom" });
    expect(result.conflicts).toEqual([]);
    expect(result.alreadyUpToDate).toBe(false);
  });

  it("reports alreadyUpToDate when the campaign content is already in HEAD", async () => {
    // The mod merged this campaign and the branch has not advanced since, so
    // the include would do nothing.
    gitMocks.isAncestor.mockResolvedValue(true);
    const result = await predictCampaignInclude({ dir: DIR, source: "lure-of-the-valley" });
    expect(result).toEqual({
      campaignId: "lure-of-the-valley",
      branch: "campaign/lure-of-the-valley",
      commitHash: SHA,
      conflicts: [],
      alreadyUpToDate: true,
    });
    expect(gitMocks.isAncestor).toHaveBeenCalledWith(DIR, "base/campaign/lure-of-the-valley", "HEAD");
    // No point running the dry run when there is nothing to merge.
    expect(gitMocks.predictMerge).not.toHaveBeenCalled();
  });

  it("rejects an unknown campaign before touching git", async () => {
    await expect(predictCampaignInclude({ dir: DIR, source: "not-real" })).rejects.toBeInstanceOf(ValidationError);
    expect(gitMocks.fetchRemote).not.toHaveBeenCalled();
  });

  it("throws NotARepoError when the directory is not a repo", async () => {
    gitMocks.isRepo.mockResolvedValue(false);
    await expect(predictCampaignInclude({ dir: DIR, source: "lure-of-the-valley" })).rejects.toBeInstanceOf(NotARepoError);
  });

  it("throws BaseRemoteMissingError when there is no base remote", async () => {
    gitMocks.hasRemote.mockResolvedValue(false);
    await expect(predictCampaignInclude({ dir: DIR, source: "lure-of-the-valley" })).rejects.toBeInstanceOf(BaseRemoteMissingError);
  });

  it("throws IncludeRefNotFoundError when the campaign branch cannot be resolved", async () => {
    gitMocks.revparseRef.mockRejectedValue(new Error("bad ref"));
    await expect(predictCampaignInclude({ dir: DIR, source: "lure-of-the-valley" })).rejects.toBeInstanceOf(IncludeRefNotFoundError);
  });
});

// --- finishMerge ---

describe("finishMerge", () => {
  it("applies each chosen side and commits the merge", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["one.md", "two.md"]));
    const result = await finishMerge({
      dir: DIR,
      resolutions: { "one.md": "ours", "two.md": "theirs" },
    });
    expect(gitMocks.checkoutConflictSide).toHaveBeenCalledWith(DIR, "one.md", "ours");
    expect(gitMocks.checkoutConflictSide).toHaveBeenCalledWith(DIR, "two.md", "theirs");
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(gitMocks.commitMerge).toHaveBeenCalledWith(DIR);
    expect(result).toEqual({ commitHash: MERGE_SHA });
  });

  it("stages a hand-blended file that no longer has conflict markers", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["blended.md"]));
    fsMocks.readFile.mockResolvedValue("cleanly merged by hand\n");
    const result = await finishMerge({ dir: DIR, resolutions: {} });
    expect(gitMocks.checkoutConflictSide).not.toHaveBeenCalled();
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "blended.md");
    expect(result).toEqual({ commitHash: MERGE_SHA });
  });

  it("throws MergeConflictError listing files that still carry markers", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["stuck.md"]));
    fsMocks.readFile.mockResolvedValue("line\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> base\n");
    await expect(finishMerge({ dir: DIR, resolutions: {} })).rejects.toMatchObject({
      name: "MergeConflictError",
      conflictedFiles: ["stuck.md"],
    });
    expect(gitMocks.commitMerge).not.toHaveBeenCalled();
  });

  it("accumulates all still-marked files in MergeConflictError when multiple are unresolved", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["alpha.md", "beta.md"]));
    fsMocks.readFile.mockResolvedValue("<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> base\n");
    await expect(finishMerge({ dir: DIR, resolutions: {} })).rejects.toMatchObject({
      name: "MergeConflictError",
      conflictedFiles: ["alpha.md", "beta.md"],
    });
    expect(gitMocks.commitMerge).not.toHaveBeenCalled();
  });

  it("mixes a chosen side and a hand-blended file, then commits", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["chosen.md", "blended.md"]));
    fsMocks.readFile.mockResolvedValue("no markers\n");
    const result = await finishMerge({
      dir: DIR,
      resolutions: { "chosen.md": "ours" },
    });
    expect(gitMocks.checkoutConflictSide).toHaveBeenCalledWith(DIR, "chosen.md", "ours");
    expect(gitMocks.stageFile).toHaveBeenCalledWith(DIR, "blended.md");
    expect(result).toEqual({ commitHash: MERGE_SHA });
  });

  it("commits immediately when there are no conflicted files left", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith([]));
    const result = await finishMerge({ dir: DIR, resolutions: {} });
    expect(gitMocks.commitMerge).toHaveBeenCalledWith(DIR);
    expect(result).toEqual({ commitHash: MERGE_SHA });
  });

  it("throws MergeConflictError from MergeConflictError itself (not GitError)", async () => {
    gitMocks.getStatus.mockResolvedValue(statusWith(["stuck.md"]));
    fsMocks.readFile.mockResolvedValue("<<<<<<< HEAD\n");
    const err = await finishMerge({ dir: DIR, resolutions: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(MergeConflictError);
  });
});
