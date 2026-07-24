/**
 * Reactive store backing the Mod Details page - the GUI's manifest editor.
 *
 * It loads the active mod's `ebr-mod.json` (via the My Mods store), exposes the
 * editable fields as draft `$state`, and writes them back to the manifest file
 * on disk when the user saves. `dirty` tracks whether there are unsaved edits.
 *
 * The pure logic (validators, `writeManifest`) lives in `core`; this store is the
 * thin front-end orchestration layer.
 */
import {
  writeManifest,
  validateName,
  validateVersion,
  validateNonEmpty,
} from "core";
import { openMods } from "./mods.svelte.js";
import { showSafeNotes, fixedSafety } from "./midcampaign.js";
import type { RawManifest } from "core/types.js";

/**
 * Split a comma-separated tag string into a deduped list of lowercase tags.
 */
function parseTags(text: string): string[] {
  const tags = text
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}

class ModDetailsForm {
  // Identity / read-only display fields.
  dir = $state<string | null>(null);
  id = $state("");
  repoUrl = $state("");

  // Editable draft fields (mirror the manifest).
  name = $state("");
  version = $state("");
  description = $state("");
  author = $state("");
  authorDiscord = $state("");
  tags = $state("");
  icon = $state("");
  language = $state("en");
  type = $state("enhancement");
  campaigns = $state<string[]>([]);
  requiredProducts = $state<string[]>([]);
  optionalProducts = $state<string[]>([]);
  safeToAddMidCampaign = $state(false);
  midCampaignNotes = $state("");

  // Transient UI state.
  /** True once a manifest was loaded; false means the mod could not be found. */
  loaded = $state(false);
  /** Per-field validation error codes, keyed by field name. */
  fieldErrors = $state<Record<string, string>>({});
  /** Save status shown to the user: idle | saving | saved | error. */
  saveState = $state("idle");
  /** Detail message from a failed write, surfaced with the error status. */
  errorDetail = $state<string | null>(null);
  /** A type the user picked but has not yet confirmed (drives the warning). */
  pendingType = $state<string | null>(null);
  /** JSON of the field values as last loaded/saved; drives the `dirty` check. */
  savedSnapshot = $state("");

  /**
   * Full manifest as last persisted; source of fields we do not edit here.
   */
  #original: RawManifest | null = null;

  /** Whether a type change is awaiting confirmation. */
  get typeChangePending() {
    return this.pendingType !== null;
  }

  /** Whether to show the "why not safe" notes field. */
  get showNotesField() {
    return showSafeNotes(this.type, this.safeToAddMidCampaign);
  }

  /** Whether the draft differs from what was last loaded or saved. */
  get dirty() {
    return this.loaded && this.#manifestString() !== this.savedSnapshot;
  }

  /** Whether any editable field currently has a validation error. */
  get hasErrors() {
    return Object.keys(this.fieldErrors).length > 0;
  }

  /**
   * Load the mod with the given id from the My Mods store into the draft. When
   * the mod is not present (removed from the list), marks the form unloaded.
   */
  load(id: string) {
    const entry = openMods.get(id);
    const mf = entry?.manifest;
    if (!entry || !mf) {
      this.loaded = false;
      this.#original = null;
      return;
    }
    this.#original = mf;
    this.dir = entry.dir;
    this.#populate(mf);
    this.pendingType = null;
    this.fieldErrors = {};
    this.saveState = "idle";
    this.errorDetail = null;
    this.loaded = true;
    this.savedSnapshot = this.#manifestString();
  }

  /**
   * Discard unsaved edits, resetting every draft field to the last saved
   * manifest. No-op before a mod is loaded.
   */
  revert() {
    if (!this.#original) return;
    this.#populate(this.#original);
    this.pendingType = null;
    this.fieldErrors = {};
    this.errorDetail = null;
    this.saveState = "idle";
  }

  /**
   * Copy a manifest's editable fields into the draft `$state`. Shared by `load`
   * and `revert`.
   */
  #populate(mf: RawManifest) {
    this.id = mf.id ?? "";
    this.repoUrl = mf.repoUrl ?? "";
    this.name = mf.name ?? "";
    this.version = mf.version ?? "";
    this.description = mf.description ?? "";
    this.author = mf.author ?? "";
    this.authorDiscord = mf.authorDiscord ?? "";
    this.tags = Array.isArray(mf.tags) ? mf.tags.join(", ") : "";
    this.icon = mf.icon ?? "";
    this.language = mf.language ?? "en";
    this.type = mf.type ?? "enhancement";
    this.campaigns = Array.isArray(mf.campaigns) ? [...mf.campaigns] : [];
    this.requiredProducts = Array.isArray(mf.requiredProducts) ? [...mf.requiredProducts] : [];
    this.optionalProducts = Array.isArray(mf.optionalProducts) ? [...mf.optionalProducts] : [];
    this.safeToAddMidCampaign = Boolean(mf.safeToAddMidCampaign);
    this.midCampaignNotes = mf.midCampaignNotes ?? "";
  }

