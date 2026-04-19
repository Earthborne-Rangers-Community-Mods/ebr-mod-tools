import { Command } from "commander";
import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { mkdir } from "node:fs/promises";
import { scaffoldMod, scaffoldModIntoClone } from "../core/workflows.js";
import { isRepo, getRemotes } from "../core/git.js";
import { buildManifest, toId } from "../core/manifest.js";
import { readManifest, writeManifest, validateNonEmpty, validateName, validateLanguage } from "../core/manifest.js";
import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "../core/catalogs.js";
import { getGithubToken, getForkUrls, getAuthorDefaults } from "../core/config.js";
import { getAuthenticatedUser } from "../core/github.js";
import { AuthenticationError, ManifestNotFoundError, GitError } from "../core/errors.js";

const MOD_TYPE_CHOICES = MOD_TYPES.map(t => ({
  name: `${t.name} - ${t.description.toLowerCase()}`,
  value: t.id,
}));

const EDITABLE_FIELDS = [
  { key: "name", label: "Mod name" },
  { key: "author", label: "Author" },
  { key: "authorDiscord", label: "Discord handle" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "campaigns", label: "Campaigns" },
  { key: "requiredProducts", label: "Required products" },
  { key: "safeToAddMidCampaign", label: "Safe mid-campaign" },
  { key: "language", label: "Language" },
  { key: "icon", label: "Icon" },
];

