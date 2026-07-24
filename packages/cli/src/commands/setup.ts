import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import open from "open";
import { getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults } from "core/config.js";
import { resolveCredentialLogin, ensureFork, forkUrlFor, forkOwnerFromUrl } from "core/workflows.js";
import { remoteExists } from "core/git.js";
import { clearCredential } from "core/github.js";
import type { ProgressEvent } from "core/types.js";

const ORG = "Earthborne-Rangers-Community-Mods";
const BASE_CONTENT_REPO = "ebr-mod-base-content";
const REGISTRY_REPO = "ebr-mod-registry";

const FORK_BASE_URL = `https://github.com/${ORG}/${BASE_CONTENT_REPO}/fork`;
const FORK_REGISTRY_URL = `https://github.com/${ORG}/${REGISTRY_REPO}/fork`;

export const setupCommand = new Command("setup")
  .description("Create your forks of the mod project on GitHub so you can publish mods")
  .option("--status", "Check your forks of the mod project and your GitHub sign-in")
  .option("--clear", "Clear all stored data")
  .option("--author", "Update just the author defaults")
  .action(async (opts) => {
    try {
      if (opts.clear) {
        await clearForkUrls();
        await clearAuthorDefaults();
        console.log("Stored data cleared.");
        return;
      }

      if (opts.status) {
        await status();
        return;
      }

      if (opts.author) {
        await updateAuthorDefaults();
        return;
      }

      await interactive();
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

/**
 * `--status`: passive auth probe (is a GitHub credential already cached?) plus a
 * fork-existence check. Never prompts - the credential read runs in passive mode
 * so a status check can't trigger a sign-in dialog.
 */
async function status() {
  const login = await resolveCredentialLogin({ interactive: false });

  if (login) {
    console.log(`GitHub login detected: ${login}.`);
  } else {
    console.log("No saved GitHub credential found.");
  }

  const forks = await getForkUrls();
  await reportForkStatus("Your fork of the mod project", forks.baseContent);
  await reportForkStatus("Your fork of the mod registry", forks.registry);
  if (!forks.baseContent || !forks.registry) {
    console.log("Your forks aren't set up yet. Run `ebr setup` to create them.");
    process.exitCode = 1;
  }

  const defaults = await getAuthorDefaults();
  if (defaults.author) console.log(`Default author: ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`Default Discord: ${defaults.authorDiscord}`);
}

/**
 * Print whether a stored fork URL resolves to an existing, reachable repo.
 */
async function reportForkStatus(label: string, url: string | null) {
  if (!url) {
    console.log(`${label}: not configured.`);
    return;
  }
  const exists = await remoteExists(url);
  console.log(`${label}: ${url} ${exists ? "(found)" : "(NOT found)"}`);
}

/**
 * Interactive first-time setup. Asks permission before touching the GitHub
 * sign-in, reads the account git is signed in as (prompting a sign-in if
 * needed), explains and confirms the two forks, creates them, stores their
 * URLs, and collects author defaults.
 */
async function interactive() {
  console.log("Checking your setup...\n");

  // If both forks already exist and are reachable, show the current setup and
  // offer to stop rather than re-running everything. The username is read from
  // the stored fork URL, so this needs no credential probe (and no sign-in
  // dialog). Unreachable forks (deleted, renamed) fall through to a real setup.
  const existingForks = await getForkUrls();
  if (existingForks.baseContent && existingForks.registry) {
    const [baseReachable, registryReachable] = await Promise.all([
      remoteExists(existingForks.baseContent),
      remoteExists(existingForks.registry),
    ]);
    if (baseReachable && registryReachable) {
      const username = forkOwnerFromUrl(existingForks.baseContent) ?? forkOwnerFromUrl(existingForks.registry);
      console.log("You're already set up:");
      if (username) console.log(`  GitHub account:    ${username}`);
      console.log(`  Mod project fork:  ${existingForks.baseContent}`);
      console.log(`  Mod registry fork: ${existingForks.registry}`);
      if (!(await confirm({ message: "Run setup again anyway?", default: false }))) {
        console.log("Leaving your setup as-is.");
        return;
      }
      console.log("");
    } else {
      // Both forks are configured but at least one no longer resolves - the
      // saved setup is stale. Say so, then fall through to a real setup.
      console.log(
        "Found saved forks, but at least one is no longer reachable on GitHub\n" +
        "(it may have been deleted or renamed).\n",
      );
    }
  }

  // 1. Ask permission before we touch the GitHub sign-in.
  console.log(
    "Setup checks which GitHub account your git is signed in to, or helps you\n" +
    "sign in if it isn't set up yet. The tools reuse the sign-in git already\n" +
    "uses; there's no separate password to create, and these tools never\n" +
    "keep a copy themselves.\n",
  );
  if (!(await confirm({ message: "Check your GitHub sign-in now?", default: true }))) {
    console.log("Run `ebr setup` again when you're ready.");
    process.exitCode = 1;
    return;
  }

  // 2. A sign-in window may open; read the account git is signed in as.
  console.log("\nA GitHub sign-in window may open - complete it to continue.");
  const detectedLogin = await resolveCredentialLogin({ interactive: true });

  const login = await resolveAccount(detectedLogin);
  if (!login) return;

  // 3. Explain forks and ask before creating them.
  console.log(
    "\nTo build and publish mods you need your own copy of two projects on\n" +
    "GitHub. A \"fork\" is your personal copy of a project. Two forks will be\n" +
    `created under your account, "${login}":\n` +
    "  - the mod base project, where you build your mods, and\n" +
    "  - the mod registry, where you publish them.\n",
  );
  if (!(await confirm({ message: "Create these two forks now?", default: true }))) {
    console.log("Run `ebr setup` again when you're ready.");
    process.exitCode = 1;
    return;
  }

  // 4. Create the forks.
  const baseOk = await ensureForkForRepo(login, BASE_CONTENT_REPO, FORK_BASE_URL, "where you build your mods");
  if (!baseOk) return;
  const registryOk = await ensureForkForRepo(login, REGISTRY_REPO, FORK_REGISTRY_URL, "where you publish mods");
  if (!registryOk) return;

  await setForkUrls({
    baseContent: forkUrlFor(login, BASE_CONTENT_REPO),
    registry: forkUrlFor(login, REGISTRY_REPO),
  });

  // 5. Author defaults - offer to update them if they're already set.
  const existingDefaults = await getAuthorDefaults();
  if (existingDefaults.author) {
    console.log("\nAuthor details are already set:");
    console.log(`  Author:  ${existingDefaults.author}`);
    if (existingDefaults.authorDiscord) console.log(`  Discord: ${existingDefaults.authorDiscord}`);
    if (await confirm({ message: "Update your author details?", default: false })) {
      await promptAuthorDefaults(login);
    }
  } else {
    await promptAuthorDefaults(login);
  }

  const forks = await getForkUrls();
  const defaults = await getAuthorDefaults();
  console.log("\nSetup complete.");
  if (forks.baseContent) console.log(`  Mod project fork: ${forks.baseContent}`);
  if (forks.registry) console.log(`  Mod registry fork:    ${forks.registry}`);
  if (defaults.author) console.log(`  Default author:    ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`  Default Discord:   ${defaults.authorDiscord}`);
}

/**
 * Resolve and confirm the GitHub account the forks will be created under.
 *
 * The login comes from the git credential - the account `git push` (and so
 * `ebr publish`) acts as, so the forks must live under it. The tools push over
 * HTTPS, so an HTTPS credential is required: with none available, setup stops.
 * With one, the account is confirmed with the user; declining offers to clear
 * the saved credential so a re-run can sign in as a different account.
 *
 * @returns the confirmed login, or null to abort setup.
 */
async function resolveAccount(detectedLogin: string | null): Promise<string | null> {
  if (!detectedLogin) {
    console.error(
      "Could not detect a GitHub sign-in, so setup can't continue. The tools push\n" +
      "to GitHub over HTTPS, so an HTTPS sign-in is required. If a sign-in window\n" +
      "opened and you closed it, re-run `ebr setup` and complete it. If git has no\n" +
      "HTTPS credential set up yet, configure one (Git Credential Manager will\n" +
      "prompt you), then re-run `ebr setup`.",
    );
    process.exitCode = 1;
    return null;
  }

  console.log(`Signed in to GitHub as "${detectedLogin}".`);
  if (await confirm({ message: `Use the GitHub account "${detectedLogin}"?`, default: true })) {
    return detectedLogin;
  }

  // Not the account they want - offer to clear the saved credential so a re-run
  // can sign in as a different account.
  await offerToClearCredential(detectedLogin);
  return null;
}

/**
 * On declining the detected account, explain that switching accounts means
 * clearing the saved GitHub credential, and - only with explicit permission -
 * offer to run `git credential reject` (a fiddly command to type by hand). On
 * decline or failure, print the manual steps and leave the credential untouched.
 */
async function offerToClearCredential(login: string) {
  console.log(
    `These tools use your saved git credentials, so setup can only\n` +
    `create forks under "${login}". To use a different account, the saved GitHub\n` +
    `credential has to be cleared so the next sign-in can pick another account.`,
  );
  const manualSteps =
    "Clear it yourself by running `git credential reject`, then typing\n" +
    "`protocol=https` and `host=github.com` on separate lines followed by a\n" +
    "blank line. Then re-run `ebr setup`.";

  if (!(await confirm({ message: "Clear your saved GitHub credential now? (You'll sign in again next time you run `ebr setup`.)", default: false }))) {
    console.log(`Left as-is. ${manualSteps}`);
    return;
  }

  if (await clearCredential()) {
    console.log("Cleared. Run `ebr setup` again and sign in with the account you want.");
  } else {
    console.log(`Could not clear it automatically. ${manualSteps}`);
  }
}

/**
 * Ensure a single fork exists, falling back to a guided browser flow when it
 * cannot be created automatically.
 * @returns true when the fork exists at the end.
 */
async function ensureForkForRepo(login: string, repo: string, browserForkUrl: string, purpose: string): Promise<boolean> {
  console.log(`\n--- Your fork of ${repo} (${purpose}) ---`);
  const result = await ensureFork(
    { owner: ORG, repo, login },
    { onProgress: (p: ProgressEvent) => console.log(p.message) },
  );

  if (result.status === "exists") {
    console.log(`Found your fork: ${result.forkUrl}`);
    return true;
  }
  if (result.status === "created") {
    console.log(`Created your fork: ${result.forkUrl}`);
    return true;
  }

  // Manual browser fallback.
  console.log("Could not create your fork automatically.");
  console.log(`\n  ${browserForkUrl}\n`);
  console.log("This will create your own fork of the project. On the page that opens, click the green \"Create fork\" button (keep the default name).");
  const openPage = await confirm({ message: "Ready to open the page to create your fork?" });
  if (openPage) {
    await open(browserForkUrl);
    await new Promise((r) => setTimeout(r, 1500));
  }
  await confirm({ message: "Done creating your fork?" });

  const exists = await remoteExists(result.forkUrl);
  if (!exists) {
    console.error(`Still could not find ${result.forkUrl}. Re-run \`ebr setup\` once the fork exists.`);
    process.exitCode = 1;
    return false;
  }
  console.log(`Found your fork: ${result.forkUrl}`);
  return true;
}

/**
 * Update the author defaults.
 */
async function updateAuthorDefaults() {
  const login = await resolveCredentialLogin({ interactive: false });
  await promptAuthorDefaults(login);

  const defaults = await getAuthorDefaults();
  console.log("\nAuthor defaults updated.");
  if (defaults.author) console.log(`  Author:  ${defaults.author}`);
  if (defaults.authorDiscord) console.log(`  Discord: ${defaults.authorDiscord}`);
}

/**
 * Prompt for author name and Discord handle, save to config.
 * @param login - GitHub login (for the display-name default).
 */
async function promptAuthorDefaults(login: string | null) {
  console.log("\n--- Author defaults ---");
  console.log("These will be pre-filled when you create a new mod.\n");

  const existing = await getAuthorDefaults();
  const authorName = await input({
    message: "Author display name:",
    default: existing.author || login || "",
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
