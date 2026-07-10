import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readManifest, writeManifest, validateManifest, validateIcon, formatValidationError, formatValidationErrors, VALIDATION_CODES, bumpVersion, compareVersions, updateManifest, deriveOptionalProducts, applyMissingProductFix } from "../src/manifest.js";
import { OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "../src/catalogs.js";
import { ManifestError, ManifestNotFoundError, ManifestParseError } from "../src/errors.js";
import { rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, validManifest, writeManifestFile, createProgressCollector } from "./helpers.js";

// --- Helpers ---

/** Extract just the codes from a validation result. */
function codes(errors) {
  return errors.map((e) => e.code);
}

/** Check whether errors contain an entry matching the given partial object. */
function hasError(errors, partial) {
  return errors.some((e) =>
    Object.entries(partial).every(([k, v]) => e[k] === v)
  );
}

// --- readManifest ---

describe("readManifest", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads and parses a valid ebr-mod.json", async () => {
    const manifest = validManifest();
    await writeFile(join(tmpDir, "ebr-mod.json"), JSON.stringify(manifest));

    const result = await readManifest(tmpDir);
    expect(result).toEqual(manifest);
  });

  it("throws ManifestNotFoundError when file is missing", async () => {
    await expect(readManifest(tmpDir)).rejects.toThrow(ManifestNotFoundError);
  });

  it("throws ManifestParseError when file contains invalid JSON", async () => {
    await writeFile(join(tmpDir, "ebr-mod.json"), "{ not valid json }}}");

    await expect(readManifest(tmpDir)).rejects.toThrow(ManifestParseError);
  });

  it("error subclasses are instanceof ManifestError", async () => {
    try {
      await readManifest(tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestNotFoundError);
      expect(err).toBeInstanceOf(ManifestError);
      expect(err.field).toBe("file");
    }
  });
});

// --- writeManifest ---

describe("writeManifest", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes pretty-printed JSON with trailing newline", async () => {
    const manifest = validManifest();
    await writeManifest(tmpDir, manifest);

    const raw = await readFile(join(tmpDir, "ebr-mod.json"), "utf-8");
    expect(raw).toBe(JSON.stringify(manifest, null, 2) + "\n");
  });

  it("round-trips through read", async () => {
    const manifest = validManifest({ tags: ["npc", "encounters"] });
    await writeManifest(tmpDir, manifest);

    const result = await readManifest(tmpDir);
    expect(result).toEqual(manifest);
  });
});

// --- validateManifest ---

