# Mod Manifest: `ebr-mod.json`

Every mod repo has an `ebr-mod.json` file at its root. This file describes the mod - its name, type, what it targets, and how it should be displayed in the mod manager. The `ebr new` command creates this file for you, and `ebr publish` reads it to populate the registry.

## Example

```json
{
  "schemaVersion": 1,
  "name": "Expanded Boulder Field",
  "id": "expanded-boulder-field",
  "version": "1.2.0",
  "type": "enhancement",
  "description": "Adds 3 new encounters and an NPC to Boulder Field.",
  "author": "ModCreatorName",
  "authorDiscord": "modcreator#1234",
  "tags": ["npc", "location"],
  "campaigns": ["lure-of-the-valley"],
  "requiredProducts": ["core-set"],
  "optionalProducts": [],
  "safeToAddMidCampaign": true,
  "midCampaignNotes": "Safe before day 15. After day 15, you'll miss conent.",
  "coverImage": "cover.png",
  "icon": "🏔️",
  "language": "en",
  "repoUrl": "https://github.com/creator/ebr-mod-base-content"
}
```

## Required Fields

### `schemaVersion`

Integer identifying the manifest schema version. Used by tools to handle forward-compatible parsing.

### `name`

Human-readable mod name. This is what players see in the registry browser.

### `id`

Unique kebab-case identifier (lowercase letters, numbers, and hyphens). Must not start or end with a hyphen. This ID is used everywhere - in the registry, in `includedMods` references, and as a CLI argument for `ebr include`.

**Valid:** `expanded-boulder-field`, `hard-mode`, `mymod`, `mod-v2`
**Invalid:** `Expanded-Boulder-Field`, `my mod`, `-leading-hyphen`, `trailing-hyphen-`

### `version`

Semver version string (e.g., `"1.0.0"`, `"2.10.3"`). Bumped each time you publish an update. The `ebr save` command can auto-increment this for you, or you can set an explicit version with `--version`.

### `type`

The kind of mod. Determines how it's categorized in the registry browser.

| Type | Description |
|---|---|
| `campaign` | An entire custom campaign built from scratch. Does not modify the base campaign. |
| `enhancement` | Focused modifications to existing campaign content. Examples include dialog improvements, balance tweaks, QoL fixes, mechanical changes, unofficial errata, or targeted content additions. |
| `one-day-mission` | A single-session mission designed to be played in one sitting. |
| `expansion` | New content that significantly extends a campaign. Examples include additional areas, story arcs, encounters, or gameplay systems. |
| `collection` | Multiple mods merged together into a single experience. The creator has resolved all conflicts by hand. Requires `includedMods`. |
| `theme` | CSS-only mod that reskins the Obsidian play experience. No content changes. |

### `description`

Short description (1-2 sentences) shown in the mod list when browsing the registry.

### `author`

Display name of the creator.

### `campaigns`

Array of campaign identifiers this mod targets.

A mod can target multiple campaigns - for example, a mod that bridges content between two campaigns might use `["lure-of-the-valley", "legacy-of-the-ancestors"]`.

**Known campaigns:** `"lure-of-the-valley"`, `"legacy-of-the-ancestors"`, `"spire-in-bloom"`, `"shadow-of-the-storm"`

**Known one-day missions** (treated as campaigns): `"animal-rescue"`, `"missing-person"`, `"predatory-instincts"`, `"incandescent-sky"`

The canonical list lives in [`src/core/catalogs.js`](../src/core/catalogs.js). Custom campaign mods define their own new identifier.

**Special cases:**
- `theme` type: use `["any"]`
- `campaign` type: use the new campaign's own identifier

### `requiredProducts`

Array of product identifiers the player **must own** to play this mod. This can't be inferred from `campaigns` alone - a mod targeting Lure of the Valley might also require cards from an expansion pack.

**Known product IDs:**
- `"core-set"` - Contains Lure of the Valley campaign and official one-day missions
- `"legacy-of-the-ancestors"`
- `"spire-in-bloom"`
- `"shadow-of-the-storm"`
- `"moments-in-the-valley"`
- `"stewards-of-the-valley"`
- `"moments-on-the-path"`
- `"ranger-card-doubler"`
- `"incandescent-sky"`

The canonical list lives in [`src/core/catalogs.js`](../src/core/catalogs.js).

### `safeToAddMidCampaign`

Boolean. Can players install this mod while a campaign is already in progress?

### `language`

BCP 47 language code for the mod's narrative text (e.g., `"en"`, `"es"`, `"fr"`, `"de"`, `"ja"`, `"zh-Hans"`, `"pt-BR"`). This is validated - it must be a structurally valid language tag.

