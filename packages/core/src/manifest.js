/**
 * Read, write, and validate ebr-mod.json manifests.
 * Shared by every command.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError, ManifestNotFoundError, ManifestParseError } from "./errors.js";
import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "./catalogs.js";

/** @typedef {import('./types.js').Manifest} Manifest */
/** @typedef {import('./types.js').RawManifest} RawManifest */
/** @typedef {import('./types.js').ModValues} ModValues */
/** @typedef {import('./types.js').ValidationErrorInfo} ValidationErrorInfo */

const MANIFEST_FILENAME = "ebr-mod.json";
export const DEFAULT_MOD_ICON = "\uD83C\uDFD4\uFE0F"; // mountain

const REQUIRED_FIELDS = [
  "schemaVersion",
  "name",
  "id",
  "version",
  "type",
  "description",
  "author",
  "campaigns",
  "requiredProducts",
  "safeToAddMidCampaign",
  "language",
  "repoUrl",
];

const INCLUDED_MOD_REQUIRED_FIELDS = ["id", "name", "author", "version", "repoUrl"];
const INCLUDED_CAMPAIGN_REQUIRED_FIELDS = ["id", "branch", "commitHash"];

// --- Field validators ---
// Each returns `true` when valid, or a human-readable error string.
// Used by both validateManifest() and CLI prompts.

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;
// Strict owner/repo shape. Mirrors GITHUB_REPO_RE in
// ebr-mod-registry/scripts/validate-mods.js so a manifest that passes publish
// also passes the registry PR check. Trailing ".git" and a trailing slash are
// tolerated; anything beyond owner/repo is rejected.
const GITHUB_REPO_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/**
 * Validate that a value is a non-empty string.
 * @param {*} val
 * @returns {true|string}
 */
export function validateNonEmpty(val) {
  return (typeof val === "string" && val.trim().length > 0) || "Cannot be empty.";
}

/**
 * Validate a mod name: non-empty and produces a valid kebab-case id.
 * @param {string} val
 * @returns {true|string}
 */
export function validateName(val) {
  if (typeof val !== "string" || !val.trim()) return "Cannot be empty.";
  const id = val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) return "Name must contain at least one letter or number.";
  return true;
}

/**
 * Validate that a value is a single user-perceived character (one grapheme
 * cluster). Accepts a single emoji, including ZWJ sequences and emoji that
 * combine a base code point with a variation selector. Whitespace-only
 * strings are rejected.
 * @param {*} val
 * @returns {true|string}
 */
export function validateIcon(val) {
  if (typeof val !== "string" || !val.trim()) return "Cannot be empty.";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const count = [...segmenter.segment(val)].length;
  if (count !== 1) {
    return `Icon must be exactly one character (got ${count}).`;
  }
  return true;
}

/**
 * Validate a kebab-case identifier.
 * @param {string} val
 * @returns {true|string}
 */
export function validateId(val) {
  if (typeof val !== "string" || !val) return "Cannot be empty.";
  return KEBAB_CASE_RE.test(val) || `Must be kebab-case (lowercase letters, numbers, hyphens). Got "${val}".`;
}

/**
 * Validate a semver-like version string.
 * @param {string} val
 * @returns {true|string}
 */
export function validateVersion(val) {
  if (typeof val !== "string" || !val) return "Cannot be empty.";
  return SEMVER_RE.test(val) || `Must be a semver string (e.g. "1.0.0"). Got "${val}".`;
}

/**
 * Validate a BCP 47 language tag.
 * @param {string} val
 * @returns {true|string}
 */
export function validateLanguage(val) {
  if (typeof val !== "string" || !val.trim()) return "Cannot be empty.";
  try {
    Intl.getCanonicalLocales(val.trim());
    return true;
  } catch {
    return `"${val}" is not a valid BCP 47 language tag (e.g. "en", "fr", "pt-BR").`;
  }
}

/**
 * Validate a GitHub repo URL (or empty string for unpublished mods).
 * Non-empty values must be a full https://github.com/<owner>/<repo> URL; the
 * empty string is allowed so work-in-progress mods pass `ebr validate`. The
 * publish flow separately requires a non-empty repoUrl.
 * @param {string} val
 * @returns {true|string}
 */
export function validateRepoUrl(val) {
  if (typeof val !== "string") return "Must be a string.";
  if (val === "") return true;
  return GITHUB_REPO_RE.test(val)
    || `Must be a GitHub repo URL (https://github.com/<owner>/<repo>). Got "${val}".`;
}