describe("validateManifest", () => {
  // --- Valid manifests ---

  it("returns no errors for a valid minimal manifest", () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it("returns no errors for a valid manifest with all optional fields", () => {
    const manifest = validManifest({
      authorDiscord: "testauthor#1234",
      tags: ["npc", "encounters"],
      optionalProducts: ["stewards-of-the-valley"],
      midCampaignNotes: "Safe after Prologue.",

      icon: "🏔️",
    });
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("returns no errors for a valid collection manifest", () => {
    const manifest = validManifest({
      type: "collection",
      safeToAddMidCampaign: false,
      includedMods: [
        {
          id: "some-mod",
          name: "Some Mod",
          author: "Author",
          version: "1.0.0",
          repoUrl: "https://github.com/author/ebr-some-mod",
        },
      ],
    });
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("returns no errors for a valid theme manifest", () => {
    const manifest = validManifest({
      type: "theme",
      campaigns: ["any"],
      safeToAddMidCampaign: true,
    });
    expect(validateManifest(manifest)).toEqual([]);
  });

  // --- Non-object input ---

  it("rejects null", () => {
    const errors = validateManifest(null);
    expect(codes(errors)).toContain(VALIDATION_CODES.NOT_AN_OBJECT);
  });

  it("rejects a string", () => {
    const errors = validateManifest("not an object");
    expect(codes(errors)).toContain(VALIDATION_CODES.NOT_AN_OBJECT);
  });

  // --- Required fields ---

  it("reports all missing required fields for an empty object", () => {
    const errors = validateManifest({});
    const missing = errors.filter((e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_FIELD);
    const missingFields = missing.map((e) => e.field);
    expect(missingFields).toContain("name");
    expect(missingFields).toContain("id");
    expect(missingFields).toContain("version");
    expect(missingFields).toContain("type");
    expect(missingFields).toContain("description");
    expect(missingFields).toContain("author");
    expect(missingFields).toContain("campaigns");
    expect(missingFields).toContain("requiredProducts");
    expect(missingFields).toContain("schemaVersion");
    expect(missingFields).toContain("safeToAddMidCampaign");
    expect(missingFields).toContain("language");
    expect(missingFields).toContain("repoUrl");
  });

  it("reports a single missing required field", () => {
    const { name, ...rest } = validManifest();
    const errors = validateManifest(rest);
    expect(errors).toEqual([{ code: VALIDATION_CODES.MISSING_REQUIRED_FIELD, field: "name" }]);
  });

  // --- Type validation ---

  it("rejects an invalid mod type", () => {
    const errors = validateManifest(validManifest({ type: "invalid" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_TYPE, value: "invalid" })).toBe(true);
  });

  it.each(["campaign", "enhancement", "one-day-mission", "expansion", "collection", "theme"])(
    "accepts valid type: %s",
    (type) => {
      const overrides = { type };
      if (type === "collection") {
        overrides.includedMods = [{
          id: "a", name: "A", author: "X", version: "1.0.0",
          repoUrl: "https://github.com/x/a",
        }];
      }
      if (type === "theme") {
        overrides.safeToAddMidCampaign = true;
      }
      const errors = validateManifest(validManifest(overrides));
      expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_TYPE)).toEqual([]);
    }
  );

  // --- ID format ---

  it("rejects uppercase in id", () => {
    const errors = validateManifest(validManifest({ id: "TestMod" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ID_FORMAT })).toBe(true);
  });

  it("rejects spaces in id", () => {
    const errors = validateManifest(validManifest({ id: "test mod" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ID_FORMAT })).toBe(true);
  });

  it("rejects leading hyphen in id", () => {
    const errors = validateManifest(validManifest({ id: "-test-mod" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ID_FORMAT })).toBe(true);
  });

  it("rejects trailing hyphen in id", () => {
    const errors = validateManifest(validManifest({ id: "test-mod-" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ID_FORMAT })).toBe(true);
  });

  it("accepts single-word id", () => {
    const errors = validateManifest(validManifest({ id: "mymod" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_ID_FORMAT)).toEqual([]);
  });

  it("accepts id with numbers", () => {
    const errors = validateManifest(validManifest({ id: "mod-v2" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_ID_FORMAT)).toEqual([]);
  });

  // --- Reserved ids (official campaign collision) ---

  it("rejects a mod id that collides with an official campaign id", () => {
    const errors = validateManifest(validManifest({ id: "lure-of-the-valley" }));
    expect(hasError(errors, { code: VALIDATION_CODES.RESERVED_ID })).toBe(true);
    // A campaign id is well-formed kebab-case, so the format check must not also fire.
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_ID_FORMAT)).toEqual([]);
  });

  it("rejects a mod id that collides with a one-day mission campaign id", () => {
    const errors = validateManifest(validManifest({ id: "animal-rescue" }));
    expect(hasError(errors, { code: VALIDATION_CODES.RESERVED_ID })).toBe(true);
  });

  it("does not flag a well-formed, non-campaign id as reserved", () => {
    const errors = validateManifest(validManifest({ id: "expanded-boulder-field" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.RESERVED_ID)).toEqual([]);
  });

  it("formats the reserved-id error to name the colliding id", () => {
    const msg = formatValidationError({ code: VALIDATION_CODES.RESERVED_ID, field: "id", value: "lure-of-the-valley" });
    expect(msg).toContain("lure-of-the-valley");
    expect(msg).toContain("campaign");
  });

  // --- Version format ---

  it("rejects non-semver version", () => {
    const errors = validateManifest(validManifest({ version: "v1" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_VERSION_FORMAT, field: "version" })).toBe(true);
  });

  it("accepts standard semver", () => {
    const errors = validateManifest(validManifest({ version: "2.10.3" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_VERSION_FORMAT)).toEqual([]);
  });

  // --- Array fields ---

  it("rejects non-array campaigns", () => {
    const errors = validateManifest(validManifest({ campaigns: "lure-of-the-valley" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "campaigns" })).toBe(true);
  });

  it("rejects non-array requiredProducts", () => {
    const errors = validateManifest(validManifest({ requiredProducts: "core-set" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "requiredProducts" })).toBe(true);
  });

  it("rejects non-array tags", () => {
    const errors = validateManifest(validManifest({ tags: "npc" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "tags" })).toBe(true);
  });

  it("rejects non-array optionalProducts", () => {
    const errors = validateManifest(validManifest({ optionalProducts: "something" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "optionalProducts" })).toBe(true);
  });

  // --- Product validation ---

  it("rejects unknown product in requiredProducts", () => {
    const errors = validateManifest(validManifest({ requiredProducts: ["core-set", "made-up-product"] }));
    expect(hasError(errors, { code: VALIDATION_CODES.UNKNOWN_PRODUCT, field: "requiredProducts", value: "made-up-product" })).toBe(true);
  });

  it("rejects unknown product in optionalProducts", () => {
    const errors = validateManifest(validManifest({ optionalProducts: ["not-a-real-product"] }));
    expect(hasError(errors, { code: VALIDATION_CODES.UNKNOWN_PRODUCT, field: "optionalProducts", value: "not-a-real-product" })).toBe(true);
  });

  it("accepts all official products", () => {
    const allIds = OFFICIAL_PRODUCTS.map((p) => p.id);
    const errors = validateManifest(validManifest({
      requiredProducts: allIds,
      optionalProducts: [],
    }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.UNKNOWN_PRODUCT)).toEqual([]);
  });

  it.each(OFFICIAL_PRODUCTS.map((p) => p.id))(
    "accepts official product: %s",
    (productId) => {
      const errors = validateManifest(validManifest({ requiredProducts: [productId] }));
      expect(errors.filter((e) => e.code === VALIDATION_CODES.UNKNOWN_PRODUCT)).toEqual([]);
    }
  );

  // --- Campaign-product requirements ---

  it("rejects campaign when its required product is missing", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["spire-in-bloom"],
      requiredProducts: ["core-set"],
    }));
    expect(hasError(errors, {
      code: VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT,
      value: "spire-in-bloom",
      campaign: "spire-in-bloom",
    })).toBe(true);
  });

  it("accepts campaign product in optionalProducts", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["spire-in-bloom"],
      requiredProducts: ["core-set"],
      optionalProducts: ["spire-in-bloom"],
    }));
    expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
  });

  it("accepts campaign when all required products are present", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["spire-in-bloom"],
      requiredProducts: ["core-set", "spire-in-bloom"],
    }));
    expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
  });

  it("skips product check for custom (unknown) campaign ids", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["my-custom-campaign"],
      requiredProducts: ["core-set"],
    }));
    expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
  });

  it.each(OFFICIAL_CAMPAIGNS.map(c => [c.id, c.requiredProducts]))(
    "campaign %s validates with its required products",
    (campaignId, products) => {
      const errors = validateManifest(validManifest({
        campaigns: [campaignId],
        requiredProducts: products,
      }));
      expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
    }
  );

  it("accepts products not implied by any selected campaign", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["lure-of-the-valley"],
      requiredProducts: ["core-set"],
      optionalProducts: ["moments-in-the-valley", "ranger-card-doubler"],
    }));
    expect(errors.filter(e => e.code === VALIDATION_CODES.UNKNOWN_PRODUCT)).toEqual([]);
    expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
  });

  it("accepts products whose associated campaign is not selected", () => {
    const errors = validateManifest(validManifest({
      campaigns: ["lure-of-the-valley"],
      requiredProducts: ["core-set", "spire-in-bloom"],
    }));
    expect(errors.filter(e => e.code === VALIDATION_CODES.UNKNOWN_PRODUCT)).toEqual([]);
    expect(errors.filter(e => e.code === VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT)).toEqual([]);
  });

  // --- safeToAddMidCampaign ---

  it("rejects non-boolean safeToAddMidCampaign", () => {
    const errors = validateManifest(validManifest({ safeToAddMidCampaign: "yes" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_BOOLEAN, field: "safeToAddMidCampaign" })).toBe(true);
  });

  // --- Collection-specific ---

  it("rejects collection without includedMods or includedCampaigns", () => {
    const errors = validateManifest(validManifest({ type: "collection" }));
    expect(codes(errors)).toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  it("rejects collection with both includedMods and includedCampaigns empty", () => {
    const errors = validateManifest(
      validManifest({ type: "collection", includedMods: [], includedCampaigns: [] }),
    );
    expect(codes(errors)).toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  it("accepts collection with non-empty includedCampaigns and empty includedMods", () => {
    const errors = validateManifest(
      validManifest({
        type: "collection",
        includedMods: [],
        includedCampaigns: [
          { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "abc1234" },
        ],
      }),
    );
    expect(codes(errors)).not.toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  it("accepts collection with both includedMods and includedCampaigns non-empty", () => {
    const errors = validateManifest(
      validManifest({
        type: "collection",
        includedMods: [
          { id: "x", name: "X", author: "A", version: "1.0.0", repoUrl: "https://github.com/a/b" },
        ],
        includedCampaigns: [
          { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "abc1234" },
        ],
      }),
    );
    expect(codes(errors)).not.toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  it("accepts collection with both non-empty includedMods and non-empty includedCampaigns", () => {
    const errors = validateManifest(
      validManifest({
        type: "collection",
        includedMods: [
          { id: "some-mod", name: "Some Mod", author: "Author", version: "1.0.0", repoUrl: "https://github.com/author/ebr-some-mod" },
        ],
        includedCampaigns: [
          { id: "lure-of-the-valley", branch: "campaign/lure-of-the-valley", commitHash: "abc1234" },
        ],
      }),
    );
    expect(codes(errors)).not.toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  it("rejects collection where includedCampaigns is a non-array and includedMods is absent", () => {
    const errors = validateManifest(
      validManifest({ type: "collection", includedCampaigns: "not-an-array" }),
    );
    expect(codes(errors)).toContain(VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS);
  });

  // --- includedMods entry validation ---

  it("rejects non-array includedMods", () => {
    const errors = validateManifest(validManifest({ includedMods: "not-array" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "includedMods" })).toBe(true);
  });

  it("reports missing fields in includedMods entries", () => {
    const errors = validateManifest(
      validManifest({
        includedMods: [{ id: "partial-mod" }],
      })
    );
    expect(hasError(errors, { code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: 0, field: "name" })).toBe(true);
    expect(hasError(errors, { code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: 0, field: "author" })).toBe(true);
    expect(hasError(errors, { code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: 0, field: "version" })).toBe(true);
    expect(hasError(errors, { code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: 0, field: "repoUrl" })).toBe(true);
  });

  it("validates multiple includedMods entries independently", () => {
    const errors = validateManifest(
      validManifest({
        type: "collection",
        includedMods: [
          { id: "good-mod", name: "Good", author: "A", version: "1.0.0", repoUrl: "https://github.com/a/b" },
          { id: "bad-mod" }, // missing name, author, version, repoUrl
        ],
      })
    );
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD && e.index === 0)).toEqual([]);
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD && e.index === 1).length).toBeGreaterThanOrEqual(4);
  });

  // --- language ---

  it("rejects empty string language", () => {
    const errors = validateManifest(validManifest({ language: "" }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_STRING, field: "language" })).toBe(true);
  });

  it("rejects non-string language", () => {
    const errors = validateManifest(validManifest({ language: 42 }));
    expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_STRING, field: "language" })).toBe(true);
  });

  it("rejects invalid BCP 47 language tag", () => {
    const errors = validateManifest(validManifest({ language: "123" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_LANGUAGE_TAG, field: "language", value: "123" })).toBe(true);
  });

  it.each(["en", "es", "fr", "de", "ja", "zh-Hans", "pt-BR"])(
    "accepts valid BCP 47 tag: %s",
    (lang) => {
      const errors = validateManifest(validManifest({ language: lang }));
      expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_LANGUAGE_TAG)).toEqual([]);
    }
  );

  // --- repoUrl ---

  it("rejects non-GitHub repoUrl", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://gitlab.com/test/mod" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_REPO_URL })).toBe(true);
  });

  it("accepts a valid GitHub URL", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://github.com/test/mod" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_REPO_URL)).toEqual([]);
  });

  it("accepts GitHub URL with different casing", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://GitHub.com/test/mod" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_REPO_URL)).toEqual([]);
  });

  it("accepts a GitHub URL with a trailing .git suffix", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://github.com/test/mod.git" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_REPO_URL)).toEqual([]);
  });

  it("rejects a GitHub URL with no repo segment", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://github.com/owner" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_REPO_URL })).toBe(true);
  });

  it("rejects a GitHub URL with extra path segments", () => {
    const errors = validateManifest(validManifest({ repoUrl: "https://github.com/owner/repo/tree/main" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_REPO_URL })).toBe(true);
  });

  // --- name / author / description non-empty ---

  it.each(["name", "author", "description"])(
    "rejects an empty %s",
    (field) => {
      const errors = validateManifest(validManifest({ [field]: "" }));
      expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_STRING, field })).toBe(true);
    },
  );

  it.each(["name", "author", "description"])(
    "rejects a whitespace-only %s",
    (field) => {
      const errors = validateManifest(validManifest({ [field]: "   " }));
      expect(hasError(errors, { code: VALIDATION_CODES.FIELD_NOT_STRING, field })).toBe(true);
    },
  );

  // --- icon ---

  it("rejects a multi-character icon", () => {
    const errors = validateManifest(validManifest({ icon: "ab" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ICON })).toBe(true);
  });

  it("rejects an empty icon", () => {
    const errors = validateManifest(validManifest({ icon: "" }));
    expect(hasError(errors, { code: VALIDATION_CODES.INVALID_ICON })).toBe(true);
  });

  it("accepts a single-grapheme emoji icon (with variation selector)", () => {
    const errors = validateManifest(validManifest({ icon: "🏔️" }));
    expect(errors.filter((e) => e.code === VALIDATION_CODES.INVALID_ICON)).toEqual([]);
  });
});

