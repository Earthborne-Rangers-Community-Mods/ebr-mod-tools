<script>
  import { MOD_TYPES, validateName } from "core";

  const nameProbe = validateName("Sample Mod");
  const coreConnected = nameProbe === true && MOD_TYPES.length > 0;
</script>

<main>
  <h1>EBR Mod Tools</h1>
  <p>Desktop app scaffold. Nothing to see here yet.</p>
  <p class="status" class:ok={coreConnected}>
    Core package: {coreConnected ? "loaded" : "unavailable"}
  </p>
  {#if coreConnected}
    <p class="detail">Mod types: {MOD_TYPES.map((t) => t.name).join(", ")}</p>
  {/if}
</main>

<style>
  main {
    font-family: system-ui, -apple-system, sans-serif;
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1.5rem;
    text-align: center;
  }

  h1 {
    font-weight: 700;
  }

  .status {
    font-size: 0.875rem;
    color: #888;
  }

  .status.ok {
    color: #2e7d32;
  }
</style>
