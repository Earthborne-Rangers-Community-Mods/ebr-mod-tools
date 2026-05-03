/**
 * Read, write, and validate ebr-mod.json manifests.
 * Shared by every command.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError, ManifestNotFoundError, ManifestParseError } from "./errors.js";
import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "./catalogs.js";

const MANIFEST_FILENAME = "ebr-mod.json";

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

// --- Field validators ---
// Each returns `true` when valid, or a human-readable error string.
// Used by both validateManifest() and CLI prompts.

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;

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
 * @param {string} val
 * @returns {true|string}
 */
export function validateRepoUrl(val) {
  if (typeof val !== "string") return "Must be a string.";
  if (val === "") return true;
  return val.toLowerCase().startsWith("https://github.com/")
    || `Must be a GitHub URL (https://github.com/...). Got "${val}".`;
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
  INVALID_VERSION_FORMAT: "INVALID_VERSION_FORMAT",
  FIELD_NOT_ARRAY: "FIELD_NOT_ARRAY",
  FIELD_NOT_BOOLEAN: "FIELD_NOT_BOOLEAN",
  FIELD_NOT_STRING: "FIELD_NOT_STRING",
  COLLECTION_MISSING_INCLUDED_MODS: "COLLECTION_MISSING_INCLUDED_MODS",
  INCLUDED_MOD_MISSING_FIELD: "INCLUDED_MOD_MISSING_FIELD",
  INVALID_LANGUAGE_TAG: "INVALID_LANGUAGE_TAG",
  UNKNOWN_PRODUCT: "UNKNOWN_PRODUCT",
  CAMPAIGN_MISSING_PRODUCT: "CAMPAIGN_MISSING_PRODUCT",
  INVALID_REPO_URL: "INVALID_REPO_URL",
});

/**
 * Read and parse ebr-mod.json from a directory.
 * @param {string} dir - Directory containing ebr-mod.json.
 * @returns {Promise<object>} Parsed manifest object.
 * @throws {ManifestError} If the file is missing or contains invalid JSON.
 */
export async function readManifest(dir) {
  const filePath = join(dir, MANIFEST_FILENAME);
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new ManifestNotFoundError(dir);
    }
    throw new ManifestError("file", `Could not read ${MANIFEST_FILENAME}: ${err.message}`);
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
 * @param {object} manifest - Manifest object to validate.
 * @returns {Array<{code: string, field?: string, value?: *, index?: number}>}
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== "object") {
    return [{ code: VALIDATION_CODES.NOT_AN_OBJECT }];
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      errors.push({ code: VALIDATION_CODES.MISSING_REQUIRED_FIELD, field });
    }
  }

  // Type validation
  if (manifest.type !== undefined && !MOD_TYPES.some(t => t.id === manifest.type)) {
    errors.push({ code: VALIDATION_CODES.INVALID_TYPE, value: manifest.type });
  }

  // ID format: kebab-case
  if (manifest.id !== undefined && validateId(manifest.id) !== true) {
    errors.push({ code: VALIDATION_CODES.INVALID_ID_FORMAT, field: "id", value: manifest.id });
  }

  // Version format: semver-like
  if (manifest.version !== undefined && validateVersion(manifest.version) !== true) {
    errors.push({ code: VALIDATION_CODES.INVALID_VERSION_FORMAT, field: "version", value: manifest.version });
  }

  // Array fields
  for (const field of ["campaigns", "requiredProducts", "tags", "optionalProducts"]) {
    if (manifest[field] !== undefined && !Array.isArray(manifest[field])) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_ARRAY, field });
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

  // collection type requires includedMods
  if (manifest.type === "collection") {
    if (!manifest.includedMods || !Array.isArray(manifest.includedMods) || manifest.includedMods.length === 0) {
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

  // language: non-empty string and valid BCP 47 tag
  if (manifest.language !== undefined) {
    if (typeof manifest.language !== "string" || manifest.language.length === 0) {
      errors.push({ code: VALIDATION_CODES.FIELD_NOT_STRING, field: "language" });
    } else if (validateLanguage(manifest.language) !== true) {
      errors.push({ code: VALIDATION_CODES.INVALID_LANGUAGE_TAG, field: "language", value: manifest.language });
    }
  }

  // repoUrl validation
  if (manifest.repoUrl !== undefined && typeof manifest.repoUrl === "string") {
    if (validateRepoUrl(manifest.repoUrl) !== true) {
      errors.push({ code: VALIDATION_CODES.INVALID_REPO_URL, field: "repoUrl", value: manifest.repoUrl });
    }
  }

  return errors;
}

/**
 * Format a single validation error as a human-readable string.
 * Used by the CLI for display. The GUI may use its own formatting/localization.
 *
 * @param {object} err - A validation error object from validateManifest().
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
    case VALIDATION_CODES.INVALID_VERSION_FORMAT:
      return `"${err.field}" must be a semver string (e.g. "1.0.0"). Got "${err.value}".`;
    case VALIDATION_CODES.FIELD_NOT_ARRAY:
      return `"${err.field}" must be an array.`;
    case VALIDATION_CODES.FIELD_NOT_BOOLEAN:
      return `"${err.field}" must be a boolean.`;
    case VALIDATION_CODES.FIELD_NOT_STRING:
      return `"${err.field}" must be a non-empty string.`;
    case VALIDATION_CODES.COLLECTION_MISSING_INCLUDED_MODS:
      return `Collection mods must have a non-empty "includedMods" array.`;
    case VALIDATION_CODES.INCLUDED_MOD_MISSING_FIELD:
      return `includedMods[${err.index}] is missing required field: "${err.field}".`;
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
    default:
      return `Unknown validation error: ${err.code}`;
  }
}

/**
 * Format all validation errors as human-readable strings.
 * @param {Array} errors - Array of validation error objects from validateManifest().
 * @returns {string[]} Array of human-readable error messages.
 */
export function formatValidationErrors(errors) {
  return errors.map(formatValidationError);
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
 * Build a manifest object from options.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} [options.id] - Defaults to kebab-case of name.
 * @param {string} options.author
 * @param {string} [options.authorDiscord]
 * @param {string} options.description
 * @param {string} options.type
 * @param {string[]} options.campaigns
 * @param {string[]} options.requiredProducts
 * @param {string[]} [options.optionalProducts]
 * @param {boolean} options.safeToAddMidCampaign
 * @param {string} [options.midCampaignNotes]
 * @param {string} options.language
 * @param {string} [options.icon]
 * @returns {object} Manifest object.
 */
export function buildManifest(options) {
  const id = options.id || toId(options.name);
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
  manifest.icon = options.icon || "🏔️";
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
 * @returns {Promise<{manifest: object, changes: Array<{field: string, oldValue: *, newValue: *}>}>}
 */
export async function updateManifest(
  { dir, version, repoUrl },
  { onProgress } = {},
) {
  onProgress?.({ step: "read", message: "Reading manifest..." });
  const manifest = await readManifest(dir);

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
