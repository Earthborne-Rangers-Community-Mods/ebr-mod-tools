/**
 * Include-campaign "Add content" kind: merge an official campaign branch into
 * the mod. The pick screen previews conflicts with a `git merge-tree` dry run;
 * a clean merge commits and reports, a conflicting merge hands the conflicted
 * files to the conflict flow and routes to the Conflict Resolution page. Pure
 * logic lives in core.
 */
import {
  includeCampaign,
  predictCampaignInclude,
  computeMissingCampaignProducts,
  OFFICIAL_CAMPAIGNS,
  IncludeRefNotFoundError,
  BaseRemoteMissingError,
  MergeConflictError,
  DirtyWorkingTreeError,
  IndexNotCleanError,
  NotARepoError,
  ValidationError,
} from "core";
import { runGuarded } from "./guarded.js";
import { ContentKindFlow } from "./contentkind.svelte.js";
import { openMods } from "./mods.svelte.js";
import { gitStatus } from "./gitstatus.svelte.js";
import { conflictFlow } from "./conflict.svelte.js";
import { navigation, ROUTES } from "./navigation.svelte.js";

/** The result of a completed clean campaign include, shown on the report screen. */
interface IncludeReport {
  campaignId: string;
  /** True when the campaign was already merged at this commit (no-op). */
  alreadyUpToDate: boolean;
}

const DEFAULT_CAMPAIGN = OFFICIAL_CAMPAIGNS[0]?.id ?? "";

/** What including the selected campaign would do, from the dry-run preview. */
interface CampaignPreview {
  /** Paths that would conflict; empty when the merge is clean. */
  conflicts: string[];
  /** True when the mod already has this campaign at its current tip (no-op). */
  alreadyUpToDate: boolean;
}

export class IncludeCampaignFlow extends ContentKindFlow {
  /** Campaign selected to include. */
  campaignSource = $state(DEFAULT_CAMPAIGN);
  /** Where to put the campaign's missing products, or skip them. */
  productChoice = $state<"required" | "optional" | "skip">("required");
  /** What the selected campaign would do, or null before the preview loads. */
  preview = $state<CampaignPreview | null>(null);
  /** The completed clean-include report, or null until it finishes. */
  report = $state<IncludeReport | null>(null);

  /** The mod's manifest, or null. */
  get #manifest() {
    return (this.dir && openMods.getByDir(this.dir)?.manifest) || null;
  }

  /**
   * Products the selected campaign needs that the manifest does not yet list.
   * Empty when nothing is missing; drives the required/optional/skip choice.
   */
  get missingProducts(): string[] {
    const manifest = this.#manifest;
    if (!manifest) return [];
    return computeMissingCampaignProducts(this.campaignSource, manifest);
  }

  begin(dir: string) {
    this.dir = dir;
    this.campaignSource = DEFAULT_CAMPAIGN;
    this.productChoice = "required";
    this.preview = null;
    this.report = null;
    this.resetStatus();
    this.#loadPreview();
  }

  protected clearResult() {
    this.campaignSource = DEFAULT_CAMPAIGN;
    this.productChoice = "required";
    this.preview = null;
    this.report = null;
  }

  protected classifyError(err: unknown): string {
    if (err instanceof IncludeRefNotFoundError) return "campaign-not-found";
    if (err instanceof BaseRemoteMissingError) return "no-base";
    if (err instanceof NotARepoError) return "not-a-repo";
    if (err instanceof DirtyWorkingTreeError) return "dirty-tree";
    if (err instanceof IndexNotCleanError) return "index-not-clean";
    if (err instanceof ValidationError) return "invalid";
    return "include-failed";
  }

  /** Select a different campaign and refresh its conflict preview. */
  selectCampaign(campaignId: string) {
    if (this.busy) return;
    this.campaignSource = campaignId;
    this.productChoice = "required";
    this.#loadPreview();
  }

  /**
   * Predict what including the selected campaign would do, so the pick screen can
   * warn about conflicts (or say the mod already has it) before anything
   * touches the working tree.
   */
  #loadPreview() {
    const dir = this.dir;
    const source = this.campaignSource;
    if (!dir || !source) return;
    this.preview = null;
    this.runPreview(
      () => predictCampaignInclude({ dir, source }),
      (r) => (this.preview = { conflicts: r.conflicts, alreadyUpToDate: r.alreadyUpToDate }),
    );
  }

  /**
   * Include the selected campaign. A clean merge commits and shows a report; a
   * conflicting merge hands the conflicted files to the conflict flow and routes
   * to the Conflict Resolution page.
   */
  async include() {
    const dir = this.dir;
    const source = this.campaignSource;
    if (!dir || !source) return;

    const addProductsTo = this.productChoice === "skip" ? null : this.productChoice;
    await runGuarded(
      this,
      "include-failed",
      async () => {
        try {
          const result = await includeCampaign({ dir, source, addProductsTo });
          this.report = { campaignId: result.campaignId, alreadyUpToDate: result.alreadyUpToDate };
          try {
            await openMods.reload(dir);
            await gitStatus.refresh(dir);
          } catch {
            // Non-fatal: the include landed; the cached view may lag.
          }
        } catch (err) {
          if (err instanceof MergeConflictError) {
            // The merge left conflicts in the tree. Hand them to the conflict
            // flow and route to its page; the launcher closes as we leave.
            conflictFlow.start(dir, { conflictedFiles: err.conflictedFiles });
            this.dismiss();
            navigation.go(ROUTES.CONFLICT, { dir });
            return;
          }
          throw err;
        }
      },
      {
        onError: (err) => {
          this.errorCode = this.classifyError(err);
        },
      },
    );
  }
}
