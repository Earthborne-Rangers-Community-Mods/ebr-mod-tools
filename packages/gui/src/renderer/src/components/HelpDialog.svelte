<script lang="ts">
  /**
   * Modal for the Help panel, driven by the shared `helpDialog` store and
   * mounted once in the app shell.
   */
  import { helpDialog } from "../lib/helpdialog.svelte.js";
  import Modal from "./Modal.svelte";
  import HelpPanel from "./HelpPanel.svelte";
  import * as m from "../lib/paraglide/messages.js";
</script>

<Modal onCancel={() => helpDialog.close()} title={m.help_panel_title()} labelledby="help-panel-title" maxWidth="36rem">
  <HelpPanel />
  <div class="help-actions">
    <button type="button" class="primary" onclick={() => helpDialog.close()}>
      {m.help_panel_close()}
    </button>
  </div>
</Modal>

<style>
  .help-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--spacing-sm);
  }
</style>
