import { describe, it, expect } from "vitest";
import { addContentKinds } from "../src/renderer/src/lib/addcontent.js";

// Types that get the template (scaffold) kind today.
const TEMPLATE_TYPES = ["campaign", "expansion"];
// Types with no add-content kind wired in yet.
const EMPTY_TYPES = ["enhancement", "one-day-mission", "collection", "theme"];

describe("addContentKinds", () => {
  it.each(TEMPLATE_TYPES)("returns ['template'] for '%s'", (type) => {
    expect(addContentKinds(type)).toEqual(["template"]);
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
