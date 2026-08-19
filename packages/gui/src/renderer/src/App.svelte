<script lang="ts">
  import { onMount } from "svelte";
  import { navigation, ROUTES } from "./lib/navigation.svelte.js";
  import { openMods } from "./lib/mods.svelte.js";
  import { setupStore } from "./lib/setup.svelte.js";
  import { modDetailsForm } from "./lib/moddetails.svelte.js";
  import { sendCloseGuard, onConfirmClose, confirmAppClose } from "./lib/platform.js";
  import MyMods from "./pages/MyMods.svelte";
  import Setup from "./pages/Setup.svelte";
  import NewMod from "./pages/NewMod.svelte";
  import ModDetails from "./pages/ModDetails.svelte";
  import ModEdit from "./pages/ModEdit.svelte";
  import ConflictResolution from "./pages/ConflictResolution.svelte";
  import UnsavedChangesDialog from "./components/UnsavedChangesDialog.svelte";
  import OperationInProgressDialog from "./components/OperationInProgressDialog.svelte";
  import SaveDialog from "./components/SaveDialog.svelte";
  import PublishDialog from "./components/PublishDialog.svelte";
  import AddContentDialog from "./components/AddContentDialog.svelte";
  import UpdateDialog from "./components/UpdateDialog.svelte";
  import OpenModDialog from "./components/OpenModDialog.svelte";
  import { saveFlow } from "./lib/save.svelte.js";
  import { publishFlow } from "./lib/publish.svelte.js";
  import { addContentFlow } from "./lib/addcontent.svelte.js";
  import { updateFlow } from "./lib/update.svelte.js";
  import { conflictFlow } from "./lib/conflict.svelte.js";
  import { openModFlow } from "./lib/openmod.svelte.js";
  import { helpDialog } from "./lib/helpdialog.svelte.js";
  import { pick } from "./lib/pick.js";
  import HelpDialog from "./components/HelpDialog.svelte";

  const PAGES = {
    [ROUTES.MY_MODS]: MyMods,
    [ROUTES.SETUP]: Setup,
    [ROUTES.NEW_MOD]: NewMod,
    [ROUTES.MOD_DETAILS]: ModDetails,
    [ROUTES.MOD_EDIT]: ModEdit,
    [ROUTES.CONFLICT]: ConflictResolution,
  };

  const CurrentPage = $derived(pick(PAGES, navigation.route) ?? MyMods);
  // True while any flow is mid-operation; blocks app close so a commit/push/stamp
  // is never interrupted by the window closing.
  const anyFlowBusy = $derived(
    saveFlow.busy || publishFlow.busy || addContentFlow.busy || updateFlow.busy || conflictFlow.busy || openModFlow.busy,
  );
  let startupReady = $state(false);
  let showCloseDialog = $state(false);
  let showBusyClose = $state(false);

  onMount(async () => {
    openMods.init();
    // Send new creators to Setup if both forks aren't configured yet.
    await setupStore.init();
    if (!setupStore.completed && navigation.route === ROUTES.MY_MODS) {
      navigation.go(ROUTES.SETUP);
    }
    startupReady = true;
  });

  // Keep the main process informed whether close should be guarded - either
  // unsaved edits or an operation in progress.
  $effect(() => {
    sendCloseGuard(modDetailsForm.dirty || anyFlowBusy);
  });

  // The main process asks to confirm before closing while the guard is active. An
  // in-progress operation cannot be cancelled, so it takes priority.
  $effect(() => {
    return onConfirmClose(() => {
      if (anyFlowBusy) showBusyClose = true;
      else if (modDetailsForm.dirty) showCloseDialog = true;
      else confirmAppClose();
    });
  });

  // Once the operation finishes, drop the wait notice so the user can close.
  $effect(() => {
    if (showBusyClose && !anyFlowBusy) showBusyClose = false;
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

{#if showBusyClose}
  <OperationInProgressDialog onDismiss={() => (showBusyClose = false)} />
{/if}

{#if saveFlow.isOpen}
  <SaveDialog />
{/if}

{#if publishFlow.isOpen}
  <PublishDialog />
{/if}

{#if addContentFlow.isOpen}
  <AddContentDialog />
{/if}

{#if updateFlow.isOpen}
  <UpdateDialog />
{/if}

{#if openModFlow.isOpen}
  <OpenModDialog />
{/if}

{#if helpDialog.isOpen}
  <HelpDialog />
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
