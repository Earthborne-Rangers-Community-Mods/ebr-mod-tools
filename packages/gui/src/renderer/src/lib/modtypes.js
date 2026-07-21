/**
 * Localized mod-type name/description lookups for the GUI.
 *
 * The six mod types are canonical in core's `MOD_TYPES` (id + English name +
 * description); their localized strings are `mod_type_<id>_name` /
 * `mod_type_<id>_desc` paraglide messages (hyphens in the id become underscores,
 * matching paraglide's generated function names). Rather than hand-maintain an
 * id -> message map per page (which drifts and can silently miss a type), both
 * helpers derive the message key from the id and look it up on the message
 * namespace, with a single fallback to core's English catalog value and then the
 * raw id. There is no map to keep in sync, so a new mod type needs only its
 * `mod_type_*` strings in `messages/en.json` - and a test asserts that catalog
 * carries a name and description for every core `MOD_TYPES` id.
 */
import { MOD_TYPES } from "core";
import * as m from "./paraglide/messages.js";

/**
 * Paraglide message key for a mod type, matching the generated function names
 * (id hyphens -> underscores).
 * @param {string} id
 * @param {"name"|"desc"} suffix
 * @returns {string}
 */
function messageKey(id, suffix) {
  return `mod_type_${id.replace(/-/g, "_")}_${suffix}`;
}

/**
 * Localized display name for a mod type id.
 * @param {string} id
 * @returns {string}
 */
export function typeName(id) {
  return m[messageKey(id, "name")]?.() ?? MOD_TYPES.find((t) => t.id === id)?.name ?? id;
}

/**
 * Localized one-line description for a mod type id.
 * @param {string} id
 * @returns {string}
 */
export function typeDesc(id) {
  return m[messageKey(id, "desc")]?.() ?? MOD_TYPES.find((t) => t.id === id)?.description ?? id;
}
