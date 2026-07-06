import type { RitualSkill } from '../types'

export const overviewSkill: RitualSkill = {
  name: 'ritual',
  description:
    'Entry point for working with Ritual, a Magic: The Gathering toolkit that manages decks, collections, and wanted lists as Markdown files. Use when a workspace has decks/, collections/, or wanted/ folders or a ritual.config.json, or when the user mentions Ritual, MTG decks, collections, or wanted lists.',
  body: `# Ritual — Magic: The Gathering decks, collections & wanted lists

Ritual is a CLI that manages Magic: The Gathering **decks**, **collections**, and
**wanted lists** as plain Markdown files in a workspace directory, and can publish
them as a static website. This is the entry-point skill; the focused \`ritual-*\`
skills cover each area in detail.

## Recognising a Ritual workspace

The current directory (or one passed with \`--base-dir <path>\`) is a Ritual
workspace if it contains \`decks/\`, \`collections/\`, or \`wanted/\` folders, or a
\`ritual.config.json\`. Confirm Ritual is installed with \`ritual --help\`.

## Workspace layout

- \`decks/<name>.md\` — one deck per file
- \`collections/<name>.md\` — collections of owned cards
- \`wanted/<name>.md\` — cards you want to acquire
- \`<name>.changes.md\` — append-only changelog next to each list (auto-maintained)
- \`ritual.config.json\` — configuration

A list is addressed by its **name** = the file basename without \`.md\`
(e.g. \`decks/winota-stax.md\` → \`winota-stax\`). Most commands resolve a name
case- and accent-insensitively across all three types (so \`cafe\` matches a list
named \`Café\`); when a name is ambiguous, pass a type
flag (\`--deck\`, \`--collection\`, \`--wanted\`).

## File format

Deck card lines start with a quantity; collection and wanted lines start with \`- \`:

\`\`\`
## Mainboard
3 Counterspell (LEA:55) &12
1 Sol Ring &5
\`\`\`

\`\`\`
# My Collection
- Black Lotus (LEA:232) [foil] [NM] {first edition} &7
- Counterspell
\`\`\`

- \`(SET:CollectorNumber)\` pins a printing. Set codes are written **UPPERCASE** in files.
- \`[foil]\`/\`[etched]\` is the finish, \`[NM]\`/\`[LP]\`/\`[MP]\`/\`[HP]\`/\`[DMG]\` the condition, \`{...}\` a note.
- \`&N\` is a **stable internal card ID**. Never hand-author or renumber these — the tools manage them.

**Prefer the CLI (or the web admin / MCP server) over hand-editing files**, so the
\`&N\` IDs and \`.changes.md\` changelog stay correct. Reading files directly for
inspection is fine.

## The ritual-* skills

- **ritual-decks** — create, import, sync, and price decks
- **ritual-collections** — manage and price collections
- **ritual-wanted** — manage and price wanted lists
- **ritual-edit** — card edits across any list: non-interactive commands (add/remove cards, notes), the unified interactive editor, and CSV/JSON exports
- **ritual-cards** — look up cards and run Scryfall searches
- **ritual-site** — build, serve, and administer the published site (and the MCP server)

## Global options (work on every command)

- \`--base-dir <path>\` — operate on a workspace other than the current directory
- \`--cache-server <host:port>\` — share a card/price cache with other instances

## Setup

\`\`\`bash
ritual login archidekt            # log in to Archidekt (for imports/sync)
ritual config-set <prop> <value>  # set a config value (dot notation for nested keys)
ritual config-set defaultCurrency eur  # currency price commands/displays default to (usd | eur | tix)
ritual cache preload-all          # warm the Scryfall card cache + tags (bulk download)
ritual cache refresh-tags         # refresh only the oracle/art tags on cached cards
ritual cache-feed host            # host a P2P feed of the raw Scryfall bulk files
ritual cache-feed fetch           # sync the cache from a feed, then seed to peers
ritual config-set cacheSource feed  # make all cache refreshes sync via the feed
\`\`\`

Cache refreshes take an exclusive lock (\`cache/.ritual-cache-lock\`); a refresh
started while another process is refreshing waits up to the configurable
\`cacheLockTimeoutSeconds\` (default 300) instead of interleaving writes.

## Alternative: the MCP server

For MCP-native agents, \`ritual mcp\` exposes the same deck/collection/wanted
operations as Model Context Protocol tools. These skills drive the CLI directly;
the MCP server is an alternative for clients that prefer tool calls. See the
**ritual-site** skill or \`ritual mcp --help\`.
`,
}
