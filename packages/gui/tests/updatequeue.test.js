import { describe, it, expect } from "vitest";
import { buildUpdateQueue, updateCount } from "../src/renderer/src/lib/updatequeue.js";

/** A campaign entry as `checkIncludedCampaignsUpdates` returns it. */
function campaign(id, updateAvailable) {
  return { id, branch: `campaign/${id}`, newCommitHash: "a".repeat(40), updateAvailable };
}

/** An included-mod entry as `checkIncludedModsUpdates` returns it. */
function mod(id, overrides = {}) {
  return {
    id,
    name: `Mod ${id}`,
    missing: false,
    manifestAhead: false,
    updateAvailable: true,
    currentVersion: "1.0.0",
    registryVersion: "1.1.0",
    repoUrl: `https://github.com/someone/${id}`,
    commitHash: "b".repeat(40),
    ...overrides,
  };
}

function sources(overrides = {}) {
  return { baseUpdateAvailable: false, campaigns: [], mods: [], ...overrides };
}

describe("buildUpdateQueue", () => {
  it("returns [] for a null status", () => {
    expect(buildUpdateQueue(null)).toEqual([]);
  });

  it("returns [] when nothing has an update", () => {
    expect(
      buildUpdateQueue(
        sources({ campaigns: [campaign("lure-of-the-valley", false)], mods: [mod("a", { updateAvailable: false })] }),
      ),
    ).toEqual([]);
  });

  it("orders base content, then campaigns, then mods", () => {
    const queue = buildUpdateQueue(
      sources({
        baseUpdateAvailable: true,
        campaigns: [campaign("lure-of-the-valley", true), campaign("spire-in-bloom", true)],
        mods: [mod("some-mod")],
      }),
    );
    expect(queue.map((item) => item.kind)).toEqual(["base", "campaign", "campaign", "mod"]);
    expect(queue[1]).toEqual({ kind: "campaign", id: "lure-of-the-valley" });
  });

  it("carries the versions a mod update moves between", () => {
    const queue = buildUpdateQueue(sources({ mods: [mod("some-mod")] }));
    expect(queue[0]).toEqual({
      kind: "mod",
      id: "some-mod",
      name: "Mod some-mod",
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
    });
  });

  it("omits campaigns with no new commits", () => {
    const queue = buildUpdateQueue(
      sources({ campaigns: [campaign("lure-of-the-valley", false), campaign("spire-in-bloom", true)] }),
    );
    expect(queue).toEqual([{ kind: "campaign", id: "spire-in-bloom" }]);
  });

  it("omits a mod that is no longer in the registry", () => {
    const queue = buildUpdateQueue(
      sources({ mods: [mod("gone", { missing: true, updateAvailable: false, registryVersion: null })] }),
    );
    expect(queue).toEqual([]);
  });

  it("omits a mod recorded ahead of its published version", () => {
    const queue = buildUpdateQueue(
      sources({
        mods: [mod("ahead", { manifestAhead: true, updateAvailable: false, currentVersion: "2.0.0", registryVersion: "1.0.0" })],
      }),
    );
    expect(queue).toEqual([]);
  });
});

describe("updateCount", () => {
  it("is 0 for a null status", () => {
    expect(updateCount(null)).toBe(0);
  });

  it("counts every available update across the three sources", () => {
    expect(
      updateCount(
        sources({
          baseUpdateAvailable: true,
          campaigns: [campaign("lure-of-the-valley", true), campaign("spire-in-bloom", false)],
          mods: [mod("a"), mod("b", { updateAvailable: false })],
        }),
      ),
    ).toBe(3);
  });
});
