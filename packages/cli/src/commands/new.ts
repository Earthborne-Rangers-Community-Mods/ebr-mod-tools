import { Command } from "commander";
import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { mkdir, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { scaffoldMod, scaffoldModIntoClone, includeCampaign, includeScaffold } from "core/workflows.js";
import { isRepo, getRemotes } from "core/git.js";
import { buildManifest, toId, deriveOptionalProducts } from "core/manifest.js";
import { readManifest, writeManifest, validateNonEmpty, validateName, validateIcon, validateLanguage } from "core/manifest.js";
import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS, KNOWN_SCAFFOLDS, impliedProductsForCampaigns, impliedProductsForScaffolds } from "core/catalogs.js";
import { getForkUrls, getAuthorDefaults } from "core/config.js";
import { checkModIdAvailability } from "core/registry.js";
import { ManifestNotFoundError, GitError, ValidationError } from "core/errors.js";

import type { Manifest, RawManifest, ModValues, ProgressEvent } from "core/types.js";

interface NewModContext {
  manifest: Manifest;
  targetDir: string;
  existingRepo: boolean;
  scaffoldsToStamp: string[];
  modIdStatus?: { status: string; entry?: { author?: string } };
}

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const MOD_TYPE_CHOICES = MOD_TYPES.map(t => ({
  name: `${t.name} - ${t.description.toLowerCase()}`,
  value: t.id,
}));

const MAP_SCAFFOLD_CHOICES = KNOWN_SCAFFOLDS
  .filter(s => s.branch.startsWith("map/"))
  .map(s => ({ name: s.name, value: s.branch }));

const PATH_SET_SCAFFOLD_CHOICES = KNOWN_SCAFFOLDS
  .filter(s => s.branch.startsWith("set/") && s.branch !== "set/custom-campaign" && s.branch !== "set/custom-one-day-mission")
  .map(s => ({ name: s.name, value: s.branch }));

const CAMPAIGN_CHOICES = OFFICIAL_CAMPAIGNS
  .filter(c => !c.oneDayMission)
  .map(c => ({ name: c.name, value: c.id }));

const ALL_CAMPAIGN_CHOICES = OFFICIAL_CAMPAIGNS.map(c => ({
  name: c.oneDayMission ? `${c.name} (one-day mission)` : c.name,
  value: c.id,
}));

const MID_CAMPAIGN_HEURISTIC =
  "  If your mod mostly adds new content, it's probably safe.\n" +
  "  If your mod modifies existing content, it's probably not,\n" +
  "  unless the changes are just flavor text or story content.";