// --- formatValidationError ---

describe("formatValidationError", () => {
  it("formats every known code without throwing", () => {
    const testCases = [
      { code: VALIDATION_CODES.NOT_AN_OBJECT },
      { code: VALIDATION_CODES.MISSING_REQUIRED_FIELD, field: "name" },
      { code: VALIDATION_CODES.INVALID_TYPE, value: "bad" },
      { code: VALIDATION_CODES.INVALID_ID_FORMAT, field: "id", value: "Bad" },
      { code: VALIDATION_CODES.INVALID_VERSION_FORMAT, field: "version", value: "x" },
      { code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "tags" },
      { code: VALIDATION_CODES.FIELD_NOT_BOOLEAN, field: "safeToAddMidCampaign" },
      { code: VALIDATION_CODES.FIELD_NOT_STRING, field: "language" },
      { code: VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS },
      { code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: 0, field: "name" },
      { code: VALIDATION_CODES.INVALID_LANGUAGE_TAG, field: "language", value: "123" },
      { code: VALIDATION_CODES.INVALID_REPO_URL, field: "repoUrl", value: "https://gitlab.com/x" },
      { code: VALIDATION_CODES.INVALID_ICON, field: "icon", value: "abc" },
      { code: VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT, field: "requiredProducts", value: "spire-in-bloom", campaign: "spire-in-bloom" },
    ];
    for (const err of testCases) {
      const msg = formatValidationError(err);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("returns a string for unknown codes", () => {
    const msg = formatValidationError({ code: "UNKNOWN_CODE" });
    expect(typeof msg).toBe("string");
  });
});

// --- formatValidationErrors ---

describe("formatValidationErrors", () => {
  it("formats an array of errors", () => {
    const errors = [
      { code: VALIDATION_CODES.MISSING_REQUIRED_FIELD, field: "name" },
      { code: VALIDATION_CODES.INVALID_TYPE, value: "bad" },
    ];
    const messages = formatValidationErrors(errors);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => typeof m === "string")).toBe(true);
  });

  it("returns empty array for no errors", () => {
    expect(formatValidationErrors([])).toEqual([]);
  });
});

// --- bumpVersion ---

describe("bumpVersion", () => {
  it("bumps patch: 1.0.0 → 1.0.1", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });

  it("bumps minor: 1.2.3 → 1.3.0", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps major: 1.2.3 → 2.0.0", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("bumps from zero: 0.1.0 → 0.1.1", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
  });

  it("bumps minor resets patch: 1.2.5 → 1.3.0", () => {
    expect(bumpVersion("1.2.5", "minor")).toBe("1.3.0");
  });

  it("bumps major resets minor and patch: 3.7.9 → 4.0.0", () => {
    expect(bumpVersion("3.7.9", "major")).toBe("4.0.0");
  });

  it("throws ManifestError on invalid version", () => {
    expect(() => bumpVersion("not-a-version", "patch")).toThrow(ManifestError);
  });

  it("throws ManifestError on invalid bump type", () => {
    expect(() => bumpVersion("1.0.0", "invalid")).toThrow(ManifestError);
  });

  it("error message mentions the invalid version", () => {
    expect(() => bumpVersion("abc", "patch")).toThrow(/abc/);
  });

  it("error message mentions the invalid bump type", () => {
    expect(() => bumpVersion("1.0.0", "huge")).toThrow(/huge/);
  });
});

