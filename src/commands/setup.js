import { Command } from "commander";
import { password, confirm, input } from "@inquirer/prompts";
import open from "open";
import { getGithubToken, setGithubToken, clearGithubToken, getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults } from "../core/config.js";
import { getAuthenticatedUser, getRepo, listPullRequests, syncFork, compareCommits } from "../core/github.js";
import { AuthenticationError, GithubError, InsufficientScopeError } from "../core/errors.js";

const BASE_CONTENT_OWNER = "Earthborne-Rangers-Community-Mods";
const BASE_CONTENT_REPO = "ebr-mod-base-content";
const REGISTRY_OWNER = "Earthborne-Rangers-Community-Mods";
const REGISTRY_REPO = "ebr-mod-registry";

const FORK_BASE_URL = `https://github.com/${BASE_CONTENT_OWNER}/${BASE_CONTENT_REPO}/fork`;
const FORK_REGISTRY_URL = `https://github.com/${REGISTRY_OWNER}/${REGISTRY_REPO}/fork`;
const PAT_URL = "https://github.com/settings/personal-access-tokens/new";

export const setupCommand = new Command("setup")
  .description("Set up GitHub forks and personal access token for publishing")
  .option("--status", "Check whether a token is stored and valid")
  .option("--clear", "Remove the stored token, fork URLs, and author defaults")
  .option("--token", "Replace just the stored token")
  .option("--author", "Update just the author defaults")
  .option("--skip-checks", "Skip fork-history and permission verification")
  .action(async (opts) => {
    try {
      if (opts.clear) {
        await clearGithubToken();
        await clearForkUrls();
        await clearAuthorDefaults();
        console.log("Token, fork URLs, and author defaults cleared.");
        return;
      }

      if (opts.status) {
        await status();
        return;
      }

      if (opts.token) {
        await replaceToken();
        return;
      }

      if (opts.author) {
        await updateAuthorDefaults();
        return;
      }

      await interactive(opts);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
  });

async function status() {
  const token = await getGithubToken();
  if (!token) {
    console.log("No token stored. Run `ebr setup` to set one up.");
    process.exitCode = 1;
    return;
  }
  try {
    const user = await getAuthenticatedUser(token);
    console.log(`Authenticated as ${user.login}.`);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.log("Stored token is invalid or expired.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const forks = await getForkUrls();
  if (forks.baseContent) console.log(`Base content fork: ${forks.baseContent}`);
  if (forks.registry) console.log(`Registry fork: ${forks.registry}`);
  if (!forks.baseContent || !forks.registry) {
    console.log("Fork URLs incomplete. Run `ebr setup` to set them up.");
  }

  const defaults = await getAuthorDefaults();
  if (defaults.author) console.log(`Default author: ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`Default Discord: ${defaults.authorDiscord}`);
}

async function interactive(opts = {}) {
  const skipChecks = !!opts.skipChecks;

  // Check existing state to decide which steps to run
  let token = await getGithubToken();
  let user = null;

  if (token) {
    try {
      user = await getAuthenticatedUser(token);
    } catch (err) {
      if (!(err instanceof AuthenticationError)) throw err;
    }
  }

  // --- Token + fork setup (always re-verify permissions) ---
  if (user) {
    const forks = await getForkUrls();
    if (forks.baseContent && forks.registry) {
      console.log(`Authenticated as ${user.login}. Verifying permissions...`);
      const forksOk = await verifyForks(token, user, skipChecks);
      if (forksOk) {
        console.log("Forks and permissions verified.\n");
      }
    } else {
      // Token works but forks aren't recorded - verify them
      console.log(`Authenticated as ${user.login}, but fork URLs are incomplete.`);
      await verifyForks(token, user, skipChecks);
    }
  } else {
    // No valid token - full setup
    if (token) {
      console.log("Stored token is invalid or expired.\n");
    }
    ({ token, user } = await setupTokenAndForks());
    if (!token) return; // user cancelled or error
  }

  // --- Author defaults (skip if already set) ---
  const existingDefaults = await getAuthorDefaults();
  if (!existingDefaults.author) {
    await promptAuthorDefaults(user);
  }

  // --- Summary ---
  const forks = await getForkUrls();
  const defaults = await getAuthorDefaults();
  console.log(`\nAuthenticated as ${user.login}. Setup complete.`);
  if (forks.baseContent) console.log(`  Base content fork: ${forks.baseContent}`);
  if (forks.registry) console.log(`  Registry fork:     ${forks.registry}`);
  if (defaults.author) console.log(`  Default author:    ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`  Default Discord:   ${defaults.authorDiscord}`);
}

/**
 * Replace the token.
 */
async function replaceToken() {
  const { token, user } = await promptForToken();
  if (!token) return;

  await setGithubToken(token);
  await verifyForks(token, user, false);

  console.log(`\nToken updated. Authenticated as ${user.login}.`);
}

/**
 * Update the author defaults.
 */
async function updateAuthorDefaults() {
  // Try to get the username for a sensible default
  let username;
  const token = await getGithubToken();
  if (token) {
    try {
      const user = await getAuthenticatedUser(token);
      username = user.login;
    } catch {
      // Ignore - just won't have a username fallback
    }
  }

  await promptAuthorDefaults(username ? { login: username } : null);

  const defaults = await getAuthorDefaults();
  console.log("\nAuthor defaults updated.");
  if (defaults.author) console.log(`  Author:  ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`  Discord: ${defaults.authorDiscord}`);
}

// --- Shared helpers ---

/**
 * Full first-time setup: guide through forks, collect token, verify forks.
 * @returns {Promise<{token: string|null, user: object|null}>}
 */
async function setupTokenAndForks() {
  // Step 0: Check for a GitHub account
  const hasAccount = await confirm({
    message: "Do you have a GitHub account?",
    default: true,
  });
  if (!hasAccount) {
    console.log("\nYou'll need a free GitHub account to publish mods.");
    console.log("We'll open the sign-up page for you. Create an account, then re-run `ebr setup`.\n");
    const openSignup = await confirm({ message: "Ready to open github.com/signup?" });
    if (openSignup) await open("https://github.com/signup");
    return { token: null, user: null };
  }

  // Step 1: Fork base-content
  console.log("\n--- Step 1: Fork ebr-mod-base-content ---");
  console.log("This is your mod workspace. All your mods live here as branches.");
  console.log(`\n  ${FORK_BASE_URL}\n`);
  console.log("We'll open that page. Click \"Create fork\" (keep the default name).");
  const openBase = await confirm({ message: "Ready to open the ebr-mod-base-content fork page?" });
  if (openBase) await open(FORK_BASE_URL);
  await confirm({ message: "Done forking ebr-mod-base-content?" });

  // Step 2: Fork registry
  console.log("\n--- Step 2: Fork ebr-mod-registry ---");
  console.log("This is where `ebr publish` pushes registry entries.");
  console.log(`\n  ${FORK_REGISTRY_URL}\n`);
  console.log("We'll open that page. Click \"Create fork\" (keep the default name).");
  const openRegistry = await confirm({ message: "Ready to open the ebr-mod-registry fork page?" });
  if (openRegistry) await open(FORK_REGISTRY_URL);
  await confirm({ message: "Done forking ebr-mod-registry?" });

  // Step 3: Create fine-grained PAT
  const { token, user } = await promptForToken();
  if (!token) return { token: null, user: null };

  // Verify forks
  const forksOk = await verifyForks(token, user, false);
  if (!forksOk) return { token: null, user: null };

  await setGithubToken(token);
  return { token, user };
}

/**
 * Prompt for a PAT and validate it.
 * @returns {Promise<{token: string|null, user: object|null}>}
 */
async function promptForToken() {
  console.log("\n--- Create a Personal Access Token ---");
  console.log(`\n  ${PAT_URL}\n`);
  console.log("We'll open GitHub's token creation page. Use these settings:");
  console.log("  - Token name: ebr-mod-tools (or anything you like)");
  console.log("  - Resource owner: Your personal account");
  console.log("  - Expiration: 90 days or longer");
  console.log("  - Repository access: \"Only select repositories\"");
  console.log("    Select your fork of ebr-mod-registry");
  console.log("  - Permissions:");
  console.log("    - Contents: Read and write");
  console.log("    - Pull requests: Read and write");
  console.log("    - Workflows: Read and write\n");
  const openToken = await confirm({ message: "Ready to open the token page?" });
  if (openToken) await open(PAT_URL);

  const token = await password({ message: "Paste your token:", mask: "*" });
  if (!token) {
    console.error("No token provided.");
    process.exitCode = 1;
    return { token: null, user: null };
  }

  let user;
  try {
    user = await getAuthenticatedUser(token);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.error("Token is invalid. Check that you copied it correctly.");
      process.exitCode = 1;
      return { token: null, user: null };
    }
    throw err;
  }

  return { token, user };
}

/**
 * Verify that the user's forks exist and are forks of the right parents.
 * Saves fork URLs on success.
 * @returns {Promise<boolean>} true if forks are valid
 */
async function verifyForks(token, user, skipChecks = false) {
  const baseContentUrl = `https://github.com/${user.login}/${BASE_CONTENT_REPO}`;
  const registryUrl = `https://github.com/${user.login}/${REGISTRY_REPO}`;

  let baseContentFork;
  try {
    baseContentFork = await getRepo(token, { owner: user.login, repo: BASE_CONTENT_REPO });
  } catch {
    console.error(`Could not find fork: ${baseContentUrl}`);
    console.error(`Make sure you forked ${BASE_CONTENT_OWNER}/${BASE_CONTENT_REPO} and kept the default name.`);
    process.exitCode = 1;
    return false;
  }

  if (!baseContentFork.isFork || baseContentFork.parentOwner !== BASE_CONTENT_OWNER) {
    console.error(`${baseContentUrl} exists but is not a fork of ${BASE_CONTENT_OWNER}/${BASE_CONTENT_REPO}.`);
    process.exitCode = 1;
    return false;
  }

  // Confirm the fork still shares history with upstream. If upstream rewrote
  // its main branch after the user forked, every later `ebr include` would
  // fail with "unrelated histories"; flag it now so they can reset the fork.
  if (skipChecks) {
    console.log("Skipping fork-history verification (--skip-checks).");
  } else {
    const { mergeBase: sharedBase } = await compareCommits(token, {
      owner: BASE_CONTENT_OWNER,
      repo: BASE_CONTENT_REPO,
      base: "main",
      head: `${user.login}:main`,
    });
    if (!sharedBase) {
      console.error(
        `\nYour base-content fork (${baseContentUrl}) does not share any commit history with upstream.`,
      );
      console.error("This usually means upstream rewrote its main branch after you forked.");
      console.error("Reset your fork's main branch to match upstream:");
      console.error("  1. On GitHub, go to your fork's main branch.");
      console.error("  2. Use \"Sync fork\" -> \"Discard commits\" (or run a force-reset locally).");
      console.error("  3. Re-run `ebr setup`.");
      console.error("\nTo skip this check, run `ebr setup --skip-checks`.");
      process.exitCode = 1;
      return false;
    }
  }

  let registryFork;
  try {
    registryFork = await getRepo(token, { owner: user.login, repo: REGISTRY_REPO });
  } catch {
    console.error(`Could not find fork: ${registryUrl}`);
    console.error(`Make sure you forked ${REGISTRY_OWNER}/${REGISTRY_REPO} and kept the default name.`);
    process.exitCode = 1;
    return false;
  }

  if (!registryFork.isFork || registryFork.parentOwner !== REGISTRY_OWNER) {
    console.error(`${registryUrl} exists but is not a fork of ${REGISTRY_OWNER}/${REGISTRY_REPO}.`);
    process.exitCode = 1;
    return false;
  }

  // Probe token permissions on the registry fork (the only one this tool
  // accesses via the PAT; base-content is accessed via git only).
  if (!skipChecks) {
    const permissionIssues = await checkTokenPermissions(token, user.login);
    if (permissionIssues.length > 0) {
      console.error("\nToken is missing required permissions:");
      for (const issue of permissionIssues) {
        console.error(`  - ${issue}`);
      }
      console.error("\nRecreate the token with Contents (read+write), Pull requests (read+write), and Workflows (read+write) for your ebr-mod-registry fork.");
      process.exitCode = 1;
      return false;
    }
  }

  await setForkUrls({ baseContent: baseContentUrl, registry: registryUrl });
  return true;
}

/**
 * Prompt for author name and Discord handle, save to config.
 * @param {object|null} user - GitHub user object (for login fallback), or null.
 */
async function promptAuthorDefaults(user) {
  console.log("--- Author defaults ---");
  console.log("These will be pre-filled when you create a new mod.\n");

  const existing = await getAuthorDefaults();
  const authorName = await input({
    message: "Author display name:",
    default: existing.author || user?.login || "",
  });
  const authorDiscord = await input({
    message: "Discord handle (optional):",
    default: existing.authorDiscord || "",
  });

  await setAuthorDefaults({
    author: authorName,
    authorDiscord: authorDiscord || null,
  });
}

/**
 * Check that the PAT has the permissions `ebr publish` needs on the
 * registry fork.
 *
 * The base-content fork is intentionally not probed here: this tool only
 * uses the PAT against the registry (via Octokit). All base-content
 * operations (`ebr new`, `ebr save`, `ebr update`) go through `git`, which
 * authenticates via the system credential helper, not this token.
 *
 * We use `syncFork` (POST merge-upstream) instead of relying on
 * `permissions.push` from GET /repos, because syncFork also surfaces a
 * missing Workflows permission via a distinct 422 response ("without
 * `workflow` scope") that metadata cannot detect. It's idempotent on an
 * already-synced fork, and exercises the same write path that `ebr publish`
 * uses.
 *
 * @param {string} token
 * @param {string} login
 * @returns {Promise<string[]>} Human-readable issue strings (empty = all good).
 */
async function checkTokenPermissions(token, login) {
  const issues = [];

  // Write probe: syncFork is idempotent (merge-upstream on an already-synced
  // fork is a no-op). A 403 means the PAT can't write to the fork.
  // A 422 mentioning "workflow scope" means the upstream has a GitHub Actions
  // workflow file and the PAT is missing the Workflows permission.
  try {
    await syncFork(token, { owner: login, repo: REGISTRY_REPO, branch: "main" });
  } catch (err) {
    if (err instanceof GithubError && err.httpStatus === 422 &&
        /without `workflow` scope/i.test(err.message)) {
      issues.push(
        `Workflows permission missing for ebr-mod-registry fork. ` +
        `The registry contains a GitHub Actions workflow file, so the token needs ` +
        `Workflows permission set to "Read and write".`,
      );
    } else if (err instanceof InsufficientScopeError ||
        (err instanceof GithubError && err.httpStatus === 403)) {
      issues.push(
        `Write access missing for ebr-mod-registry fork. ` +
        `Make sure the token's "Resource owner" is your personal account ` +
        `and its repository access includes ${login}/${REGISTRY_REPO} ` +
        `with Contents permission set to "Read and write".`,
      );
    } else if (err instanceof GithubError && err.httpStatus === 404) {
      issues.push(
        `Cannot access ${login}/${REGISTRY_REPO}. The token may not include this repository. ` +
        `Fine-grained tokens must use your personal account as "Resource owner" ` +
        `and explicitly select your fork in the repository list.`,
      );
    }
    // Other 409/422 = fork diverged, which is fine — publish handles it.
  }

  // Pull requests permission: try listing PRs on the registry fork.
  try {
    await listPullRequests(token, { owner: login, repo: REGISTRY_REPO, state: "closed" });
  } catch (err) {
    if (err instanceof GithubError && err.httpStatus === 403) {
      issues.push(`Pull requests permission missing for ebr-mod-registry fork`);
    }
  }

  return issues;
}
