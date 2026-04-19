/**
 * Shared test helpers used across multiple test files.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

/**
 * Create a temporary directory for testing.
 * @param {string} [prefix="ebr-test-"] - Temp dir name prefix.
 * @returns {Promise<string>}
 */
export async function createTempDir(prefix = "ebr-test-") {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * A minimal valid manifest with all required fields.
 * @param {object} [overrides] - Fields to override or add.
 * @returns {object}
 */
export function validManifest(overrides = {}) {
  return {
    name: "Test Mod",
    id: "test-mod",
    version: "1.0.0",
    type: "enhancement",
    description: "A test mod.",
    author: "TestAuthor",
    campaigns: ["lure-of-the-valley"],
    requiredProducts: ["core-set"],
    baseVersion: "1.0.0",
    safeToAddMidCampaign: true,
    language: "en",
    repoUrl: "https://github.com/test/ebr-test-mod",
    ...overrides,
  };
}

/**
 * Write an ebr-mod.json to a directory.
 * @param {string} dir
 * @param {object} manifest
 */
export async function writeManifestFile(dir, manifest) {
  await writeFile(
    join(dir, "ebr-mod.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

/**
 * Initialize a git repo with user config so commits work.
 * Uses simpleGit directly (not the module under test).
 * @param {string} dir
 */
export async function initTestRepo(dir) {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
}

/**
 * Create a file, stage, and commit.
 * Uses simpleGit directly (not the module under test).
 * @param {string} dir
 * @param {string} filename
 * @param {string} content
 * @param {string} message
 */
export async function commitFile(dir, filename, content, message) {
  await writeFile(join(dir, filename), content);
  const git = simpleGit(dir);
  await git.add("-A");
  await git.commit(message);
}
