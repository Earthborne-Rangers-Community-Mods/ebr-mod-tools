import { Command } from "commander";
import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { mkdir, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { scaffoldMod, scaffoldModIntoClone, includeCampaign } from "../core/workflows.js";
import { isRepo, getRemotes } from "../core/git.js";
import { buildManifest, toId, deriveOptionalProducts } from "../core/manifest.js";
import { readManifest, writeManifest, validateNonEmpty, validateName, validateIcon, validateLanguage } from "../core/manifest.js";
import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "../core/catalogs.js";
import { getGithubToken, getForkUrls, getAuthorDefaults } from "../core/config.js";
import { getAuthenticatedUser } from "../core/github.js";
import { AuthenticationError, ManifestNotFoundError, GitError, ValidationError } from "../core/errors.js";

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
  .option("--manifest-only", "Write the manifest file without git setup")
  .action(async (opts) => {
    try {
      const cwd = process.cwd();

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
        existingRepo = await isRepo(cwd);
      } catch (err) {
        if (!(err instanceof GitError)) throw err;
        // Directory doesn't exist yet - not a repo
      }

      if (existingRepo && !opts.manifestOnly) {
        // Verify it's actually a clone of ebr-mod-base-content
        const remotes = await getRemotes(cwd);
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
        existing = await readManifest(cwd);
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
      syncOptionalProducts(values);

      // Build manifest
      const manifest = buildManifest(values);

      // Resolve target directory
      let targetDir;
      if (existingRepo) {
        // Existing repo - use current directory for branch creation
        targetDir = cwd;
      } else if (basename(cwd) === manifest.id) {
        // Current folder already matches the mod ID - use it if empty
        const entries = await readdir(cwd);
        if (entries.length === 0) {
          targetDir = cwd;
        } else {
          throw new ValidationError(
            `Current directory matches mod ID "${manifest.id}" but is not empty.`,
          );
        }
      } else {
        // Create a subfolder named after the mod ID
        targetDir = resolve(cwd, manifest.id);
        try {
          const entries = await readdir(targetDir);
          if (entries.length > 0) {
            throw new ValidationError(
              `Directory "${targetDir}" already exists and is not empty.`,
            );
          }
        } catch (err) {
          if (err instanceof ValidationError) throw err;
          // Directory doesn't exist yet - that's fine, scaffoldMod will create it
        }
      }

      // Confirm / edit loop
      const context = { manifest, targetDir, existingRepo };
      const confirmed = await confirmLoop(context);
      if (!confirmed) {
        console.log("Cancelled.");
        return;
      }
      targetDir = context.targetDir;

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

        // Offer to include any selected official campaigns. Theme mods (which
        // target "any") and any unrecognized ids are skipped here; the user
        // can always run `ebr include` later.
        const knownIds = new Set(OFFICIAL_CAMPAIGNS.map((c) => c.id));
        const includable = (manifest.campaigns || []).filter((id) => knownIds.has(id));
        if (includable.length > 0) {
          await offerIncludeCampaigns(result.modDir, includable);
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

/**
 * Wrapper around `deriveOptionalProducts` that mutates the in-progress mod
 * values used by `ebr new`. Deletes the key entirely when the result is
 * empty so we don't write `"optionalProducts": []` to disk.
 *
 * @param {object} values - Mutable values object being assembled in `ebr new`.
 */
function syncOptionalProducts(values) {
  const derived = deriveOptionalProducts({
    type: values.type,
    campaigns: values.campaigns,
    requiredProducts: values.requiredProducts,
    optionalProducts: values.optionalProducts,
  });
  if (derived.length === 0) {
    delete values.optionalProducts;
  } else {
    values.optionalProducts = derived;
  }
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

function displaySummary(context) {
  const { manifest, targetDir } = context;
  console.log("\n  Mod Summary:");
  console.log(`    Name:               ${manifest.name}`);
  console.log(`    ID:                 ${manifest.id}`);
  console.log(`    Author:             ${manifest.author}`);
  console.log(`    Discord:            ${manifest.authorDiscord || "(none)"}`);
  console.log(`    Description:        ${manifest.description}`);
  console.log(`    Type:               ${manifest.type}`);
  console.log(`    Campaigns:          ${manifest.campaigns.join(", ")}`);
  console.log(`    Required products:  ${manifest.requiredProducts.join(", ") || "(none)"}`);
  if (manifest.optionalProducts && manifest.optionalProducts.length > 0) {
    console.log(`    Optional products:  ${manifest.optionalProducts.join(", ")}`);
  }
  console.log(`    Safe mid-campaign:  ${manifest.safeToAddMidCampaign ? "Yes" : "No"}`);
  console.log(`    Language:           ${manifest.language}`);
  console.log(`    Icon:               ${manifest.icon}`);
  console.log(`    Directory:          ${targetDir}`);
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

async function confirmLoop(context) {
  const { manifest, existingRepo } = context;
  while (true) {
    displaySummary(context);

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

    // Add directory field (not editable for existing repos - branch goes into the clone)
    if (!existingRepo) {
      fieldChoices.push({
        name: `Directory: ${context.targetDir}`,
        value: "targetDir",
      });
    }

    const field = await select({ message: "Which field?", choices: fieldChoices });
    if (field === "targetDir") {
      context.targetDir = await input({
        message: "Target directory:",
        default: context.targetDir,
        validate: validateNonEmpty,
      });
      context.targetDir = resolve(context.targetDir);
    } else {
      await editField(manifest, field);
    }
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
          delete manifest.optionalProducts;
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
        syncOptionalProducts(manifest);
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
      syncOptionalProducts(manifest);
      break;
    }
    case "requiredProducts": {
      const choices = productChoices(manifest.campaigns, manifest.requiredProducts);
      manifest.requiredProducts = await checkbox({ message: "Required products:", choices });
      syncOptionalProducts(manifest);
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
      manifest.icon = await input({ message: "Icon (emoji):", default: manifest.icon, validate: validateIcon });
      break;
  }
}

/**
 * Offer to run `ebr include` for each campaign the user selected during
 * `ebr new`. The user gets a checkbox preselected with everything; they can
 * deselect any they'd rather include manually later.
 *
 * Failures are reported but don't abort the overall workflow - the mod is
 * already scaffolded, and the user can always re-run `ebr include` for any
 * campaign that didn't make it through.
 *
 * @param {string} dir - Mod directory.
 * @param {string[]} campaignIds - Official campaign ids to offer.
 */
async function offerIncludeCampaigns(dir, campaignIds) {
  const labelFor = (id) => {
    const c = OFFICIAL_CAMPAIGNS.find((c) => c.id === id);
    if (!c) return id;
    return c.oneDayMission ? `${c.name} (one-day mission)` : c.name;
  };

  console.log(`\nThis mod targets ${campaignIds.length} official campaign(s).`);
  const proceed = await confirm({
    message: "Include them now? (You can also do this later with `ebr include`.)",
    default: true,
  });
  if (!proceed) return;

  const selected = await checkbox({
    message: "Select campaigns to include (space to toggle, enter to confirm):",
    choices: campaignIds.map((id) => ({
      name: labelFor(id),
      value: id,
      checked: true,
    })),
  });
  if (selected.length === 0) {
    console.log("No campaigns selected.");
    return;
  }

  const onProgress = ({ message }) => console.log(message);
  for (let i = 0; i < selected.length; i++) {
    const id = selected[i];
    if (selected.length > 1) {
      console.log(`\n=== Including ${id} (${i + 1}/${selected.length}) ===`);
    }
    try {
      const result = await includeCampaign({ dir, source: id }, { onProgress });
      if (result.alreadyUpToDate) {
        console.log(`\n${result.branch} is already up to date at ${result.commitHash.slice(0, 7)}.`);
      } else {
        console.log(`\nMerged ${result.branch} at ${result.commitHash.slice(0, 7)}.`);
      }
    } catch (err) {
      console.error(`\nFailed to include ${id}: ${err.message}`);
      const remaining = selected.slice(i + 1);
      if (remaining.length > 0) {
        console.error(`Skipped: ${remaining.join(", ")}`);
        console.error("Re-run `ebr include` for the remaining campaigns once the failure is resolved.");
      }
      return;
    }
  }
}
