<script>
  /**
   * Mid-campaign safety section: a bordered fieldset with the "safe to add"
   * Yes/No choice and, when applicable, the "why not safe" notes field.
   *
   * Renders nothing for types whose safety is fixed (see `showSafeChoice`); the
   * notes field appears only per `showSafeNotes`.
   *
   * @typedef {object} Props
   * @property {string} type - The mod type, which drives what is shown.
   * @property {boolean} safe - Bindable safe-to-add flag.
   * @property {string} notes - Bindable mid-campaign notes.
   * @property {boolean} [disabled] - Disable the controls.
   * @property {boolean} [wide] - Span all columns when placed in a grid layout.
   * @property {() => void} [onpersist] - Called when the choice changes or the
   *   notes field blurs, so an auto-saving page can persist. Omit for create-time
   *   forms that collect the value once.
   */
  import { tick } from "svelte";
  import { showSafeChoice, showSafeNotes } from "../lib/midcampaign.js";
  import * as m from "../lib/paraglide/messages.js";

  /** @type {Props} */
  let {
    type,
    safe = $bindable(false),
    notes = $bindable(""),
    disabled = false,
    wide = false,
    onpersist = undefined,
  } = $props();

  // Notify the caller to persist only after pending binding writes flush, so the
  // bound `safe`/`notes` have propagated to the parent before it reads them -
  // otherwise a change event could persist the previous value.
  async function notifyPersist() {
    await tick();
    onpersist?.();
  }
</script>

{#if showSafeChoice(type)}
  <fieldset class="group" class:wide {disabled}>
    <legend>{m.midcampaign_legend()}</legend>
    <label class="field">
      <span>{m.midcampaign_safe_label()}</span>
      <select bind:value={safe} onchange={notifyPersist}>
        <option value={true}>{m.midcampaign_safe_yes()}</option>
        <option value={false}>{m.midcampaign_safe_no()}</option>
      </select>
    </label>
    {#if showSafeNotes(type, safe)}
      <label class="field">
        <span>{m.midcampaign_notes_label()}</span>
        <textarea
          rows="2"
          bind:value={notes}
          onblur={notifyPersist}
          placeholder={m.midcampaign_notes_placeholder()}
        ></textarea>
      </label>
    {/if}
  </fieldset>
{/if}

<style>
  .group {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  /* Span all columns when dropped into a grid form. */
  .group.wide {
    grid-column: 1 / -1;
  }

  .group legend {
    font-weight: 600;
    padding: 0 var(--spacing-xs);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
</style>
