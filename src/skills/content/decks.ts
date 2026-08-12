import type { RitualSkill } from '../types'
import {
  csvImportSection,
  IMPORT_DRY_RUN_GUARANTEE,
  interactiveEditIntro,
  moxfieldUserAgentNote,
  PRICE_CURRENCY_COMMENT,
  priceIntro,
  REFRESH_SESSION,
  sessionSemantics,
  SYNC_CHANGE_FILTER,
  wrapProse,
} from './shared'

export const decksSkill: RitualSkill = {
  name: 'ritual-decks',
  description:
    'Create, build, import, sync, and price Magic: The Gathering decks with Ritual. Use when the user wants to make a new deck, interactively build a deck by adding cards to sections, import a decklist from Archidekt, Moxfield, or MTGGoldfish, import a deck from a CSV file, pull or push changes to Archidekt, extract a deck primer, or price a deck.',
  body: `# Managing decks with Ritual

Decks live in \`decks/<name>.md\`. See the **ritual** skill for the file format and
the **ritual-edit** skill for adding/removing individual cards.

## Create

\`\`\`bash
ritual new deck "Winota Stax"                 # defaults to commander
ritual new deck "Mono-Red Aggro" -f standard  # -f / --format
\`\`\`

Renaming and deleting decks (\`ritual rename\`, \`ritual delete\`) are covered in
the **ritual** skill.

### Deck format

\`--format\` takes one of: \`commander\`, \`oathbreaker\`, \`standard\`, \`modern\`,
\`pioneer\`, \`legacy\`, \`vintage\`, \`pauper\`, \`historic\`, \`alchemy\`, \`explorer\`,
\`timeless\`, \`penny-dreadful\`, \`brawl\`, \`historic-brawl\`, \`duel-commander\`,
\`pauper-commander\`, \`pre-dh\`, \`pre-modern\`, \`limited\`. Common aliases are accepted
and normalized (\`EDH\` → \`commander\`, \`premodern\` → \`pre-modern\`); anything else is
an error.

The format is stored as \`format:\` in the deck's front matter. A deck that declares
none is inferred from its sections — an \`## Oathbreaker\` or \`## Signature Spell\`
section means Oathbreaker (checked first), and a command-zone section such as
\`## Commander\` means Commander — and that inference is written into the file on
its next save, so do not add a \`format:\` by hand to "fix" a deck that displays
correctly.

The rest of the deck's front matter (\`description\`, \`tags\`, \`format\`, and the
\`sourceId\`/\`sourceUrl\` sync link) is scripted with \`ritual metadata\` — a
front-matter-only write that never touches card lines and records no changelog:

\`\`\`bash
ritual metadata set my-deck description "A budget mono-red burn list"
ritual metadata set my-deck tags aggro budget     # replace; --add / --remove merge
ritual metadata set my-deck format modern
ritual metadata list my-deck                      # every field, (unset) included
ritual metadata unset my-deck description
\`\`\`

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill) to edit an
existing deck without a TUI:

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring" --deck
ritual add-card "Winota Stax" "Lightning Bolt" --deck -q 4         # -q quantity
ritual add-card "Winota Stax" "Kenrith, the Returned King" --deck --commander
ritual add-card "Winota Stax" "Pyroblast" --deck --section Sideboard -f foil
ritual remove-card "Winota Stax" "Lightning Bolt" --deck -q 2      # or --all-copies
ritual set-card "Winota Stax" "Sol Ring" --deck --section Sideboard
ritual set-card "Winota Stax" "Winota, Joiner of Forces" --deck --commander
ritual note "Winota Stax" "Sol Ring" --deck -n "fast mana"         # or --clear
ritual move "Lightning Bolt" --from "deck:Winota Stax" --to deck:burn
\`\`\`

Deck adds merge onto an existing line for the same card and printing (never a
duplicate line, and the merged line keeps its \`&N\` and any \`{note}\`) and append
new lines at the end of the deck's first regular section unless
\`--section\`/\`--commander\` says otherwise. Merging wins over placement: when the
deck already runs the printing, the copies join that line where it is, and
\`--commander\` then moves the whole line into the Commander section. Add \`-n\`/\`--dry-run\`
to any one-shot command to preview it without writing anything.

## Build interactively

${interactiveEditIntro({
  pick:
    'pick a deck (or `➕ New Deck`, which prompts for a format) from its list selection menu, ' +
    'then add cards to named `## Section` headers with name/collector entry modes and session ' +
    'filters (`-s/--sets`, `-f/--finish`, `-c/--condition`) plus section targeting and a ' +
    '`🏷️ Change Format` action',
})}

