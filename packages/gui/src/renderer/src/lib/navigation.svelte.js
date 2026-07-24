/**
 * In-memory navigation state for the GUI shell. Selecting a route swaps the page
 * shown in the main area; the route and selected mod live in memory.
 */

export const ROUTES = Object.freeze({
  MY_MODS: "my-mods",
  SETUP: "setup",
  NEW_MOD: "new-mod",
  MOD_DETAILS: "mod-details",
  MOD_EDIT: "mod-edit",
  CONFLICT: "conflict",
});

class Navigation {
  route = $state(/** @type {string} */ (ROUTES.MY_MODS));
  selectedModId = $state(/** @type {string|null} */ (null));

  /**
   * @param {string} route
   * @param {{ modId?: string|null }} [options]
   */
  go(route, { modId = null } = {}) {
    this.route = route;
    this.selectedModId = modId;
  }
}

export const navigation = new Navigation();
