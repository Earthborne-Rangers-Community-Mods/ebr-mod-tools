import { describe, it, expect } from "vitest";
import { addContentKinds } from "../src/renderer/src/lib/addcontent.js";

// Types that get only the template (scaffold) kind.
const TEMPLATE_ONLY_TYPES = ["campaign"];
// Types that get only the include-campaign kind.
const INCLUDE_ONLY_TYPES = ["enhancement", "one-day-mission", "collection"];
// Types with no add-content kind.
const EMPTY_TYPES = ["theme"];

describe("addContentKinds", () => {
  it.each(TEMPLATE_ONLY_TYPES)("returns ['template'] for '%s'", (type) => {
    expect(addContentKinds(type)).toEqual(["template"]);
  });

  it.each(INCLUDE_ONLY_TYPES)("returns ['include-campaign'] for '%s'", (type) => {
    expect(addContentKinds(type)).toEqual(["include-campaign"]);
  });

  it("returns both kinds, template first, for 'expansion'", () => {
    expect(addContentKinds("expansion")).toEqual(["template", "include-campaign"]);
  });

  it.each(EMPTY_TYPES)("returns [] for '%s'", (type) => {
    expect(addContentKinds(type)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(addContentKinds(undefined)).toEqual([]);
  });

  it("returns [] for an unrecognized type", () => {
    expect(addContentKinds("unknown-future-type")).toEqual([]);
  });
});
