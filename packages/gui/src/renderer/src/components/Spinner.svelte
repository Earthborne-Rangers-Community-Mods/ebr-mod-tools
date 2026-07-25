<script lang="ts">
  /**
   * Small reusable loading spinner. Decorative by default; pass `label` to expose
   * it as an accessible status (and tooltip). `size` accepts any CSS length.
   */
  interface Props {
    /** Accessible status label + tooltip. Omit for a purely decorative spinner. */
    label?: string;
    /** Diameter (any CSS length). Defaults to 1rem. */
    size?: string;
  }
  let { label, size = "1rem" }: Props = $props();
</script>

<span
  class="spinner"
  style={`--spinner-size: ${size}`}
  role={label ? "status" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  title={label}
></span>

<style>
  .spinner {
    display: inline-block;
    width: var(--spinner-size, 1rem);
    height: var(--spinner-size, 1rem);
    flex-shrink: 0;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spinner-rotate 0.6s linear infinite;
  }

  @keyframes spinner-rotate {
    to {
      transform: rotate(360deg);
    }
  }
</style>
