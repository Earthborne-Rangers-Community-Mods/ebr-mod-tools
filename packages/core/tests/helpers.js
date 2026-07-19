/**
 * Shared test helpers used across multiple test files.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

// --- Temp directory management ---
//
// Every test temp dir is created inside a single per-file "run root" so the
// whole tree can be removed in one shot after the file finishes (registered as
// an afterAll hook by tests/temp-cleanup.js).
//
// Vitest isolates modules per test file, so this state (and the run root) is
// scoped to a single test file.

let runRootPromise = null;

function getRunRoot() {
  if (!runRootPromise) {
    runRootPromise = mkdtemp(join(tmpdir(), "ebr-test-run-"));
  }
  return runRootPromise;
}

/**
 * Create a temporary directory for testing, nested inside the per-file run
 * root so it is cleaned up automatically after the test file finishes.
 * @param {string} [prefix="ebr-test-"] - Temp dir name prefix.
 * @returns {Promise<string>}
 */
export async function createTempDir(prefix = "ebr-test-") {
  const root = await getRunRoot();
  return mkdtemp(join(root, prefix));
}

/**
 * Remove the per-file run root and everything created under it. Registered as
 * an afterAll hook via tests/temp-cleanup.js. This is a best-effort backstop:
 * a leftover temp dir is a nuisance, not a test failure, so a removal failure
 * warns rather than throws.
 */
export async function cleanupTempRoot() {
  if (!runRootPromise) return;
  const root = await runRootPromise.catch(() => null);
  runRootPromise = null;
  if (!root) return;
  try {
    await rm(root, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[tests] could not remove temp root ${root}: ${err?.message ?? err}`);
  }
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
    schemaVersion: 1,
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

/**
 * Create a progress collector that validates every onProgress call has the
 * standard shape: { step: string, message: string, ...optional }.
 *
 * Use `collector.fn` as the onProgress callback, then call
 * `collector.steps()` to get the list of step names and
 * `collector.assertValid()` to verify all calls matched the contract.
 *
 * @returns {{ fn: function, calls: Array, steps: function, assertValid: function }}
 */
export function createProgressCollector() {
  const calls = [];
  return {
    fn(info) {
      calls.push(info);
    },
    calls,
    steps() {
      return calls.map((c) => c.step);
    },
    assertValid() {
      for (const call of calls) {
        if (typeof call.step !== "string" || !call.step) {
          throw new Error(`onProgress call missing 'step': ${JSON.stringify(call)}`);
        }
        if (typeof call.message !== "string" || !call.message) {
          throw new Error(`onProgress call missing 'message': ${JSON.stringify(call)}`);
        }
      }
    },
  };
}