/**
 * Stable validation error codes. Tests assert on these, not on message strings.
 * The CLI/GUI maps codes to localized human-readable messages.
 */
export const VALIDATION_CODES = Object.freeze({
  NOT_AN_OBJECT: "NOT_AN_OBJECT",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_ID_FORMAT: "INVALID_ID_FORMAT",
  RESERVED_ID: "RESERVED_ID",
  INVALID_VERSION_FORMAT: "INVALID_VERSION_FORMAT",
  FIELD_NOT_ARRAY: "FIELD_NOT_ARRAY",
  FIELD_NOT_BOOLEAN: "FIELD_NOT_BOOLEAN",
  FIELD_NOT_STRING: "FIELD_NOT_STRING",
  FIELD_NOT_NUMBER: "FIELD_NOT_NUMBER",
  ARRAY_ITEM_NOT_STRING: "ARRAY_ITEM_NOT_STRING",
  COLLECTION_MISSING_INCLUDED_MODS: "COLLECTION_MISSING_INCLUDED_MODS",
  INCLUDED_MOD_MISSING_FIELD: "INCLUDED_MOD_MISSING_FIELD",
  INCLUDED_CAMPAIGN_MISSING_FIELD: "INCLUDED_CAMPAIGN_MISSING_FIELD",
  INVALID_LANGUAGE_TAG: "INVALID_LANGUAGE_TAG",
  UNKNOWN_PRODUCT: "UNKNOWN_PRODUCT",
  CAMPAIGN_MISSING_PRODUCT: "CAMPAIGN_MISSING_PRODUCT",
  INVALID_REPO_URL: "INVALID_REPO_URL",
  INVALID_ICON: "INVALID_ICON",
});

/**
 * Read and parse ebr-mod.json from a directory.
 * @param {string} dir - Directory containing ebr-mod.json.
 * @returns {Promise<RawManifest>} Parsed, but not yet validated, manifest object.
 * @throws {ManifestError} If the file is missing or contains invalid JSON.
 */
