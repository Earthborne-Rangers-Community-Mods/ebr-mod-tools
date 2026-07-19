<script>
  import { onMount } from "svelte";
  import { navigation, ROUTES } from "./lib/navigation.svelte.js";
  import { openMods } from "./lib/mods.svelte.js";
  import { setupStore } from "./lib/setup.svelte.js";
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
  let startupReady = $state(false);

  onMount(async () => {
    openMods.init();
    // Send new creators to Setup if both forks aren't configured yet.
    await setupStore.init();
    if (!setupStore.completed && navigation.route === ROUTES.MY_MODS) {
      navigation.go(ROUTES.SETUP);
    }
    startupReady = true;
  });
</script>

<main class="content">
  {#if startupReady}
    <CurrentPage />
  {:else}
    <div class="startup-gate" aria-hidden="true"></div>
  {/if}
</main>

<style>
  .content {
    min-height: 100vh;
    padding: var(--spacing-xl);
    max-width: var(--max-width);
    margin: 0 auto;
  }

  .startup-gate {
    min-height: calc(100vh - (var(--spacing-xl) * 2));
    background-color: var(--color-bg);
  }
</style>
