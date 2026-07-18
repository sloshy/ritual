import type { RitualSkill } from '../types'
import {
  csvImportSection,
  DIFF_BY_MODES,
  interactiveEditIntro,
  PRICE_CURRENCY_COMMENT,
  priceIntro,
  REFRESH_SESSION,
  sessionSemantics,
  textImportSection,
  wrapProse,
} from './shared'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage and price a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, import a collection from a CSV export or text file, or get the total value of a collection.',
  body: `# Managing collections with Ritual

Collections of owned cards live in \`collections/<name>.md\`. See the **ritual**
skill for the file format.

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill).
\`add-card\` works on collections, and — when the type is pinned with
\`--collection\` or a \`collection:\` prefix — creates the collection if it does
not exist yet:

\`\`\`bash
ritual add-card "Main Binder" "Sol Ring" --collection --set c21 --collector-number 263
ritual add-card "Main Binder" "Black Lotus" --collection --set lea --collector-number 232 -c LP
ritual remove-card "Main Binder" "Sol Ring" --collection             # one entry
ritual set-card "Main Binder" "Sol Ring" --collection --finish foil --condition NM
ritual note "Main Binder" "Black Lotus" --collection -n "graded"     # or --clear
ritual move "Sol Ring" --from "collection:Main Binder" --to deck:burn
\`\`\`

\`-f\` finish (nonfoil/foil/etched), \`-c\` condition (NM/LP/MP/HP/DMG, or \`NONE\` to
record no condition). Collections track specific physical printings, so pin one
with \`--set\` + \`--collector-number\` — a non-interactive add without a pin only
succeeds when the card has a single paper printing.

## Interactive management

${interactiveEditIntro({
  pick: 'pick a collection (or `➕ New Collection`) from its list selection menu to bulk-add cards',
})}

\`\`\`bash
ritual edit
ritual edit "Main Binder"            # open one collection directly (matches the file basename)
ritual edit --sets "FDN,SPG"         # restrict to these set codes
ritual edit --finish foil --condition NM
ritual edit --collector              # enter cards by collector number
ritual edit --allow-digital-only-cards
ritual edit --refresh never          # use the existing cache as-is, no prompt
ritual edit --refresh auto           # redownload the cache when prices are >1 day old
\`\`\`

${REFRESH_SESSION}

${sessionSemantics({
  fileNoun: 'file',
  editScope: "the collection's existing entries",
  editFields: "change a card's printing, finish, condition, or note, or remove it",
  undoAddVerb: 'removes',
  changeKinds: 'adds, edits, and removals',
  discardTarget: 'same-card changes',
  discardAddEffect:
    "Discarding an add frees that card's `&N` id and keeps the remaining session ids dense (each later card slides down one).",
})}

## Compare with another list

${wrapProse(
  '`ritual diff` compares any two lists — e.g. which wanted cards a collection ' +
    `already covers, or what two collections share. ${DIFF_BY_MODES}`,
)}

\`\`\`bash
ritual diff wanted:to-buy "collection:Main Binder"          # overlap = already owned
ritual diff "Main Binder" trade-binder --by printing --output json
\`\`\`

## Import from a text file

${textImportSection({
  typeNoun: 'collection',
  typeFlag: 'collection',
  examples: `ritual import binder.txt --type collection
ritual import binder.txt --type collection --overwrite --no-input`,
  extra:
    'Every line must carry a printing (e.g. `2 Sol Ring (C19:221)`) — collections track specific physical printings, so name-only lines are rejected.',
})}

## Import from a CSV file

${csvImportSection({
  source: 'a CSV export (Moxfield, Deckbox, ManaBox, ...)',
  typeNoun: 'collection',
  examples: `ritual import binder.csv --type collection --name "Red Binder" \\
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
ritual import more.csv --type collection --name "Red Binder" --append \\
  --columns "name=1,set=2,collector-number=3"`,
  requiredColumns: 'collections require `name`, `set`, and `collector-number` columns',
  appendNote: 'appends continue card IDs and record the changelog',
  typeNotes:
    'Conditions/finishes are normalized (e.g. `Near Mint` → `NM`, `F` → foil, empty → non-foil).',
})}

## Price

${priceIntro({ scopeFlag: '--collection' })}

\`\`\`bash
ritual price --collection --summary            # every collection's totals
ritual price main-binder --no-input            # one collection's cards + totals
ritual price main-binder --output json --quiet
ritual price main-binder --sort price --descending --no-input
ritual price main-binder --prices eur          ${PRICE_CURRENCY_COMMENT}
\`\`\`

Collection entries are priced at their exact printing and finish; totals include a
quantity-weighted unpriced-card count.
`,
}
