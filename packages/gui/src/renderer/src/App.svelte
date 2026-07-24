<script lang="ts">
  import { onMount } from "svelte";
  import { navigation, ROUTES } from "./lib/navigation.svelte.js";
  import { openMods } from "./lib/mods.svelte.js";
  import { setupStore } from "./lib/setup.svelte.js";
  import { modDetailsForm } from "./lib/moddetails.svelte.js";
  import { sendDirty, onConfirmClose, confirmAppClose } from "./lib/platform.js";
  import MyMods from "./pages/MyMods.svelte";
  import Setup from "./pages/Setup.svelte";
  import NewMod from "./pages/NewMod.svelte";
  import ModDetails from "./pages/ModDetails.svelte";
  import ModEdit from "./pages/ModEdit.svelte";
  import ConflictResolution from "./pages/ConflictResolution.svelte";
  import UnsavedChangesDialog from "./components/UnsavedChangesDialog.svelte";
  import { pick } from "./lib/pick.js";

  const PAGES = {
    [ROUTES.MY_MODS]: MyMods,
    [ROUTES.SETUP]: Setup,
    [ROUTES.NEW_MOD]: NewMod,
    [ROUTES.MOD_DETAILS]: ModDetails,
    [ROUTES.MOD_EDIT]: ModEdit,
    [ROUTES.CONFLICT]: ConflictResolution,
  };

  const CurrentPage = $derived(pick(PAGES, navigation.route) ?? MyMods);
  let startupReady = $state(false);
  let showCloseDialog = $state(false);

  onMount(async () => {
    openMods.init();
    // Send new creators to Setup if both forks aren't configured yet.
    await setupStore.init();
    if (!setupStore.completed && navigation.route === ROUTES.MY_MODS) {
      navigation.go(ROUTES.SETUP);
    }
    startupReady = true;
  });

  // Keep the main process informed of unsaved edits so it can guard the close.
  $effect(() => {
    sendDirty(modDetailsForm.dirty);
  });

  // The main process asks to confirm before closing while edits are unsaved.
  $effect(() => {
    return onConfirmClose(() => {
      if (modDetailsForm.dirty) showCloseDialog = true;
      else confirmAppClose();
    });
  });

  async function closeSave() {
    await modDetailsForm.save();
    showCloseDialog = false;
    // If the save was blocked by validation the form stays dirty; leave the app
    // open so the user can fix the highlighted fields.
    if (!modDetailsForm.dirty) confirmAppClose();
  }

  function closeDiscard() {
    showCloseDialog = false;
    modDetailsForm.revert();
    confirmAppClose();
  }

  function closeCancel() {
    showCloseDialog = false;
  }
</script>

<main class="content">
  {#if startupReady}
    <CurrentPage />
  {:else}
    <div class="startup-gate" aria-hidden="true"></div>
  {/if}
</main>

{#if showCloseDialog}
  <UnsavedChangesDialog onSave={closeSave} onDiscard={closeDiscard} onCancel={closeCancel} />
{/if}

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