export async function readManifest(dir) {
  const filePath = join(dir, MANIFEST_FILENAME);
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      throw new ManifestNotFoundError(dir);
    }
    throw new ManifestError("file", `Could not read ${MANIFEST_FILENAME}: ${e.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ManifestParseError(dir);
  }
}

/**
 * Write a manifest object to ebr-mod.json in a directory.
 * @param {string} dir - Directory to write ebr-mod.json into.
 * @param {object} manifest - Manifest object to serialize.
 */
export async function writeManifest(dir, manifest) {
  const filePath = join(dir, MANIFEST_FILENAME);
  const json = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(filePath, json, "utf-8");
}

/**
 * Validate a manifest object. Returns an array of structured validation errors (empty if valid).
 * Each error has a stable `code` (from `VALIDATION_CODES`) plus context fields (field, value, index).
 * Use `formatValidationError()` to get human-readable messages for display.
 *
 * @param {unknown} input - Untrusted value to validate.
 * @returns {ValidationErrorInfo[]}
 */
export function validateManifest(input) {
  /** @type {ValidationErrorInfo[]} */
  const errors = [];

  if (!input || typeof input !== "object") {
    return [{ code: VALIDATION_CODES.NOT_AN_OBJECT }];
  }
  const manifest = /** @type {Record<string, any>} */ (input);

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      errors.push({ code: VALIDATION_CODES.MISSING_REQUIRED_FIELD, field });
    }
  }

  // schemaVersion must be a number when present.
  if (manifest.schemaVersion !== undefined && typeof manifest.schemaVersion !== "number") {
    errors.push({ code: VALIDATION_CODES.FIELD_NOT_NUMBER, field: "schemaVersion" });
  }

  // Type validation
  if (manifest.type !== undefined && !MOD_TYPES.some(t => t.id === manifest.type)) {
    errors.push({ code: VALIDATION_CODES.INVALID_TYPE, value: manifest.type });
  }

  // ID format: kebab-case
  if (manifest.id !== undefined && validateId(manifest.id) !== true) {
    errors.push({ code: VALIDATION_CODES.INVALID_ID_FORMAT, field: "id", value: manifest.id });
  }

  // ID must not collide with an official campaign id
  if (typeof manifest.id === "string" && OFFICIAL_CAMPAIGNS.some((c) => c.id === manifest.id)) {
    errors.push({ code: VALIDATION_CODES.RESERVED_ID, field: "id", value: manifest.id });
  }

  // Free-text required fields must be non-empty strings (not just present).
  for (const field of ["name", "author", "description"]) {
    if (manifest[field] != null && validateNonEmpty(manifest[field]) !== true) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_STRING, field });
    }
  }

  // Version format: semver-like
  if (manifest.version !== undefined && validateVersion(manifest.version) !== true) {
    errors.push({ code: VALIDATION_CODES.INVALID_VERSION_FORMAT, field: "version", value: manifest.version });
  }

  // Array fields: must be arrays of strings when present.
  for (const field of ["campaigns", "requiredProducts", "tags", "optionalProducts"]) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_ARRAY, field });
    } else {
      value.forEach((item, index) => {
        if (typeof item !== "string") {
          errors.push({ code: VALIDATION_CODES.ARRAY_ITEM_NOT_STRING, field, index, value: item });
        }
      });
    }
  }

  // Validate product IDs against known products
  const knownProductIds = new Set(OFFICIAL_PRODUCTS.map((p) => p.id));
  for (const field of ["requiredProducts", "optionalProducts"]) {
    if (Array.isArray(manifest[field])) {
      for (const value of manifest[field]) {
        if (typeof value === "string" && !knownProductIds.has(value)) {
          errors.push({ code: VALIDATION_CODES.UNKNOWN_PRODUCT, field, value });
        }
      }
    }
  }

  // Validate that campaigns' required products appear in requiredProducts or optionalProducts
  if (Array.isArray(manifest.campaigns)) {
    const allProducts = new Set([
      ...(Array.isArray(manifest.requiredProducts) ? manifest.requiredProducts : []),
      ...(Array.isArray(manifest.optionalProducts) ? manifest.optionalProducts : []),
    ]);
    for (const campaignId of manifest.campaigns) {
      const campaign = OFFICIAL_CAMPAIGNS.find(c => c.id === campaignId);
      if (!campaign) continue;
      for (const productId of campaign.requiredProducts) {
        if (!allProducts.has(productId)) {
          errors.push({ code: VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT, field: "requiredProducts", value: productId, campaign: campaignId });
        }
      }
    }
  }

  // safeToAddMidCampaign must be boolean
  if (
    manifest.safeToAddMidCampaign !== undefined &&
    typeof manifest.safeToAddMidCampaign !== "boolean"
  ) {
    errors.push({ code: VALIDATION_CODES.FIELD_NOT_BOOLEAN, field: "safeToAddMidCampaign" });
  }

  // collection type requires at least one included mod or campaign
  if (manifest.type === "collection") {
    const hasMods = Array.isArray(manifest.includedMods) && manifest.includedMods.length > 0;
    const hasCampaigns = Array.isArray(manifest.includedCampaigns) && manifest.includedCampaigns.length > 0;
    if (!hasMods && !hasCampaigns) {
      errors.push({ code: VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS });
    }
  }

  // Validate includedMods entries when present
  if (manifest.includedMods !== undefined) {
    if (!Array.isArray(manifest.includedMods)) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "includedMods" });
    } else {
      for (let i = 0; i < manifest.includedMods.length; i++) {
        const mod = manifest.includedMods[i];
        for (const field of INCLUDED_MOD_REQUIRED_FIELDS) {
          if (!mod[field]) {
            errors.push({ code: VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD, index: i, field });
          }
        }
      }
    }
  }

  // Validate includedCampaigns entries when present: each must carry a string
  // id/branch/commitHash, matching the IncludedCampaign shape assertValidManifest
  // narrows to.
  if (manifest.includedCampaigns !== undefined) {
    if (!Array.isArray(manifest.includedCampaigns)) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_ARRAY, field: "includedCampaigns" });
    } else {
      for (let i = 0; i < manifest.includedCampaigns.length; i++) {
        const entry = manifest.includedCampaigns[i];
        for (const field of INCLUDED_CAMPAIGN_REQUIRED_FIELDS) {
          if (!entry || typeof entry[field] !== "string" || entry[field].length === 0) {
            errors.push({ code: VALIDATION_CODES.INCLUDED_CAMPAIGN_MISSING_FIELD, index: i, field });
          }
        }
      }
    }
  }

  // language: non-empty string and valid BCP 47 tag
  if (manifest.language !== undefined) {
    if (typeof manifest.language !== "string" || manifest.language.length === 0) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_STRING, field: "language" });
    } else if (validateLanguage(manifest.language) !== true) {
      errors.push({ code: VALIDATION_CODES.INVALID_LANGUAGE_TAG, field: "language", value: manifest.language });
    }
  }

  // repoUrl validation - a present repoUrl must be a string and a valid GitHub
  // URL. A present-but-non-string value is rejected.
  if (manifest.repoUrl !== undefined) {
    if (typeof manifest.repoUrl !== "string" || validateRepoUrl(manifest.repoUrl) !== true) {
      errors.push({ code: VALIDATION_CODES.INVALID_REPO_URL, field: "repoUrl", value: manifest.repoUrl });
    }
  }

  // icon must be a single grapheme cluster
  if (manifest.icon !== undefined && validateIcon(manifest.icon) !== true) {
    errors.push({ code: VALIDATION_CODES.INVALID_ICON, field: "icon", value: manifest.icon });
  }

  return errors;
}

/**
 * Format a single validation error as a human-readable string.
 * Used by the CLI for display. The GUI may use its own formatting/localization.
 *
 * @param {ValidationErrorInfo} err - A validation error object from validateManifest().
 * @returns {string} Human-readable error message.
 */
export function formatValidationError(err) {
  switch (err.code) {
    case VALIDATION_CODES.NOT_AN_OBJECT:
      return "Manifest must be a JSON object.";
    case VALIDATION_CODES.MISSING_REQUIRED_FIELD:
      return `Missing required field: "${err.field}".`;
    case VALIDATION_CODES.INVALID_TYPE:
      return `Invalid type "${err.value}". Must be one of: ${MOD_TYPES.map(t => t.id).join(", ")}.`;
    case VALIDATION_CODES.INVALID_ID_FORMAT:
      return `"id" must be kebab-case (lowercase letters, numbers, hyphens). Got "${err.value}".`;
    case VALIDATION_CODES.RESERVED_ID:
      return `"id" cannot be "${err.value}" - that is an official campaign id, reserved for campaigns. Choose a different mod id.`;
    case VALIDATION_CODES.INVALID_VERSION_FORMAT:
      return `"${err.field}" must be a semver string (e.g. "1.0.0"). Got "${err.value}".`;
    case VALIDATION_CODES.FIELD_NOT_ARRAY:
      return `"${err.field}" must be an array.`;
    case VALIDATION_CODES.FIELD_NOT_BOOLEAN:
      return `"${err.field}" must be a boolean.`;
    case VALIDATION_CODES.FIELD_NOT_STRING:
      return `"${err.field}" must be a non-empty string.`;
    case VALIDATION_CODES.FIELD_NOT_NUMBER:
      return `"${err.field}" must be a number.`;
    case VALIDATION_CODES.ARRAY_ITEM_NOT_STRING:
      return `"${err.field}[${err.index}]" must be a string.`;
    case VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS:
      return `Collection mods must include at least one mod or campaign (non-empty "includedMods" or "includedCampaigns").`;
    case VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD:
      return `includedMods[${err.index}] is missing required field: "${err.field}".`;
    case VALIDATION_CODES.INCLUDED_CAMPAIGN_MISSING_FIELD:
      return `includedCampaigns[${err.index}] must have a non-empty string "${err.field}".`;
    case VALIDATION_CODES.INVALID_LANGUAGE_TAG:
      return `"language" must be a valid BCP 47 language tag (e.g. "en", "es", "zh-Hans"). Got "${err.value}".`;
    case VALIDATION_CODES.UNKNOWN_PRODUCT:
      return `Unknown product "${err.value}" in "${err.field}". See the known products list in catalogs.js.`;
    case VALIDATION_CODES.CAMPAIGN_MISSING_PRODUCT: {
      const campaign = OFFICIAL_CAMPAIGNS.find(c => c.id === err.campaign);
      const product = OFFICIAL_PRODUCTS.find(p => p.id === err.value);
      return `Campaign "${campaign?.name || err.campaign}" requires product "${product?.name || err.value}" in requiredProducts or optionalProducts.`;
    }
    case VALIDATION_CODES.INVALID_REPO_URL:
      return `"repoUrl" must be a GitHub URL (https://github.com/...). Got "${err.value}".`;
    case VALIDATION_CODES.INVALID_ICON:
      return `"icon" must be exactly one character. Got "${err.value}".`;
    default:
      return `Unknown validation error: ${err.code}`;
  }
}

