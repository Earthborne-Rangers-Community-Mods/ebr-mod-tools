<script lang="ts">
  /**
   * Presentational checkbox-group control: a bordered fieldset with a legend and
   * a responsive grid of labelled checkboxes.
   *
   * Callers pass the item list plus small accessor functions rather than a fixed
   * item shape. Disabling the fieldset natively disables every checkbox inside it.
   */
  interface Props {
    /** Group heading. */
    legend: string;
    /** Rows to render. */
    items: readonly any[];
    /** Stable key for the {#each} block. */
    key: (item: any) => string;
    /** Visible label text for a row. */
    label: (item: any) => string;
    /** Whether a row is selected. */
    checked: (item: any) => boolean;
    /** Called when a row is toggled. */
    onToggle: (item: any) => void;
    /** Disable every checkbox. */
    disabled?: boolean;
    /** Span all columns when placed in a grid layout. */
    wide?: boolean;
  }
  let { legend, items, key, label, checked, onToggle, disabled = false, wide = false }: Props = $props();
</script>

<fieldset class="check-group" class:wide {disabled}>
  <legend>{legend}</legend>
  <div class="checks">
    {#each items as item (key(item))}
      <label class="check">
        <input type="checkbox" checked={checked(item)} onchange={() => onToggle(item)} />
        <span>{label(item)}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .check-group {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--spacing-sm) var(--spacing-md);
    min-width: 0;
  }

  /* Span all columns when dropped into a grid form (e.g. the New Mod page). */
  .check-group.wide {
    grid-column: 1 / -1;
  }

  .check-group legend {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .checks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--spacing-xs) var(--spacing-md);
    margin-top: var(--spacing-xs);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: 0.9rem;
  }
</style>