  /**
   * Validate one required text field and record (or clear) its inline error.
   * Unknown/optional fields are no-ops, so callers can route every text field's
   * blur through here.
   */
  validateField(field: string) {
    let code: string | null = null;
    if (field === "name") {
      if (validateName(this.name) !== true) code = "invalid-name";
    } else if (field === "version") {
      if (validateVersion(this.version) !== true) code = "invalid-version";
    } else if (field === "description") {
      if (validateNonEmpty(this.description) !== true) code = "invalid-description";
    } else if (field === "author") {
      if (validateNonEmpty(this.author) !== true) code = "invalid-author";
    } else {
      return;
    }
    const next = { ...this.fieldErrors };
    if (code) next[field] = code;
    else delete next[field];
    this.fieldErrors = next;
  }

  /**
   * Validate every required text field into `fieldErrors` and report whether the
   * draft is safe to write. This is the real persistence gate.
   */
  #validateRequired() {
    for (const field of ["name", "version", "description", "author"]) {
      this.validateField(field);
    }
    return Object.keys(this.fieldErrors).length === 0;
  }

  #toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  toggleCampaign(id: string) {
    this.campaigns = this.#toggle(this.campaigns, id);
  }

  toggleRequiredProduct(id: string) {
    this.requiredProducts = this.#toggle(this.requiredProducts, id);
  }

  toggleOptionalProduct(id: string) {
    this.optionalProducts = this.#toggle(this.optionalProducts, id);
  }

  /**
   * Record a type the user selected, holding it as pending until they confirm.
   * Selecting the current type clears any pending change.
   */
  requestTypeChange(next: string) {
    this.pendingType = !next || next === this.type ? null : next;
  }

  /** Apply the pending type change. */
  confirmTypeChange() {
    if (this.pendingType === null) return;
    this.type = this.pendingType;
    this.pendingType = null;
    // For types whose safety is fixed, the section (and notes) are hidden, so
    // force the canonical value and clear notes - otherwise a retype would leave
    // a stale flag or orphan notes with no control left to repair them.
    const fixed = fixedSafety(this.type);
    if (fixed !== null) {
      this.safeToAddMidCampaign = fixed;
      this.midCampaignNotes = "";
    }
  }

  /** Discard the pending type change; the select reverts to the saved type. */
  cancelTypeChange() {
    this.pendingType = null;
  }

  /** Assemble the manifest to persist, preserving fields we do not edit. */
  #buildManifest() {
    const next = { ...this.#original };
    next.name = this.name.trim();
    next.version = this.version.trim();
    next.description = this.description.trim();
    next.author = this.author.trim();
    next.language = this.language.trim() || "en";
    next.type = this.type;
    next.campaigns = [...this.campaigns];
    next.requiredProducts = [...this.requiredProducts];
    next.safeToAddMidCampaign = this.safeToAddMidCampaign;

    const discord = this.authorDiscord.trim();
    if (discord) next.authorDiscord = discord;
    else delete next.authorDiscord;

    const tags = parseTags(this.tags);
    if (tags.length) next.tags = tags;
    else delete next.tags;

    const icon = this.icon.trim();
    if (icon) next.icon = icon;
    else delete next.icon;

    if (this.optionalProducts.length) next.optionalProducts = [...this.optionalProducts];
    else delete next.optionalProducts;

    const notes = this.midCampaignNotes.trim();
    if (this.showNotesField && notes) next.midCampaignNotes = notes;
    else delete next.midCampaignNotes;

    return next;
  }

  /**
   * Serialize the manifest a save would write, so `dirty` and `savedSnapshot`
   * share one normalization (via `#buildManifest`) and cannot drift apart.
   */
  #manifestString() {
    return JSON.stringify(this.#buildManifest());
  }

  /**
   * Write the current draft to disk. Validates the required fields first; when
   * any is invalid the write is skipped and the inline errors are surfaced. No-op
   * before a mod is loaded or while a save is already running.
   */
  async save() {
    if (!this.dir || this.saveState === "saving") return;
    if (!this.#validateRequired()) return;
    this.saveState = "saving";
    try {
      const manifest = this.#buildManifest();
      await writeManifest(this.dir, manifest);
      this.#applySaved(manifest);
      this.savedSnapshot = JSON.stringify(manifest);
      this.saveState = "saved";
    } catch (err) {
      this.saveState = "error";
      this.errorDetail = (err as Error)?.message ?? "";
    }
  }

  /** Record a freshly-written manifest as the new baseline and sync My Mods.
   */
  #applySaved(manifest: RawManifest) {
    this.#original = manifest;
    const entry = openMods.entries.find((e) => e.dir === this.dir);
    if (entry) entry.manifest = manifest;
  }
}

export const modDetailsForm = new ModDetailsForm();
