import type { RitualSkill } from '../types'

export const cardsSkill: RitualSkill = {
  name: 'ritual-cards',
  description:
    'Look up Magic: The Gathering cards and run Scryfall searches with Ritual. Use when the user wants details or prices for a specific card, a Scryfall syntax query, batch card lookups, or random cards. Pass --output json to get the full Scryfall card objects for parsing.',
  body: `# Looking up cards with Ritual

These commands query Scryfall and print **readable text by default**: \`card\`
shows the card's name, mana cost, type line, rules text (each face of a
multi-face card), printing and price; \`scry\` prints one
\`Name · SET:CN · Type line · price\` line per card. **To parse the result, always
pass \`--output json\`** (or \`ndjson\`), which emits the full Scryfall card
objects. \`--fields <list>\` projects those objects and implies \`--output json\`
when no \`--output\` is given (\`--fields\` with an explicit \`--output text\` is a
usage error). Neither command registers \`--quiet\`: everything they print is
payload, an error, or a content-loss warning.

## Look up one card

\`\`\`bash
ritual card "Sol Ring"                     # human-readable card text
ritual card "Sol Ring" --output json       # the full Scryfall card object
ritual card "Jace" --fuzzy                 # fuzzy name match instead of exact
ritual card "Sol Ring" --set cmr           # filter by set code
ritual card "Sol Ring" --fields name,set,prices   # projected JSON
\`\`\`

Batch lookups (one card name per line):

\`\`\`bash
ritual card --from-file names.txt --output json
cat names.txt | ritual card --stdin --output json
\`\`\`

A batch's output shape depends only on the flag, never on the input's line
count: \`--output json\` emits ONE array of cards for the whole batch, and
\`--output ndjson\` streams one object per line as results arrive. (A
single-name lookup emits a bare card object; the default text output prints each
card's block, separated by a blank line.) A name that cannot be found makes the
run exit 3 — in text mode with a plain "Card '…' not found." line on stderr, in
\`--output json\` as the error envelope with \`messageKey: cli.card.notFound\`. A
fetch failure exits 1, and in a batch the failure code outranks not-found.

## Raw Scryfall search

\`scry\` runs a raw [Scryfall query](https://scryfall.com/docs/syntax):

\`\`\`bash
ritual scry "c:red cmc<=2 t:instant"                   # one readable line per card
ritual scry "c:red cmc<=2 t:instant" --output json     # the Scryfall card objects
ritual scry "set:fdn r:mythic" --output ndjson
ritual scry "o:draw t:creature" --no-input              # no pagination prompts, one page
ritual scry "t:land" --pages 3                          # fetch the first 3 pages, no prompts
ritual scry "c:blue" --output csv                       # CSV, rendered by Scryfall
\`\`\`

Paging never blocks a script: \`--pages <n>\` fetches up to \`n\` pages without
prompting, and everywhere prompts are unavailable (piped output, the global
\`--no-input\` flag, or \`RITUAL_NO_INPUT\`) exactly one page is fetched. A run
fetches at most 20 pages either way (each page is a separately paced Scryfall
request), and \`--count\` is capped at 50; a larger value is refused at parse
time. There is no fetch-all flag.

\`--output json\` emits ONE array of cards on a scripted run, whatever the page
count — a single-page run and a five-page run produce the same shape, and a run
that matched nothing emits \`[]\`. Interactive paging prints each page as it
arrives instead. \`--output ndjson\` streams one document per card as pages
arrive, and the default text output prints one \`Name · SET:CN · Type line ·
price\` line per card (the price in the configured \`defaultPriceSource\`'s
currency, from Scryfall).
\`scry\` also takes \`--output csv\` (Scryfall's server-side CSV); \`sell\` is the
only other command that does.
When a non-interactive run stops with results left, one line always goes to
stderr (\`Fetched X of Y results (page 1); use --pages <n> for more.\`) so a
capped run is never mistaken for a complete one. A query with no matches exits
3; a Scryfall error exits 1.

## Random cards

\`scry --random\` fetches random cards instead of searching; the (optional) query
becomes a Scryfall filter on the picks:

\`\`\`bash
ritual scry --random
ritual scry "is:commander c:gruul" --random             # constrain with a Scryfall query
ritual scry --random --count 5 --output json            # 5 random cards, emitted as an array
ritual scry --random --output json                      # one bare card object
\`\`\`

Under \`--output json\`, a single pick (the default) is one bare card object and
\`--count\` above 1 is an array; text output prints one line per pick. \`--count\`
requires \`--random\` (max 50), and \`--random\` cannot be combined with \`--pages\`
or \`--output csv\`.

## Live queries vs. the local cache

\`card\` and \`scry\` always query Scryfall **live** — they never read or refresh
the local bulk cache that the list commands (\`add-card\`, \`edit\`, \`price\`,
\`build-site\`, ...) use. To warm that cache for offline or CI work, run
\`ritual cache preload-all\` (bulk download: cards, prices, and tags) or
\`ritual cache preload-set <code>\` for a single set — see the **ritual** skill's
Setup section. Read cached card data (EDHREC rank, market prices) through \`export\`,
\`price\` and \`sell\` output rather than by parsing the cache's \`cache.json\` — the **ritual**
skill's Workspace layout lists which command carries which field.
`,
}
