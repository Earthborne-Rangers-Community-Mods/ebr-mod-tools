/**
 * Reactive store backing the New Mod page - the GUI equivalent of `ebr new`.
 *
 * Holds the in-progress mod values (the same fields the CLI collects through
 * prompts), applies the per-type defaults `ebr new` applies, and runs the same
 * create pipeline: `scaffoldMod` clones the fork and writes the manifest, then
 * scaffolds are stamped and official campaigns are merged in. On success the
 * new mod is added to the My Mods list.
 *
 * The pure logic (`buildManifest`, `deriveOptionalProducts`, `scaffoldMod`,
 * `includeScaffold`, `includeCampaign`) lives in `core`; this store is the thin
 * front-end orchestration layer.
 */
import {
  toId,
  buildManifest,
  deriveOptionalProducts,
  validateName,
  validateNonEmpty,
  validateLanguage,
  validateIcon,
  scaffoldMod,
  includeScaffold,
  includeCampaign,
  impliedProductsForCampaigns,
  impliedProductsForScaffolds,
  DEFAULT_MOD_ICON,
  OFFICIAL_CAMPAIGNS,
  KNOWN_SCAFFOLDS,
} from "core";
import { join } from "node:path";
import { openMods } from "./mods.svelte.js";
import { setupStore } from "./setup.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";
import { pickDirectory } from "./platform.js";
import { runGuarded } from "./guarded.js";
import { checkModId } from "./registry.js";
import { showSafeNotes, fixedSafety } from "./midcampaign.js";

/** @typedef {import('core/types.js').ProgressEvent} ProgressEvent */
/** @typedef {import('core/types.js').ModValues} ModValues */
/** @typedef {import('core/types.js').Manifest} Manifest */

/** Map scaffold branches selectable for a `campaign` mod. */
export const MAP_SCAFFOLDS = KNOWN_SCAFFOLDS.filter((s) => s.branch.startsWith("map/"));

/** Path-set scaffold branches selectable for a `campaign` mod. */
export const PATH_SET_SCAFFOLDS = KNOWN_SCAFFOLDS.filter(
  (s) =>
    s.branch.startsWith("set/") &&
    s.branch !== "set/custom-campaign" &&
    s.branch !== "set/custom-one-day-mission",
);

/** Campaigns a `campaign`/`expansion`/etc. mod can target (story arcs only). */
export const STORY_CAMPAIGNS = OFFICIAL_CAMPAIGNS.filter((c) => !c.oneDayMission);

class NewModForm {
  // Universal fields (mirror the CLI's universal prompts).
  name = $state("");
  author = $state("");
  authorDiscord = $state("");
  description = $state("");
  icon = $state(DEFAULT_MOD_ICON);
  language = $state("en");
  type = $state("enhancement");

  // Type-specific fields.
  campaigns = $state(/** @type {string[]} */ ([]));
  requiredProducts = $state(/** @type {string[]} */ ([]));
  safeToAddMidCampaign = $state(false);
  midCampaignNotes = $state("");
  selectedMaps = $state(/** @type {string[]} */ ([]));
  selectedSets = $state(/** @type {string[]} */ ([]));

  // Where the mod folder will be created (its parent directory).
  parentDir = $state(/** @type {string|null} */ (null));

  // Async/create state.
  busy = $state(false);
  progress = $state(/** @type {string|null} */ (null));
  errorCode = $state(/** @type {string|null} */ (null));
  errorDetail = $state(/** @type {string|null} */ (null));
  /** Non-fatal failures from the scaffold/include steps after the mod was created. */
  warnings = $state(/** @type {Array<{kind: string, ref: string, detail: string}>} */ ([]));
  /** True once creation finished but left warnings; the mod exists and is tracked. */
  completedWithWarnings = $state(false);
  /** Id of the mod just created, so completion can route to its details page. */
  createdModId = $state(/** @type {string|null} */ (null));
  /** Registry availability of the current id ({ status, entry } or null). */
  idStatus = $state(/** @type {{status: string, entry?: {author?: string}}|null} */ (null));
  /** Per-field validation error codes, keyed by field name (blur-time feedback). */
  fieldErrors = $state(/** @type {Record<string, string>} */ ({}));

