/**
 * GitHub integration: a thin `@octokit/rest` wrapper for the two REST calls
 * that have no git equivalent (resolving the authenticated login and creating a
 * fork), plus local git credential helpers.
 *
 * Trust boundary - the local machine: this module never mints or stores a
 * GitHub user token. Content and registry operations use the user's existing
 * git credentials (Git Credential Manager or SSH). Fork creation borrows the
 * OAuth token Git Credential Manager already caches, holds it in memory for a
 * single request, and drops it. The store is read with `git credential fill`
 * (never `approve`); the only write is `clearCredential`, which calls
 * `git credential reject` to forget a stored credential - only ever on an
 * explicit user request (e.g. `ebr setup` offering to clear a wrong account),
 * never automatically.
 *
 * Every helper that shells out accepts an injectable `runImpl` so the
 * orchestration can be unit-tested without spawning `git`.
 */

import { spawn } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { GithubError, AuthenticationError } from "./errors.js";

/**
 * Normalize a git remote URL to a GitHub HTTPS URL.
 * Handles HTTPS (with or without .git) and SSH formats.
 * Returns null if the URL is not a GitHub URL.
 * @param {string|null} url
 * @returns {string|null}
 */
export function normalizeGithubUrl(url) {
  if (!url) return null;

  // SSH: git@github.com:user/repo.git
  const sshMatch = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;

  // HTTPS: https://github.com/user/repo.git
  const httpsMatch = url.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;

  return null;
}

const noopLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Create an authenticated Octokit instance.
 * @param {string} token - GitHub token borrowed in memory for a single request.
 */
function octokit(token) {
  return new Octokit({ auth: token, log: noopLog });
}

/**
 * Wrap an Octokit error into a typed GithubError (or subclass).
 * Checks HTTP status for known failure modes.
 */
function wrapError(operation, err) {
  if (err instanceof GithubError) return err;
  if (err.status === 401) {
    return new AuthenticationError();
  }
  return new GithubError(operation, err.message || String(err), err.status);
}

/**
 * Verify a token and return the authenticated user's info.
 * @param {string} token
 * @returns {Promise<{login: string, name: string|null}>}
 */
export async function getAuthenticatedUser(token) {
  try {
    const { data } = await octokit(token).rest.users.getAuthenticated();
    return { login: data.login, name: data.name };
  } catch (err) {
    throw wrapError("getAuthenticatedUser", err);
  }
}

/**
 * Fork a repository. Idempotent - returns the existing fork if one exists.
 * @param {string} token - Token borrowed in memory for this single request.
 * @param {object} options
 * @param {string} options.owner - Upstream repo owner.
 * @param {string} options.repo - Upstream repo name.
 * @returns {Promise<{owner: string, repo: string, cloneUrl: string}>}
 */
export async function forkRepo(token, { owner, repo }) {
  try {
    const { data } = await octokit(token).rest.repos.createFork({ owner, repo });
    return {
      owner: data.owner.login,
      repo: data.name,
      cloneUrl: data.clone_url,
    };
  } catch (err) {
    throw wrapError("forkRepo", err);
  }
}

// --- Local git credential helpers ---

/**
 * Run a command, optionally feeding stdin, capturing stdout/stderr.
 * Resolves with `{ code, stdout, stderr }`; never rejects on a non-zero exit.
 * Rejects only if the process cannot be spawned at all.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.input] - Text written to stdin then closed.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Parse the `key=value` lines emitted by `git credential fill`.
 * @param {string} stdout
 * @returns {Record<string, string>}
 */
export function parseCredentialFill(stdout) {
  const result = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    result[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return result;
}

/**
 * Borrow the OAuth token Git Credential Manager has cached for a host.
 *
 * Reads the credential store only (`git credential fill`). The returned token
 * is the same one git already uses on every push; callers must hold it in
 * memory for a single request and drop it - never write it to disk, log it, or
 * pass it as a subprocess argument.
 *
 * By default this is interactive: `git credential fill` lets the credential
 * helper prompt (e.g. a GCM sign-in window) when nothing is cached yet. Pass
 * `interactive: false` for a passive probe that returns only an already-cached
 * credential and never prompts - `git -c credential.interactive=false` tells the
 * helper not to open a sign-in dialog. Use passive mode for status/probe paths
 * where an unexpected sign-in window would be wrong.
 *
 * Returns `null` when no usable HTTPS password credential is available (SSH
 * users, a store that returns nothing, or - in passive mode - nothing cached).
 *
 * @param {object} [options]
 * @param {string} [options.host]
 * @param {boolean} [options.interactive] - When false, never prompt; return a cached credential or null.
 * @param {(command: string, args: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} [options.runImpl]
 * @returns {Promise<string|null>}
 */
export async function borrowCredentialToken({ host = "github.com", interactive = true, runImpl = runCommand } = {}) {
  const args = interactive
    ? ["credential", "fill"]
    : ["-c", "credential.interactive=false", "credential", "fill"];
  let res;
  try {
    res = await runImpl("git", args, {
      input: `protocol=https\nhost=${host}\n\n`,
    });
  } catch {
    return null;
  }
  if (res.code !== 0) return null;
  const fields = parseCredentialFill(res.stdout);
  return fields.password || null;
}

/**
 * Erase the cached GitHub credential for a host (`git credential reject`).
 *
 * This is the module's one write to the credential store: it tells the helper
 * to forget the stored credential so the next operation re-authenticates. It
 * retrieves nothing (unlike `borrowCredentialToken`), and callers must only
 * invoke it on an explicit user request.
 *
 * @param {object} [options]
 * @param {string} [options.host]
 * @param {(command: string, args: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} [options.runImpl]
 * @returns {Promise<boolean>} true if `git credential reject` exited cleanly.
 */
export async function clearCredential({ host = "github.com", runImpl = runCommand } = {}) {
  try {
    const res = await runImpl("git", ["credential", "reject"], {
      input: `protocol=https\nhost=${host}\n\n`,
    });
    return res.code === 0;
  } catch {
    return false;
  }
}