const EDITABLE_FIELDS = [
  { key: "name", label: "Mod name" },
  { key: "author", label: "Author" },
  { key: "authorDiscord", label: "Discord handle" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "campaigns", label: "Campaigns" },
  { key: "requiredProducts", label: "Required products" },
  { key: "safeToAddMidCampaign", label: "Safe mid-campaign" },
  { key: "midCampaignNotes", label: "Mid-campaign notes" },
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

      // Fork URL check (skip for manifest-only - that's a local-only operation).
      if (!opts.manifestOnly) {
        const forks = await getForkUrls();
        if (!forks.baseContent) {
          console.error("Your copy of the mod project isn't set up yet. Run `ebr setup` first.");
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
      let existing: RawManifest = {};
      try {
        existing = await readManifest(cwd);
        console.log("Found existing ebr-mod.json.\n");
      } catch (err) {
        if (!(err instanceof ManifestNotFoundError)) throw err;
      }

      // Pre-populate author defaults from config
      const authorDefaults = await getAuthorDefaults();
      const values = { ...existing } as ModValues;
      if (!values.author && authorDefaults.author) {
        values.author = authorDefaults.author;
      }
      if (!("authorDiscord" in values) && authorDefaults.authorDiscord) {
        values.authorDiscord = authorDefaults.authorDiscord;
      }
      // Stage 1: Universal prompts
      await promptUniversal(values);

      // Stage 2: Type-specific prompts
      const postActions = await promptForType(values);
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
      const context: NewModContext = { manifest, targetDir, existingRepo, scaffoldsToStamp: postActions.scaffoldsToStamp };
      // Courtesy mod-id uniqueness check; the warning is shown after the summary.
      context.modIdStatus = await checkModIdAvailability(manifest.id);
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
          { dir: targetDir, manifest, forkUrl: forkUrl as string },
          { onProgress: (ev: ProgressEvent) => console.log(ev.message) },
        );

        console.log(`\nMod initialized in ${result.modDir}`);
        console.log(`  Name:   ${result.manifest.name}`);
        console.log(`  ID:     ${result.manifest.id}`);
        console.log(`  Type:   ${result.manifest.type}`);

        // Stamp scaffolds and include official campaigns
        await stampScaffoldsAndIncludeCampaigns(result.modDir, manifest, context.scaffoldsToStamp);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

// --- Helper functions ---

/**
 * Courtesy check: warn if the proposed mod id is already claimed in
 * the public registry. A network failure degrades to a quiet "could
 * not verify" note rather than stopping mod creation.
 */
function printModIdWarning(modId: string, result?: { status: string; entry?: { author?: string } }) {
  if (!result) return;
  if (result.status === "claimed") {
    const claimedBy = result.entry?.author ?? "unknown author";
    console.log(yellow(`\n\u26a0 A mod with ID "${modId}" already exists in the registry (by ${claimedBy}).`));
    console.log(yellow("  Publishing will require a unique ID. Consider renaming before you continue."));
  } else if (result.status === "unverified") {
    console.log("\n  Could not verify mod ID uniqueness (registry unreachable). Proceeding.");
  }
}

function productChoices(campaigns: string[], selected: string[] = []) {
  const implied = impliedProductsForCampaigns(campaigns);
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
 * @param values - Mutable values object being assembled in `ebr new`.
 */
function syncOptionalProducts(values: Record<string, any>) {
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

// --- Universal prompts ---

async function promptUniversal(values: ModValues) {
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
  if (!values.icon) {
    const iconVal = await input({ message: "Icon emoji (optional, press Enter for default):", default: "" });
    if (iconVal && validateIcon(iconVal) === true) {
      values.icon = iconVal;
    }
  }
  if (!values.language) {
    values.language = await input({ message: "Language (BCP 47 code):", default: "en", validate: validateLanguage });
  }
  if (!values.type) {
    values.type = await select({ message: "Mod type:", choices: MOD_TYPE_CHOICES });
  }
}

// --- Type-specific prompts ---

/**
 * Dispatch to the correct type-specific prompt function.
 * Returns a postActions object with scaffoldsToStamp (array of branch names).
 */
async function promptForType(values: ModValues) {
  switch (values.type) {
    case "campaign": return promptCampaignType(values);
    case "expansion": return promptExpansionType(values);
    case "enhancement": return promptEnhancementType(values);
    case "one-day-mission": return promptOneDayMissionType(values);
    case "collection": return promptCollectionType(values);
    case "theme": return promptThemeType(values);
    default: return promptGenericType(values);
  }
}

async function promptCampaignType(values: ModValues) {
  values.campaigns = [toId(values.name)];
  values.safeToAddMidCampaign = false;

  const maps = await checkbox({
    message: "Map scaffolds to include (leave empty for fully custom):",
    choices: [...MAP_SCAFFOLD_CHOICES, { name: "Fully custom", value: null }],
  });
  const selectedMaps = maps.filter(v => v !== null);

  const sets = await checkbox({
    message: "Path set scaffolds to include (leave empty for fully custom):",
    choices: [...PATH_SET_SCAFFOLD_CHOICES, { name: "Fully custom", value: null }],
  });
  const selectedSets = sets.filter(v => v !== null);

  const allScaffolds = ["set/custom-campaign", ...selectedMaps, ...selectedSets];
  const products = impliedProductsForScaffolds(allScaffolds);
  if (!values.requiredProducts) {
    values.requiredProducts = [...products];
  }

  return { scaffoldsToStamp: allScaffolds };
}

/**
 * Prompt for mid-campaign notes when the mod is marked unsafe and none are set
 * yet.
 */
async function promptMidCampaignNotes(values: ModValues) {
  if (!values.safeToAddMidCampaign && !values.midCampaignNotes) {
    values.midCampaignNotes = await input({
      message: "Mid-campaign notes (guidance on when it is / isn't safe to add to an in-progress campaign):",
      default: "",
    }) || undefined;
  }
}

async function promptExpansionType(values: ModValues) {
  if (!values.campaigns || values.campaigns.length === 0) {
    values.campaigns = await checkbox({
      message: "Which campaign(s) does this expansion extend?",
      choices: CAMPAIGN_CHOICES,
    });
    if (values.campaigns.length === 0) {
      const sure = await confirm({
        message: "No campaigns selected. An expansion typically extends at least one campaign. Continue without?",
        default: false,
      });
      if (!sure) {
        values.campaigns = await checkbox({
          message: "Which campaign(s) does this expansion extend?",
          choices: CAMPAIGN_CHOICES,
        });
      }
    }
  }

  if (!values.requiredProducts) {
    const choices = productChoices(values.campaigns);
    values.requiredProducts = await checkbox({ message: "Required products:", choices });
  }

  if (values.safeToAddMidCampaign === undefined) {
    console.log("\n" + MID_CAMPAIGN_HEURISTIC);
    values.safeToAddMidCampaign = await confirm({
      message: "Safe to add mid-campaign?",
      default: false,
    });
  }

  await promptMidCampaignNotes(values);

  return { scaffoldsToStamp: [] };
}

async function promptEnhancementType(values: ModValues) {
  if (!values.campaigns || values.campaigns.length === 0) {
    values.campaigns = await checkbox({
      message: "Which campaign(s) does this enhancement target? (may be empty)",
      choices: ALL_CAMPAIGN_CHOICES,
    });
    if (values.campaigns.length === 0) {
      const sure = await confirm({
        message: "No campaigns selected. You'll likely want to `ebr include` a campaign later. Continue without?",
        default: false,
      });
      if (!sure) {
        values.campaigns = await checkbox({
          message: "Which campaign(s) does this enhancement target?",
          choices: ALL_CAMPAIGN_CHOICES,
        });
      }
    }
  }

  if (!values.requiredProducts) {
    const choices = productChoices(values.campaigns);
    values.requiredProducts = await checkbox({ message: "Required products:", choices });
  }

  if (values.safeToAddMidCampaign === undefined) {
    console.log("\n" + MID_CAMPAIGN_HEURISTIC);
    values.safeToAddMidCampaign = await confirm({
      message: "Safe to add mid-campaign?",
      default: false,
    });
  }

  await promptMidCampaignNotes(values);

  return { scaffoldsToStamp: [] };
}

async function promptOneDayMissionType(values: ModValues) {
  if (!values.campaigns || values.campaigns.length === 0) {
    values.campaigns = await checkbox({
      message: "Which campaign(s) should this mission include?",
      choices: ALL_CAMPAIGN_CHOICES.map(c => ({
        ...c,
        checked: c.value === "lure-of-the-valley",
      })),
    });
    if (values.campaigns.length === 0) {
      console.log("  Note: The mission will require a separate campaign vault at play time.");
    }
  }

  if (!values.requiredProducts) {
    const choices = productChoices(values.campaigns);
    values.requiredProducts = await checkbox({ message: "Required products:", choices });
  }

  values.safeToAddMidCampaign = true;

  return { scaffoldsToStamp: ["set/custom-one-day-mission"] };
}

async function promptCollectionType(values: ModValues) {
  if (!values.campaigns || values.campaigns.length === 0) {
    values.campaigns = await checkbox({
      message: "Which campaign(s) does this collection target?",
      choices: ALL_CAMPAIGN_CHOICES,
    });
  }

  if (!values.requiredProducts) {
    const choices = productChoices(values.campaigns);
    values.requiredProducts = await checkbox({ message: "Required products:", choices });
  }

  if (values.safeToAddMidCampaign === undefined) {
    values.safeToAddMidCampaign = await confirm({
      message: "Safe to add mid-campaign?",
      default: false,
    });
  }

  await promptMidCampaignNotes(values);

  return { scaffoldsToStamp: [] };
}

async function promptThemeType(values: ModValues) {
  values.campaigns = ["any"];
  values.requiredProducts = [];
  values.safeToAddMidCampaign = true;

  console.log("\n  Theme defaults:");
  console.log('    Campaigns:          ["any"]');
  console.log("    Required products:  (none)");
  console.log("    Safe mid-campaign:  Yes");
  console.log("  Theme creators modify the existing ebr-symbols.css and ebr-styles.css directly.\n");

  const ok = await confirm({ message: "Accept these defaults?", default: true });
  if (!ok) {
    console.log("  You can edit individual fields in the next step.");
  }

  return { scaffoldsToStamp: [] };
}

async function promptGenericType(values: ModValues) {
  if (!values.campaigns || values.campaigns.length === 0) {
    values.campaigns = await checkbox({
      message: "Target campaigns:",
      choices: ALL_CAMPAIGN_CHOICES,
    });
  }
  if (!values.requiredProducts) {
    const choices = productChoices(values.campaigns);
    values.requiredProducts = await checkbox({ message: "Required products:", choices });
  }
  if (values.safeToAddMidCampaign === undefined) {
    values.safeToAddMidCampaign = await confirm({ message: "Safe to add mid-campaign?", default: false });
  }
  await promptMidCampaignNotes(values);
  return { scaffoldsToStamp: [] };
}

// --- Summary display ---

function displaySummary(context: NewModContext) {
  const { manifest, targetDir, scaffoldsToStamp } = context;
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
  if (manifest.midCampaignNotes) {
    console.log(`    Mid-campaign notes: ${manifest.midCampaignNotes}`);
  }
  console.log(`    Language:           ${manifest.language}`);
  console.log(`    Icon:               ${manifest.icon}`);
  if (scaffoldsToStamp && scaffoldsToStamp.length > 0) {
    console.log(`    Scaffolds:          ${scaffoldsToStamp.join(", ")}`);
  }
  console.log(`    Directory:          ${targetDir}`);
  console.log();
}

function formatFieldValue(manifest: Record<string, any>, key: string) {
  const val = manifest[key];
  if (val === undefined || val === null) return "(none)";
  if (Array.isArray(val)) return val.join(", ") || "(none)";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

// --- Confirm / edit loop ---

function isFieldVisible(manifest: Manifest, key: string): boolean {
  const type = manifest.type;
  switch (key) {
    case "campaigns":
      return type !== "campaign" && type !== "theme";
    case "requiredProducts":
      return type !== "theme";
    case "safeToAddMidCampaign":
      return type !== "campaign" && type !== "one-day-mission" && type !== "theme";
    case "midCampaignNotes":
      return isFieldVisible(manifest, "safeToAddMidCampaign") && !manifest.safeToAddMidCampaign;
    default:
      return true;
  }
}

async function confirmLoop(context: NewModContext) {
  const { manifest, existingRepo } = context;
  while (true) {
    displaySummary(context);
    printModIdWarning(manifest.id, context.modIdStatus);

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

    const fieldChoices = EDITABLE_FIELDS
      .filter((f) => isFieldVisible(manifest, f.key))
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
      const idBefore = manifest.id;
      await editField(manifest, field, context);
      // Re-run the courtesy uniqueness check if an edit changed the mod id.
      if (manifest.id !== idBefore) {
        context.modIdStatus = await checkModIdAvailability(manifest.id);
      }
    }
  }
}

async function editField(manifest: Record<string, any>, key: string, context: NewModContext) {
  switch (key) {
    case "name":
      manifest.name = await input({ message: "Mod name:", default: manifest.name, validate: validateName });
      manifest.id = toId(manifest.name);
      if (manifest.type === "campaign") {
        manifest.campaigns = [manifest.id];
      }
      // Update targetDir to match new mod ID
      if (context && !context.existingRepo) {
        context.targetDir = resolve(context.targetDir, "..", manifest.id);
      }
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
          delete manifest.midCampaignNotes;
          context.scaffoldsToStamp = [];
        } else if (manifest.type === "campaign") {
          manifest.campaigns = [manifest.id];
          manifest.safeToAddMidCampaign = false;
          delete manifest.midCampaignNotes;
          // Re-ask scaffold questions
          const maps = await checkbox({
            message: "Map scaffolds to include (leave empty for fully custom):",
            choices: [...MAP_SCAFFOLD_CHOICES, { name: "Fully custom", value: null }],
          });
          const selectedMaps = maps.filter(v => v !== null);
          const sets = await checkbox({
            message: "Path set scaffolds to include (leave empty for fully custom):",
            choices: [...PATH_SET_SCAFFOLD_CHOICES, { name: "Fully custom", value: null }],
          });
          const selectedSets = sets.filter(v => v !== null);
          context.scaffoldsToStamp = ["set/custom-campaign", ...selectedMaps, ...selectedSets];
          manifest.requiredProducts = [...impliedProductsForScaffolds(context.scaffoldsToStamp)];
        } else if (manifest.type === "one-day-mission") {
          manifest.safeToAddMidCampaign = true;
          delete manifest.midCampaignNotes;
          context.scaffoldsToStamp = ["set/custom-one-day-mission"];
          if (oldType === "theme" || oldType === "campaign") {
            const choices = ALL_CAMPAIGN_CHOICES.map(c => ({
              ...c,
              checked: c.value === "lure-of-the-valley",
            }));
            manifest.campaigns = await checkbox({ message: "Target campaigns:", choices });
            manifest.requiredProducts = await checkbox({
              message: "Required products:",
              choices: productChoices(manifest.campaigns),
            });
          }
        } else {
          // expansion, enhancement, collection
          context.scaffoldsToStamp = [];
          if (oldType === "theme" || oldType === "campaign") {
            manifest.campaigns = await checkbox({
              message: "Target campaigns:",
              choices: ALL_CAMPAIGN_CHOICES,
            });
            manifest.requiredProducts = await checkbox({
              message: "Required products:",
              choices: productChoices(manifest.campaigns),
            });
            manifest.safeToAddMidCampaign = await confirm({
              message: "Safe to add mid-campaign?",
              default: false,
            });
          }
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
      const choices = ALL_CAMPAIGN_CHOICES.map(c => ({
        ...c,
        checked: manifest.campaigns.includes(c.value),
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
      if (manifest.safeToAddMidCampaign) {
        delete manifest.midCampaignNotes;
      }
      break;
    case "midCampaignNotes": {
      const notes = await input({
        message: "Mid-campaign notes:",
        default: manifest.midCampaignNotes || "",
      });
      if (notes) {
        manifest.midCampaignNotes = notes;
      } else {
        delete manifest.midCampaignNotes;
      }
      break;
    }
    case "language":
      manifest.language = await input({ message: "Language (BCP 47 code):", default: manifest.language, validate: validateLanguage });
      break;
    case "icon":
      manifest.icon = await input({ message: "Icon (emoji):", default: manifest.icon, validate: validateIcon });
      break;
  }
}

// --- Stamp scaffolds and include campaigns ---

/**
 * Stamp scaffolds and include official campaigns after the mod is initialized.
 * Scaffolds are stamped first, then campaigns are included. Failures in
 * either step are reported but don't abort the overall workflow -- the mod
 * is already initialized and the user can retry with `ebr scaffold` or
 * `ebr include`.
 *
 * @param dir - Mod directory.
 * @param manifest - The mod's manifest.
 * @param scaffoldsToStamp - Scaffold branch names to stamp.
 */
async function stampScaffoldsAndIncludeCampaigns(dir: string, manifest: Manifest, scaffoldsToStamp: string[]) {
  const onProgress = (ev: ProgressEvent) => console.log(ev.message);

  // Stamp scaffolds
  if (scaffoldsToStamp && scaffoldsToStamp.length > 0) {
    console.log(`\nStamping ${scaffoldsToStamp.length} scaffold(s)...`);
    for (const branch of scaffoldsToStamp) {
      try {
        const result = await includeScaffold({ dir, source: branch }, { onProgress });
        const skipped = result.filesSkipped ? ` (${result.filesSkipped} skipped)` : "";
        console.log(`  Stamped ${result.branch} (${result.filesAdded} file(s)${skipped})`);
      } catch (err) {
        console.error(`  Failed to stamp ${branch}: ${(err as Error).message}`);
        console.error(`  You can retry later with: ebr scaffold ${branch}`);
      }
    }
  }

  // Include official campaigns
  const knownIds = new Set(OFFICIAL_CAMPAIGNS.map(c => c.id));
  const campaignsToInclude = (manifest.campaigns || []).filter(id => knownIds.has(id));

  if (campaignsToInclude.length > 0) {
    console.log(`\nIncluding ${campaignsToInclude.length} campaign(s)...`);
    for (let i = 0; i < campaignsToInclude.length; i++) {
      const id = campaignsToInclude[i];
      try {
        const result = await includeCampaign({ dir, source: id }, { onProgress });
        if (result.alreadyUpToDate) {
          console.log(`  ${result.branch} is already up to date.`);
        } else {
          console.log(`  Merged ${result.branch} at ${result.commitHash.slice(0, 7)}.`);
        }
      } catch (err) {
        console.error(`  Failed to include ${id}: ${(err as Error).message}`);
        console.error(`  You can retry later with: ebr include ${id}`);
        const remaining = campaignsToInclude.slice(i + 1);
        for (const skipped of remaining) {
          console.error(`  Skipped ${skipped}. Retry later with: ebr include ${skipped}`);
        }
        break;
      }
    }
  }

  if (manifest.type === "collection") {
    console.log("\nTo add mods to this collection, use: ebr include <mod-id-or-url>");
  }
}
