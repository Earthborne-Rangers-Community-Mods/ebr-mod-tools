<script lang="ts">
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import * as m from "../lib/paraglide/messages.js";

  // `onclick`, when provided, overrides the default navigation.
  // Used to guard a dirty form before leaving.
  let { to = ROUTES.MY_MODS, label = m.nav_back_to_mods(), onclick = undefined } = $props();

  function handleClick() {
    if (onclick) onclick();
    else navigation.go(to);
  }
</script>

<button type="button" class="link back" onclick={handleClick}>
  &larr; {label}
</button>

<style>
  .back {
    align-self: flex-start;
  }
</style>