This is the language of the mod's content, not the app UI. Displayed on the mod detail page and used for filtering in the registry.

### `repoUrl`

GitHub URL of the creator's fork of `ebr-mod-base-content` (e.g., `"https://github.com/creator/ebr-mod-base-content"`). Must start with `https://github.com/`. All mods by the same author share the same `repoUrl` - the `commitHash` in the registry identifies the specific mod version. Auto-detected by `ebr save` from the `origin` remote.

## Optional Fields

### `authorDiscord`

Creator's Discord handle (e.g., `"modcreator#1234"` or just `"modcreator"`). Displayed on the mod detail page for community contact.

### `tags`

Array of lowercase kebab-case tags for search and filtering (e.g., `["boulder-field", "npc", "combat"]`).

### `optionalProducts`

Array of product identifiers that **enhance** the experience but aren't required. For example, a mod that references cards from an expansion but provides workarounds if you don't have them. Displayed as "Enhanced by" on the mod detail page.

### `includedMods`

Array of objects listing the mods this one is built from. **Required for `collection` type** (must be non-empty). Optional for all other types - any mod can declare lineage.

Each entry must have these fields:

| Field | Description |
|---|---|
| `id` | The included mod's kebab-case ID |
| `name` | Human-readable name |
| `author` | The original creator |
| `version` | The version that was merged in |
| `repoUrl` | GitHub URL of the original mod's repo |

**Example:**

```json
"includedMods": [
  {
    "id": "expanded-boulder-field",
    "name": "Expanded Boulder Field",
    "author": "ModCreatorName",
    "version": "1.2.0",
    "repoUrl": "https://github.com/creator/ebr-mod-base-content"
  }
]
```

The `ebr include` command automatically adds or updates entries here after a successful merge.

### `midCampaignNotes`

Human-readable guidance on when it's safe or unsafe to add this mod mid-campaign. Only useful when `safeToAddMidCampaign` is `true` with caveats (e.g., "Safe as long as rangers haven't reached day 15.").

### `coverImage`

Relative path to a cover image in the repo (e.g., `"cover.png"`). Displayed in the registry browser. Recommended 16:9 aspect ratio, 800x450px minimum.

### `icon`

A single emoji used as a compact visual identity for the mod (e.g., `"🏔️"`, `"⚔️"`, `"🧩"`). Shown in list views, badges, and anywhere space is tight. Serves as a fallback when `coverImage` is absent.

## Collection Example

Collections combine multiple mods into a single pre-merged experience. The `includedMods` array is required and must be non-empty.

```json
{
  "schemaVersion": 1,
  "name": "Ultimate Valley Experience",
  "id": "ultimate-valley-experience",
  "version": "1.0.0",
  "type": "collection",
  "description": "Combines Expanded Boulder Field, Deeper Spire, and Meadow Nights into one seamless experience.",
  "author": "MergeMaster",
  "authorDiscord": "mergemaster",
  "tags": ["curated", "boulder-field", "spire", "meadow"],
  "campaigns": ["lure-of-the-valley"],
  "requiredProducts": ["core-set", "spire-in-bloom"],
  "optionalProducts": ["shadow-of-the-storm"],
  "includedMods": [
    { "id": "expanded-boulder-field", "name": "Expanded Boulder Field", "author": "ModCreatorName", "version": "1.2.0", "repoUrl": "https://github.com/creator/ebr-mod-base-content" },
    { "id": "deeper-spire", "name": "Deeper Spire", "author": "SpireEnjoyer", "version": "2.0.1", "repoUrl": "https://github.com/spire-enjoyer/ebr-mod-base-content" },
    { "id": "meadow-nights", "name": "Meadow Nights", "author": "NightOwl", "version": "0.9.0", "repoUrl": "https://github.com/nightowl/ebr-mod-base-content" }
  ],
  "safeToAddMidCampaign": false,
  "midCampaignNotes": "Touches content across multiple areas. Best installed before starting a new campaign.",
  "coverImage": "cover.png",
  "icon": "🧩",
  "language": "en",
  "repoUrl": "https://github.com/mergemaster/ebr-mod-base-content"
}
```

## Validation

Run `ebr validate` or `ebr publish` to check your manifest. The validator checks:

- All required fields are present
- `type` is one of the recognized values
- `id` is valid kebab-case
- `version` is a semver string
- `campaigns`, `requiredProducts`, `tags`, and `optionalProducts` are arrays (when present)
- `safeToAddMidCampaign` is a boolean
- `language` is a valid BCP 47 tag
- `repoUrl` is a GitHub URL
- `collection` type has a non-empty `includedMods` array
- Each `includedMods` entry has all required fields (`id`, `name`, `author`, `version`, `repoUrl`)
