import type { RitualSkill } from '../types'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage and price a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, import a collection from a CSV export, or get the total value of a collection.',
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
