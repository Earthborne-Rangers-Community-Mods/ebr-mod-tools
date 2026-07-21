import { describe, it, expect } from "vitest";
import { showSafeChoice, showSafeNotes, fixedSafety } from "../src/renderer/src/lib/midcampaign.js";

// Types whose safe value is fixed by the type - no dropdown offered.
const FIXED_TYPES = ["campaign", "one-day-mission", "theme"];
// Types where the creator chooses the safe value (and so get the notes field
// when they mark the mod not safe).
const CHOOSABLE_TYPES = ["enhancement", "expansion", "collection"];

describe("fixedSafety", () => {
  it("is false for campaign (never safe mid-campaign)", () => {
    expect(fixedSafety("campaign")).toBe(false);
  });

  it.each(["theme", "one-day-mission"])("is true for always-safe type '%s'", (type) => {
    expect(fixedSafety(type)).toBe(true);
  });

  it.each(CHOOSABLE_TYPES)("is null for choosable type '%s'", (type) => {
    expect(fixedSafety(type)).toBe(null);
  });
});

describe("showSafeChoice", () => {
  it.each(FIXED_TYPES)("returns false for fixed-safety type '%s'", (type) => {
    expect(showSafeChoice(type)).toBe(false);
  });

  it.each(CHOOSABLE_TYPES)("returns true for choosable type '%s'", (type) => {
    expect(showSafeChoice(type)).toBe(true);
  });
});

describe("showSafeNotes", () => {
  it.each(CHOOSABLE_TYPES)("returns true for choosable type '%s' when not safe", (type) => {
    expect(showSafeNotes(type, false)).toBe(true);
  });

  it.each(CHOOSABLE_TYPES)("returns false for choosable type '%s' when safe", (type) => {
    expect(showSafeNotes(type, true)).toBe(false);
  });

  it.each(FIXED_TYPES)("returns false for fixed-safety type '%s' regardless of safe flag", (type) => {
    expect(showSafeNotes(type, false)).toBe(false);
  });
});
