<script module>
  import ISO6391 from "iso-639-1";

  // Built once for the whole module (shared by every instance): the option list
  // is every ISO 639-1 language, sorted by label. Each label pairs the English
  // name with the native name when they differ, so speakers recognize their own
  // language at a glance.
  const LANGUAGES = ISO6391.getLanguages(ISO6391.getAllCodes())
    .map(({ code, name, nativeName }) => ({
      code,
      label: nativeName && nativeName !== name ? `${name} - ${nativeName}` : name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
</script>

<script>
  /**
   * Language picker field - a native select over the ISO 639-1 language set,
   * bound to a mod's `language` manifest field (a BCP 47 tag). Reusable across
   * forms that edit a mod's content language.
   *
   * The language list comes from the `iso-639-1` data package (offline, zero
   * network); the control itself is the platform's own select, so it stays
   * accessible and keyboard-friendly with no extra dependency. Values are the
   * base ISO 639-1 codes ("en", "fr", "pt"); region variants ("pt-BR") are not
   * offered here.
   */
  let { value = $bindable("en"), disabled = false, id = undefined } = $props();
</script>

<select bind:value {disabled} {id}>
  {#each LANGUAGES as language (language.code)}
    <option value={language.code}>{language.label}</option>
  {/each}
</select>
