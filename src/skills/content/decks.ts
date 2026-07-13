import type { RitualSkill } from '../types'

export const decksSkill: RitualSkill = {
  name: 'ritual-decks',
  description:
    'Create, build, import, sync, and price Magic: The Gathering decks with Ritual. Use when the user wants to make a new deck, interactively build a deck by adding cards to sections, import a decklist from Archidekt, Moxfield, or MTGGoldfish, import a deck from a CSV file, pull or push changes to Archidekt, extract a deck primer, or price a deck.',
  body: `# Managing decks with Ritual

Decks live in \`decks/<name>.md\`. See the **ritual** skill for the file format and
the **ritual-edit** skill for adding/removing individual cards.

## Create

\`\`\`bash
ritual new-deck "Winota Stax"                 # defaults to commander
ritual new-deck "Mono-Red Aggro" -f standard  # -f / --format
\`\`\`

### Deck format

\`--format\` takes one of: \`commander\`, \`oathbreaker\`, \`standard\`, \`modern\`,
\`pioneer\`, \`legacy\`, \`vintage\`, \`pauper\`, \`historic\`, \`alchemy\`, \`explorer\`,
\`timeless\`, \`penny-dreadful\`, \`brawl\`, \`historic-brawl\`, \`duel-commander\`,
\`pauper-commander\`, \`pre-dh\`, \`pre-modern\`, \`limited\`. Common aliases are accepted
and normalized (\`EDH\` → \`commander\`, \`premodern\` → \`pre-modern\`); anything else is
an error.

The format is stored as \`format:\` in the deck's front matter. A deck that declares
none is treated as Commander when it has a \`## Commander\` section, and that
inference is written into the file on its next save — so do not add a \`format:\` by
hand to "fix" a deck that displays correctly.

## Add cards (non-interactive — best for agents)

Use \`add-card\` (covered by the **ritual-edit** skill) to add a single card to an
existing deck without a TUI:

\`\`\`bash
ritual add-card winota-stax "Sol Ring" --deck
ritual add-card winota-stax "Lightning Bolt" --deck -q 4   # -q quantity
\`\`\`

## Build interactively

\`ritual edit\` opens the interactive editor (covered in full by the **ritual-edit**
skill); pick a deck (or \`➕ New Deck\`, which prompts for a format) from its list
selection menu, then add cards to named \`## Section\` headers with name/collector entry
modes and session filters (\`-s/--sets\`, \`-f/--finish\`, \`-c/--condition\`) plus section
targeting and a \`🏷️ Change Format\` action. It **requires a terminal**, so it is not
suitable for non-interactive agents — use \`add-card\` instead.

\`\`\`bash
ritual edit                                   # pick a deck, prompt for a section per card
ritual edit --section Sideboard               # add every deck card to one section
ritual edit --collector --sets "FDN, SPG"     # collector-number entry, sets preloaded
ritual edit --no-cache-prompt                 # skip the "cache is >1 week old, update?" prompt
ritual edit --refresh-prices                  # redownload the cache when prices are >1 day old
\`\`\`

When the card cache was last fully downloaded more than a week ago, the session prompts
to redownload it before starting; \`--no-cache-prompt\` suppresses that prompt and uses the
existing cache. \`--refresh-prices\` redownloads the cache (refreshing prices) without
prompting when the cached prices are more than a day old.

Set the **target section** to a fixed section or "prompt every time" via \`--section\`,
the \`🗂️ Set Target Section\` menu, or the session filters. Adding a card whose printing
already exists in the deck increments its quantity instead of duplicating the line.

**Saving:** changes accumulate **in memory** — \`💾 Save\` writes the deck file and changelog
without exiting, and \`🚪 Exit\` (or Esc) opens an exit menu when changes are unsaved: save and
exit, exit without saving (discards everything unsaved), or cancel to keep editing. Saving more than
once in one session folds the later changes into the session's existing changelog entry (bumping its
timestamp) rather than writing a new entry per save — one editing session is always one changelog
entry.

**Edit mode:** \`🛠️ Switch to Edit Mode\` turns the search prompt into a picker over the deck's
existing lines — change a line's printing, add/remove copies, move it to another section, edit
its note, or remove it entirely — and \`↩️ Undo Last Edit\` reverts the latest edit.

**Undo within the session:** \`↩️ Undo Last Add\` takes back the most recent card, and
\`📋 View Session Changes\` opens a picker over every change made this session — copy adds,
field edits, and removals — where selecting one offers to discard just that change
(same-line changes must be discarded newest-first). Discarding an add decrements or removes
the line; a fully removed session line frees its \`&N\` id and keeps the remaining session
ids dense.

## Import from a URL or text file

\`\`\`bash
# Archidekt, Moxfield, or MTGGoldfish URL, or a local decklist file
ritual import https://archidekt.com/decks/123456
ritual import ./my-decklist.txt --type deck
ritual import <url> --overwrite          # replace an existing deck of the same name
ritual import <url> --dry-run            # preview without writing files
ritual import <url> --non-interactive    # never prompt (fail if input is required)
\`\`\`

URLs always import decks. A text file import prompts for the list type (deck,
collection, or wanted list) unless \`--type\` is passed; non-interactive runs
without \`--type\` default to a deck.

Moxfield imports need a unique User-Agent: pass
\`--moxfield-user-agent "you@example.com"\` or set \`MOXFIELD_USER_AGENT\`.

## Import from a CSV file

\`import-csv\` imports a CSV export into a new deck, or appends to an existing one.
Non-interactive agents must pass all flags (running it bare opens an interactive
column-mapping wizard):

\`\`\`bash
ritual import-csv burn.csv --type deck --name "Burn" --format modern \\
  --columns "quantity=1,name=2,section=3"
ritual import-csv more.csv --type deck --name "Burn" --append \\
  --columns "quantity=1,name=2"          # merge into existing lines; no --format needed
\`\`\`

\`--columns\` maps fields to 1-based column numbers (fields: \`name\`, \`set\`,
\`collector-number\`, \`condition\`, \`finish\`, \`section\`, \`quantity\`; only \`name\` is
required for decks). Add \`--no-header\` when the first row is data, \`--overwrite\` to
replace an existing deck, or \`--append\` to add to one (appends merge identical
printings, continue card IDs, and record the changelog). Conditions/finishes/sections
are normalized (e.g. \`Near Mint\` → \`NM\`, \`F\` → foil, \`side\` → \`Sideboard\`). Failed
rows are reported with line numbers on stderr and the rest still import (exit code 1
on partial failure).

## Import an entire Archidekt account

\`\`\`bash
ritual import-account someuser            # interactively pick decks
ritual import-account someuser --all      # import every deck
ritual import-account --all               # use the logged-in account
\`\`\`

## Sync with Archidekt

\`\`\`bash
ritual deck-sync                          # sync all linked decks
ritual deck-sync winota-stax              # one deck
ritual deck-sync --download-changes       # pull remote changes only
ritual deck-sync --upload-changes         # push local changes only
\`\`\`

A download also adopts the deck's Archidekt format (mapped onto Ritual's format
keys). An upload does not push the local format back.

## Primer

\`\`\`bash
ritual get-primer winota-stax             # print a local deck's primer as Markdown
ritual get-primer <moxfield-url>          # fetch a primer from Moxfield
\`\`\`

## Price

The unified \`price\` command covers all list types; scope it with \`--deck\` or a name.
An interactive browser opens on a TTY — for agents, always pass a non-interactive flag
(\`--summary\`, \`--no-interactive\`, or \`--output json\`):

\`\`\`bash
ritual price --deck --summary                       # every deck's totals
ritual price winota-stax --no-interactive           # one deck's cards + totals
ritual price winota-stax --output json --quiet
ritual price winota-stax --prices eur               # usd | eur | tix (defaults to config defaultCurrency)
\`\`\`

Deck totals cover every section except extras (maybeboard/token). Each deck also
reports a "lowest" total (cheapest printing of every card) and a quantity-weighted
unpriced-card count.
`,
}
