/**
 * Reactive store for the app color theme. The default is "system".
 */

import { getThemePreference, sendThemePreference } from "./platform.js";

export type ThemePreference = "system" | "light" | "dark";

/**
 * Reflect a preference onto the document. "system" removes the data-theme
 * attribute so the CSS prefers-color-scheme fallback applies; "light" and
 * "dark" pin the theme explicitly.
 */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

class ThemeStore {
  preference = $state<ThemePreference>("system");

  /** Load the stored preference and apply it. Call once before the app mounts.
   *  Idempotent - re-reading and re-applying is safe. */
  init(): void {
    this.preference = getThemePreference();
    applyPreference(this.preference);
  }

  /** Apply a new preference and persist it. */
  set(preference: ThemePreference): void {
    this.preference = preference;
    applyPreference(preference);
    sendThemePreference(preference);
  }
}

export const themeStore = new ThemeStore();