// --- compareVersions ---

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 1 when the first version is greater", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("returns -1 when the first version is lesser", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.9", "1.3.0")).toBe(-1);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
  });

  it("compares numerically, not lexically (10 > 9)", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("0.0.10", "0.0.9")).toBe(1);
  });

  it("ignores pre-release and build metadata beyond the numeric triple", () => {
    expect(compareVersions("1.2.3-beta", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3+build.5", "1.2.3-rc.1")).toBe(0);
  });

  it("returns null when either version is unparseable", () => {
    expect(compareVersions("not-a-version", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "")).toBeNull();
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(compareVersions(undefined, "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", null)).toBeNull();
    expect(compareVersions(123, "1.0.0")).toBeNull();
  });
});

// --- updateManifest ---

describe("updateManifest", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sets version and writes manifest", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "1.0.0" }));

    const result = await updateManifest({ dir: tmpDir, version: "1.0.1" });

    expect(result.manifest.version).toBe("1.0.1");
    const onDisk = JSON.parse(
      await readFile(join(tmpDir, "ebr-mod.json"), "utf-8"),
    );
    expect(onDisk.version).toBe("1.0.1");
  });

  it("reports version change", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "2.5.0" }));

    const result = await updateManifest({ dir: tmpDir, version: "2.6.0" });

    expect(result.changes).toContainEqual({
      field: "version",
      oldValue: "2.5.0",
      newValue: "2.6.0",
    });
  });

  it("skips version change when version not provided", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "1.0.0" }));

    const result = await updateManifest({ dir: tmpDir });

    expect(result.manifest.version).toBe("1.0.0");
    expect(result.changes.find((c) => c.field === "version")).toBeUndefined();
  });

  it("throws ManifestNotFoundError when no manifest exists", async () => {
    await expect(
      updateManifest({ dir: tmpDir }),
    ).rejects.toThrow(ManifestNotFoundError);
  });

  it("calls onProgress with expected steps", async () => {
    await writeManifestFile(tmpDir, validManifest());

    const progress = createProgressCollector();
    await updateManifest(
      { dir: tmpDir, version: "1.0.1" },
      { onProgress: progress.fn },
    );

    expect(progress.steps()).toContain("read");
    expect(progress.steps()).toContain("version");
    expect(progress.steps()).toContain("write");
    progress.assertValid();
  });

  it("preserves all other manifest fields", async () => {
    const original = validManifest({
      version: "1.0.0",
      tags: ["test", "example"],
      authorDiscord: "test#1234",
    });
    await writeManifestFile(tmpDir, original);

    const result = await updateManifest({ dir: tmpDir, version: "1.0.1" });

    expect(result.manifest.tags).toEqual(["test", "example"]);
    expect(result.manifest.authorDiscord).toBe("test#1234");
    expect(result.manifest.name).toBe("Test Mod");
  });

  it("sets an explicit version", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "1.0.0" }));

    const result = await updateManifest({ dir: tmpDir, version: "3.0.0" });

    expect(result.manifest.version).toBe("3.0.0");
    expect(result.changes).toContainEqual({
      field: "version",
      oldValue: "1.0.0",
      newValue: "3.0.0",
    });
    const onDisk = JSON.parse(
      await readFile(join(tmpDir, "ebr-mod.json"), "utf-8"),
    );
    expect(onDisk.version).toBe("3.0.0");
  });

  it("throws ManifestError for invalid version format", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "1.0.0" }));

    await expect(
      updateManifest({ dir: tmpDir, version: "not-a-version" }),
    ).rejects.toThrow(ManifestError);
  });

  it("skips write when version matches current version", async () => {
    await writeManifestFile(tmpDir, validManifest({ version: "2.0.0" }));

    const result = await updateManifest({ dir: tmpDir, version: "2.0.0" });

    expect(result.changes.find((c) => c.field === "version")).toBeUndefined();
  });
});


