import type { RitualSkill } from '../types'

export const decksSkill: RitualSkill = {
  name: 'ritual-decks',
  description:
    'Create, build, import, sync, and price Magic: The Gathering decks with Ritual. Use when the user wants to make a new deck, interactively build a deck by adding cards to sections, import a decklist from Archidekt, Moxfield, or MTGGoldfish, pull or push changes to Archidekt, extract a deck primer, or price a deck.',
  body: `# Managing decks with Ritual

Decks live in \`decks/<name>.md\`. See the **ritual** skill for the file format and
the **ritual-edit** skill for adding/removing individual cards.

## Create

\`\`\`bash
ritual new-deck "Winota Stax"                 # defaults to commander
ritual new-deck "Mono-Red Aggro" -f standard  # -f / --format
\`\`\`

## Add cards (non-interactive — best for agents)

Use \`add-card\` (covered by the **ritual-edit** skill) to add a single card to an
existing deck without a TUI:

\`\`\`bash
ritual add-card winota-stax "Sol Ring" --deck
ritual add-card winota-stax "Lightning Bolt" --deck -q 4   # -q quantity
\`\`\`

## Build interactively

\`ritual deck\` opens an interactive builder (the deck counterpart to \`ritual collection\`
and \`ritual wanted\`). You select or create a deck, then add cards to named \`## Section\`
headers. It shares the same name/collector entry modes and session filters
(\`-s/--sets\`, \`-f/--finish\`, \`-c/--condition\`) and adds section targeting. It **requires
a terminal**, so it is not suitable for non-interactive agents — use \`add-card\` instead.

\`\`\`bash
ritual deck                                   # pick a deck, prompt for a section per card
ritual deck --section Sideboard               # add every card to one section
ritual deck --collector --sets "FDN, SPG"     # collector-number entry, sets preloaded
\`\`\`

Set the **target section** to a fixed section or "prompt every time" via \`--section\`,
the \`🗂️ Set Target Section\` menu, or the session filters. Adding a card whose printing
already exists in the deck increments its quantity instead of duplicating the line.

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
