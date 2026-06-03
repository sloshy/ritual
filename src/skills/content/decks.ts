import type { RitualSkill } from '../types'

export const decksSkill: RitualSkill = {
  name: 'ritual-decks',
  description:
    'Create, import, sync, and price Magic: The Gathering decks with Ritual. Use when the user wants to make a new deck, import a decklist from Archidekt, Moxfield, or MTGGoldfish, pull or push changes to Archidekt, extract a deck primer, or price a deck.',
  body: `# Managing decks with Ritual

Decks live in \`decks/<name>.md\`. See the **ritual** skill for the file format and
the **ritual-edit** skill for adding/removing individual cards.

## Create

\`\`\`bash
ritual new-deck "Winota Stax"                 # defaults to commander
ritual new-deck "Mono-Red Aggro" -f standard  # -f / --format
\`\`\`

## Import from a URL or text file

\`\`\`bash
# Archidekt, Moxfield, or MTGGoldfish URL, or a local decklist file
ritual import https://archidekt.com/decks/123456
ritual import ./my-decklist.txt
ritual import <url> --overwrite          # replace an existing deck of the same name
ritual import <url> --dry-run            # preview without writing files
ritual import <url> --non-interactive    # never prompt (fail if input is required)
\`\`\`

Moxfield imports need a unique User-Agent: pass
\`--moxfield-user-agent "you@example.com"\` or set \`MOXFIELD_USER_AGENT\`.

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

## Primer

\`\`\`bash
ritual get-primer winota-stax             # print a local deck's primer as Markdown
ritual get-primer <moxfield-url>          # fetch a primer from Moxfield
\`\`\`

## Price

\`price-deck\` is non-interactive and supports JSON, so it is easy to parse:

\`\`\`bash
ritual price-deck winota-stax
ritual price-deck winota-stax --output json --quiet
ritual price-deck winota-stax --prices eur          # usd | eur | tix
ritual price-deck winota-stax --all                 # include Sideboard/Maybeboard
ritual price-deck winota-stax --with-sideboard      # include just the Sideboard
\`\`\`
`,
}
