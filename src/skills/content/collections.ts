import type { RitualSkill } from '../types'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage and price a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, import a collection from a CSV export or text file, or get the total value of a collection.',
  body: `# Managing collections with Ritual

Collections of owned cards live in \`collections/<name>.md\`. See the **ritual**
skill for the file format.

## Add cards (non-interactive — best for agents)

Use \`add-card\` (covered by the **ritual-edit** skill). It works on collections and
creates the collection if it does not exist yet:

\`\`\`bash
ritual add-card "Main Binder" "Sol Ring" --collection
ritual add-card "Main Binder" "Black Lotus" --collection -f foil -c NM
\`\`\`

\`-f\` finish (nonfoil/foil/etched), \`-c\` condition (NM/LP/MP/HP/DMG).

## Interactive management

\`ritual edit\` opens the interactive editor (covered in full by the **ritual-edit**
skill); pick a collection (or \`➕ New Collection\`) from its list selection menu to
bulk-add cards. It **requires a terminal**, so it is not suitable for non-interactive
agents — use \`add-card\` instead.

\`\`\`bash
ritual edit
ritual edit --sets "FDN,SPG"         # restrict to these set codes
ritual edit --finish foil --condition NM
ritual edit --collector              # enter cards by collector number
ritual edit --allow-digital-only-cards
ritual edit --no-cache-prompt        # skip the "cache is >1 week old, update?" prompt
ritual edit --refresh-prices         # redownload the cache when prices are >1 day old
\`\`\`

When the card cache was last fully downloaded more than a week ago, the session prompts to redownload it before starting; \`--no-cache-prompt\` suppresses that prompt. \`--refresh-prices\` redownloads the cache (refreshing prices) without prompting when the cached prices are more than a day old.

Within the session, changes accumulate **in memory**: \`💾 Save\` writes the file and changelog without exiting (saving repeatedly in one session folds the later changes into that session's existing changelog entry and bumps its timestamp, so one editing session is always one changelog entry), and \`🚪 Exit\` (or Esc) opens an exit menu when changes are unsaved — save and exit, exit without saving (discards everything unsaved), or cancel to keep editing. \`🛠️ Switch to Edit Mode\` turns the search prompt into a picker over the collection's existing entries — change a card's printing, finish, condition, or note, or remove it — and \`↩️ Undo Last Edit\` reverts the latest edit. \`↩️ Undo Last Add\` removes the most recent card and \`📋 View Session Changes\` opens a picker over every change made this session — adds, edits, and removals — where selecting one offers to discard just that change (same-card changes must be discarded newest-first). Discarding an add frees that card's \`&N\` id and keeps the remaining session ids dense (each later card slides down one).

## Import from a text file

\`import\` turns a decklist-style text file into a new collection (quantities expand
to one bullet line per copy):

\`\`\`bash
ritual import binder.txt --type collection
ritual import binder.txt --type collection --overwrite --non-interactive
\`\`\`

Without \`--type\` an interactive run prompts for the list type; non-interactive runs
default to a deck, so agents should always pass \`--type collection\`. Every line
must carry a printing (e.g. \`2 Sol Ring (C19:221)\`) — collections track specific
physical printings, so name-only lines are rejected.

## Import from a CSV file

\`import-csv\` imports a CSV export (Moxfield, Deckbox, ManaBox, ...) into a new
collection, or appends to an existing one. Non-interactive agents must pass all flags
(running it bare opens an interactive column-mapping wizard):

\`\`\`bash
ritual import-csv binder.csv --type collection --name "Red Binder" \\
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
ritual import-csv more.csv --type collection --name "Red Binder" --append \\
  --columns "name=1,set=2,collector-number=3"
\`\`\`

\`--columns\` maps fields to 1-based column numbers; collections require \`name\`,
\`set\`, and \`collector-number\` columns. Add \`--no-header\` when the first row is data,
\`--overwrite\` to replace an existing collection, or \`--append\` to add to one
(appends continue card IDs and record the changelog). Conditions/finishes are
normalized (e.g. \`Near Mint\` → \`NM\`, \`F\` → foil, empty → non-foil). Failed rows are
reported with line numbers on stderr and the rest still import (exit code 1 on
partial failure).

## Price

The unified \`price\` command covers all list types; scope it with \`--collection\` or a
name. An interactive browser opens on a TTY — for agents, always pass a non-interactive
flag (\`--summary\`, \`--no-interactive\`, or \`--output json\`):

\`\`\`bash
ritual price --collection --summary            # every collection's totals
ritual price main-binder --no-interactive      # one collection's cards + totals
ritual price main-binder --output json --quiet
ritual price main-binder --sort price --descending --no-interactive
ritual price main-binder --prices eur          # usd | eur | tix (defaults to config defaultCurrency)
\`\`\`

Collection entries are priced at their exact printing and finish; totals include a
quantity-weighted unpriced-card count.
`,
}