  /** Kebab-case id derived from the name, matching `ebr new`. */
  get id() {
    return toId(this.name);
  }

  /** Scaffold branches this mod will stamp, driven by type and selections. */
  get scaffoldsToStamp() {
    if (this.type === "campaign") {
      return ["set/custom-campaign", ...this.selectedMaps, ...this.selectedSets];
    }
    if (this.type === "one-day-mission") {
      return ["set/custom-one-day-mission"];
    }
    return [];
  }

  get showCampaignsField() {
    return this.type !== "campaign" && this.type !== "theme";
  }

  get showProductsField() {
    return this.type !== "theme";
  }

  get showScaffoldsField() {
    return this.type === "campaign";
  }

  get showNotesField() {
    return showSafeNotes(this.type, this.safeToAddMidCampaign);
  }

  /** Seed the form from setup defaults and reset transient state. */
  reset() {
    this.name = "";
    this.author = setupStore.author || setupStore.displayLogin || "";
    this.authorDiscord = setupStore.authorDiscord || "";
    this.description = "";
    this.icon = DEFAULT_MOD_ICON;
    this.language = "en";
    this.type = "enhancement";
    this.campaigns = [];
    this.requiredProducts = [];
    this.safeToAddMidCampaign = false;
    this.midCampaignNotes = "";
    this.selectedMaps = [];
    this.selectedSets = [];
    this.parentDir = openMods.pickerDefaultPath ?? null;
    this.busy = false;
    this.progress = null;
    this.errorCode = null;
    this.errorDetail = null;
    this.warnings = [];
    this.completedWithWarnings = false;
    this.createdModId = null;
    this.idStatus = null;
    this.fieldErrors = {};
  }

  /**
   * Apply the per-type defaults `ebr new` sets when a type is chosen. Mirrors
   * the CLI's `editField` type-change rules: the campaign/product basis is reset
   * when moving into `campaign`/`theme` or out of them (so no stale scaffold- or
   * campaign-derived products leak across the switch), and preserved when moving
   * within the campaign-targeting family (enhancement/expansion/collection/
   * one-day-mission).
   * @param {string} type
   */
  setType(type) {
    const cameFromReset = this.type === "campaign" || this.type === "theme";
    this.type = type;
    this.selectedMaps = [];
    this.selectedSets = [];
    if (type === "campaign" || type === "theme") {
      this.campaigns = [];
      this.requiredProducts = [];
    } else if (type === "one-day-mission") {
      if (cameFromReset) {
        this.campaigns = [];
        this.requiredProducts = [];
      }
      // Pre-check Lure as a convenience when nothing is selected yet
      if (this.campaigns.length === 0) this.campaigns = ["lure-of-the-valley"];
    } else {
      // enhancement, expansion, collection
      if (cameFromReset) {
        this.campaigns = [];
        this.requiredProducts = [];
        this.safeToAddMidCampaign = false;
      }
      // Otherwise preserve campaigns, requiredProducts, and the safe flag
    }
    // Types whose safety is fixed take the canonical value and drop notes.
    const fixed = fixedSafety(type);
    if (fixed !== null) {
      this.safeToAddMidCampaign = fixed;
      this.midCampaignNotes = "";
    }
    this.#refreshImpliedProducts();
  }

