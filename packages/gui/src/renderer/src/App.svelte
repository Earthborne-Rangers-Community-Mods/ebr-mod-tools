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
  :global(:root) {
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;
    --radius: 8px;

    --surface: #ffffff;
    --surface-alt: #f5f2ec;
    --border: #e0d9cf;
    --text: #2b2620;
    --text-secondary: #6f665a;

    --accent: #d98a2b;
    --accent-strong: #a5601a;
    --accent-soft: #f7e6cf;
    --success-strong: #2e7d32;
    --success-soft: #dcefdc;
    --danger-strong: #b23b3b;
    --danger-soft: #f5dede;
  }

  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--text);
    background: var(--surface-alt);
  }

  :global(button) {
    font: inherit;
  }

  :global(input, textarea, select) {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: inherit;
  }

  :global(.primary),
  :global(.secondary),
  :global(.ghost),
  :global(.danger) {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    background: var(--surface);
    color: inherit;
  }

  :global(.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  :global(.secondary) {
    background: var(--surface);
  }

  :global(.ghost) {
    background: transparent;
    border-color: transparent;
    color: var(--text-secondary);
  }

  :global(.link) {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent-strong);
    cursor: pointer;
    font: inherit;
  }

  :global(.muted) {
    color: var(--text-secondary);
  }

  :global(h1) {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
  }

  :global(code) {
    font-family: ui-monospace, monospace;
    background: var(--surface-alt);
    padding: 1px 4px;
    border-radius: 4px;
  }

  .content {
    min-height: 100vh;
    padding: var(--space-xl);
    max-width: 60rem;
    margin: 0 auto;
  }
</style>
