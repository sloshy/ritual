import type { RitualSkill } from '../types'
import { asBullet, NO_INPUT_GUARANTEE, REFRESH_COMMANDS } from './shared'

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
- \`ritual.config.json\` — configuration (optional: reading config never creates
  it, so a workspace only has one once \`config set\`/\`unset\`, \`init-site\`, the
  admin Settings page, or the MCP \`update_config\` tool writes it)

A list is addressed by its **name** = the file basename without \`.md\`
(e.g. \`decks/Winota Stax.md\` → \`Winota Stax\`). Most commands resolve a name across
all three types, ignoring case, accents, and separators (so \`cafe\` matches \`Café\`,
and \`winota-stax\` matches \`Winota Stax\`); when a name matches lists of **different**
types, pass a type flag (\`--deck\`, \`--collection\`, \`--wanted\`) or prefix the name
(\`deck:staples\`) — commands taking more than one list (\`diff\`'s two sides,
\`export\`'s list arguments, \`move\`'s \`--from\`/\`--to\`) suggest the prefix, since one
whole-command flag cannot scope a single argument. When the matches are all the **same** type, no type
selector can help: type more of the name. The error's last line always names the
remedy that actually applies.

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
not \`winota-stax.md\`). Only what file systems reject is cleaned up: the characters
\`/ \\ : * ? " < > |\` are stripped, runs of dots collapse to a single dot, leading and
trailing dots are trimmed, and a name with nothing usable left is an error. Older
lists may still have hyphenated file names; they resolve by name as normal, and their
display name comes from the deck's \`name:\` front matter (or, for collections and
wanted lists, the first \`# Title\` heading), falling back to the file name.
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
\`\`\`

\`\`\`
# Wants
- Counterspell &3
\`\`\`

- \`(SET:CollectorNumber)\` pins a printing. Set codes are written **UPPERCASE** in files.
- **Collection lines always carry a printing** — a printing-less collection line is
  rejected by every write path and skipped (with a warning) on load. Deck and wanted
  lines may be name-only, as \`1 Sol Ring &5\` and \`- Counterspell &3\` above.
- **Collection and wanted lines hold one copy each** — there is no quantity on the line, so a
  deck-style \`- 1 Sol Ring (C21:240)\` parses as a card *named* \`1 Sol Ring\`. \`collection-sync\`,
  \`cleanup\`, and the CLI editors print an advisory naming such a line (a 1-3 digit leading integer; a real name like \`1996 World Champion\`
  is left alone). It is advisory only: the line parses and survives every save, so fix the file.
- \`[foil]\`/\`[etched]\` is the finish, \`[LP]\`/\`[MP]\`/\`[HP]\`/\`[DMG]\` the condition (the default \`NM\` is not written), \`{...}\` a note.
- \`&N\` is a **stable internal card ID**. Never hand-author or renumber these — the tools manage them.
  Commands that add or edit card lines (editors, card mutations, imports, syncs \`deck-sync pull\`/\`push\`
  and \`collection-sync\` — not \`deck-sync status\`/\`link\` — \`cleanup\`,
  the site build, and the admin/MCP servers) backfill missing IDs on startup and persist
  them to the files. Read-only commands (\`lists\`, \`diff\`, \`price\`, \`export\`,
  \`list-all-cards\`, \`history --show\`, ...) and the \`new\`/\`rename\`/\`delete\` lifecycle
  never touch card lines, and \`-n\`/\`--dry-run\` writes nothing, including that backfill.

**Fenced code blocks are prose.** Anything inside a \`\`\`\` \`\`\` \`\`\`\`/\`~~~\` fence in a list file is
ignored by card parsing: a card-looking line there is not a card, a \`## Heading\` there is
not a section, an \`&N\` there is not an ID in use, and none of it warns. Fenced lines are
never a mutation target and never get an ID stamped into them, so a block survives every
line-preserving edit byte-for-byte. An **unclosed fence extends to the end of the file**
(CommonMark), so a stray fence hides every card below it — and an \`add-card\`/\`move\` that
would append past it is refused rather than write a line no parse can see. The whole-file
rewrite paths cannot re-emit a fenced block: admin editor saves, \`import --append\`, and a
\`move\` with a deck on either side refuse such a file; \`cleanup\` skips its content rewrite;
the syncs hold it back behind the unreadable-lines gate. A \`ritual edit\` session warns on
load but still drops the block on save.

A deck's YAML front matter carries its \`format:\` (a fixed set of keys — see the
**ritual-decks** skill). A deck with no \`format:\` is treated as Commander when it
has a \`## Commander\` section, and the tools write that down on the next save.

**Prefer the CLI (or the web admin / MCP server) over hand-editing files**, so the
\`&N\` IDs and \`.changes.md\` changelog stay correct. Reading files directly for
inspection is fine. To normalize a whole workspace — canonical formatting, file
names that match list names, a \`format:\` on every deck — run \`ritual cleanup\`
(\`-n\`/\`--dry-run\` to preview; \`--check\` to also exit 1 when any file would
change, for hooks and CI; \`--skip-formats\` to never prompt for deck formats,
leaving formatless decks untouched and reported). A file it cannot read or parse
is named, skipped, and reported with \`unreadable: true\` while its siblings are
still cleaned — that exits 1 in **every** mode, including \`--dry-run\`. Under
\`--no-input\`, a real run that needs the deck-format prompt is a usage error
(exit 2), not an unreadable file; pass \`--skip-formats\` to avoid the prompt.

## The ritual-* skills

- **ritual-decks** — create, import, sync, and price decks
- **ritual-collections** — manage, sync (Archidekt), and price collections
- **ritual-wanted** — manage and price wanted lists
- **ritual-edit** — card edits across any list: one-shot non-interactive commands (\`add-card\`, \`remove-card\`, \`set-card\`, \`note\`, scripted \`move\`), the unified interactive editor, and card exports (CSV, JSON, plain text, Markdown)
- **ritual-cards** — look up cards and run Scryfall searches
- **ritual-site** — build, serve, and administer the published site, the CI publishing pipeline, and the MCP server

## Global options (work on every command)

- \`--base-dir <path>\` — operate on a workspace other than the current directory
  (the \`RITUAL_BASE_DIR\` environment variable does the same; the flag wins). The
  path must already be an existing directory — Ritual never creates it, and a
  path that is missing, not a directory, or unreadable is a usage error
  (exit 2), so a typo can never read as an empty workspace
- \`--cache-server <host:port>\` — share a card/price cache with other instances
  (the \`RITUAL_CACHE_SERVER\` environment variable does the same; host one with
  \`ritual cache server\`). A malformed address is a usage error (exit 2)
${asBullet(NO_INPUT_GUARANTEE)}

Exit codes are uniform across commands: **1** runtime error, **2** usage error,
**3** not found. A missing resource — a list, file, or sidecar that is simply
not there — is always **3**, never 1.

## Scripting conventions (uniform across commands)

- \`--output text|json|ndjson\` always selects the **stdout envelope**, never a
  file format or destination. \`json\` emits exactly one document per run (a
  card batch or a multi-page search is still one array); \`ndjson\` streams one
  object per line. Errors go to stderr as
  \`{"error":{"code","message","details"}}\` in the structured modes. Two
  exceptions, both deliberate: \`scry\` adds a fourth value \`--output csv\`, and
  \`export\` has no \`--output\` at all (its stdout payload *is* the export —
  pick the format with \`--format csv|json|text|md\`, redirect with \`--out\`).
- \`--quiet\` suppresses progress and status chatter **only**. The structured
  payload always emits, so \`--quiet --output json\` is clean JSON with no
  surrounding noise. Errors and data-loss warnings (an unparseable card line, a
  change skipped as a conflict, a truncated result set) always reach stderr
  regardless. A command with no chatter does not register the flag at all
  (\`card\`, \`diff\`, \`scry\`, \`cache status\`, \`dep-license\`, \`history\`,
  \`login status\`, \`deck-sync status\`, \`skills list\`).
- Piping structured output into an early-closing reader (\`… --output ndjson |
  head\`) is a clean exit 0, not a crash.

${REFRESH_COMMANDS}

## Setup

\`\`\`bash
ritual login archidekt            # log in to Archidekt (for imports/sync)
echo "$PASS" | ritual login archidekt --username you --password-stdin  # headless login
ritual login status               # stored login + whether its session still authenticates
                                  #   exit 0 usable, 1 expired (re-login), 3 nothing stored
ritual login logout               # remove the stored Archidekt session
ritual config set <prop> <value>  # set a config value (dot notation for nested keys)
ritual config set defaultCurrency eur  # currency price commands/displays default to (usd | eur | tix)
ritual config set searchDebounceMs 250 # web editors' add-card search debounce in ms (0 disables)
ritual config get <prop>          # read one value (exit 3 when unset)
ritual config list                # print the full effective config (defaults marked)
ritual config unset <prop>        # revert a value to its default
ritual cache status               # report cache size/freshness/source without refreshing
ritual cache preload-all          # warm the Scryfall card cache + tags (bulk download)
ritual cache preload-set khm      # cache all cards of one set (exit 3 = unknown set code, 1 = search failed)
ritual cache refresh-tags         # refresh only the oracle/art tags on cached cards (exit 1 when the download fails)
ritual cache server               # host a shared cache server (default 127.0.0.1:4000)
ritual cache feed host            # host a P2P feed of the raw Scryfall bulk files
ritual cache feed fetch           # sync the cache from a feed, then seed to peers
ritual config set cacheSource feed  # make all cache refreshes sync via the feed
\`\`\`

\`ritual.config.json\` is created only by a genuine write — \`config set\`/\`unset\`,
\`init-site\`, the admin Settings page, or the MCP \`update_config\` tool — reading
config never does. If the file exists but is not valid JSON, every command fails with exit 1
and a message naming the path; the file is never rewritten, so fix (or delete)
it rather than trying to overwrite it with \`config set\`.

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
