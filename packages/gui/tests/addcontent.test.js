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

  it("does not add include-mod by default (Advanced mode off)", () => {
    expect(addContentKinds("enhancement")).toEqual(["include-campaign"]);
  });

  it.each(["enhancement", "one-day-mission", "collection"])(
    "adds include-mod after include-campaign for '%s' when Advanced mode is on",
    (type) => {
      expect(addContentKinds(type, true)).toEqual(["include-campaign", "include-mod"]);
    },
  );

  it("adds include-mod after include-campaign for 'expansion' when Advanced mode is on", () => {
    expect(addContentKinds("expansion", true)).toEqual(["template", "include-campaign", "include-mod"]);
  });

  it("does not add include-mod for types that lack include-campaign, even with Advanced mode on", () => {
    expect(addContentKinds("campaign", true)).toEqual(["template"]);
    expect(addContentKinds("theme", true)).toEqual([]);
  });
});
