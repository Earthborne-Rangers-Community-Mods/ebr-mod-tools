import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MOD_TYPES } from "core";

// The GUI localizes every mod type via `mod_type_<id>_name` / `_desc` paraglide
// messages, sourced from this committed catalog. `lib/modtypes.js` binds those
// messages to ids in one place; this test guards the underlying invariant that
// the catalog covers every core mod type, so adding a type to core without its
// GUI strings fails here rather than silently falling back to English at
// runtime. Reads the JSON directly (not the build-only paraglide output) so it
// holds on a fresh checkout with no prior build.
const here = dirname(fileURLToPath(import.meta.url));
const messages = JSON.parse(readFileSync(join(here, "../messages/en.json"), "utf-8"));

describe("mod type localization coverage", () => {
  it("has a name and description message for every core mod type", () => {
    for (const { id } of MOD_TYPES) {
      const key = id.replace(/-/g, "_");
      expect(messages, `missing mod_type_${key}_name`).toHaveProperty(`mod_type_${key}_name`);
      expect(messages, `missing mod_type_${key}_desc`).toHaveProperty(`mod_type_${key}_desc`);
    }
  });
});