  /**
   * Add every product implied by the current campaigns (or scaffolds, for a
   * campaign mod) to `requiredProducts`, preserving the user's own picks.
   */
  #refreshImpliedProducts() {
    if (this.type === "theme") {
      this.requiredProducts = [];
      return;
    }
    const implied =
      this.type === "campaign"
        ? impliedProductsForScaffolds(this.scaffoldsToStamp)
        : impliedProductsForCampaigns(this.campaigns);
    const merged = new Set(this.requiredProducts);
    for (const p of implied) merged.add(p);
    this.requiredProducts = [...merged];
  }

  /**
   * Add or remove `value` from `list`, returning a fresh array (so the `$state`
   * assignment stays reactive).
   * @param {string[]} list
   * @param {string} value
   * @returns {string[]}
   */
  #toggle(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  /** @param {string} id */
  toggleCampaign(id) {
    this.campaigns = this.#toggle(this.campaigns, id);
    this.#refreshImpliedProducts();
  }

  /** @param {string} id */
  toggleProduct(id) {
    this.requiredProducts = this.#toggle(this.requiredProducts, id);
  }

  /** @param {string} branch */
  toggleMap(branch) {
    this.selectedMaps = this.#toggle(this.selectedMaps, branch);
    this.#refreshImpliedProducts();
  }

  /** @param {string} branch */
  toggleSet(branch) {
    this.selectedSets = this.#toggle(this.selectedSets, branch);
    this.#refreshImpliedProducts();
  }

  /** Open the native directory picker to choose the parent folder. */
  async pickFolder() {
    const seed = this.parentDir ?? openMods.pickerDefaultPath;
    const dir = await pickDirectory(seed ?? undefined);
    if (dir) this.parentDir = dir;
  }

  /**
   * Courtesy registry uniqueness check for the current id.
   * Network failure degrades to "unverified"; never blocks creation.
   */
  async checkId() {
    const id = this.id;
    if (!id) {
      this.idStatus = null;
      return;
    }
    const result = await checkModId(id);
    // Ignore a stale response if the name (and thus id) changed while in flight.
    if (id === this.id) this.idStatus = result;
  }

  /**
   * Validate one editable text field and record (or clear) its inline error, so
   * the user sees a problem on blur rather than only at create time. Reuses the
   * same `newmod_error_invalid_*` messages the create gate surfaces.
   * @param {string} field
   */
  validateField(field) {
    /** @type {string|null} */
    let code = null;
    if (field === "name") {
      if (validateName(this.name) !== true) code = "invalid-name";
    } else if (field === "author") {
      if (validateNonEmpty(this.author) !== true) code = "invalid-author";
    } else if (field === "description") {
      if (validateNonEmpty(this.description) !== true) code = "invalid-description";
    } else if (field === "language") {
      if (validateLanguage(this.language) !== true) code = "invalid-language";
    } else if (field === "icon") {
      // Icon is optional; only a non-empty, non-single-emoji value is an error.
      if (this.icon.trim() && validateIcon(this.icon.trim()) !== true) code = "invalid-icon";
    }
    // Reassign the whole map so the `$state` proxy tracks the add/remove.
    const next = { ...this.fieldErrors };
    if (code) next[field] = code;
    else delete next[field];
    this.fieldErrors = next;
  }

  /**
   * Validate every editable field into `fieldErrors` and report whether all
   * passed. Used as the create-time gate so a submit surfaces every field
   * problem inline at once, not just the first.
   * @returns {boolean}
   */
  #validateAllFields() {
    for (const field of ["name", "author", "description", "language", "icon"]) {
      this.validateField(field);
    }
    return Object.keys(this.fieldErrors).length === 0;
  }

  /** Assemble the manifest-input values from the current form state. */
  #buildValues() {
    const id = this.id;
    let campaigns;
    if (this.type === "campaign") campaigns = [id];
    else if (this.type === "theme") campaigns = ["any"];
    else campaigns = [...this.campaigns];

    const requiredProducts = this.type === "theme" ? [] : [...this.requiredProducts];

    /** @type {ModValues} */
    const values = {
      name: this.name.trim(),
      author: this.author.trim(),
      description: this.description.trim(),
      type: this.type,
      campaigns,
      requiredProducts,
      safeToAddMidCampaign: this.safeToAddMidCampaign,
      language: this.language.trim() || "en",
    };

    const discord = this.authorDiscord.trim();
    if (discord) values.authorDiscord = discord;

    const icon = this.icon.trim();
    if (icon && validateIcon(icon) === true) values.icon = icon;

    if (this.showNotesField) {
      const notes = this.midCampaignNotes.trim();
      if (notes) values.midCampaignNotes = notes;
    }

    const optional = deriveOptionalProducts({
      type: values.type,
      campaigns: values.campaigns,
      requiredProducts: values.requiredProducts,
      optionalProducts: [],
    });
    if (optional.length > 0) values.optionalProducts = optional;

    return values;
  }

  /**
   * Stamp scaffolds and merge official campaigns after the mod branch exists.
   * Failures here are non-fatal - the mod is already created and tracked, and
   * the creator can retry with the scaffold/include tools - so they are
   * collected as warnings rather than thrown.
   * @param {string} dir
   * @param {Manifest} manifest
   */
  async #stampAndInclude(dir, manifest) {
    const onProgress = (/** @type {ProgressEvent} */ p) => (this.progress = p.message ?? null);

    for (const branch of this.scaffoldsToStamp) {
      try {
        await includeScaffold({ dir, source: branch }, { onProgress });
      } catch (err) {
        this.warnings = [...this.warnings, { kind: "scaffold", ref: branch, detail: (/** @type {Error} */ (err))?.message ?? "" }];
      }
    }

    const knownIds = new Set(OFFICIAL_CAMPAIGNS.map((c) => c.id));
    const campaignsToInclude = (manifest.campaigns || []).filter((id) => knownIds.has(id));
    for (let i = 0; i < campaignsToInclude.length; i++) {
      const id = campaignsToInclude[i];
      try {
        await includeCampaign({ dir, source: id }, { onProgress });
      } catch (err) {
        this.warnings = [...this.warnings, { kind: "campaign", ref: id, detail: (/** @type {Error} */ (err))?.message ?? "" }];
        // Stop on the first campaign failure: later merges likely depend on a
        // clean tree. Report the rest as explicitly skipped so the user knows
        // they were never attempted.
        for (const skipped of campaignsToInclude.slice(i + 1)) {
          this.warnings = [...this.warnings, { kind: "campaign-skipped", ref: skipped, detail: "" }];
        }
        break;
      }
    }
  }

  /**
   * Validate, create the mod (clone + branch + manifest), stamp scaffolds, and
   * merge campaigns. On a clean run, tracks the mod and returns to My Mods; if
   * only the post-scaffold steps failed, stays on the page and surfaces the
   * warnings.
   */
  async create() {
    if (this.busy) return;

    this.errorCode = null;
    this.errorDetail = null;
    this.warnings = [];
    this.completedWithWarnings = false;

    const forkUrl = setupStore.forks.baseContent;
    if (!forkUrl) {
      this.errorCode = "setup-required";
      return;
    }
    if (!this.#validateAllFields()) {
      return;
    }
    if (!this.parentDir) {
      this.errorCode = "no-folder";
      return;
    }
    const parentDir = this.parentDir;

    await runGuarded(
      this,
      "create-failed",
      async () => {
        this.progress = null;
        const manifest = buildManifest(this.#buildValues());
        const targetDir = join(parentDir, manifest.id);
        const result = await scaffoldMod(
          { dir: targetDir, manifest, forkUrl },
          { onProgress: (/** @type {ProgressEvent} */ p) => (this.progress = p.message ?? null) },
        );
        await this.#stampAndInclude(result.modDir, manifest);
        const added = await openMods.add(result.modDir);
        if (added.ok) this.createdModId = manifest.id;

        if (this.warnings.length > 0) {
          this.completedWithWarnings = true;
        } else {
          this.finish();
        }
      },
      {
        onError: (/** @type {unknown} */ err) => {
          this.errorDetail = (/** @type {Error} */ (err))?.message ?? null;
        },
        finalize: () => {
          this.progress = null;
        },
      },
    );
  }

  /**
   * Leave the New Mod page for the freshly created mod's details page (falling
   * back to My Mods if the id was somehow lost), clearing the form for next time.
   */
  finish() {
    const modId = this.createdModId;
    this.reset();
    if (modId) {
      navigation.go(ROUTES.MOD_DETAILS, { modId });
    } else {
      navigation.go(ROUTES.MY_MODS);
    }
  }
}

export const newModForm = new NewModForm();
