<script>
  import { navigation, ROUTES } from "./lib/navigation.svelte.js";
  import MyMods from "./pages/MyMods.svelte";
  import Setup from "./pages/Setup.svelte";
  import NewMod from "./pages/NewMod.svelte";
  import ModDetails from "./pages/ModDetails.svelte";
  import ConflictResolution from "./pages/ConflictResolution.svelte";

  const PAGES = {
    [ROUTES.MY_MODS]: MyMods,
    [ROUTES.SETUP]: Setup,
    [ROUTES.NEW_MOD]: NewMod,
    [ROUTES.MOD_DETAILS]: ModDetails,
    [ROUTES.CONFLICT]: ConflictResolution,
  };

  const CurrentPage = $derived(PAGES[navigation.route] ?? MyMods);
</script>

<main class="content">
  <CurrentPage />
</main>

<style>
  .content {
    min-height: 100vh;
    padding: var(--spacing-xl);
    max-width: var(--max-width);
    margin: 0 auto;
  }
</style>
