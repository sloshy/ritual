import type { RitualSkill } from '../types'
import {
  csvImportSection,
  DIFF_BY_MODES,
  interactiveEditIntro,
  PRICE_CURRENCY_COMMENT,
  PRICE_SOURCE_COMMENT,
  priceIntro,
  REFRESH_SESSION,
  sessionSemantics,
  textImportSection,
  wrapProse,
} from './shared'

export const wantedSkill: RitualSkill = {
  name: 'ritual-wanted',
  description:
    'Manage and price a Magic: The Gathering wanted list (cards to acquire) with Ritual. Use when the user wants to track cards they want to buy, add cards to a wishlist, record a purchase by moving a wanted card into a collection, import a wanted list from a CSV or text file, or price a wanted list.',
  body: `# Managing wanted lists with Ritual

Wanted lists (cards to acquire) live in \`wanted/<name>.md\`. Entries may be
name-only — no printing required. See the **ritual** skill for the file format.

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill).
\`add-card\` works on wanted lists, and — when the type is pinned with \`--wanted\`
or a \`wanted:\` prefix — creates the list if it does not exist yet, including in a
workspace with no wanted lists at all (the file is created only once the add is
certain to succeed, so a failed add or a \`--dry-run\` leaves none behind). Every wanted
add chooses a specificity: \`--name-only\` (any copy), a specific printing via
\`--set\`/\`--collector-number\`, or \`--specific\` (open the interactive printing
picker; needs a terminal). A terminal prompts when none is given; a
non-interactive run without one exits 2. A specific-printing add also needs
\`-f\` when that printing comes in several finishes — headless runs never guess
one:

\`\`\`bash
ritual add-card "To Buy" "Mox Ruby" --wanted --name-only
ritual add-card "To Buy" "Lightning Bolt" --wanted --name-only -f foil   # -f finish (optional)
ritual add-card "To Buy" "Demonic Tutor" --wanted --set sta --collector-number 90 -f nonfoil
ritual remove-card "To Buy" "Mox Ruby" --wanted              # one entry
ritual set-card "To Buy" "Lightning Bolt" --wanted --finish foil
ritual note "To Buy" "Mox Ruby" --wanted -n "budget copy only"
\`\`\`

## Bought a card? Move it to a collection

\`ritual move\` with \`--from\`/\`--to\` records a purchase in one command: the entry
leaves the wanted list and lands in the collection. Collections need a concrete
printing, so a name-only entry takes it from \`--set\`/\`--collector-number\` (or its
single known printing in the local card cache — a card the cache does not hold has
no printing list, so pass the flags); already-pinned entries move as-is:

\`\`\`bash
ritual move "Demonic Tutor" --from "wanted:To Buy" --to "collection:Main Binder" \\
  --set sta --collector-number 90
\`\`\`

## Plan purchases with a diff

${wrapProse(
  '`ritual diff` compares a wanted list against a collection: entries only in ' +
    'the wanted list are still unowned, matches are already covered (mismatched ' +
    `quantities are listed separately). ${DIFF_BY_MODES}`,
)}

\`\`\`bash
ritual diff wanted:to-buy "collection:Main Binder"
ritual diff wanted:to-buy "collection:Main Binder" --by printing --output json
\`\`\`

## Interactive management

${interactiveEditIntro({
  pick: 'pick a wanted list (or `➕ New Wanted List`) from its list selection menu',
})}

\`\`\`bash
ritual edit
ritual edit "wanted:To Buy"          # open one list directly (matches the file basename)
ritual edit --sets "FDN,SPG"         # restrict to these set codes
ritual edit --finish foil
ritual edit --collector              # start in SET:CN printing search mode
ritual edit --allow-digital-only-cards
ritual edit --refresh never          # use the existing cache as-is, no prompt
ritual edit --refresh auto           # redownload the cache when prices are >1 day old
\`\`\`

${REFRESH_SESSION}

${sessionSemantics({
  fileNoun: 'file',
  editScope: "the list's existing entries",
  editFields:
    "change a card's printing (or make it name-only), finish, language, or note, move it to another list, or remove it",
  editModeNote:
    'The `✨ Change Finish` item is hidden for name-only entries — a finish only annotates a specific printing.',
  undoAddVerb: 'removes',
  changeKinds: 'adds, edits, and removals',
  discardTarget: 'same-card changes',
  discardAddEffect:
    "Discarding an add frees that card's `&N` id and keeps the remaining session ids dense (each later card slides down one).",
})}

## Import from a text file

${textImportSection({
  typeNoun: 'wanted list',
  typeFlag: 'wanted',
  examples: `ritual import wants.txt --type wanted
ritual import wants.txt --type wanted --overwrite --no-input`,
})}

## Import from a CSV file

${csvImportSection({
  source: 'a CSV file',
  typeNoun: 'wanted list',
  examples: `ritual import wants.csv --type wanted --name "To Buy" \\
  --columns "name=1,set=2,collector-number=3,finish=4,quantity=5"
ritual import more.csv --type wanted --name "To Buy" --append --columns "name=1"`,
  requiredColumns: 'only `name` is required and wanted lists carry no `condition` column',
  appendNote: 'appends continue card IDs and record the changelog',
})}

## Price

${priceIntro({ scopeFlag: '--wanted' })}

\`\`\`bash
ritual price --wanted --summary                # every wanted list's totals
ritual price to-buy --no-input                 # one list's cards + totals
ritual price to-buy --output json --quiet
ritual price to-buy --sort price --descending --no-input
ritual price to-buy --prices eur               ${PRICE_CURRENCY_COMMENT}
ritual price to-buy --source cardkingdom       ${PRICE_SOURCE_COMMENT}
\`\`\`

Each wanted list also reports a "lowest" total: name-only entries use the cheapest
printing, printing-pinned entries the cheapest finish of that printing, and
fully-specified entries their exact price.
`,
}
