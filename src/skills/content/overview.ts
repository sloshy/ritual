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
- \`<name>.changes.md\` — append-only changelog next to each list (auto-maintained;
  each entry is prose \`- \` lines plus a fenced \`ritual-changes\` block of JSON-Lines
  events — the block is what Ritual reads back, the prose is rendered only and is
  always English whatever the UI locale; an entry with no block is legacy and shows
  no events until \`ritual cleanup\` converts it)
- \`<name>.art.json\` — optional custom-art sidecar next to a list, mapping card
  \`&N\` ids to a replacement image (see **Custom art** below)
- \`ritual.config.json\` — configuration (optional: reading config never creates
  it, so a workspace only has one once \`config set\`/\`unset\`, \`init-site\`, the
  admin Settings page, or the MCP \`update_config\` tool writes it)

A list is addressed by its **name** = the file basename without \`.md\`
(e.g. \`decks/Winota Stax.md\` → \`Winota Stax\`). A name typed **exactly** as the file
spells it always selects that one list, before any folding — the escape hatch when
two names look alike. Otherwise most commands resolve a name across all three types,
ignoring case, accents, separators, apostrophes, and the punctuation a file name
cannot hold (so \`cafe\` matches \`Café\`, \`winota-stax\` matches \`Winota Stax\`, and
\`Atraxa: Praetors' Voice\` matches the \`Atraxa Praetors' Voice.md\` that name created);
then by unique substring. When a name matches lists of **different**
types, pass a type flag (\`--deck\`, \`--collection\`, \`--wanted\`) or prefix the name
(\`deck:staples\`) — commands taking more than one list (\`diff\`'s two sides,
\`export\`'s list arguments, \`move\`'s \`--from\`/\`--to\`) suggest the prefix, since one
whole-command flag cannot scope a single argument. A prefix that contradicts a type
flag (\`delete deck:X --collection\`) is a usage error, not a silent override. When the
matches are all the **same** type, no type selector can help: type more of the name,
or the full name exactly as spelled. The error's last line always names the
remedy that actually applies.

**Discovering lists:** \`ritual lists\` is the discovery primitive — it enumerates
every deck, collection, and wanted list as \`type slug name\` rows. Filter with
\`--deck\`/\`--collection\`/\`--wanted\`, and pass \`--output json\` for machine-readable
\`{type, slug, name}\` objects. Prefer it over globbing the workspace folders.

**List lifecycle:** \`ritual new <deck|collection|wanted> "<name>"\` creates a list
(\`-f/--format\` for decks, default \`commander\`), \`ritual rename <list> "<new name>"\`
renames one (file, sidecars, and front matter together), and
\`ritual delete <list> --confirm "<name>"\` deletes one (\`--confirm\` must repeat the
display name; without it a terminal prompts). \`new\` and \`rename\` **refuse** a name
that resolves to an existing list of the same type — \`atraxa superfriends\` beside
\`Atraxa Superfriends\` is an error, not a second deck — so no two lists ever share
one addressable name; re-spelling a list's own name (capitalization, punctuation) is
allowed. \`rename --output json\` returns \`newFilePath\`/\`oldFilePath\`, and
\`delete --output json\` returns \`deletedFiles\`. \`ritual diff <listA> <listB>\` compares any two lists by card name
(\`--by printing\` for exact printings).

**File naming:** creating a list names its file exactly as the list is named — case,
spaces, and punctuation are kept (\`ritual new deck "Winota Stax"\` → \`decks/Winota Stax.md\`,
not \`winota-stax.md\`). Only what file systems reject is cleaned up: the characters
\`/ \\ : * ? " < > |\` are stripped, runs of dots collapse to a single dot, leading and
trailing dots are trimmed, and a name with nothing usable left is an error. Older
lists may still have hyphenated file names; they resolve by name as normal, and their
display name comes from the file's first \`# Title\` heading (every list type),
falling back to the file name.
\`ritual cleanup\` renames such files to match their list names in one pass.

## File format

Full reference: the **List File Format** docs page (\`/list-format/\`). Every list is
optional YAML front matter, a \`# Title\` H1 (all three types — there is no \`name:\`
key), then \`## Section\` headings and \`- \` bulleted card lines. The canonical line
every write emits, in this order, with defaults omitted:

\`\`\`
- [qty] Name (SET:CN) [finish] [cond] [lang] [labels] #tag, tag {note} &N
\`\`\`

\`\`\`
---
format: commander
---

# Winota Stax

## Commander

- 1 Winota, Joiner of Forces (IKO:216) &1

## Main

- 3 Counterspell (LEA:55) [foil] &12
- 1 Sol Ring &5
\`\`\`

\`\`\`
# My Collection

- Black Lotus (LEA:232) [LP] [keep] {first edition} &7
\`\`\`

\`\`\`
# Wants

- Counterspell &3
\`\`\`

- **Decks** carry the copies as a quantity on the line; **collections and wanted lists
  hold one line per copy** and write no quantity.
- \`(SET:CollectorNumber)\` pins a printing; set codes are written **UPPERCASE** in
  files. **Collection lines always carry a printing** — a printing-less collection line
  is refused (\`missing-printing\`) and blocks whole-file writes until fixed. Deck and
  wanted lines may be name-only.
- \`[foil]\`/\`[etched]\` is the finish (\`nonfoil\` unwritten), \`[LP]\`/\`[MP]\`/\`[HP]\`/\`[DMG]\`
  the condition (\`NM\` unwritten), \`[ja]\`-style tokens the **language** — a lowercase
  Scryfall code (\`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph\`; \`zhs\`/\`zht\`
  for Chinese, not ISO codes), omitted for English so a bare line always means \`en\`.
  \`{...}\` is a note, greedy to the last \`}\`.
- \`[sale]\`/\`[trade]\`/\`[sale,trade]\`/\`[keep]\`/\`[proxy]\` is a **card label override**:
  \`sale\` and \`trade\` combine, \`keep\` and \`proxy\` each stand alone. Collections take
  all four, **decks take \`proxy\` only** (another label on a deck line is a warning that
  keeps the card and drops the token), and **wanted lists carry neither labels nor a
  condition** — such a token on a wanted line is a named refusal of that line. A card's
  *effective* labels are its own token when present, else the list's front-matter
  default — see the **ritual-collections** and **ritual-decks** skills.
- **Read tolerances** (rewritten to the canonical form on the next save): bracket
  tokens in any order; any whitespace run; the \`- \` bullet is optional on a deck line
  (a deck line is recognized by its leading quantity; a flat-list line by its bullet);
  \`4x\` quantities; a quantity on a collection/wanted line (\`- 4 Sol Ring (C21:240)\`
  reads as four copies and is **expanded to four lines on save** — an advisory, never a
  refusal; the first copy keeps the \`&N\`); Arena/MTGO \`Name (SET) CN\` and Moxfield
  \`Name (SET) *F* CN\` printings; \`//\` comment lines (dropped on write); \`_\` in set
  codes. A refused line (an unknown or disallowed token, a collection line with no
  printing) is a warning naming the file, line, and token, and blocks every
  whole-file write of that file; line-preserving commands leave it alone.
- **Sections** are matched by exact name (case-insensitive) against a closed table:
  \`Commander\`/\`Commanders\`/\`Command Zone\`, \`Companion\`, \`Oathbreaker\`/\`Signature
  Spell\`, \`Sideboard\`, \`Maybeboard\`, \`Tokens\`/\`Token\`, \`Main\`/\`Mainboard\`/\`Deck\`.
  **Every other name is a main-deck section** — \`## Token Generators\` or
  \`## Sideboard (post-board)\` is not special. Maybeboard and Tokens count toward no
  total and are left out of every decklist export.
- \`&N\` is a **stable internal card ID**. Never hand-author or renumber these — the tools manage them.
  Commands that add or edit card lines (editors, card mutations, imports, syncs \`deck-sync pull\`/\`push\`
  and \`collection-sync\` — not \`deck-sync status\`/\`link\` — \`cleanup\`,
  the site build, and the admin/MCP servers) backfill missing IDs on startup and persist
  them to the files. \`set-list-image\` backfills **conditionally**: only when the run names a
  card (\`--card\`, or the wizard's card picker), since \`--file\`/\`--url\`/\`--default\` never
  read an \`&N\` at all. Read-only commands (\`lists\`, \`diff\`, \`price\`, \`sell\`, \`export\`,
  \`list-all-cards\`, \`history --show\`, ...) and the \`new\`/\`rename\`/\`delete\` lifecycle
  never touch card lines, and \`-n\`/\`--dry-run\` writes nothing, including that backfill.
- A card line may carry tags — one \`#\` token holding a comma-separated list (\`#Ramp, Card
  Draw\`), after the labels and before the note, on every list type — the owner's free-form
  vocabulary, spaces and case kept, the \`#\` being file punctuation no UI shows; see the
  **ritual-edit** skill (\`set-card --tag\`/\`--untag\`, \`add-card --tag\`, the editor's
  \`🔖 Edit Tags\` action). Front-matter \`tags:\` on a deck describes the list, not its cards.

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

One shape the whole-file paths **do** delete, on purpose and without refusing: a deck's
empty **extras** section (a \`## Maybeboard\`/\`## Tokens\` header with no cards under it).
Extras count toward no total, so the header holds nothing to lose — every whole-file write
clears it, and \`cleanup\` names it (\`Dropped empty section: Maybeboard\`) while still
rewriting. An empty \`## Main\`/\`## Mainboard\`/\`## Deck\`/\`## Sideboard\` header in a deck
with cards elsewhere is kept instead: it is written back bare, with no warning. Any
other empty heading is content a rewrite would lose, so it warns and blocks the write.

A deck's YAML front matter carries its \`format:\` and \`tags:\` (a fixed set of keys — see
the **ritual-decks** skill; \`name:\`/\`created:\` are legacy keys that \`cleanup\` and every
deck save strip, the name having moved to the \`# Title\` H1). A deck with no \`format:\` is treated as Commander when it
has a \`## Commander\` section, and the tools write that down on the next save.
A **collection's** YAML front matter carries its default card labels
(\`labels: [sale, trade]\` or \`labels: [keep]\`), and a **deck's** carries
\`labels: [proxy]\` — the same key, restricted to the labels that type takes;
wanted lists carry no labels. All three types carry \`description:\`, the prose
blurb the published site prints above the cards (\`ritual metadata set <list>
description "…"\`), and \`image:\`, the list's cover on the published site (see
**List cover images** below) — between them, the only front-matter keys a wanted
list defines. A flat list's block round-trips byte-for-byte through every save.

## Custom art

Any card in any list can show a **custom image** in place of the printing's own
scan — a proxy's artwork, an altered card, a photo of the physical copy. The
mapping lives in a per-list \`<name>.art.json\` sidecar keyed by the card's \`&N\`
id, each entry naming either a file under the configured art directory or an
image URL:

\`\`\`json
{
  "5": { "file": "proxies/sol-ring.jpg" },
  "12": { "url": "https://example.com/art/bolt.png" }
}
\`\`\`

\`ritual config set artDir <path>\` picks the directory (default \`./art\`,
resolved against the workspace like \`decks/\`); nothing creates it, and a missing
one simply means no local art. Files are **referenced, never uploaded** — put the
image there yourself, then point at it with a forward-slash relative path that
stays inside the directory and ends in \`.avif\`, \`.gif\`, \`.jpeg\`, \`.jpg\`,
\`.png\` or \`.webp\` (the extensions the art route serves; a URL is not
extension-checked). Set it with \`ritual set-card <list> <card> --art\`
(see the **ritual-edit** skill), the \`ritual edit\` TUI's \`🎨 Set Custom Art\` card
action (the one deferred writer: staged in the session and written by its save), the
admin editors' **Set Custom Art…** card action, or the MCP \`set_card_art\` tool. Custom art is list *metadata* like a primer: it never
touches the card line and records **no** changelog entry (every writer but the
\`edit\` TUI's also writes it immediately, needing no save). Building the site copies referenced files into \`dist/art/\` and bakes the
URL into the card; \`ritual serve --api\` serves them live from the art directory.

Custom art **also removes the card's price**, on the same rule as the \`proxy\`
label: a card wearing art of its own is not the printing a price is quoted for.
It prices as **0** in \`ritual price\` and on the site (unpriced reason
\`custom-art\`, which is *not* counted as an unpriced card), and it never appears
in \`ritual sell\`, the buylist quotes, or the sell cart. Surfaces show
\`CUSTOM\` where a price would be — \`PROXY\` for a proxy without custom art,
and \`CUSTOM\` when a card is both.

The sidecar follows the card lines automatically, because an \`&N\` freed by a
removal is handed to the next card added: removing a card (or a whole deck line)
drops its art entry, a cross-list move carries the entry to the id the
destination's new line gets (\`ritual move\`, the editors' move-to-another-list,
and the \`edit\` TUI's alike), a save that renumbers a line re-files it, and a
sync that pulls removals in (\`deck-sync pull\`, \`collection-sync\`) drops the
entries of the cards it removed. A removal is final for the art even when the
same edit re-adds the card and the new line takes the same \`&N\` back: a re-added
card is a new copy, so set its art again if it should have one. Art returns on
its own only by *undoing* the removal (the \`edit\` TUI's \`↩️ Undo Last Edit\` and
the web editors' undo, which reclaim the original id). Only a hand edit —
or another tool deleting a card line — can leave art behind pointing at an id the
list no longer has; that shows up as a load/build warning naming the raw ids.

## List cover images

Every list shows one **cover image** on the published site — the picture on its
tile on the index page and in Quick Switch. By default that is chosen for
you: a commander deck shows its commander, every other list its most expensive
printing. A list overrides it with an \`image:\` key in its front matter, which
decks, collections and wanted lists all carry:

\`\`\`yaml
image:
  card: 12                            # the &N of a line in THIS list
image:
  file: alters/atraxa.png             # art-dir-relative, same rules as custom art
image:
  url: https://example.com/cover.jpg  # absolute http(s), used verbatim
\`\`\`

**The mapping is the only spelling.** A scalar \`image: &12\` is a YAML *anchor*
that parses to \`null\`, not to the string \`&12\`, so scalars are rejected
outright rather than half-understood; there is likewise no \`image: default\` —
removing the key (or writing \`null\` through an API) is how a list goes back to
the built-in rule. \`file\` obeys the custom-art rules exactly (forward slashes,
inside the art directory, one of the servable extensions), and \`url\` is never
validated at all — a broken one is the browser's problem.

Set it with \`ritual set-list-image\` (\`--card\`, \`--file\`, \`--url\`,
\`--default\`, or no flag at all for a wizard), the admin editors' **Cover
Image** button, the MCP \`set_list_metadata\` tool's \`image\` field, or by hand.
\`ritual metadata\` deliberately does **not** write it — a cover is a mapping,
which that command's scalar values cannot spell — though \`metadata list\`
still reports what is stored (\`get\`, like \`set\`, points you here instead).

\`\`\`bash
ritual set-list-image "Winota Stax" --card 12       # &12 in this deck; &12 also works
ritual set-list-image "Main Binder" --file alters/binder.png
ritual set-list-image "To Buy" --wanted --url https://example.com/cover.jpg
ritual set-list-image "Winota Stax" --default      # remove the key
ritual set-list-image                              # wizard: pick list, mode, then the image
\`\`\`

The three modes fail differently, on purpose:

- **\`card\`** is verified against the list *as it is written*: a write naming an
  \`&N\` the list does not carry is rejected (CLI exit 2, HTTP/MCP 400) rather than
  stored. The reference then **follows the card lines** the way custom art does —
  removing that card clears the key, and a save that renumbers the line rewrites
  it — because an \`&N\` freed by a removal is handed to the next card added, and a
  stale cover would silently show an unrelated card. A card whose printing cannot
  be resolved falls back to the default cover silently.
- **\`file\`** has only its *shape* checked when written — unlike a card's custom
  art, which is refused when the file is not there, a cover may name an image you
  add later. The site build warns about a path with nothing behind it (the same
  \`Custom art file not found\` line a card's missing art produces) and falls back to
  the default cover.
- **\`url\`** is never checked at all, at write time or build time.

**Prefer the CLI (or the web admin / MCP server) over hand-editing files**, so the
\`&N\` IDs and \`.changes.md\` changelog stay correct. Reading files directly for
inspection is fine. To normalize a whole workspace — canonical formatting (bullets,
token order, expanded flat-list quantities, \`# Title\` H1 with legacy \`name:\`/\`created:\`
stripped), file names that match list names, and a \`format:\` on every deck — run
\`ritual cleanup\`
(\`-n\`/\`--dry-run\` to preview; \`--check\` to also exit 1 when any file would
change, for hooks and CI; \`--skip-formats\` to never prompt for deck formats,
leaving formatless decks untouched and reported). A file it cannot read or parse
is named, skipped, and reported with \`unreadable: true\` while its siblings are
still cleaned — that exits 1 in **every** mode, including \`--dry-run\`. Under
\`--no-input\`, a real run that needs the deck-format prompt is a usage error
(exit 2), not an unreadable file; pass \`--skip-formats\` to avoid the prompt.

## The ritual-* skills

- **ritual-decks** — create, import, sync, and price decks
- **ritual-collections** — manage, sync (Archidekt), price, and sell (Card Kingdom buylist) collections
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
- \`--locale <tag>\` — the language Ritual's **own interface text** speaks, as a
  BCP-47 tag (\`de-AT\`, \`ja\`). The \`RITUAL_LOCALE\` environment variable and the
  \`uiLocale\` config key say the same thing at lower precedence:
  \`--locale\` → \`RITUAL_LOCALE\` → \`uiLocale\` → the OS environment → \`en\`.
  A malformed tag on the flag is a usage error (exit 2); a malformed
  \`RITUAL_LOCALE\`/\`uiLocale\` warns and falls through to the next tier. This is
  **not** \`defaultLanguage\` (which picks which *printing* of a card is used) —
  the two are independent, and a Japanese interface listing English cards is a
  valid combination. A locale Ritual ships no dictionary for renders in English
  rather than failing. The OS-environment tier reads \`LC_ALL\`/\`LC_MESSAGES\`/
  \`LANGUAGE\`/\`LANG\` only; asking Windows or macOS directly costs a subprocess and
  happens **only** under \`ritual locale --detect\`
${asBullet(NO_INPUT_GUARANTEE)}

Exit codes are uniform across commands: **1** runtime error, **2** usage error,
**3** not found. A missing resource — a list, file, or sidecar that is simply
not there — is always **3**, never 1.

## Scripting conventions (uniform across commands)

- \`--output text|json|ndjson\` always selects the **stdout envelope**, never a
  file format or destination. \`json\` emits exactly one document per run (a
  card batch or a multi-page search is still one array); \`ndjson\` streams one
  object per line. Errors go to stderr as
  \`{"error":{"code","messageKey?","message","details?"}}\` in the structured
  modes — \`code\` and \`messageKey\` are locale-invariant (match on those, never
  on prose), while \`message\` follows the UI locale. An unexpected internal
  failure uses the same envelope with \`code: "runtime_error"\` and exit \`1\`,
  carrying neither \`messageKey\` nor \`details\` — there is no catalog entry
  and no structured payload behind it. Three
  exceptions, all deliberate: \`scry\` and \`sell\` add a fourth value
  \`--output csv\` (Scryfall's server-side CSV and Card Kingdom's sell-cart
  upload format, respectively — \`sell\`'s csv is a different payload, not the
  report re-rendered), and \`export\` has no \`--output\` at all (its stdout
  payload *is* the export — pick the format with \`--format csv|json|text|md\`,
  redirect with \`--out\`).
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
ritual config set priceSources tcgplayer cardkingdom  # stores the sites offer prices from
                                  #   (tcgplayer = Scryfall USD, cardmarket = Scryfall EUR,
                                  #   cardkingdom = CK NM retail). Default tcgplayer; remove every
                                  #   entry (--remove) to hide all site prices. cardkingdom makes
                                  #   builds/servers download the ~70 MB CK feed like sell mode
ritual config set defaultLanguage ja   # language stamped on newly added cards (Scryfall codes;
                                  #   aliases like jp/Japanese normalize). Non-en switches cache
                                  #   downloads to Scryfall's much larger all-cards bulk
ritual config set searchDebounceMs 250 # web editors' add-card search debounce in ms (0 disables)
ritual config set artDir ./art    # directory custom card art is referenced from (default ./art)
ritual config set uiLocale de-AT  # language Ritual's own interface text speaks (BCP-47 tag).
                                  #   NOT defaultLanguage: that one picks card printings
ritual config get <prop>          # read one value (exit 3 when unset)
ritual config list                # print the full effective config (defaults marked)
ritual config unset <prop>        # revert a value to its default
ritual locale                     # resolved UI locale, which tier supplied it, the locales
                                  #   this build ships, and the card language, side by side
ritual locale --detect            # opt-in: also run the OS probes (a subprocess on Windows/macOS,
                                  #   skipped elsewhere and under WSL), report what each source
                                  #   said, and offer to save it as uiLocale. Writes only on a
                                  #   yes; --no-input and --output json print the finding and
                                  #   write nothing (json carries it as suggestedUiLocale)
ritual metadata set <list> <prop> <value...>  # list front matter, same shape as config:
                                  #   any list's description; deck tags/format/sourceId/
                                  #   sourceUrl/labels; collection labels
ritual metadata get|list|unset <list> [prop]  # read or clear it (get exits 3 when unset)
ritual cache status               # report cache size/freshness/source without refreshing
ritual cache preload-all          # warm the Scryfall card cache + tags (bulk download); also
                                  #   refreshes the Card Kingdom buylist when site.sellMode is on
                                  #   or priceSources includes cardkingdom
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
