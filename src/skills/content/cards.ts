import type { RitualSkill } from '../types'

export const cardsSkill: RitualSkill = {
  name: 'ritual-cards',
  description:
    'Look up Magic: The Gathering cards and run Scryfall searches with Ritual. Use when the user wants details or prices for a specific card, a Scryfall syntax query, batch card lookups, or a random card. Output is JSON by default for easy parsing.',
  body: `# Looking up cards with Ritual

These commands query Scryfall and print **JSON by default**, so they are easy to
parse. All accept \`--output json|ndjson|text\`, \`--fields <list>\`, and \`--quiet\`.

## Look up one card

\`\`\`bash
ritual card "Sol Ring"
ritual card "Jace" --fuzzy                 # fuzzy name match instead of exact
ritual card "Sol Ring" --set cmr           # filter by set code
ritual card "Sol Ring" --output text       # human-readable
ritual card "Sol Ring" --fields name,set,prices --output ndjson
\`\`\`

Batch lookups (one card name per line):

\`\`\`bash
ritual card --from-file names.txt
cat names.txt | ritual card --stdin
\`\`\`

## Raw Scryfall search

\`scry\` runs a raw [Scryfall query](https://scryfall.com/docs/syntax):

\`\`\`bash
ritual scry "c:red cmc<=2 t:instant"
ritual scry "set:fdn r:mythic" --output ndjson
ritual scry "o:draw t:creature" --non-interactive       # no pagination prompts
ritual scry "t:land" --pages 3 --yes                    # fetch the first 3 pages
ritual scry "c:blue" --csv                              # CSV output
\`\`\`

In scripts always pass \`--non-interactive\` (or \`--yes\`) so pagination never blocks.

## Random card

\`\`\`bash
ritual random
ritual random --filter "is:commander c:gruul"           # constrain with a Scryfall query
ritual random --output text
\`\`\`
`,
}
