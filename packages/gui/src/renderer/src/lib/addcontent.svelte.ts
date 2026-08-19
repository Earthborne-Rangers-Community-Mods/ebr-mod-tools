/**
 * Coordinator behind the "Add content" launcher on the Mod Details page. It owns
 * the chooser shell - which kinds are offered (see {@link addContentKinds}), the
 * save-first gate, and which kind is active - and delegates the actual
 * pick -> preview -> apply -> report work to one sub-flow per kind.
 */
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { saveFlow } from "./save.svelte.js";
import { TemplateFlow } from "./template.svelte.js";
import { IncludeCampaignFlow } from "./includecampaign.svelte.js";
import { IncludeModFlow } from "./includemod.svelte.js";
import type { ContentKindFlow } from "./contentkind.svelte.js";
import type { AddContentKind } from "./addcontent.js";

class AddContentFlow {
  /** Directory of the mod the launcher is open for, or null when closed. */
  dir = $state<string | null>(null);
  /** Type of the mod being edited, driving which kinds are offered. */
  modType = $state("");
  /** Selected content kind, or null while the chooser is showing. */
  kind = $state<AddContentKind | null>(null);

  /** The template-stamp sub-flow. */
  template = new TemplateFlow();
  /** The include-campaign sub-flow. */
  campaign = new IncludeCampaignFlow();
  /** The include-mod sub-flow (Advanced mode only). */
  mod = new IncludeModFlow();

  constructor() {
    // A sub-flow that routes the user away (a campaign include that hit conflicts)
    // closes the launcher via this callback; the sub-flow has already reset itself.
    // Only merge-capable kinds route away.
    this.campaign.onDismiss = () => {
      this.dir = null;
      this.kind = null;
    };
    this.mod.onDismiss = () => {
      this.dir = null;
      this.kind = null;
    };
  }

  /** Whether the launcher modal is open. */
  get isOpen(): boolean {
    return this.dir !== null;
  }

  /** The active kind's sub-flow, or null while the chooser is showing. */
  get active(): ContentKindFlow | null {
    if (this.kind === "template") return this.template;
    if (this.kind === "include-campaign") return this.campaign;
    if (this.kind === "include-mod") return this.mod;
    return null;
  }

  /** True while the active kind's operation runs (drives the app close-guard). */
  get busy(): boolean {
    return this.active?.busy ?? false;
  }

  /**
   * Whether the mod has uncommitted work that must be saved before adding
   * content.
   */
  get needsSave(): boolean {
    return Boolean(gitStatus.get(this.dir ?? "")?.hasUncommitted);
  }

  /**
   * True until the open mod's git status has loaded at least once, so the
   * chooser can wait rather than briefly show a kind before the save-first gate
   * is known.
   */
  get statusPending(): boolean {
    const entry = gitStatus.get(this.dir ?? "");
    return !entry || !entry.loaded;
  }

  /** Open the launcher for a mod, starting at the chooser. */
  start(dir: string, modType: string) {
    if (this.busy) return;
    this.dir = dir;
    this.modType = modType;
    this.kind = null;
    this.template.reset();
    this.campaign.reset();
    this.mod.reset();
    // Refresh the dirty state so the save-first gate on the chooser is current.
    gitStatus.refresh(dir);
  }

  /** Pick a content kind, advancing from the chooser to that kind's screen. */
  chooseKind(kind: AddContentKind) {
    if (this.busy) return;
    this.kind = kind;
    this.active?.begin(this.dir!);
  }

  /** Return to the chooser, discarding the active kind's in-flight state. */
  back() {
    if (this.busy) return;
    this.active?.reset();
    this.kind = null;
  }

  /** Close the launcher. No-op while an operation is in flight. */
  cancel() {
    if (this.busy) return;
    this.active?.reset();
    this.dir = null;
    this.kind = null;
  }

  /**
   * Close the launcher and open the save flow instead. Offered on the chooser
   * when the mod has unsaved work: the user saves, then re-opens the launcher.
   */
  saveFirst() {
    const dir = this.dir;
    if (!dir || this.busy) return;
    const status = gitStatus.get(dir);
    const mode = status?.hasUncommitted ? "commit" : "push";
    const currentVersion = openMods.getByDir(dir)?.manifest?.version ?? "0.0.0";
    this.cancel();
    saveFlow.start(dir, { currentVersion, mode });
  }
}

export const addContentFlow = new AddContentFlow();
