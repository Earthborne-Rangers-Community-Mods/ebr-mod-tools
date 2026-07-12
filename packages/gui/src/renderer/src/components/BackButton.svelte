<script>
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";

  let { to = ROUTES.MY_MODS, label = "Back to My Mods" } = $props();
</script>

<button type="button" class="link back" onclick={() => navigation.go(to)}>
  &larr; {label}
</button>

<style>
  .back {
    align-self: flex-start;
  }
</style>