describe("validateIcon", () => {
  it("accepts a single ASCII character", () => {
    expect(validateIcon("X")).toBe(true);
  });

  it("accepts a single emoji", () => {
    expect(validateIcon("🦀")).toBe(true);
  });

  it("accepts an emoji with a variation selector (one grapheme cluster)", () => {
    // mountain + variation selector-16 = one grapheme
    expect(validateIcon("🏔️")).toBe(true);
  });

  it("accepts a ZWJ emoji sequence (one grapheme cluster)", () => {
    // family emoji is multiple code points joined into a single grapheme
    expect(validateIcon("👨‍👩‍👧")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(validateIcon("")).not.toBe(true);
  });

  it("rejects whitespace-only input", () => {
    expect(validateIcon(" ")).not.toBe(true);
    expect(validateIcon("\t")).not.toBe(true);
  });

  it("rejects multiple ASCII characters", () => {
    expect(validateIcon("ab")).not.toBe(true);
  });

  it("rejects multiple emoji", () => {
    expect(validateIcon("🦀🦀")).not.toBe(true);
  });

  it("rejects non-string values", () => {
    expect(validateIcon(undefined)).not.toBe(true);
    expect(validateIcon(null)).not.toBe(true);
    expect(validateIcon(42)).not.toBe(true);
  });
});

// --- deriveOptionalProducts ---

describe("deriveOptionalProducts", () => {
  it("returns empty array for theme mods regardless of inputs", () => {
    expect(
      deriveOptionalProducts({
        type: "theme",
        campaigns: ["lure-of-the-valley"],
        requiredProducts: [],
        optionalProducts: ["legacy-of-the-ancestors"],
      }),
    ).toEqual([]);
  });

  it("does not double-add a product already in requiredProducts", () => {
    // lure-of-the-valley implies core-set
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: ["lure-of-the-valley"],
      requiredProducts: ["core-set"],
      optionalProducts: [],
    });
    expect(result).toEqual([]);
  });

  it("moves implied-but-not-required products into optional", () => {
    // spire-in-bloom implies core-set + spire-in-bloom
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: ["spire-in-bloom"],
      requiredProducts: [],
      optionalProducts: [],
    });
    expect(result.sort()).toEqual(["core-set", "spire-in-bloom"].sort());
  });

  it("preserves user-set optionalProducts entries", () => {
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: ["lure-of-the-valley"],
      requiredProducts: [],
      optionalProducts: ["legacy-of-the-ancestors"],
    });
    expect(new Set(result)).toEqual(new Set(["core-set", "legacy-of-the-ancestors"]));
  });

  it("removes a product from optional when it is also in required", () => {
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: [],
      requiredProducts: ["core-set"],
      optionalProducts: ["core-set", "legacy-of-the-ancestors"],
    });
    expect(result).toEqual(["legacy-of-the-ancestors"]);
  });

  it("ignores unknown campaign ids", () => {
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: ["does-not-exist"],
      requiredProducts: [],
      optionalProducts: [],
    });
    expect(result).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const required = ["core-set"];
    const optional = ["legacy-of-the-ancestors"];
    deriveOptionalProducts({
      type: "campaign",
      campaigns: ["spire-in-bloom"],
      requiredProducts: required,
      optionalProducts: optional,
    });
    expect(required).toEqual(["core-set"]);
    expect(optional).toEqual(["legacy-of-the-ancestors"]);
  });

  it("deduplicates products implied by multiple campaigns", () => {
    // spire-in-bloom and shadow-of-the-storm both imply core-set
    const result = deriveOptionalProducts({
      type: "campaign",
      campaigns: ["spire-in-bloom", "shadow-of-the-storm"],
      requiredProducts: [],
      optionalProducts: [],
    });
    expect(result.filter((id) => id === "core-set")).toHaveLength(1);
    expect(new Set(result)).toEqual(new Set(["core-set", "spire-in-bloom", "shadow-of-the-storm"]));
  });

  it("defaults missing params to empty arrays (only type given)", () => {
    expect(deriveOptionalProducts({ type: "campaign" })).toEqual([]);
  });
});