/**
 * Format all validation errors as human-readable strings.
 * @param {ValidationErrorInfo[]} errors - Array of validation error objects from validateManifest().
 * @returns {string[]} Array of human-readable error messages.
 */
export function formatValidationErrors(errors) {
  return errors.map(formatValidationError);
}

/**
 * Validate a raw (on-disk) manifest and narrow it to a `Manifest`, or throw with
 * the aggregated validation errors. This is the single gate that turns the
 * unvalidated `readManifest` result into a shape callers can rely on.
 *
 * @param {RawManifest} manifest - A parsed, not-yet-validated manifest.
 * @returns {Manifest} The same object, narrowed to a validated manifest.
 * @throws {ManifestError} If validation fails (message lists every problem).
 */
export function assertValidManifest(manifest) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    const messages = formatValidationErrors(errors);
    throw new ManifestError(
      "validation",
      `Manifest validation failed:\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    );
  }
  return /** @type {Manifest} */ (manifest);
}

/**
 * Bump a semver version string.
 * @param {string} version - Current version (e.g. "1.2.3").
 * @param {"patch"|"minor"|"major"} type - Bump type.
 * @returns {string} Bumped version.
 */
export function bumpVersion(version, type) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new ManifestError(
      "version",
      `Cannot bump invalid version "${version}". Expected semver format (e.g. "1.0.0").`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new ManifestError(
        "version",
        `Invalid bump type "${type}". Must be "major", "minor", or "patch".`,
      );
  }
}

/**
 * Compare two semver-like version strings by their major.minor.patch triple.
 *
 * Pre-release and build metadata are ignored (only the leading numeric triple
 * is compared), matching the rest of the toolchain's lenient SEMVER handling.
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null} -1 if a < b, 1 if a > b, 0 if equal, or `null` when
 *   either value cannot be parsed as a version (callers treat null as
 *   "cannot compare").
 */
export function compareVersions(a, b) {
  const parse = (/** @type {string} */ v) => {
    const m = typeof v === "string" ? v.match(/^(\d+)\.(\d+)\.(\d+)/) : null;
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Convert a mod name to a kebab-case identifier.
 * @param {string} name
 * @returns {string}
 */
export function toId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive `optionalProducts` from selected campaigns. Any product implied by
 * a campaign that the user did not put in `requiredProducts` becomes
 * optional. Existing `optionalProducts` entries are preserved unless they
 * have since been moved to `requiredProducts`. Theme mods (which target
 * `"any"`) get `[]` - the caller decides whether to drop the key.
 *
 * Pure function: returns a fresh array, never mutates inputs.
 *
 * @param {object} input
 * @param {string} input.type - Mod type (theme | campaign | one-day-mission | enhancement | expansion | collection).
 * @param {string[]} [input.campaigns] - Selected campaign ids.
 * @param {string[]} [input.requiredProducts] - Products the user marked required.
 * @param {string[]} [input.optionalProducts] - Products already marked optional.
 * @returns {string[]} The derived `optionalProducts` array.
 */
export function deriveOptionalProducts({ type, campaigns = [], requiredProducts = [], optionalProducts = [] }) {
  if (type === "theme") return [];
  const required = new Set(requiredProducts);
  const result = new Set(optionalProducts);
  for (const id of campaigns) {
    const campaign = OFFICIAL_CAMPAIGNS.find((c) => c.id === id);
    if (!campaign) continue;
    for (const productId of campaign.requiredProducts) {
      if (!required.has(productId)) result.add(productId);
    }
  }
  // Required wins over optional.
  for (const id of required) result.delete(id);
  return [...result];
}

/**
 * Apply a `CAMPAIGN_MISSING_PRODUCT` auto-fix to a manifest. Adds the given
 * product ids to either `requiredProducts` or `optionalProducts`, with
 * symmetric de-duplication so a product never ends up in both buckets:
 * promoting an id into one bucket removes it from the other.
 *
 * Mutates the manifest in place and returns it. `requiredProducts` is a
 * required manifest field, so it stays as an empty array if drained;
 * `optionalProducts` is optional, so it's deleted when drained.
 *
 * @param {RawManifest} manifest - The parsed manifest. `requiredProducts` and
 *   `optionalProducts` must be arrays or absent; this function is meant to
 *   be called only after callers have confirmed those fields are well-formed.
 * @param {string[]} missingProducts - Product ids to add.
 * @param {"required"|"optional"} bucket - Which list to add them to.
 * @returns {RawManifest} The same manifest object (mutated).
 */
export function applyMissingProductFix(manifest, missingProducts, bucket) {
  if (bucket !== "required" && bucket !== "optional") {
    throw new Error(`applyMissingProductFix: bucket must be "required" or "optional", got "${bucket}".`);
  }
  if (bucket === "required") {
    const required = new Set(Array.isArray(manifest.requiredProducts) ? manifest.requiredProducts : []);
    for (const id of missingProducts) required.add(id);
    manifest.requiredProducts = [...required];
    if (Array.isArray(manifest.optionalProducts)) {
      manifest.optionalProducts = manifest.optionalProducts.filter((id) => !required.has(id));
      if (manifest.optionalProducts.length === 0) delete manifest.optionalProducts;
    }
  } else {
    const optional = new Set(Array.isArray(manifest.optionalProducts) ? manifest.optionalProducts : []);
    for (const id of missingProducts) optional.add(id);
    manifest.optionalProducts = [...optional];
    // Symmetric de-dupe with requiredProducts. Leave requiredProducts as
    // an empty array if it ends up empty - it's a required manifest field.
    if (Array.isArray(manifest.requiredProducts)) {
      manifest.requiredProducts = manifest.requiredProducts.filter((id) => !optional.has(id));
    }
  }
  return manifest;
}

/**
 * Build a manifest object from a creator's collected field values.
 *
 * @param {ModValues} options
 * @returns {Manifest} Manifest object.
 */
export function buildManifest(options) {
  const id = options.id || toId(options.name);
  /** @type {Manifest} */
  const manifest = {
    schemaVersion: 1,
    name: options.name,
    id,
    version: options.version || "0.1.0",
    type: options.type,
    description: options.description,
    author: options.author,
    campaigns: options.campaigns,
    requiredProducts: options.requiredProducts,
    safeToAddMidCampaign: options.safeToAddMidCampaign,
    language: options.language,
    tags: options.tags || [],
    repoUrl: options.repoUrl || "",
  };

  // Optional fields - only include when provided
  if (options.authorDiscord) manifest.authorDiscord = options.authorDiscord;
  if (options.optionalProducts) manifest.optionalProducts = options.optionalProducts;
  if (options.midCampaignNotes) manifest.midCampaignNotes = options.midCampaignNotes;
  manifest.icon = options.icon || DEFAULT_MOD_ICON;
  if (options.type === "collection") manifest.includedMods = options.includedMods || [];

  return manifest;
}

/**
 * Auto-update ebr-mod.json fields.
 *
 * Bumps the version and/or sets the repoUrl.
 *
 * @param {object} options
 * @param {string} options.dir - Mod directory containing ebr-mod.json.
 * @param {string} [options.version] - Target version to set (omit or null to skip).
 * @param {string|null} [options.repoUrl] - GitHub URL to set (omit or null to skip).
 * @param {object} [callbacks]
 * @param {function} [callbacks.onProgress] - Progress callback.
 * @returns {Promise<{manifest: RawManifest, changes: Array<{field: string, oldValue: *, newValue: *}>}>}
 */
export async function updateManifest(
  { dir, version, repoUrl },
  { onProgress } = {},
) {
  onProgress?.({ step: "read", message: "Reading manifest..." });
  const manifest = await readManifest(dir);

  /** @type {Array<{field: string, oldValue: *, newValue: *}>} */
  const changes = [];

  // --- Set version ---
  if (version) {
    const valid = validateVersion(version);
    if (valid !== true) {
      throw new ManifestError("version", valid);
    }
    if (manifest.version !== version) {
      const oldVersion = manifest.version;
      onProgress?.({ step: "version", message: `Setting version to ${version}...` });
      manifest.version = version;
      changes.push({ field: "version", oldValue: oldVersion, newValue: version });
    }
  }

  // --- Set repoUrl ---
  if (repoUrl && manifest.repoUrl !== repoUrl) {
    const oldValue = manifest.repoUrl;
    manifest.repoUrl = repoUrl;
    changes.push({ field: "repoUrl", oldValue, newValue: repoUrl });
  }

  // --- Write updated manifest ---
  if (changes.length > 0) {
    onProgress?.({ step: "write", message: "Writing manifest..." });
    await writeManifest(dir, manifest);
  }

  return { manifest, changes };
}
