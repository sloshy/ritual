import type { RitualSkill } from '../types'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage and price a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, or get the total value of a collection.',
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
