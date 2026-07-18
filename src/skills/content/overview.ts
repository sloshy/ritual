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
(e.g. \`decks/Winota Stax.md\` → \`Winota Stax\`). Most commands resolve a name across
all three types, ignoring case, accents, and separators (so \`cafe\` matches \`Café\`,
and \`winota-stax\` matches \`Winota Stax\`); when a name is ambiguous, pass a type
flag (\`--deck\`, \`--collection\`, \`--wanted\`) or prefix the name (\`deck:staples\`).

**Discovering lists:** \`ritual lists\` is the discovery primitive — it enumerates
every deck, collection, and wanted list as \`type slug name\` rows. Filter with
\`--deck\`/\`--collection\`/\`--wanted\`, and pass \`--output json\` for machine-readable
\`{type, slug, name}\` objects. Prefer it over globbing the workspace folders.

**List lifecycle:** \`ritual new <deck|collection|wanted> "<name>"\` creates a list
(\`-f/--format\` for decks), \`ritual rename <list> "<new name>"\` renames one (file,
sidecars, and front matter together), and \`ritual delete <list> --confirm "<name>"\`
deletes one (\`--confirm\` must repeat the display name; without it a terminal
prompts). \`ritual diff <listA> <listB>\` compares any two lists by card name
(\`--by printing\` for exact printings).

**File naming:** creating a list names its file exactly as the list is named — case,
spaces, and punctuation are kept (\`ritual new deck "Winota Stax"\` → \`decks/Winota Stax.md\`,
not \`winota-stax.md\`). Only characters file systems reject (\`/ \\ : * ? " < > |\`, leading or
repeated dots) are stripped, and a name with nothing usable left is an error. Older lists may
still have hyphenated file names; they resolve by name as normal, and their display name comes
from the deck's \`name:\` front matter (or the file name, for collections and wanted lists).
\`ritual cleanup\` renames such files to match their list names in one pass.

## File format

Deck card lines start with a quantity; collection and wanted lines start with \`- \`:

\`\`\`
## Mainboard
3 Counterspell (LEA:55) &12
1 Sol Ring &5
\`\`\`

\`\`\`
# My Collection
- Black Lotus (LEA:232) [foil] [LP] {first edition} &7
- Counterspell
\`\`\`

- \`(SET:CollectorNumber)\` pins a printing. Set codes are written **UPPERCASE** in files.
- \`[foil]\`/\`[etched]\` is the finish, \`[LP]\`/\`[MP]\`/\`[HP]\`/\`[DMG]\` the condition (the default \`NM\` is not written), \`{...}\` a note.
- \`&N\` is a **stable internal card ID**. Never hand-author or renumber these — the tools manage them.
  Any list-touching command backfills missing IDs on startup and persists them to the
  files — except under \`-n\`/\`--dry-run\`, which writes nothing, including that backfill.

A deck's YAML front matter carries its \`format:\` (a fixed set of keys — see the
**ritual-decks** skill). A deck with no \`format:\` is treated as Commander when it
has a \`## Commander\` section, and the tools write that down on the next save.

**Prefer the CLI (or the web admin / MCP server) over hand-editing files**, so the
\`&N\` IDs and \`.changes.md\` changelog stay correct. Reading files directly for
inspection is fine. To normalize a whole workspace — canonical formatting, file
names that match list names, a \`format:\` on every deck — run \`ritual cleanup\`
(\`-n\`/\`--dry-run\` to preview; \`--check\` to additionally exit 1 when any file
would change, for hooks and CI; \`--skip-formats\` to never prompt for deck
formats, leaving formatless decks untouched and reported).

## The ritual-* skills

- **ritual-decks** — create, import, sync, and price decks
- **ritual-collections** — manage and price collections
- **ritual-wanted** — manage and price wanted lists
- **ritual-edit** — card edits across any list: one-shot non-interactive commands (\`add-card\`, \`remove-card\`, \`set-card\`, \`note\`, scripted \`move\`), the unified interactive editor, and card exports (CSV, JSON, plain text, Markdown)
- **ritual-cards** — look up cards and run Scryfall searches
- **ritual-site** — build, serve, and administer the published site (and the MCP server)

## Global options (work on every command)

- \`--base-dir <path>\` — operate on a workspace other than the current directory
- \`--cache-server <host:port>\` — share a card/price cache with other instances
- \`--no-input\` — **the** headless switch: never prompt anywhere; where input
  would be required the command fails fast (or uses a documented default)
  instead of hanging. Setting the \`RITUAL_NO_INPUT\` environment variable does
  the same. There are no per-command non-interactive flags.

Commands that read the Scryfall card cache (\`add-card\`, \`edit\`, \`price\`,
\`build-site\`, \`serve --build\`, \`admin\`) also share a \`--refresh <mode>\` option
controlling cache freshness: \`ask\` (the default — prompt about stale or empty
caches; the prompt is skipped when prompts are unavailable), \`auto\` (refresh
stale data without asking, bulk download allowed), \`no-bulk\` (refresh stale
prices per-card, never a bulk download), and \`never\` (use the cache as-is).

## Setup

\`\`\`bash
ritual login archidekt            # log in to Archidekt (for imports/sync)
echo "$PASS" | ritual login archidekt --username you --password-stdin  # headless login
ritual login status               # show the stored Archidekt login (exit 3 when not logged in)
ritual login logout               # remove the stored Archidekt session
ritual config set <prop> <value>  # set a config value (dot notation for nested keys)
ritual config set defaultCurrency eur  # currency price commands/displays default to (usd | eur | tix)
ritual config get <prop>          # read one value (exit 3 when unset)
ritual config list                # print the full effective config (defaults marked)
ritual config unset <prop>        # revert a value to its default
ritual cache status               # report cache size/freshness/source without refreshing
ritual cache preload-all          # warm the Scryfall card cache + tags (bulk download)
ritual cache refresh-tags         # refresh only the oracle/art tags on cached cards
ritual cache feed host            # host a P2P feed of the raw Scryfall bulk files
ritual cache feed fetch           # sync the cache from a feed, then seed to peers
ritual config set cacheSource feed  # make all cache refreshes sync via the feed
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