export const newCommand = new Command("new")
  .description("Scaffold a new mod as a branch in your fork of ebr-mod-base-content")
  .argument("[dir]", "Directory to scaffold into (default: current directory)")
  .option("--manifest-only", "Write the manifest file without git setup")
  .action(async (dir, opts) => {
    try {
      const targetDir = dir || process.cwd();

      let forkUrl = null;

      // Auth & fork URL check (skip for manifest-only - that's a local-only operation)
      if (!opts.manifestOnly) {
        const token = await getGithubToken();
        if (!token) {
          console.error("Not authenticated. Run `ebr setup` first.");
          process.exitCode = 1;
          return;
        }
        try {
          const user = await getAuthenticatedUser(token);
          console.log(`Authenticated as ${user.login}.`);
        } catch (err) {
          if (err instanceof AuthenticationError) {
            console.error("Stored token is invalid or expired. Run `ebr setup` to fix it.");
            process.exitCode = 1;
            return;
          }
          throw err;
        }

        const forks = await getForkUrls();
        if (!forks.baseContent) {
          console.error("No base content fork URL found. Run `ebr setup` to set up your forks.");
          process.exitCode = 1;
          return;
        }
        forkUrl = forks.baseContent;
      }

      // Detect existing repo
      let existingRepo = false;
      try {
        existingRepo = await isRepo(targetDir);
      } catch (err) {
        if (!(err instanceof GitError)) throw err;
        // Directory doesn't exist yet - not a repo
      }

      if (existingRepo && !opts.manifestOnly) {
        // Verify it's actually a clone of ebr-mod-base-content
        const remotes = await getRemotes(targetDir);
        const isBaseContent = remotes.some(r =>
          r.refs?.fetch?.includes("ebr-mod-base-content") ||
          r.refs?.push?.includes("ebr-mod-base-content"),
        );
        if (!isBaseContent) {
          console.error("This git repository does not appear to be a fork of ebr-mod-base-content.");
          console.error("Run `ebr new` from an empty directory or your existing fork clone.");
          process.exitCode = 1;
          return;
        }

        console.log("\n⚠ WARNING: This directory is already a git repository.");
        console.log("Creating a second mod branch in an existing repo is an advanced feature");
        console.log("intended for experienced git users who want multiple mods in one clone.");
        console.log("\nIf you're not comfortable with git branches and using git manually to");
        console.log("switch between them, cancel and run `ebr new` from an empty directory");
        console.log("instead.");
        const proceed = await confirm({ message: "I am a git expert. Continue?", default: false });
        if (!proceed) {
          console.log("Cancelled.");
          return;
        }
      }

      // Read existing manifest if present
      let existing = {};
      try {
        existing = await readManifest(targetDir);
        console.log("Found existing ebr-mod.json.\n");
      } catch (err) {
        if (!(err instanceof ManifestNotFoundError)) throw err;
      }

      // Pre-populate author defaults from config
      const authorDefaults = await getAuthorDefaults();
      const values = { ...existing };
      if (!values.author && authorDefaults.author) {
        values.author = authorDefaults.author;
      }
      if (!("authorDiscord" in values) && authorDefaults.authorDiscord) {
        values.authorDiscord = authorDefaults.authorDiscord;
      }
      await promptMissing(values);

      // Build manifest
      const manifest = buildManifest(values);

      // Confirm / edit loop
      const confirmed = await confirmLoop(manifest);
      if (!confirmed) {
        console.log("Cancelled.");
        return;
      }

      if (opts.manifestOnly) {
        await mkdir(targetDir, { recursive: true });
        await writeManifest(targetDir, manifest);
        console.log(`\nManifest written to ${targetDir}`);
      } else {
        const scaffold = existingRepo ? scaffoldModIntoClone : scaffoldMod;
        const result = await scaffold(
          { dir: targetDir, manifest, forkUrl },
          { onProgress: ({ message }) => console.log(message) },
        );

        console.log(`\nMod initialized in ${result.modDir}`);
        console.log(`  Name:   ${result.manifest.name}`);
        console.log(`  ID:     ${result.manifest.id}`);
        console.log(`  Type:   ${result.manifest.type}`);

        if (manifest.type === "collection") {
          console.log("\nTo add mods to this collection, use: ebr include <repo-url>");
        }
      }
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
  });

// --- Prompting helpers ---

function impliedProducts(campaigns) {
  const products = new Set();
  for (const id of campaigns) {
    const campaign = OFFICIAL_CAMPAIGNS.find(c => c.id === id);
    if (campaign) campaign.requiredProducts.forEach(p => products.add(p));
  }
  return products;
}

function productChoices(campaigns, selected = []) {
  const implied = impliedProducts(campaigns);
  return OFFICIAL_PRODUCTS.map(p => ({
    name: p.name,
    value: p.id,
    checked: implied.has(p.id) || selected.includes(p.id),
  }));
}

async function promptMissing(values) {
  if (!values.name) {
    values.name = await input({ message: "Mod name:", validate: validateName });
  }
  if (!values.author) {
    values.author = await input({ message: "Author display name:", validate: validateNonEmpty });
  }
  if (!("authorDiscord" in values)) {
    values.authorDiscord = await input({ message: "Discord handle (optional):", default: "" }) || undefined;
  }
  if (!values.description) {
    values.description = await input({ message: "Short description (1-2 sentences):", validate: validateNonEmpty });
  }
  if (!values.type) {
    values.type = await select({ message: "Mod type:", choices: MOD_TYPE_CHOICES });
  }

  if (values.type === "theme") {
    values.campaigns = values.campaigns || ["any"];
    values.requiredProducts = values.requiredProducts || [];
    if (values.safeToAddMidCampaign === undefined) values.safeToAddMidCampaign = true;
  } else {
    if (!values.campaigns || values.campaigns.length === 0) {
      const choices = OFFICIAL_CAMPAIGNS.map((c) => ({
        name: `${c.name}${c.oneDayMission ? " (one-day)" : ""}`,
        value: c.id,
      }));
      values.campaigns = await checkbox({ message: "Target campaigns:", choices });
    }
    if (!values.requiredProducts) {
      const choices = productChoices(values.campaigns);
      values.requiredProducts = await checkbox({ message: "Required products:", choices });
    }
    if (values.safeToAddMidCampaign === undefined) {
      values.safeToAddMidCampaign = await confirm({ message: "Safe to add mid-campaign?", default: false });
    }
  }

  if (!values.language) {
    values.language = await input({ message: "Language (BCP 47 code):", default: "en", validate: validateLanguage });
  }
}

// --- Summary display ---

function displaySummary(manifest) {
  console.log("\n  Mod Summary:");
  console.log(`    Name:               ${manifest.name}`);
  console.log(`    ID:                 ${manifest.id}`);
  console.log(`    Author:             ${manifest.author}`);
  console.log(`    Discord:            ${manifest.authorDiscord || "(none)"}`);
  console.log(`    Description:        ${manifest.description}`);
  console.log(`    Type:               ${manifest.type}`);
  console.log(`    Campaigns:          ${manifest.campaigns.join(", ")}`);
  console.log(`    Required products:  ${manifest.requiredProducts.join(", ") || "(none)"}`);
  console.log(`    Safe mid-campaign:  ${manifest.safeToAddMidCampaign ? "Yes" : "No"}`);
  console.log(`    Language:           ${manifest.language}`);
  console.log(`    Icon:               ${manifest.icon}`);
  console.log();
}

function formatFieldValue(manifest, key) {
  const val = manifest[key];
  if (val === undefined || val === null) return "(none)";
  if (Array.isArray(val)) return val.join(", ") || "(none)";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

// --- Confirm / edit loop ---

async function confirmLoop(manifest) {
  while (true) {
    displaySummary(manifest);

    const action = await select({
      message: "Does this look right?",
      choices: [
        { name: "Yes, continue", value: "confirm" },
        { name: "Edit a field", value: "edit" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "confirm") return true;
    if (action === "cancel") return false;

    // Build choices showing current values, hide theme-locked fields
    const fieldChoices = EDITABLE_FIELDS
      .filter((f) => {
        if (manifest.type === "theme" && ["campaigns", "requiredProducts", "safeToAddMidCampaign"].includes(f.key)) {
          return false;
        }
        return true;
      })
      .map((f) => ({
        name: `${f.label}: ${formatFieldValue(manifest, f.key)}`,
        value: f.key,
      }));

    const field = await select({ message: "Which field?", choices: fieldChoices });
    await editField(manifest, field);
  }
}

async function editField(manifest, key) {
  switch (key) {
    case "name":
      manifest.name = await input({ message: "Mod name:", default: manifest.name, validate: validateName });
      manifest.id = toId(manifest.name);
      break;
    case "author":
      manifest.author = await input({ message: "Author display name:", default: manifest.author, validate: validateNonEmpty });
      break;
    case "authorDiscord": {
      const val = await input({ message: "Discord handle:", default: manifest.authorDiscord || "" });
      if (val) {
        manifest.authorDiscord = val;
      } else {
        delete manifest.authorDiscord;
      }
      break;
    }
    case "description":
      manifest.description = await input({ message: "Description:", default: manifest.description, validate: validateNonEmpty });
      break;
    case "type": {
      const oldType = manifest.type;
      manifest.type = await select({ message: "Mod type:", choices: MOD_TYPE_CHOICES });
      if (manifest.type !== oldType) {
        if (manifest.type === "theme") {
          manifest.campaigns = ["any"];
          manifest.requiredProducts = [];
          manifest.safeToAddMidCampaign = true;
        } else if (oldType === "theme") {
          const campChoices = OFFICIAL_CAMPAIGNS.map((c) => ({
            name: `${c.name}${c.oneDayMission ? " (one-day mission)" : ""}`,
            value: c.id,
          }));
          manifest.campaigns = await checkbox({ message: "Target campaigns:", choices: campChoices });
          manifest.requiredProducts = await checkbox({ message: "Required products:", choices: productChoices(manifest.campaigns) });
          manifest.safeToAddMidCampaign = await confirm({ message: "Safe to add mid-campaign?", default: false });
        }
        if (manifest.type === "collection") {
          manifest.includedMods = manifest.includedMods || [];
        } else {
          delete manifest.includedMods;
        }
      }
      break;
    }
    case "campaigns": {
      const choices = OFFICIAL_CAMPAIGNS.map((c) => ({
        name: `${c.name}${c.oneDayMission ? " (one-day mission)" : ""}`,
        value: c.id,
        checked: manifest.campaigns.includes(c.id),
      }));
      manifest.campaigns = await checkbox({ message: "Target campaigns:", choices });
      break;
    }
    case "requiredProducts": {
      const choices = productChoices(manifest.campaigns, manifest.requiredProducts);
      manifest.requiredProducts = await checkbox({ message: "Required products:", choices });
      break;
    }
    case "safeToAddMidCampaign":
      manifest.safeToAddMidCampaign = await confirm({
        message: "Safe to add mid-campaign?",
        default: manifest.safeToAddMidCampaign,
      });
      break;
    case "language":
      manifest.language = await input({ message: "Language (BCP 47 code):", default: manifest.language, validate: validateLanguage });
      break;
    case "icon":
      manifest.icon = await input({ message: "Icon (emoji):", default: manifest.icon, validate: validateNonEmpty });
      break;
  }
}
