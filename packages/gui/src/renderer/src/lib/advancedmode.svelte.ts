/**
 * Reactive store for "Advanced mode": a persisted, default-OFF flag that
 * reveals git power-user features.
 */

const STORAGE_KEY = "ebr-gui:advanced-mode";

/** Read the persisted preference, defaulting to off. Best-effort. */
function loadPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the preference. Best-effort. */
function savePreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage unavailable; the preference will not survive a restart.
  }
}

class AdvancedModeStore {
  enabled = $state(loadPreference());

  /** Set and persist the preference. */
  set(enabled: boolean): void {
    this.enabled = enabled;
    savePreference(enabled);
  }
}

export const advancedMode = new AdvancedModeStore();
