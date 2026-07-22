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
  route = $state(ROUTES.MY_MODS);
  selectedModId = $state(null);

  go(route, { modId = null } = {}) {
    this.route = route;
    this.selectedModId = modId;
  }
}

export const navigation = new Navigation();
