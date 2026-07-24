/**
 * User configuration storage (~/.ebr/).
 * Shared by CLI and Creator GUI.
 *
 * All functions accept an optional `{ configDir }` parameter
 * that overrides the default directory (for testing).
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ConfigError } from "./errors.js";

/** Default config directory: ~/.ebr/ */
export const CONFIG_DIR = join(homedir(), ".ebr");

const CONFIG_FILE = "config.json";

/**
 * Read the full config object.
 * Returns `{}` if the config dir or file does not exist.
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<Record<string, any>>}
 * @throws {ConfigError} If the config file contains invalid JSON.
 */
export async function getConfig({ configDir = CONFIG_DIR } = {}) {
  const filePath = join(configDir, CONFIG_FILE);
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return {};
    throw new ConfigError("read", `Failed to read config: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigError(
      "read",
      `Config file contains invalid JSON: ${filePath}`,
    );
  }
}

/**
 * Set a config key. Creates the config dir and file if they do not exist.
 * Pass `undefined` or `null` as the value to remove the key.
 * @param {string} key
 * @param {*} value
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<void>}
 * @throws {ConfigError} If key is not a non-empty string.
 */
export async function setConfig(key, value, { configDir = CONFIG_DIR } = {}) {
  if (typeof key !== "string" || key === "") {
    throw new ConfigError("setConfig", "Key must be a non-empty string.");
  }
  const config = await getConfig({ configDir });
  if (value === undefined || value === null) {
    delete config[key];
  } else {
    config[key] = value;
  }
  await writeConfigFile(configDir, config);
}

/**
 * Get the stored fork URLs (base-content and registry).
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<{ baseContent: string|null, registry: string|null }>}
 */
export async function getForkUrls({ configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  return {
    baseContent: config.forkBaseContentUrl ?? null,
    registry: config.forkRegistryUrl ?? null,
  };
}

/**
 * Store the fork URLs for base-content and registry.
 * Pass null to delete a URL. Omit or pass undefined to skip.
 * @param {{ baseContent?: string|null, registry?: string|null }} urls
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<void>}
 */
export async function setForkUrls({ baseContent, registry }, { configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  if (baseContent !== undefined) {
    if (baseContent === null) {
      delete config.forkBaseContentUrl;
    } else {
      config.forkBaseContentUrl = baseContent;
    }
  }
  if (registry !== undefined) {
    if (registry === null) {
      delete config.forkRegistryUrl;
    } else {
      config.forkRegistryUrl = registry;
    }
  }
  await writeConfigFile(configDir, config);
}

/**
 * Remove the stored fork URLs.
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<void>}
 */
export async function clearForkUrls({ configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  delete config.forkBaseContentUrl;
  delete config.forkRegistryUrl;
  await writeConfigFile(configDir, config);
}

// --- Author defaults ---

/**
 * Get the stored author defaults (name and discord handle).
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<{ author: string|null, authorDiscord: string|null }>}
 */
export async function getAuthorDefaults({ configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  return {
    author: config.authorName ?? null,
    authorDiscord: config.authorDiscord ?? null,
  };
}

/**
 * Store the author defaults.
 * Pass null to delete a value. Omit or pass undefined to skip.
 * @param {{ author?: string|null, authorDiscord?: string|null }} defaults
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<void>}
 */
export async function setAuthorDefaults({ author, authorDiscord }, { configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  if (author !== undefined) {
    if (author === null) {
      delete config.authorName;
    } else {
      config.authorName = author;
    }
  }
  if (authorDiscord !== undefined) {
    if (authorDiscord === null) {
      delete config.authorDiscord;
    } else {
      config.authorDiscord = authorDiscord;
    }
  }
  await writeConfigFile(configDir, config);
}

/**
 * Remove the stored author defaults.
 * @param {{ configDir?: string }} [options]
 * @returns {Promise<void>}
 */
export async function clearAuthorDefaults({ configDir = CONFIG_DIR } = {}) {
  const config = await getConfig({ configDir });
  delete config.authorName;
  delete config.authorDiscord;
  await writeConfigFile(configDir, config);
}

// --- Internal helpers ---

/**
 * Write the config object to disk, creating the directory if needed.
 * @param {string} configDir
 * @param {object} config
 */
async function writeConfigFile(configDir, config) {
  await mkdir(configDir, { recursive: true });
  const filePath = join(configDir, CONFIG_FILE);
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