\`\`\`bash
ritual edit                                   # pick a deck, prompt for a section per card
ritual edit "Winota Stax"                     # open one deck directly (matches the file basename)
ritual edit --section Sideboard               # add every deck card to one section
ritual edit --collector --sets "FDN, SPG"     # collector-number entry, sets preloaded
ritual edit --refresh never                   # use the existing cache as-is, no prompt
ritual edit --refresh auto                    # redownload the cache when prices are >1 day old
\`\`\`

${REFRESH_SESSION}

Set the **target section** to a fixed section or "prompt every time" via \`--section\`,
the \`🗂️ Set Target Section\` menu, or the session filters. Adding a card whose printing
already exists in the deck increments its quantity instead of duplicating the line.

${sessionSemantics({
  fileNoun: 'deck file',
  editScope: "the deck's existing lines",
  editFields:
    "change a line's printing or language, add/remove copies, move it to another section, edit its note, or remove it entirely",
  undoAddVerb: 'takes back',
  changeKinds: 'copy adds, field edits, and removals',
  discardTarget: 'same-line changes',
  discardAddEffect:
    'Discarding an add decrements or removes the line; a fully removed session line frees its `&N` id and keeps the remaining session ids dense.',
})}

## Import from a URL or text file

\`\`\`bash
# Archidekt, Moxfield, or MTGGoldfish URL, or a local decklist file
ritual import https://archidekt.com/decks/123456
ritual import ./my-decklist.txt --type deck
ritual import <url> --overwrite          # replace an existing deck of the same name
ritual import <url> --dry-run            # preview without writing files
ritual import <url> --sync-printings     # keep the source's exact printings, without asking
ritual import <url> --no-sync-printings  # import bare card names, without asking
ritual import <url> --no-input           # never prompt (fail if input is required)
\`\`\`

URLs always import decks. A text file import prompts for the list type (deck,
collection, or wanted list) unless \`--type\` is passed; under the global
\`--no-input\` flag a run without \`--type\` defaults to a deck.

Whether a URL import keeps each card's exact printing (set, collector number,
and foil/etched finish) as the source states it is a **prompt** (default yes)
unless \`--sync-printings\` or \`--no-sync-printings\` answers it up front — as an
agent, pass one explicitly (ask the user which they want if unclear).
Declining writes bare card names. Under \`--no-input\` with neither flag the
printings are kept, with a line saying so. MTGGoldfish carries no printing
data, so those imports never ask. Both flags are URL-only — on a CSV or
text-file source they are a usage error (exit 2), since a file's printings are
its own data.

Text imports read Ritual's own format and the MTG Arena/MTGO export dialect —
\`4 Lightning Bolt (M10) 146\` lines plus bare \`Deck\`/\`Sideboard\`/\`Commander\`/
\`Companion\`/\`About\` markers, a trailing \`*F*\`/\`*E*\` foil marker, and the
inside of a \`\`\` fence (a decklist pasted from Discord or GitHub arrives wrapped
in one, so on the import path — and only there — the fence is packaging, not
prose). A \`(SET)\` with no collector number is **not** read as a printing: half a
printing cannot be written to a card line, and \`Very Cryptic Command (Untap)\` is
a real card name, so the name is kept verbatim and an advisory is printed.
Lines the parser cannot read are skipped and reported (exit 1); lines that import
but look wrong (a name still holding a printing token) print an advisory on
stderr and appear in the JSON \`advisories\` array without changing the exit code.

\`--moxfield-user-agent\` applies to URL imports only — passing it with a CSV or
text-file source is a usage error (exit 2).

${IMPORT_DRY_RUN_GUARANTEE}

${wrapProse(moxfieldUserAgentNote({ subject: 'imports' }))}

## Import from a CSV file

${csvImportSection({
  source: 'a CSV export',
  typeNoun: 'deck',
  examples: `ritual import burn.csv --type deck --name "Burn" --deck-format modern \\
  --columns "quantity=1,name=2,section=3"
