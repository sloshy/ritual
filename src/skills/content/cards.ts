import type { RitualSkill } from '../types'

export const cardsSkill: RitualSkill = {
  name: 'ritual-cards',
  description:
    'Look up Magic: The Gathering cards and run Scryfall searches with Ritual. Use when the user wants details or prices for a specific card, a Scryfall syntax query, batch card lookups, or random cards. Output is JSON by default for easy parsing.',
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
ritual scry "o:draw t:creature" --no-input              # no pagination prompts, one page
ritual scry "t:land" --pages 3                          # fetch the first 3 pages, no prompts
ritual scry "c:blue" --csv                              # CSV output
\`\`\`

Paging never blocks a script: \`--pages <n>\` fetches up to \`n\` pages without
prompting, and everywhere prompts are unavailable (piped output, the global
\`--no-input\` flag, or \`RITUAL_NO_INPUT\`) exactly one page is fetched. There is
no fetch-all flag — pass a large \`--pages\` value to get everything.

## Random cards

\`scry --random\` fetches random cards instead of searching; the (optional) query
becomes a Scryfall filter on the picks:

\`\`\`bash
ritual scry --random
ritual scry "is:commander c:gruul" --random             # constrain with a Scryfall query
ritual scry --random --count 5                          # 5 random cards, emitted as an array
ritual scry --random --output text
\`\`\`

With a single pick (the default) the output is one bare card object. \`--count\`
requires \`--random\`, and \`--random\` cannot be combined with \`--pages\` or \`--csv\`.
`,
}
