import type { RitualSkill } from '../types'

export const editSkill: RitualSkill = {
  name: 'ritual-edit',
  description:
    'Edit cards in any Ritual deck, collection, or wanted list — non-interactive commands for agents and scripts, plus the interactive editor TUI. Use when the user wants to add or remove a card, set or clear a card note, edit lists interactively, move cards between lists, apply a change bundle exported from the site editor, export cards as CSV or JSON, or compact a change history.',
  body: `# Editing cards in any Ritual list (non-interactive)

These commands edit a deck, collection, or wanted list **without an interactive
TUI**, so they are the right tools for agents and scripts. They keep the \`&N\` card
IDs and the \`.changes.md\` changelog correct — prefer them over hand-editing files.

The first argument is the list **name** (file basename). It is resolved across all
three types unless you pass \`--deck\`, \`--collection\`, or \`--wanted\`. When a name is
ambiguous across types, a type flag is required.

## Add a card

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring"                 # resolve across all types
ritual add-card "Winota Stax" "Sol Ring" --deck -q 2     # 2 copies (deck only)
ritual add-card "Main Binder" "Black Lotus" --collection -f foil -c NM
ritual add-card "To Buy" "Mox Ruby" --wanted
ritual add-card "Winota Stax" "Lightning Bolt" --exact   # skip the interactive name picker
\`\`\`

- \`--collection\` / \`--wanted\` create the list if it does not exist (\`--deck\` does not — use \`new-deck\`).
- \`-q\` quantity (deck only), \`-f\` finish (nonfoil/foil/etched), \`-c\` condition (NM/LP/MP/HP/DMG).
- \`-e\`/\`--exact\` matches the card name exactly so no prompt is shown.

## Add or replace a note

\`\`\`bash
ritual add-note "Winota Stax" "Sol Ring" -n "fast mana"
ritual add-note "Winota Stax" "Sol Ring" -n "ramp" --overwrite   # replace an existing note
ritual add-note "Winota Stax" "Sol Ring" --card-id 5 -n "..."    # disambiguate by &N
ritual add-note "Winota Stax" "Sol Ring" -n "..." --output json --quiet
\`\`\`

Omit \`-n\` to be prompted for the text (interactive). Use \`--card-id <N>\` (the \`&N\`
suffix in the file) when the same card name appears more than once. Without
\`--overwrite\`, adding a note to a card that already has one fails.

## Clear a note

\`\`\`bash
ritual clear-note "Winota Stax" "Sol Ring"
ritual clear-note "Winota Stax" "Sol Ring" --card-id 5
ritual clear-note "Winota Stax" "Sol Ring" --output json --quiet
\`\`\`

## Interactive editor

\`ritual edit\` is **the** interactive TUI (requires a terminal) for editing decks,
collections, and wanted lists: a selection menu covers all lists (plus create-new
items), and backing out of a list (\`🔀 Switch List\` or Esc) keeps its unsaved changes
in memory while you edit other lists. Save flushes every open list (a separate "save
current list" item saves just one), and each saved list gets one changelog entry per
session. Sessions support name/collector entry modes, per-type edit modes over
existing entries, and undo. Creating a deck prompts for its format, and deck sessions
have a \`🏷️ Change Format\` menu action that rewrites the \`format:\` front matter on the
next save. Not suitable for non-interactive agents — use
\`add-card\`/\`add-note\`/\`clear-note\` instead:

\`\`\`bash
ritual edit
ritual edit --sets "FDN,SPG" --finish foil --condition NM   # session filter defaults
ritual edit --section Sideboard             # pin the deck target section
ritual edit --collector --sets "FDN, SPG"   # collector-number entry, sets preloaded
ritual edit --no-cache-prompt               # skip the "cache is >1 week old?" prompt
ritual edit --refresh-prices                # redownload cache when prices are >1 day old
\`\`\`

The selection menu's first item, \`🗃️ All Lists\` (shown once there are two or more
lists), edits every list at once. Adding a card asks **which list** to add it to and
then runs that list's own prompts, so a deck may take a name-only card while the next
card added to a collection still requires a specific printing. Edit mode autocompletes
over every list's entries at once (each labelled with its list), so cards can be edited
or removed across lists without switching. Save writes each list to its own file and
changelog; there is no "save current list" item in this mode.

## Move cards between lists

\`ritual move\` is an interactive TUI (requires a terminal) for moving cards between
decks, collections, and wanted lists:

\`\`\`bash
ritual move
\`\`\`

For **non-interactive** moves, use the web admin's HTTP API or the MCP \`move_cards\`
tool (see the **ritual-site** skill).

You can also move a card **while editing a list** (in the admin or public in-browser
editor) instead of using the dedicated batch tool: a **Move to list…** item appears in
the per-card menu, the per-list **Selected** menu, and the cross-list **All Selected**
navbar menu, opening a picker of destination lists. The card leaves the list you're
editing, and on save **both** lists are
written — removed from the source, added to the destination, with a changelog entry on
each. Moving a printing-less card into a collection prompts for a specific printing first.

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

Changes are re-targeted to each list's current \`&N\` card IDs (by ID when it still
exists, else by card name); changes whose target card no longer exists are skipped
and reported. Each list gets a changelog entry, and a failed list (e.g. one that no
longer exists) is reported without stopping the rest. Exits non-zero when any list
fails. The same JSON can also be applied in the web admin's **Import Changes** page.

## Export cards as CSV or JSON

\`ritual export\` renders any grouping of cards to CSV or JSON. Bare \`ritual export\`
in a terminal opens an interactive wizard; agents should always pass flags (any
source, filter, or output flag runs non-interactively). With no lists and no
\`--card\` picks, **every list** is exported:

\`\`\`bash
ritual export --format json > all-cards.json          # everything, JSON on stdout
ritual export deck:burn --out burn.csv                # one deck to a CSV file
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
\`condition\`, \`note\`, \`section\`, \`listName\`, \`listType\`. Set codes are
lowercase in JSON and UPPERCASE in CSV. Without \`--out\` the export goes to stdout (the confirmation goes to
stderr, so stdout stays parseable). Presets persist in \`ritual.config.json\` under
\`exportPresets\`. Exit codes: 2 usage error, 3 unknown list/preset.

## Compact change history

\`ritual history\` interactively compacts and rewrites a list's \`.changes.md\` log.
Only the changelog is touched — the list file itself is never modified:

\`\`\`bash
ritual history "Winota Stax"
ritual history "Winota Stax" --deck
\`\`\`

Combining two change sets orders the merged lines oldest-set-first (newest changes
at the bottom) and cancels opposite changes — an add and a later remove of the same
card annihilate — mirroring the card editor's live change log.
`,
}
