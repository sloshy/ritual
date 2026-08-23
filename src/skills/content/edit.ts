import type { RitualSkill } from '../types'
import { asBullet, NO_INPUT_GUARANTEE, REFRESH_COMMANDS, sessionSavingSemantics } from './shared'

export const editSkill: RitualSkill = {
  name: 'ritual-edit',
  description:
    'Edit cards in any Ritual deck, collection, or wanted list — one-shot non-interactive commands for agents and scripts (add-card, remove-card, set-card, note, scripted move), plus the interactive editor TUI. Use when the user wants to add, remove, or update a card, label a card, give a card custom art, set or clear a card note, move cards between lists, edit lists interactively, apply a change bundle exported from the site editor, export cards as CSV, JSON, plain text, or Markdown, or read or compact a change history.',
  body: `# Editing cards in any Ritual list

The **one-shot commands** — \`add-card\`, \`remove-card\`, \`set-card\`, \`note\`, and the
scripted form of \`move\` — are how agents and scripts edit decks, collections, and
wanted lists: each is a single non-interactive invocation. They keep the \`&N\` card
IDs and the \`.changes.md\` changelog correct — prefer them over hand-editing files.
\`remove-card\`, \`set-card\`, and \`note\` are line-preserving: they touch only the
targeted card's line, so hand-written prose or comments elsewhere in the file survive.
The interactive editor TUI (\`ritual edit\`, below) is the alternative when a human
is driving.

Conventions shared by every one-shot command:

- The first argument is the list **name** (file basename, no \`.md\`). It is resolved
  across all three types unless you pass \`--deck\`, \`--collection\`, or \`--wanted\`
  (or prefix the name: \`deck:burn\`, \`collection:Main Binder\`, \`wanted:To Buy\`).
  A prefix that contradicts the type flag (\`deck:burn --collection\`) is a usage
  error, not a silent override — pass one or the other.
  An ambiguous name is an error; when the matches are all the same type, the fix is
  typing more of the name (or its full name exactly as the file spells it, which
  always wins outright), not a type flag.
- The card is matched by name (case-, accent-, and punctuation-insensitive).
  \`add-card\` matches the name against Scryfall's cards — splitting what you pass on
  whitespace and requiring **every term** to appear in the name, in any order, so
  \`"in tre"\` finds "In the Trenches" — while the other commands (\`remove-card\`,
  \`set-card\`, \`note\`, \`move\`) match the list's existing entries by exact name first,
  then substring, and when several match disambiguate with \`--card-id <N>\` (the
  \`&N\` suffix in the file — \`add-card\` has no \`--card-id\`). Passing a card name
  **and** \`--card-id\` requires them to agree: a mismatch is a usage error naming
  both, so a stale ID can never silently hit the wrong card.
- \`-n\`/\`--dry-run\` (\`--dry-run\` only on \`note\`, whose \`-n\` is \`--note\`) resolves
  and validates everything, reports what would change (text prefixed
  \`[dry-run]\`, JSON carrying \`dryRun: true\`), and writes nothing at all — no list
  file, changelog, sidecar, auto-created list, or card-ID backfill.
- \`--output json\` (or \`ndjson\`) emits a machine-readable result; \`--quiet\`
  suppresses non-essential text.
- Nothing blocks on a prompt in a script: when stdin is not a terminal, a missing
  argument or flag fails fast with exit code 2 (\`Input required: ...\`) instead of
  opening a picker. Exit codes: 1 runtime error, 2 usage error, 3 not found.
${asBullet(NO_INPUT_GUARANTEE)}
${asBullet(REFRESH_COMMANDS)}

## Add a card

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring"                 # resolve across all types
ritual add-card "Winota Stax" "Sol Ring" --deck -q 2     # 2 copies (deck only)
ritual add-card "Main Binder" "Black Lotus" --collection --set lea --collector-number 232 -c LP
ritual add-card "To Buy" "Mox Ruby" --wanted --name-only # any copy
ritual add-card "To Buy" "Demonic Tutor" --wanted --set sta --collector-number 90
ritual add-card "Winota Stax" "Lightning Bolt" --exact --output json
ritual add-card "Winota Stax" "Lightning Bolt" --deck --set sta --collector-number 42 -f foil --section Sideboard
ritual add-card "Winota Stax" "Kenrith, the Returned King" --deck --commander
ritual add-card "Main Binder" "Sol Ring" --collection --set c21 --collector-number 263 -c NM --language ja
ritual add-card "Winota Stax" "Sol Ring" --deck -q 4 --dry-run   # preview, writes nothing
\`\`\`

- \`--collection\` / \`--wanted\` create the list if it does not exist — including in a
  workspace with no lists of that type yet (\`--deck\` does not — use \`ritual new deck\`).
  The file is created only at write time, so a failed add (or a \`--dry-run\`) leaves none.
- Deck adds go through the same engine as the editors: copies **merge onto an
  existing line** for the same card and printing, a new line is appended at the end
  of the target section (the deck's first regular section by default — never a
  hardcoded \`## Main\`), and \`-q N\` records N add events in the changelog.
- \`--set <code>\` + \`--collector-number <cn>\` (always together) pin an exact printing;
  the pair is validated against the card's real printings, and \`-f\` against the
  finishes that printing offers.
- \`-q\` quantity (deck only), \`-f\` finish (nonfoil/foil/etched — any list type),
  \`-c\` condition (NM/LP/MP/HP/DMG, or \`NONE\` to record no condition — decks and
  collections). Decks also take \`--section <name>\` and \`--commander\` to place the
  new line. A flag the target type does not support is an error. Neither
  finish nor condition has an implicit default: without a terminal a collection add
  needs \`-c\`, and any specific-printing add whose printing comes in several finishes
  needs \`-f\` — otherwise the run exits 2 naming the flag instead of writing a
  half-specified line.
- \`--language <code>\` records a non-English copy (lowercase Scryfall codes — \`ja\`, \`de\`,
  \`zhs\`, ...; aliases like \`jp\` or \`Japanese\` normalize). Adding **never prompts** for a
  language: omitted, the configured \`defaultLanguage\` is stamped, and a bare line in the
  file always means English. A pinned non-English add is verified against the printing's
  real languages, like the set/collector-number pair itself.
- Wanted adds must choose a specificity: \`--name-only\` (any copy), a printing pin via
  \`--set\`/\`--collector-number\`, or \`--specific\` (interactive picker). Non-interactive
  runs without one exit 2.
- \`-e\`/\`--exact\` requires the card name to match exactly (no picker). Without a
  terminal the name must match exactly anyway, and a collection add without a
  printing pin succeeds only when the card has a single paper printing — pass
  \`--set\`/\`--collector-number\` to be safe.
- \`--label <label>\` records the new copy's label override (a deck takes \`proxy\`
  alone). There is **no art flag on \`add-card\`**: a line's \`&N\` is allocated by the
  write, so custom art at add time is a two-step — add the card, then aim
  \`set-card --art\` at it (\`--output json\` reports the \`cardId\` the add produced, or
  read the \`&N\` off the written line). This is deliberate: art is list metadata in
  \`<list>.art.json\`, not part of the card line the add writes.

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
ritual set-card "Main Binder" "Sol Ring" --language ja      # mark the Japanese copy
ritual set-card "Main Binder" "Sol Ring" --language en      # back to English (token removed)
ritual set-card "Winota Stax" "Lightning Bolt" --section Sideboard
ritual set-card "Winota Stax" "Winota, Joiner of Forces" --commander
ritual set-card "To Buy" "Demonic Tutor" --wanted --finish foil --output json
\`\`\`

- At least one change flag is required.
- \`--set\` + \`--collector-number\` (always together) change the printing; the pair is
  validated against the card's real printings (an unknown pair is a usage error
  listing what exists). Without \`--finish\` alongside, the current finish is kept.
- \`--finish nonfoil|foil|etched\` — always validated against the printing the line
  will carry (the new one when changing the printing, otherwise the entry's own).
  The check is cache-only: when the card cache cannot vouch for the printing it is
  skipped rather than guessed. A line that names **no** printing cannot take
  \`foil\`/\`etched\` at all (exit 2) — a finish belongs to a printing; pass
  \`--set\`/\`--collector-number\` in the same call to pin one and record the finish
  together. \`--finish nonfoil\` always applies: it clears a token rather than
  asserting one.
- \`--condition NM|LP|MP|HP|DMG|NONE\` — decks and collections only (wanted entries
  carry no condition). \`NONE\` clears a recorded grade; note that \`NM\` is the
  unrecorded default and writes an ungraded line, exactly like \`NONE\`.
- \`--language <code>\` sets the card's language on any list type (canonical Scryfall codes
  or aliases like \`jp\`); \`en\` clears the line's token, since a bare line means English.
  Validated cache-only against the printing's real languages, like \`--finish\`.
- \`--label sale,trade|keep|proxy|none\` — decks and collections. Sets the card's
  label override (\`sale\`/\`trade\` combine; \`keep\` and \`proxy\` each stand alone);
  \`none\` clears it so the list's front-matter default applies again. A
  **deck takes \`proxy\` only** and a wanted list takes no labels at all — anything
  else is a usage error naming what the type supports. \`add-card\` takes the
  same \`--label\` (minus \`none\`) to label a fresh add.
- \`--art <path|url|none>\` — any list type. Records the card's **custom art**: an
  image path relative to the configured \`artDir\` (which must already exist —
  Ritual references images, it never uploads them), an \`http(s)://\` URL kept
  verbatim, or \`none\` to clear it. A file path must end in \`.avif\`, \`.gif\`,
  \`.jpeg\`, \`.jpg\`, \`.png\` or \`.webp\` — the only extensions the art route
  serves; a URL is not extension-checked. A missing file exits 3 naming the path
  it checked; a malformed value (a \`..\` escape, a backslash, a non-image
  extension, a bad URL) exits 2.
  The write goes straight to the list's \`<name>.art.json\` sidecar keyed by the
  card's \`&N\` id — the card line is untouched and **no changelog entry** is
  recorded, so it composes with the other flags but is not a card change. Custom
  art also makes the card **priceless by rule**, exactly like \`--label proxy\`:
  it prices as 0 (unpriced reason \`custom-art\`, not counted as an unpriced
  card) and drops out of \`ritual sell\` and the buylist quotes. See the
  **ritual** skill's *Custom art* section.

\`\`\`bash
ritual set-card "Main Binder" "Sol Ring" --collection --art proxies/sol-ring.jpg
ritual set-card "Winota Stax" "Sol Ring" --deck --art https://example.com/alter.png
ritual set-card "Winota Stax" "Sol Ring" --deck --art none    # back to the printing's own scan
\`\`\`
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
  "Known printings" means the local card cache only — a card the cache has no entry
  for has no printing list, so pass \`--set\`/\`--collector-number\` (verified against
  Scryfall directly) or run \`ritual cache preload-all\` first.
- Moving into a **deck**, \`--to-section <name>\` targets that section (exact name,
  created if missing) instead of the default; it errors on non-deck destinations.
- Deck sources decrement quantity, notes travel with the card, both lists get
  changelog entries, and \`-q <n>\` moves n copies of the same printing. The card's
  **custom art** and — as far as the destination type can express them — its label
  overrides travel too; the art is re-filed under the destination line's new \`&N\`,
  unless the copy merged onto a line the destination already had. JSON output:
  \`{moved, card, from, to, droppedNotes}\` — \`droppedNotes\` lists any note discarded
  by a quantity-merge onto an existing deck line whose note differs (also warned on
  stderr).

Interactively, \`ritual move\` (requires a terminal) opens a TUI session across all
lists; \`--from <list>\` alone starts it with only that list enabled as a source
(widen it under Session Filters). A deck destination asks which section the card
lands in (the deck's sections plus "New section…"; the default one is preselected).
Its **🧺 Batch Mode** menu row switches the session to many-cards-one-destination:
pick which lists to view (seeded from the session's Move FROM filter, but local to
the batch), tick cards off one combined searchable checklist (with "Select all" /
"Select all from…" for whole lists), then choose a single destination for the lot.
Batches queue into the same pending state. Two things drop a card from a batch, each
reported with a count: it already sits in the destination, or it is a printing-less
card headed for a collection whose printing could not be resolved. The session stays
in batch mode until you exit it, or until the viewed lists hold nothing left to move.

You can also move a card **while editing a list** instead of using the dedicated batch
tool. In the admin or public in-browser editor, a **Move to list…** item appears in
the per-card menu, the per-list **Selected** menu, and the cross-list **All Selected**
navbar menu, opening a picker of destination lists. In the \`ritual edit\` TUI, the
same operation is the \`📤 Move to Another List\` action in every type's edit mode
(a deck line moves with all its copies). Either way the card leaves the list you're
editing, and on save **both** lists are
written — removed from the source, added to the destination, with a changelog entry on
each. In a public-site export the move is recorded once, in the bundle's top-level
\`moves\` array (never as a per-list change), and \`ritual import-changes\` applies it
to both lists the same way. Moving a printing-less card into a collection prompts for
a specific printing first. Notes and label overrides never follow an editor/TUI move; the card's
**custom art** does, re-filed under the destination line's new \`&N\`.

The web editors (admin and public) also offer a batch **Swap Printings…** wizard on decks and
collections, built on the same moves: re-pick the printings of many lines at once using copies
already owned in the *other* lists. Entry points are the action bar / navbar edit row (whole
list), the **Selected** menu (pre-checked on the selection), and a pinned card's ⋯ menu (**Swap
printing…**, that card alone). The steps are: tick cards (name-only lines are greyed and cannot
be swapped); choose source lists (decks + collections on by default, wanted lists off but
selectable; the edited list is never a source; only saved contents count); pick **Manual**,
**Most expensive** or **Least expensive** mode — every mode offers a finish filter (it also
seeds the picker's quick-filter) and where displaced copies go (back to each replacement's
source, or one chosen deck/collection — never a wanted list), and the price modes add an
unpriced-candidate policy (**Skip** / **Ignore** / **Ask me** = force a pick by hand); then
per-card picking (manual mode goes straight on to the summary) or, in the price modes, a
review with **Change…** overrides, and a summary with the moves grouped by list and value
before → after. Applying records one **move in** per replacement
copy and one **move out** per displaced copy into the editor's pending changes; Save (admin)
writes both sides like any move, and a public export carries them in the bundle's \`moves\`.

## Interactive editor

\`ritual edit\` is **the** interactive TUI (requires a terminal) for editing decks,
collections, and wanted lists: a selection menu covers all lists (plus create-new
items). Sessions support name/collector entry modes, per-type edit modes over
existing entries (with nothing typed the whole list is listed below the menu
rows, so it can be scrolled as well as searched), and undo. Collector mode is a \`SET:CN\` search over **every
printing in the local Scryfall cache** (\`mkm:123\`, \`mkm 123\`, or a bare token
matched against set codes and collector numbers) — nothing is preloaded, and
\`--sets\` is only an optional filter narrowing that pool. A collector-mode row
already names one printing, so it skips the printing picker and that picker's
language-availability check. Every type's edit mode includes a **Change Language**
action (Scryfall codes; picking \`en\` removes the line's token) and a
\`🎨 Set Custom Art\` action (enter an image URL, browse the configured \`artDir\` for a
file, or clear it — scripted equivalent: \`set-card --art\`). An art edit is deferred
like every other session edit: it is staged, written to the list's \`.art.json\` by the
save, undone by \`↩️ Undo Last Edit\`, and records no changelog entry. Adding a card never
prompts for a language — the configured \`defaultLanguage\` is stamped — and under a
non-English default the printing picker notes when a printing does not exist in that
language, falling back to English. Creating a deck prompts for its format, and deck
sessions have \`🏷️ Change Format\` and \`🔖 Edit Tags\` menu actions that rewrite the front
matter on the next save; deck and collection sessions both offer \`🏷️ Edit List Labels\`
for the default card labels (a deck's choices are \`proxy\` or none — scripted
equivalent: \`ritual metadata\`) plus a per-card \`🏷️ Change Label\` action in edit mode. A deck with no
\`format:\` is read as Commander when it has a \`## Commander\`
section, and saving writes that inferred format into the file (see the **ritual-decks**
skill). Not suitable for non-interactive agents — use the one-shot commands above
instead:

\`\`\`bash
ritual edit
ritual edit "Winota Stax"                   # open one list directly, skipping the menu
ritual edit "wanted:To Buy"                 # deck:/collection:/wanted: prefixes and type flags work
ritual edit --sets "FDN,SPG" --finish foil --condition NM   # session filter defaults
ritual edit --section Sideboard             # pin the deck target section
ritual edit --collector                     # start in SET:CN search mode (whole cache)
ritual edit --collector --sets "FDN, SPG"   # ...narrowed to two sets
ritual edit --allow-digital-only-cards      # include digital-only sets (e.g. Alchemy)
ritual edit --refresh never                 # use the existing cache as-is, no prompt
ritual edit --refresh auto                  # redownload cache when prices are >1 day old
\`\`\`

The \`[listName]\` argument matches the list's **file basename** (like every other
command), not a deck's display title from its front matter.

${sessionSavingSemantics({ fileNoun: 'list file' })}

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
JSON is a \`ritual-change-bundle\` (version 2) covering one or more lists — the export
panel's "This list" and "All lists" scopes both produce it. Each list's own edits sit
in \`lists[].changes\`; cross-list moves are normalized into one top-level \`moves\`
array (source list, destination list, one entry per copy) instead of appearing in
either list's changes. The full change list is previewed grouped by target list, moves
included, and nothing is written until you confirm:

\`\`\`bash
ritual import-changes edits.json          # preview, then confirm interactively
ritual import-changes edits.json --yes    # apply without the confirmation prompt
\`\`\`

Agents and scripts must always pass \`--yes\`: when stdin is not a terminal the
command refuses with exit code 2 instead of prompting. With \`--output json\` the
preview is suppressed and the apply report (\`{success, failedCount, lists, message}\`
— byte-identical to the admin \`/api/import-changes\` response; the MCP
\`import_change_bundle\` tool returns the same fields without the constant \`success\`)
is emitted on stdout; \`--yes\` is required there too, since the confirmation prompt
only exists in text mode. \`success\` is always \`true\` on a report that was produced
at all — read \`failedCount\`, and each list's own \`error\`, to tell a clean import
from a partial one.

Changes are re-targeted to each list's current \`&N\` card IDs (by ID when it still
exists, else by card name); changes whose target card no longer exists are skipped
and reported. A move is applied to both of its lists — removed from the source, added
to the destination — and a changelog entry is written on each. Every touched list gets
a changelog entry, and a failed list (e.g. one that no longer exists) is reported
without stopping the rest. Exits non-zero when any list
fails. The same JSON can also be applied in the web admin's **Import Changes** page.

## Export cards (CSV, JSON, text, Markdown)

\`ritual export\` renders any grouping of cards in one of four formats, chosen with
\`--format csv|json|text|md\` (default \`csv\`). There is no scripting \`--output\`
flag here: the raw payload on stdout *is* the export, unless \`--out <file>\`
writes it to a file instead. \`text\` merges everything into **one flat decklist** (\`1 Name (SET:CN)\`
lines, quantities aggregated across lists); \`md\` is canonical list markdown
grouped by list and section, **without** \`&N\` ids. Bare \`ritual export\` in a
terminal opens an interactive wizard; agents should always pass flags (any
source, filter, or output flag runs non-interactively). With no lists and no
\`--card\` picks, **every list** is exported:

\`\`\`bash
ritual export --format json > all-cards.json          # everything, JSON on stdout
ritual export deck:burn --out burn.csv                # one deck to a CSV file
ritual export --all --format text                     # one merged decklist on stdout
ritual export --all --format md --out cards.md        # canonical markdown, no &N ids
ritual export "Main Binder" wishlist --set MKM        # two lists, filtered by set
ritual export --card "sol ring" --card "mana crypt"   # cherry-pick cards across lists
ritual export --collection --finish foil --condition NM
ritual export --all --columns name,quantity,listName --no-header --quote-all
ritual export --all --save-preset trade-sheet         # save format/columns/CSV options
ritual export --all --preset trade-sheet --out t.csv  # reuse them (flags override)
ritual export --collection --preset archidekt         # built-in: Archidekt import CSV
\`\`\`

List names take an optional \`deck:\`/\`collection:\`/\`wanted:\` prefix (or scope with
\`--deck\`/\`--collection\`/\`--wanted\`). Filters: \`--name <terms>\`, \`--set <code>\`,
\`--finish nonfoil|foil|etched\` (nonfoil also matches unmarked cards),
\`--condition <list>\` — comma-separated NM|LP|MP|HP|DMG|none, where a grade
matches only cards with it explicitly marked and \`none\` matches cards without
one (e.g. \`--condition NM,none\`); wanted entries never match — and
\`--labels <list>\` — comma-separated sale|trade|keep|proxy|none matched against
each deck and collection card's *effective* labels (\`none\` = unlabeled), a deck
line's resolved against the deck's front-matter default, so \`--labels proxy\`
selects a deck's proxies; wanted entries carry no labels and never match.
Available columns:
\`name\`, \`quantity\`, \`set\`, \`collectorNumber\`, \`edition\` (set + collector
number as \`SET:number\`), \`scryfallId\` (the printing's Scryfall UUID, resolved
from the local Scryfall cache — an uncached printing exports an empty cell plus a
warning), \`finish\`, \`isFoil\` (true when foil or etched), \`condition\`,
\`language\` (Scryfall language code; blank for English), \`labels\`
(effective labels, comma-joined), \`note\`,
\`section\`, \`listName\`, \`listType\`. Columns apply to
csv/json only: giving \`--columns\`, \`--dialect\`, \`--no-header\`, or \`--quote-all\`
alongside an explicit \`--format text|md\` is a usage error (a preset's stored
columns with a text/md format are simply unused). Set codes are lowercase in JSON
and UPPERCASE in CSV, text, and md output.

\`--dialect ritual|archidekt\` (csv/json) chooses how finish and condition are
spelled: \`ritual\` (default) writes the file's own values, \`archidekt\` writes
\`Normal|Foil|Etched\` under a \`Variant\` header and \`NM|LP|MP|HP|D\`, filling in
the effective value (\`Normal\`/\`NM\`) for lines that mark none. The built-in
\`archidekt\` preset is that dialect with columns
\`Scryfall ID,Quantity,Variant,Condition\` — the CSV archidekt.com/collections/import
accepts, and what \`ritual collection-sync push\` uploads for large batches.

Without \`--out\` the export goes to stdout (the confirmation goes to
stderr, so stdout stays parseable). Saved presets persist in \`ritual.config.json\`
under \`exportPresets\` and shadow a built-in of the same name. Exit codes: 2 usage
error, 3 unknown list/preset.

## Read or compact change history

\`ritual history\` interactively compacts and rewrites a list's \`.changes.md\` log.
Only the changelog is touched — the list file itself is never modified. The editor
needs a terminal: without one (or under \`--no-input\`) it exits 2 pointing at
\`--show\` rather than opening, and \`--output json\`/\`ndjson\` requires \`--show\` too:

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
ritual history "Winota Stax" --show --output json
\`\`\`

Combining two change sets orders the merged lines oldest-set-first (newest changes
at the bottom) and cancels opposite changes — an add and a later remove of the same
card annihilate — mirroring the card editor's live change log.
`,
}
