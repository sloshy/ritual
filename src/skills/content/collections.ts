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

\`ritual collection\` opens an interactive TUI for bulk-adding cards. It **requires a
terminal**, so it is not suitable for non-interactive agents — use \`add-card\` instead.

\`\`\`bash
ritual collection                          # alias: ritual collect
ritual collection --sets "FDN,SPG"         # restrict to these set codes
ritual collection --finish foil --condition NM
ritual collection --collector              # enter cards by collector number
ritual collection --allow-digital-only-cards
\`\`\`

Within the session, changes accumulate **in memory**: \`💾 Save\` writes the file and changelog without exiting, \`✅ Done\` saves and exits, and \`🚪 Exit Without Saving\` discards everything unsaved. \`🛠️ Switch to Edit Mode\` turns the search prompt into a picker over the collection's existing entries — change a card's printing, finish, condition, or note, or remove it — and \`↩️ Undo Last Edit\` reverts the latest edit. \`↩️ Undo Last Add\` removes the most recent card and \`🗑️ Discard a Card Added This Session\` opens a picker to drop any card you added this session. Discarding frees that card's \`&N\` id and keeps the remaining session ids dense (each later card slides down one).

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

\`\`\`bash
ritual price-collection                       # every collection
ritual price-collection main-binder           # one collection
ritual price-collection main-binder --output json --quiet
ritual price-collection main-binder --sort price --descending
ritual price-collection main-binder --prices eur     # usd | eur | tix
\`\`\`

Alias: \`ritual pc\`.
`,
}
