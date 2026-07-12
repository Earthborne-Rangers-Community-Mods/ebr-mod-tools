/**
 * Placeholder data for the nonfunctional page blockouts.
 */

/** Stand-in for the active GitHub account and author defaults (see `ebr setup`). */
export const PLACEHOLDER_ACCOUNT = Object.freeze({
  login: "modcreator",
  author: "ModCreatorName",
  authorDiscord: "modcreator#1234",
  baseContentFork: "https://github.com/modcreator/ebr-mod-base-content",
  registryFork: "https://github.com/modcreator/ebr-mod-registry",
  credentialsOk: true,
  forksReady: true,
});

/** Stand-in mods for the My Mods list and Mod Details view. */
export const PLACEHOLDER_MODS = Object.freeze([
  {
    schemaVersion: 1,
    id: "expanded-boulder-field",
    name: "Expanded Boulder Field",
    version: "1.2.0",
    type: "enhancement",
    description: "Adds 3 new missions and an NPC to Boulder Field.",
    author: "ModCreatorName",
    authorDiscord: "modcreator#1234",
    tags: ["boulder-field", "npc", "encounters"],
    campaigns: ["lure-of-the-valley"],
    requiredProducts: ["core-set", "legacy-of-the-ancestors"],
    optionalProducts: [],
    safeToAddMidCampaign: true,
    midCampaignNotes: "Safe before day 10.",
    icon: "\uD83C\uDFD4\uFE0F",
    language: "en",
    repoUrl: "https://github.com/modcreator/ebr-mod-base-content",
    dir: "C:/Mods/expanded-boulder-field",
    branch: "mod/expanded-boulder-field",
    dirty: true,
    publishedVersion: "1.1.0",
    prUrl: null,
  },
  {
    schemaVersion: 1,
    id: "meadow-nights",
    name: "Meadow Nights",
    version: "0.9.0",
    type: "campaign",
    description: "Adds a nighttime story arc for the Harvest Festival.",
    author: "ModCreatorName",
    authorDiscord: "modcreator#1234",
    tags: ["meadow", "story"],
    campaigns: ["lure-of-the-valley"],
    requiredProducts: ["core-set"],
    optionalProducts: ["stewards-of-the-valley"],
    safeToAddMidCampaign: false,
    midCampaignNotes: "Best installed before starting a new campaign.",
    icon: "\uD83C\uDF19",
    language: "en",
    repoUrl: "https://github.com/modcreator/ebr-mod-base-content",
    dir: "C:/Mods/meadow-nights",
    branch: "mod/meadow-nights",
    dirty: false,
    publishedVersion: "0.9.0",
    prUrl: "https://github.com/ebr/ebr-mod-registry/pull/42",
  },
]);

export function findPlaceholderMod(id) {
  return PLACEHOLDER_MODS.find((mod) => mod.id === id) ?? null;
}
