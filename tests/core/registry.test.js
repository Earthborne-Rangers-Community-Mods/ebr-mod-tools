import { describe, it, expect } from "vitest";
import { checkIncludedMods, buildRegistryEntry } from "../../src/core/registry.js";
import { validManifest } from "../helpers.js";

const COMMIT_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

// --- checkIncludedMods ---

describe("checkIncludedMods", () => {
  const registry = {
    mods: [
      { id: "mod-a", name: "Mod A" },
      { id: "mod-b", name: "Mod B" },
      { id: "mod-c", name: "Mod C" },
    ],
  };

  it("returns no warnings when all mods are in registry", () => {
    const includedMods = [
      { id: "mod-a", name: "Mod A", author: "A", version: "1.0.0", repoUrl: "https://github.com/a/a" },
      { id: "mod-b", name: "Mod B", author: "B", version: "1.0.0", repoUrl: "https://github.com/b/b" },
    ];
    expect(checkIncludedMods(includedMods, registry)).toEqual([]);
  });

  it("returns warnings for mods not in registry", () => {
    const includedMods = [
      { id: "mod-a", name: "Mod A", author: "A", version: "1.0.0", repoUrl: "https://github.com/a/a" },
      { id: "mod-missing", name: "Missing Mod", author: "X", version: "1.0.0", repoUrl: "https://github.com/x/x" },
    ];
    const warnings = checkIncludedMods(includedMods, registry);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].modId).toBe("mod-missing");
    expect(warnings[0].modName).toBe("Missing Mod");
    expect(warnings[0].message).toContain("not found in the registry");
  });

  it("returns multiple warnings for multiple missing mods", () => {
    const includedMods = [
      { id: "mod-x", name: "Mod X", author: "X", version: "1.0.0", repoUrl: "https://github.com/x/x" },
      { id: "mod-y", name: "Mod Y", author: "Y", version: "1.0.0", repoUrl: "https://github.com/y/y" },
    ];
    const warnings = checkIncludedMods(includedMods, registry);
    expect(warnings).toHaveLength(2);
  });

  it("uses mod.id as modName when name is missing", () => {
    const includedMods = [
      { id: "mod-no-name", author: "X", version: "1.0.0", repoUrl: "https://github.com/x/x" },
    ];
    const warnings = checkIncludedMods(includedMods, registry);
    expect(warnings[0].modName).toBe("mod-no-name");
  });

  it("returns empty when includedMods is undefined", () => {
    expect(checkIncludedMods(undefined, registry)).toEqual([]);
  });

  it("returns empty when registry is undefined", () => {
    const includedMods = [
      { id: "mod-a", name: "Mod A", author: "A", version: "1.0.0", repoUrl: "https://github.com/a/a" },
    ];
    expect(checkIncludedMods(includedMods, undefined)).toEqual([]);
  });

  it("returns empty when registry has no mods array", () => {
    expect(checkIncludedMods([{ id: "mod-a" }], {})).toEqual([]);
  });
});

// --- buildRegistryEntry ---

describe("buildRegistryEntry", () => {
  it("mirrors required fields from manifest", () => {
    const manifest = validManifest();
    const entry = buildRegistryEntry(manifest, COMMIT_SHA);

    expect(entry.id).toBe("test-mod");
    expect(entry.name).toBe("Test Mod");
    expect(entry.author).toBe("TestAuthor");
    expect(entry.description).toBe("A test mod.");
    expect(entry.repoUrl).toBe("https://github.com/test/ebr-test-mod");
    expect(entry.type).toBe("enhancement");
    expect(entry.campaigns).toEqual(["lure-of-the-valley"]);
    expect(entry.requiredProducts).toEqual(["core-set"]);
    expect(entry.baseVersion).toBe("1.0.0");
    expect(entry.safeToAddMidCampaign).toBe(true);
    expect(entry.language).toBe("en");
  });

  it("sets registry-specific fields", () => {
    const manifest = validManifest({ version: "2.1.0" });
    const entry = buildRegistryEntry(manifest, COMMIT_SHA);

    expect(entry.latestVersion).toBe("2.1.0");
    expect(entry.commitHash).toBe(COMMIT_SHA);
    expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("includes optional fields when present", () => {
    const manifest = validManifest({
      authorDiscord: "testuser#1234",
      tags: ["combat", "npc"],
      coverImage: "cover.png",
      icon: "🏔️",
      optionalProducts: ["stewards-of-the-valley"],
      includedMods: [{ id: "other-mod", name: "Other Mod", author: "OA", version: "1.0.0", repoUrl: "https://github.com/oa/other" }],
      midCampaignNotes: "Safe before day 15.",
    });
    const entry = buildRegistryEntry(manifest, COMMIT_SHA);

    expect(entry.authorDiscord).toBe("testuser#1234");
    expect(entry.tags).toEqual(["combat", "npc"]);
    expect(entry.coverImage).toBe("cover.png");
    expect(entry.icon).toBe("🏔️");
    expect(entry.optionalProducts).toEqual(["stewards-of-the-valley"]);
    expect(entry.includedMods).toHaveLength(1);
    expect(entry.midCampaignNotes).toBe("Safe before day 15.");
  });

  it("omits optional fields when empty or missing", () => {
    const manifest = validManifest({ tags: [], optionalProducts: [] });
    const entry = buildRegistryEntry(manifest, COMMIT_SHA);

    expect(entry.authorDiscord).toBeUndefined();
    expect(entry.tags).toBeUndefined();
    expect(entry.coverImage).toBeUndefined();
    expect(entry.icon).toBeUndefined();
    expect(entry.optionalProducts).toBeUndefined();
    expect(entry.includedMods).toBeUndefined();
    expect(entry.midCampaignNotes).toBeUndefined();
  });

  it("does not include version field (uses latestVersion instead)", () => {
    const manifest = validManifest();
    const entry = buildRegistryEntry(manifest, COMMIT_SHA);

    expect(entry.version).toBeUndefined();
    expect(entry.latestVersion).toBe("1.0.0");
  });
});
