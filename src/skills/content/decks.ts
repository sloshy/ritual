import type { RitualSkill } from '../types'
import {
  csvImportSection,
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

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill) to edit an
existing deck without a TUI:

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring" --deck
ritual add-card "Winota Stax" "Lightning Bolt" --deck -q 4         # -q quantity
ritual remove-card "Winota Stax" "Lightning Bolt" --deck -q 2      # or --all-copies
ritual set-card "Winota Stax" "Sol Ring" --deck --section Sideboard
ritual set-card "Winota Stax" "Winota, Joiner of Forces" --deck --commander
ritual note "Winota Stax" "Sol Ring" --deck -n "fast mana"         # or --clear
ritual move "Lightning Bolt" --from "deck:Winota Stax" --to deck:burn
\`\`\`

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
    "change a line's printing, add/remove copies, move it to another section, edit its note, or remove it entirely",
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
ritual import <url> --no-input           # never prompt (fail if input is required)
\`\`\`

URLs always import decks. A text file import prompts for the list type (deck,
collection, or wanted list) unless \`--type\` is passed; under the global
\`--no-input\` flag a run without \`--type\` defaults to a deck.

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
\`\`\`

Deck selection is a prompt, so \`--all\` is mandatory for an agent: without a
terminal (or under \`--no-input\`) the run exits 2 before fetching anything.
Existing decks conflict unless \`--overwrite\`/\`--yes\` says what to do.

## Sync with Archidekt

The first argument is the sync direction — \`pull\` (Archidekt → local) or \`push\`
(local → Archidekt); anything else exits with code 2:

\`\`\`bash
ritual deck-sync pull                        # pull remote changes for all linked decks
ritual deck-sync push "Winota Stax"          # push local changes for one deck
ritual deck-sync push --dry-run              # preview without sending anything
ritual deck-sync pull --yes                  # accept dropping lines the parser can't read
ritual deck-sync pull --only additions       # add cards locally, never remove any
ritual deck-sync push --only removals        # push removals only, add nothing remotely
\`\`\`

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

The same sync runs from the admin site's **Sync Decks** page (deck toggles,
direction, change filter, live per-deck progress, and each deck's last-synced
time) and from the MCP \`sync_decks\` tool (same \`only\` field).

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