ritual import more.csv --type deck --name "Burn" --append \\
  --columns "quantity=1,name=2"          # merge into existing lines`,
  requiredColumns: 'only `name` is required for decks',
  appendNote: 'appends merge identical printings, continue card IDs, and record the changelog',
  typeNotes:
    'Conditions/finishes/sections are normalized (e.g. `Near Mint` → `NM`, `F` → foil, `side` → `Sideboard`). `--deck-format` applies only when creating a deck — passing it with `--append` is a usage error.',
})}

## Import an entire Archidekt account

\`\`\`bash
ritual import-account someuser            # interactively pick decks
ritual import-account someuser --all      # import every deck
ritual import-account --all               # use the logged-in account
ritual import-account someuser --all --output json --quiet   # structured result
\`\`\`

Deck selection is a prompt, so \`--all\` is mandatory for an agent: without a
terminal (or under \`--no-input\`) the run exits 2 before fetching anything.
The printing question above applies here too, asked **once for the whole run**
— \`--sync-printings\` / \`--no-sync-printings\` answer it up front.
Existing decks conflict unless \`--overwrite\`/\`--yes\` says what to do. The whole
account is fetched (every page), and \`--output json\` reports
\`found\`/\`selected\`/\`imported\`/\`failed\`/\`skipped\` plus a per-deck array.
A username with no results is reported honestly: Archidekt cannot distinguish an
unknown user from an account with no public decks, so check the spelling.

## Sync with Archidekt

\`deck-sync\` has four subcommands — \`pull\` (Archidekt → local), \`push\`
(local → Archidekt), \`link\`, and \`status\`; anything else exits with code 2:

\`\`\`bash
ritual deck-sync pull                        # pull remote changes for all linked decks
ritual deck-sync push "Winota Stax"          # push local changes for one deck
ritual deck-sync push --dry-run              # preview without sending anything
ritual deck-sync pull --yes                  # accept dropping lines the parser can't read
ritual deck-sync pull --only additions       # add cards locally, never remove any
ritual deck-sync push --only removals        # push removals only, add nothing remotely
ritual deck-sync push "Winota Stax" --force  # overwrite remote edits made since the last sync
ritual deck-sync push --sync-printings       # also sync each card's exact printing + finish
ritual deck-sync status --output json        # what is linked, and when each last synced
ritual deck-sync link "Alpha Deck" https://archidekt.com/decks/123456  # link an existing remote deck
\`\`\`

A text-mode run closes with a tally —
\`Synced 4 decks (2 with changes), 1 skipped, 1 failed.\` — while
\`--output json\` emits the full per-deck report instead.

### Linking and status

\`push\` only operates on decks whose front matter carries \`sourceUrl\` +
\`sourceId\`, which \`import\`/\`import-account\` write. For a deck built locally,
create it on archidekt.com first (Ritual cannot create one — Archidekt has no
API for it), then link it. \`link\` takes an Archidekt **deck** URL (a bare id or
another service exits 2), canonicalizes it, and rewrites the front matter only —
card lines, \`&N\` ids, and prose survive byte for byte. It takes \`--dry-run\`,
\`--output\`, and \`--quiet\`; the MCP \`set_list_metadata\` tool performs the same
write (there, \`sourceId\` and \`sourceUrl\` must name the same Archidekt deck or
the call is rejected). A deck name two decks answer to exits 2, not 3.

\`status\` is read-only and offline (no Archidekt session needed): it lists every
linked deck with its URL and \`lastSynced\`, plus when the account's collection
last synced (or, when that record exists but cannot be read,
\`Collection: sync state unreadable (…)\` rather than \`never synced\`).

### Push divergence guard

A push makes Archidekt match the local file, so cards added on archidekt.com
since the last sync would be deleted. A push therefore compares the remote deck's
\`updatedAt\` against the deck's \`sourceUpdatedAt\` — the remote \`updatedAt\` the
last sync observed — and **fails** that deck when the remote moved on:

\`\`\`
Remote deck changed since last sync (remote: …, last synced against: …) — pull first, or pass --force to overwrite remote changes.
\`\`\`

Pull that deck first (the usual fix), or pass \`--force\` to overwrite
deliberately. A pull records the baseline even when it finds **no card changes**
— a remote rename or category shuffle moves \`updatedAt\` without giving a pull
anything to apply, and "pull first" has to clear the refusal in that case too
(such a pull rewrites the front matter only). \`--dry-run\` reports the same
refusal without needing \`--force\`. A deck that has never synced has nothing to
compare against and pushes normally; a remote that reports no usable
\`updatedAt\` is pushed with a warning saying the guard could not run.

Both sides of the comparison are Archidekt's clock, which is why it is
\`sourceUpdatedAt\` and not \`lastSynced\` (your machine's wall clock, shown by
\`status\`): a client running behind the server would otherwise diverge against
its own push. Never hand-author either field.
Only decks that pushed cleanly get fresh stamps — a failed deck keeps
its old ones. \`collection-sync push\` has **no** such guard: it is
last-writer-wins, so preview it with \`--dry-run\` when you also edit on
Archidekt.

${SYNC_CHANGE_FILTER}

${wrapProse(
  'Use it when the remote and local decks are deliberately out of step and only ' +
    'one direction of change should carry over. It filters cards only: a pull ' +
    'still adopts the remote format. `collection-sync` takes the identical flag ' +
    '(see the **ritual-collections** skill).',
)}

Syncing rewrites the deck file, so a line the parser cannot read would be deleted.
Such decks are listed with their exact lines and confirmed before syncing;
\`--yes\` answers up front, and without a terminal (\`--no-input\`, a pipe, or
\`--output json\`) those decks fail instead.

A pull also adopts the deck's Archidekt format (mapped onto Ritual's format
keys). A push does not push the local format back.

### Printing sync

By default the diff compares card **names and quantities only** — printings
(\`SET:CN\`) and finishes (\`[foil]\`/\`[etched]\`) on either side are ignored.
\`--sync-printings\` (on \`pull\` and \`push\`) also syncs each card's exact
printing: a pull rewrites local lines to the printing Archidekt records
(changelogged as \`set-printing\` events), and a push moves the remote entries to
the local file's printing and finish. A local line that names no printing is
left alone on a push (it expresses no preference); a card with several distinct
printings of one name on either side is skipped with a warning rather than
guessed at. A finish the local line states must exist for that printing on
Archidekt or the deck is reported failed; \`--only\` does not filter printing
updates (they neither add nor remove cards). Condition and language tokens are
never synced — Archidekt deck entries carry neither.

The same sync runs from the admin site's **Sync Decks** page (deck toggles,
direction, change filter, printing sync, live per-deck progress, and each
deck's last-synced time) and from the MCP \`sync_decks\` tool (same \`only\` and
\`syncPrintings\` fields).

## Primer

\`\`\`bash
ritual get-primer "Winota Stax"           # print a local deck's primer as Markdown
ritual get-primer <moxfield-url>          # fetch a primer from Moxfield
\`\`\`

## Price

${priceIntro({ scopeFlag: '--deck' })}

\`\`\`bash
ritual price --deck --summary                       # every deck's totals
ritual price "Winota Stax" --no-input               # one deck's cards + totals
ritual price "Winota Stax" --output json --quiet
ritual price "Winota Stax" --prices eur             ${PRICE_CURRENCY_COMMENT}
\`\`\`

Deck totals cover every section except extras (maybeboard/token). Each deck also
reports a "lowest" total (cheapest printing of every card) and a quantity-weighted
unpriced-card count.
`,
}
