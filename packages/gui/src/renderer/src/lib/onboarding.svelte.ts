/**
 * Onboarding surfaces for creators unfamiliar with the git+Obsidian workflow:
 * the one-time New Mod completion explainer.
 */
import { helpDialog } from "./helpdialog.svelte.js";

/** The public modding guide, hosted in the mod manager. */
export function moddingGuideUrl(modManagerUrl: string): string {
  return `${modManagerUrl}docs/modding-guide`;
}

const NEW_MOD_EXPLAINER_KEY = "ebr-gui:seen-new-mod-explainer";

function hasSeenNewModExplainer(): boolean {
  try {
    return localStorage.getItem(NEW_MOD_EXPLAINER_KEY) === "1";
  } catch {
    return false;
  }
}

function persistSeenNewModExplainer(): void {
  try {
    localStorage.setItem(NEW_MOD_EXPLAINER_KEY, "1");
  } catch {
    // Storage unavailable - the explainer may show again next time.
  }
}

/** Clear the seen-flag so the New Mod completion explainer shows again. */
export function resetNewModExplainerSeen(): void {
  try {
    localStorage.removeItem(NEW_MOD_EXPLAINER_KEY);
  } catch {
    // Storage unavailable - nothing to clear.
  }
}

class OnboardingState {
  /** Whether the one-time New Mod completion explainer is open over Mod Details. */
  showNewModExplainer = $state(false);

  /**
   * Called right after a new mod finishes scaffolding, before routing to Mod
   * Details. Shows the completion explainer only the first time ever.
   */
  notifyNewModCreated() {
    if (!hasSeenNewModExplainer()) {
      this.showNewModExplainer = true;
      persistSeenNewModExplainer();
    }
  }

  /** Dismiss the explainer. Already marked seen when it was first shown. */
  dismissNewModExplainer() {
    this.showNewModExplainer = false;
  }

  /** "Learn more" from the explainer: dismiss it and open the Help panel. */
  learnMoreFromNewModExplainer() {
    this.dismissNewModExplainer();
    helpDialog.open();
  }
}

export const onboarding = new OnboardingState();