// --- applyMissingProductFix ---

describe("applyMissingProductFix", () => {
  it("adds products to requiredProducts when bucket is 'required'", () => {
    const manifest = { requiredProducts: ["core-set"] };
    applyMissingProductFix(manifest, ["spire-in-bloom"], "required");
    expect(new Set(manifest.requiredProducts)).toEqual(new Set(["core-set", "spire-in-bloom"]));
  });

  it("adds products to optionalProducts when bucket is 'optional'", () => {
    const manifest = { optionalProducts: ["core-set"] };
    applyMissingProductFix(manifest, ["spire-in-bloom"], "optional");
    expect(new Set(manifest.optionalProducts)).toEqual(new Set(["core-set", "spire-in-bloom"]));
  });

  it("when promoting to required, removes the product from optional", () => {
    const manifest = {
      requiredProducts: [],
      optionalProducts: ["spire-in-bloom", "legacy-of-the-ancestors"],
    };
    applyMissingProductFix(manifest, ["spire-in-bloom"], "required");
    expect(manifest.requiredProducts).toEqual(["spire-in-bloom"]);
    expect(manifest.optionalProducts).toEqual(["legacy-of-the-ancestors"]);
  });

  it("deletes optionalProducts when it empties out after promotion", () => {
    const manifest = { requiredProducts: [], optionalProducts: ["spire-in-bloom"] };
    applyMissingProductFix(manifest, ["spire-in-bloom"], "required");
    expect("optionalProducts" in manifest).toBe(false);
  });

  it("creates requiredProducts array when missing", () => {
    const manifest = {};
    applyMissingProductFix(manifest, ["core-set"], "required");
    expect(manifest.requiredProducts).toEqual(["core-set"]);
  });

  it("creates optionalProducts array when missing", () => {
    const manifest = {};
    applyMissingProductFix(manifest, ["core-set"], "optional");
    expect(manifest.optionalProducts).toEqual(["core-set"]);
  });

  it("de-duplicates within the target bucket", () => {
    const manifest = { requiredProducts: ["core-set"] };
    applyMissingProductFix(manifest, ["core-set", "spire-in-bloom"], "required");
    expect(new Set(manifest.requiredProducts)).toEqual(new Set(["core-set", "spire-in-bloom"]));
    expect(manifest.requiredProducts.length).toBe(2);
  });

  it("returns the same manifest object", () => {
    const manifest = { requiredProducts: [] };
    const result = applyMissingProductFix(manifest, ["core-set"], "required");
    expect(result).toBe(manifest);
  });

  it("does not duplicate a product already in optionalProducts when adding to optional", () => {
    const manifest = { optionalProducts: ["core-set", "spire-in-bloom"] };
    applyMissingProductFix(manifest, ["core-set"], "optional");
    expect(manifest.optionalProducts.filter((id) => id === "core-set")).toHaveLength(1);
    expect(new Set(manifest.optionalProducts)).toEqual(new Set(["core-set", "spire-in-bloom"]));
    expect(manifest.optionalProducts.length).toBe(2);
  });

  it("removes from requiredProducts when promoting a product to optional", () => {
    const manifest = { requiredProducts: ["core-set", "spire-in-bloom"], optionalProducts: [] };
    applyMissingProductFix(manifest, ["core-set"], "optional");
    expect(manifest.optionalProducts).toContain("core-set");
    expect(manifest.requiredProducts).not.toContain("core-set");
    expect(manifest.requiredProducts).toContain("spire-in-bloom");
  });

  it("leaves requiredProducts as an empty array (not deleted) when fully drained", () => {
    const manifest = { requiredProducts: ["core-set"], optionalProducts: [] };
    applyMissingProductFix(manifest, ["core-set"], "optional");
    expect(manifest.requiredProducts).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(manifest, "requiredProducts")).toBe(true);
  });

  it("throws on an unknown bucket", () => {
    expect(() => applyMissingProductFix({}, ["core-set"], "neither")).toThrow();
  });
});


