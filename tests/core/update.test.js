import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProgressCollector } from "../helpers.js";

// --- Mock git.js at the module level ---

const gitMocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  hasRemote: vi.fn(),
  fetchRemote: vi.fn(),
  isAncestor: vi.fn(),
  merge: vi.fn(),
}));

vi.mock("../../src/core/git.js", () => gitMocks);

// Import AFTER mocks are set up
import { checkBaseUpdate, applyBaseUpdate } from "../../src/core/workflows.js";
import { NotARepoError, BaseRemoteMissingError } from "../../src/core/errors.js";

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

