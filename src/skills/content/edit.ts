import type { RitualSkill } from '../types'

export const editSkill: RitualSkill = {
  name: 'ritual-edit',
  description:
    'Edit cards in any Ritual deck, collection, or wanted list — one-shot non-interactive commands for agents and scripts (add-card, remove-card, set-card, note, scripted move), plus the interactive editor TUI. Use when the user wants to add, remove, or update a card, set or clear a card note, move cards between lists, edit lists interactively, apply a change bundle exported from the site editor, export cards as CSV, JSON, plain text, or Markdown, or read or compact a change history.',
  body: `# Editing cards in any Ritual list

The **one-shot commands** — \`add-card\`, \`remove-card\`, \`set-card\`, \`note\`, and the
scripted form of \`move\` — are how agents and scripts edit decks, collections, and
wanted lists: each is a single non-interactive invocation. They keep the \`&N\` card
IDs and the \`.changes.md\` changelog correct — prefer them over hand-editing files.
The interactive editor TUI (\`ritual edit\`, below) is the alternative when a human
is driving.

Conventions shared by every one-shot command:

- The first argument is the list **name** (file basename, no \`.md\`). It is resolved
  across all three types unless you pass \`--deck\`, \`--collection\`, or \`--wanted\`
  (or prefix the name: \`deck:burn\`, \`collection:Main Binder\`, \`wanted:To Buy\`).
  An ambiguous name is an error.
- The card is matched by name (case-, accent-, and punctuation-insensitive). When
  several entries match, disambiguate with \`--card-id <N>\` (the \`&N\` suffix in
  the file).
- \`--output json\` (or \`ndjson\`) emits a machine-readable result; \`--quiet\`
  suppresses non-essential text.
- Nothing blocks on a prompt in a script: when stdin is not a terminal, a missing
  argument or flag fails fast with exit code 2 (\`Input required: ...\`) instead of
  opening a picker. Exit codes: 1 runtime error, 2 usage error, 3 not found.
- The global \`--no-input\` flag (or the \`RITUAL_NO_INPUT\` environment variable)
  works on **every** command and guarantees no prompting: where input would be
  required the command fails fast (or uses a documented default) instead of
  hanging. It is the one headless switch — there are no per-command
  non-interactive flags.
- Commands that read the Scryfall card cache (\`add-card\`, \`edit\`, \`price\`,
  \`build-site\`, \`serve --build\`, \`admin\`) share a \`--refresh <mode>\` option
  controlling cache freshness: \`ask\` (the default — prompt about stale/empty
  caches; the prompt is skipped when prompts are unavailable), \`auto\` (refresh
  stale data without asking, bulk download allowed), \`no-bulk\` (refresh stale
  prices per-card, never a bulk download), and \`never\` (use the cache as-is).

## Add a card

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring"                 # resolve across all types
ritual add-card "Winota Stax" "Sol Ring" --deck -q 2     # 2 copies (deck only)
ritual add-card "Main Binder" "Black Lotus" --collection --set lea --collector-number 232 -c LP
ritual add-card "To Buy" "Mox Ruby" --wanted --name-only # any copy
ritual add-card "To Buy" "Demonic Tutor" --wanted --set sta --collector-number 90
ritual add-card "Winota Stax" "Lightning Bolt" --exact --output json
\`\`\`

- \`--collection\` / \`--wanted\` create the list if it does not exist (\`--deck\` does not — use \`ritual new deck\`).
- \`--set <code>\` + \`--collector-number <cn>\` (always together) pin an exact printing;
  the pair is validated against the card's real printings, and \`-f\` against the
  finishes that printing offers.
- \`-q\` quantity (deck only), \`-f\` finish (nonfoil/foil/etched — collection and wanted
  only), \`-c\` condition (NM/LP/MP/HP/DMG, or \`NONE\` to record no condition —
  collection only). A flag the target type does not support is an error.
- Wanted adds must choose a specificity: \`--name-only\` (any copy), a printing pin via
  \`--set\`/\`--collector-number\`, or \`--specific\` (interactive picker). Non-interactive
  runs without one exit 2.
- \`-e\`/\`--exact\` requires the card name to match exactly (no picker). Without a
  terminal the name must match exactly anyway, and a collection add without a
  printing pin succeeds only when the card has a single paper printing — pass
  \`--set\`/\`--collector-number\` to be safe.

## Remove a card

\`\`\`bash
ritual remove-card "Winota Stax" "Lightning Bolt"            # one copy
ritual remove-card "Winota Stax" "Lightning Bolt" -q 2       # 2 copies (decks only)
ritual remove-card "Winota Stax" "Lightning Bolt" --all-copies
ritual remove-card "Main Binder" "Sol Ring" --card-id 5 --output json
\`\`\`

- Deck lines carry quantities: \`-q <n>\` removes that many copies (more than the line
  holds is an error) and \`--all-copies\` drops the whole line. Collection and wanted
  entries are one physical card each, so those flags do not apply there — remove
  copies one at a time, disambiguating with \`--card-id\`.
- JSON output: \`{type, list, cardName, cardId, removed, remaining}\`.

## Update a card in place

\`set-card\` changes a card's fields on its existing line — the \`&N\` id is kept:

\`\`\`bash
ritual set-card "Main Binder" "Lightning Bolt" --set 2xm --collector-number 157
ritual set-card "Main Binder" "Sol Ring" --finish foil --condition LP
ritual set-card "Winota Stax" "Lightning Bolt" --section Sideboard
ritual set-card "Winota Stax" "Winota, Joiner of Forces" --commander
ritual set-card "To Buy" "Demonic Tutor" --wanted --finish foil --output json
\`\`\`

- At least one change flag is required.
- \`--set\` + \`--collector-number\` (always together) change the printing; the pair is
  validated against the card's real printings (an unknown pair is a usage error
  listing what exists). Without \`--finish\` alongside, the current finish is kept.
- \`--finish nonfoil|foil|etched\` — validated against the chosen printing's finishes
  when changing the printing too.
- \`--condition NM|LP|MP|HP|DMG\` — decks and collections only (wanted entries carry
  no condition).
- Decks only: \`--section <name>\` moves the line to that section (created if
  missing); \`--commander\` / \`--no-commander\` move it into / out of the
  \`## Commander\` section.

## Set or clear a note

\`\`\`bash
ritual note "Winota Stax" "Sol Ring" -n "fast mana"        # set or replace
ritual note "Winota Stax" "Sol Ring" --clear               # remove
ritual note "Winota Stax" "Sol Ring" --card-id 5 -n "..." --output json --quiet
\`\`\`

- \`-n/--note\` **replaces unconditionally** — there is no overwrite guard; the
  previous text comes back as \`previousNote\` in JSON output.
- \`--clear\` is idempotent: clearing a card with no note succeeds without touching
  the file (JSON reports \`cleared: false\`).
- Omitting both \`-n\` and \`--clear\` prompts for the text on a terminal, and exits 2
  without one.

## Move cards between lists

The scripted form (\`--from\` + \`--to\`) moves without prompts. Both flags take a plain
list name or a \`deck:\`/\`collection:\`/\`wanted:\` prefix:

\`\`\`bash
ritual move "Lightning Bolt" --from deck:burn --to deck:storm
ritual move "Lightning Bolt" --from burn --to "collection:Main Binder" -q 2
ritual move "Demonic Tutor" --from "wanted:To Buy" --to "collection:Main Binder" \\
  --set sta --collector-number 90     # purchase flow: assign the printing on arrival
ritual move "Duress" --from "collection:Main Binder" --to deck:storm --to-section Sideboard
ritual move --card-id 7 --from "wanted:To Buy" --to deck:storm --output json
\`\`\`

- Select the card by name (fuzzy) or \`--card-id\`. When the name matches several
  distinct printings, the command refuses to pick one arbitrarily and lists them —
  narrow with \`--set\`, \`--collector-number\`, \`--finish\`, or \`--card-id\`.
- Moving into a **collection** requires a concrete printing: a card without one (a
  name-only wanted entry) takes it from \`--set\`/\`--collector-number\`, or from its
  single known printing; otherwise the command errors listing the cached printings.
- Moving into a **deck**, \`--to-section <name>\` targets that section (exact name,
  created if missing) instead of the default; it errors on non-deck destinations.
- Deck sources decrement quantity, notes travel with the card, both lists get
  changelog entries, and \`-q <n>\` moves n copies of the same printing. JSON output:
  \`{moved, card, from, to, droppedNotes}\` — \`droppedNotes\` lists any note discarded
  by a quantity-merge onto an existing deck line whose note differs (also warned on
  stderr).

Interactively, \`ritual move\` (requires a terminal) opens a TUI session across all
lists; \`--from <list>\` alone starts it with only that list enabled as a source
(widen it under Session Filters).

You can also move a card **while editing a list** (in the admin or public in-browser
editor) instead of using the dedicated batch tool: a **Move to list…** item appears in
the per-card menu, the per-list **Selected** menu, and the cross-list **All Selected**
navbar menu, opening a picker of destination lists. The card leaves the list you're
editing, and on save **both** lists are
written — removed from the source, added to the destination, with a changelog entry on
each. Moving a printing-less card into a collection prompts for a specific printing first.

## Interactive editor

\`ritual edit\` is **the** interactive TUI (requires a terminal) for editing decks,
collections, and wanted lists: a selection menu covers all lists (plus create-new
items), and backing out of a list (\`🔀 Switch List\` or Esc) keeps its unsaved changes
in memory while you edit other lists. Save flushes every open list (a separate "save
current list" item saves just one), and each saved list gets one changelog entry per
session. Sessions support name/collector entry modes, per-type edit modes over
existing entries, and undo. Creating a deck prompts for its format, and deck sessions
have a \`🏷️ Change Format\` menu action that rewrites the \`format:\` front matter on the
next save. A deck with no \`format:\` is read as Commander when it has a \`## Commander\`
section, and saving writes that inferred format into the file (see the **ritual-decks**
skill). Not suitable for non-interactive agents — use the one-shot commands above
instead:

\`\`\`bash
ritual edit
ritual edit "Winota Stax"                   # open one list directly, skipping the menu
ritual edit "wanted:To Buy"                 # deck:/collection:/wanted: prefixes and type flags work
ritual edit --sets "FDN,SPG" --finish foil --condition NM   # session filter defaults
ritual edit --section Sideboard             # pin the deck target section
ritual edit --collector --sets "FDN, SPG"   # collector-number entry, sets preloaded
ritual edit --refresh never                 # use the existing cache as-is, no prompt
ritual edit --refresh auto                  # redownload cache when prices are >1 day old
\`\`\`

The \`[listName]\` argument matches the list's **file basename** (like every other
command), not a deck's display title from its front matter.

The selection menu leads with the **multi-list modes** — \`🗃️ All Lists\`, \`🎴 All Decks\`,
\`📦 All Collections\`, \`🎯 All Wanted Lists\` — each shown only when it spans two or more
lists (and \`All Lists\` is skipped when every list shares one type). They edit every list
in scope at once. Adding a card asks **which list** to add it to — an existing one, or a
\`➕ New …\` item that creates one on the spot — and then runs that list's own prompts, so
a deck may take a name-only card while the next card added to a collection still requires
a specific printing. A single-type mode offers only its own type's create item. Edit mode
autocompletes over every in-scope list's entries at once (each labelled with its list), so
cards can be edited or removed across lists without switching. Save writes each list to its
own file and changelog; there is no "save current list" item in these modes.

Creating a list (from the selection menu or from All Lists mode) only creates it **in
memory**: the file appears when you save the editor, and never if you exit without
saving. A pending list shows a \`— new\` badge in the selection menu, and an empty one
still saves (as an empty list file). The creation is listed in \`📋 View Session Changes\`
as \`Created this deck\` (or collection / wanted list) ahead of that list's card changes;
discarding it drops the whole list, and is blocked until the list's own card changes are
discarded first.

## Apply exported changes

\`ritual import-changes\` applies a change bundle exported from the public site's
edit mode (or the admin editor's Export panel) to the underlying list files. The
JSON is a \`ritual-change-bundle\` covering one or more lists — the export panel's
"This list" and "All lists" scopes both produce it. The full change list is
previewed grouped by target list, and nothing is written until you confirm:

\`\`\`bash
ritual import-changes edits.json          # preview, then confirm interactively
ritual import-changes edits.json --yes    # apply without the confirmation prompt
\`\`\`

Agents and scripts must always pass \`--yes\`: when stdin is not a terminal the
command refuses with exit code 2 instead of prompting. With \`--output json\` the
preview is suppressed and the apply report (\`{success, lists, message}\` —
byte-identical to the admin \`/api/import-changes\` response and the MCP
\`import_changes\` tool) is emitted on stdout; \`--yes\` is required there too, since
the confirmation prompt only exists in text mode.

Changes are re-targeted to each list's current \`&N\` card IDs (by ID when it still
exists, else by card name); changes whose target card no longer exists are skipped
and reported. Each list gets a changelog entry, and a failed list (e.g. one that no
longer exists) is reported without stopping the rest. Exits non-zero when any list
fails. The same JSON can also be applied in the web admin's **Import Changes** page.

## Export cards (CSV, JSON, text, Markdown)

\`ritual export\` renders any grouping of cards in one of four formats, chosen with
\`--output csv|json|text|md\` (default \`csv\`). On this command \`--output\` is the
**export format** itself — not the shared \`text|json|ndjson\` envelope other
commands use — and the raw payload goes to stdout unless \`--out <file>\` writes it
to a file. \`text\` merges everything into **one flat decklist** (\`1 Name (SET:CN)\`
lines, quantities aggregated across lists); \`md\` is canonical list markdown
grouped by list and section, **without** \`&N\` ids. Bare \`ritual export\` in a
terminal opens an interactive wizard; agents should always pass flags (any
source, filter, or output flag runs non-interactively). With no lists and no
\`--card\` picks, **every list** is exported:

\`\`\`bash
ritual export --output json > all-cards.json          # everything, JSON on stdout
ritual export deck:burn --out burn.csv                # one deck to a CSV file
ritual export --all --output text                     # one merged decklist on stdout
ritual export --all --output md --out cards.md        # canonical markdown, no &N ids
ritual export "Main Binder" wishlist --set MKM        # two lists, filtered by set
ritual export --card "sol ring" --card "mana crypt"   # cherry-pick cards across lists
ritual export --collection --finish foil --condition NM
ritual export --all --columns name,quantity,listName --no-header --quote-all
ritual export --all --save-preset trade-sheet         # save format/columns/CSV options
ritual export --all --preset trade-sheet --out t.csv  # reuse them (flags override)
\`\`\`

List names take an optional \`deck:\`/\`collection:\`/\`wanted:\` prefix (or scope with
\`--deck\`/\`--collection\`/\`--wanted\`). Filters: \`--name <terms>\`, \`--set <code>\`,
\`--finish nonfoil|foil|etched\` (nonfoil also matches unmarked cards), and
\`--condition <list>\` — comma-separated NM|LP|MP|HP|DMG|none, where a grade
matches only cards with it explicitly marked and \`none\` matches cards without
one (e.g. \`--condition NM,none\`); wanted entries never match. Available columns:
\`name\`, \`quantity\`, \`set\`, \`collectorNumber\`, \`edition\` (set + collector
number as \`SET:number\`), \`finish\`, \`isFoil\` (true when foil or etched),
\`condition\`, \`note\`, \`section\`, \`listName\`, \`listType\`. Columns apply to
csv/json only: giving \`--columns\`, \`--no-header\`, or \`--quote-all\` alongside an
explicit \`--output text|md\` is a usage error (a preset's stored columns with a
text/md format are simply unused). Set codes are lowercase in JSON and UPPERCASE
in CSV, text, and md output. Without \`--out\` the export goes to stdout (the confirmation goes to
stderr, so stdout stays parseable). Presets persist in \`ritual.config.json\` under
\`exportPresets\`. Exit codes: 2 usage error, 3 unknown list/preset.

## Read or compact change history

\`ritual history\` interactively compacts and rewrites a list's \`.changes.md\` log.
Only the changelog is touched — the list file itself is never modified:

\`\`\`bash
ritual history "Winota Stax"
ritual history "Winota Stax" --deck
\`\`\`

**Reading history non-interactively:** \`--show\` prints the change history
newest-first and exits without opening the editor (nothing is ever written), and
\`--limit <n>\` (requires \`--show\`) keeps only the newest \`n\` change sets. This is
how agents read a changelog:

\`\`\`bash
ritual history "Winota Stax" --show
ritual history "Winota Stax" --show --limit 3
ritual history "Winota Stax" --show --output json --quiet
\`\`\`

Combining two change sets orders the merged lines oldest-set-first (newest changes
at the bottom) and cancels opposite changes — an add and a later remove of the same
card annihilate — mirroring the card editor's live change log.
`,
}
