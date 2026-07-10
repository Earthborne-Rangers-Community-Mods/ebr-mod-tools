import { describe, it, expect } from "vitest";
import {
  KNOWN_SCAFFOLDS,
  OFFICIAL_CAMPAIGNS,
  OFFICIAL_PRODUCTS,
  MOD_TYPES,
} from "../src/catalogs.js";

// --- KNOWN_SCAFFOLDS structural integrity ---

describe("KNOWN_SCAFFOLDS", () => {
  it("every entry has a branch string and a name string", () => {
    for (const entry of KNOWN_SCAFFOLDS) {
      expect(typeof entry.branch).toBe("string");
      expect(entry.branch.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("all map/* entries have a product field", () => {
    const mapEntries = KNOWN_SCAFFOLDS.filter(s => s.branch.startsWith("map/"));
    expect(mapEntries.length).toBeGreaterThan(0);
    for (const entry of mapEntries) {
      expect(entry.product).toBeTruthy();
    }
  });

  it("set/custom-campaign has no product (utility scaffold)", () => {
    const entry = KNOWN_SCAFFOLDS.find(s => s.branch === "set/custom-campaign");
    expect(entry).toBeDefined();
    expect(entry.product).toBeUndefined();
  });

  it("set/custom-one-day-mission has no product (utility scaffold)", () => {
    const entry = KNOWN_SCAFFOLDS.find(s => s.branch === "set/custom-one-day-mission");
    expect(entry).toBeDefined();
    expect(entry.product).toBeUndefined();
  });

  it("non-utility set/* entries all have a product field", () => {
    const UTILITY = ["set/custom-campaign", "set/custom-one-day-mission"];
    const setEntries = KNOWN_SCAFFOLDS.filter(
      s => s.branch.startsWith("set/") && !UTILITY.includes(s.branch),
    );
    expect(setEntries.length).toBeGreaterThan(0);
    for (const entry of setEntries) {
      expect(entry.product).toBeTruthy();
    }
  });

  it("all products in KNOWN_SCAFFOLDS are valid OFFICIAL_PRODUCTS ids", () => {
    const validIds = new Set(OFFICIAL_PRODUCTS.map(p => p.id));
    for (const entry of KNOWN_SCAFFOLDS) {
      if (entry.product !== undefined) {
        expect(validIds.has(entry.product), `Unknown product '${entry.product}' on branch '${entry.branch}'`).toBe(true);
      }
    }
  });

  // --- Map scaffold filter (simulates MAP_SCAFFOLD_CHOICES in commands/new.js) ---

  describe("map scaffold filter (MAP_SCAFFOLD_CHOICES shape)", () => {
    const mapEntries = KNOWN_SCAFFOLDS.filter(s => s.branch.startsWith("map/"));

    it("includes known map branches", () => {
      const branches = mapEntries.map(s => s.branch);
      expect(branches).toContain("map/lure-of-the-valley");
      expect(branches).toContain("map/spire-in-bloom");
      expect(branches).toContain("map/shadow-of-the-storm");
    });

    it("every map entry has a product that is a valid OFFICIAL_PRODUCTS id", () => {
      const validIds = new Set(OFFICIAL_PRODUCTS.map(p => p.id));
      for (const entry of mapEntries) {
        expect(validIds.has(entry.product), `Unknown product '${entry.product}' on '${entry.branch}'`).toBe(true);
      }
    });
  });

  // --- Path set scaffold filter (simulates PATH_SET_SCAFFOLD_CHOICES in commands/new.js) ---

  describe("path set scaffold filter (PATH_SET_SCAFFOLD_CHOICES shape)", () => {
    const UTILITY_SET_BRANCHES = ["set/custom-campaign", "set/custom-one-day-mission"];
    const setEntries = KNOWN_SCAFFOLDS.filter(
      s => s.branch.startsWith("set/") && !UTILITY_SET_BRANCHES.includes(s.branch),
    );

    it("excludes utility scaffolds set/custom-campaign and set/custom-one-day-mission", () => {
      const branches = setEntries.map(s => s.branch);
      expect(branches).not.toContain("set/custom-campaign");
      expect(branches).not.toContain("set/custom-one-day-mission");
    });

    it("includes known path-set branches", () => {
      const branches = setEntries.map(s => s.branch);
      expect(branches).toContain("set/the-valley");
    });

    it("every path-set entry has a product that is a valid OFFICIAL_PRODUCTS id", () => {
      const validIds = new Set(OFFICIAL_PRODUCTS.map(p => p.id));
      for (const entry of setEntries) {
        expect(validIds.has(entry.product), `Unknown product '${entry.product}' on '${entry.branch}'`).toBe(true);
      }
    });
  });

});

// --- OFFICIAL_CAMPAIGNS catalog integrity ---

describe("OFFICIAL_CAMPAIGNS", () => {
  it("all requiredProducts reference valid OFFICIAL_PRODUCTS ids", () => {
    const validIds = new Set(OFFICIAL_PRODUCTS.map(p => p.id));
    for (const campaign of OFFICIAL_CAMPAIGNS) {
      for (const product of campaign.requiredProducts) {
        expect(validIds.has(product), `Campaign '${campaign.id}' references unknown product '${product}'`).toBe(true);
      }
    }
  });

  it("CAMPAIGN_CHOICES filter (non-ODM): expected campaign ids are present", () => {
    // Simulates the CAMPAIGN_CHOICES constant in commands/new.js
    const nonOdm = OFFICIAL_CAMPAIGNS.filter(c => !c.oneDayMission).map(c => c.id);
    expect(nonOdm).toContain("lure-of-the-valley");
    expect(nonOdm).toContain("legacy-of-the-ancestors");
    expect(nonOdm).toContain("spire-in-bloom");
    expect(nonOdm).toContain("shadow-of-the-storm");
  });

  it("CAMPAIGN_CHOICES filter (non-ODM): no entry with oneDayMission passes", () => {
    const nonOdm = OFFICIAL_CAMPAIGNS.filter(c => !c.oneDayMission);
    for (const c of nonOdm) {
      expect(c.oneDayMission).toBeFalsy();
    }
  });

  it("ALL_CAMPAIGN_CHOICES includes at least one one-day mission", () => {
    const odms = OFFICIAL_CAMPAIGNS.filter(c => c.oneDayMission);
    expect(odms.length).toBeGreaterThan(0);
  });

  it("lure-of-the-valley requires only core-set (ODM pre-check default)", () => {
    // one-day-mission type pre-checks lure-of-the-valley; verify it does not
    // unexpectedly drag in other products.
    const lotv = OFFICIAL_CAMPAIGNS.find(c => c.id === "lure-of-the-valley");
    expect(lotv).toBeDefined();
    expect(lotv.requiredProducts).toEqual(["core-set"]);
  });
});

// --- MOD_TYPES catalog integrity ---

describe("MOD_TYPES", () => {
  it("contains all type ids required for the type-aware flow", () => {
    const ids = MOD_TYPES.map(t => t.id);
    expect(ids).toContain("campaign");
    expect(ids).toContain("expansion");
    expect(ids).toContain("enhancement");
    expect(ids).toContain("one-day-mission");
    expect(ids).toContain("collection");
    expect(ids).toContain("theme");
  });

  it("every entry has id, name, and description", () => {
    for (const t of MOD_TYPES) {
      expect(typeof t.id).toBe("string");
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
