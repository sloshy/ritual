import type { RitualSkill } from '../types'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage and price a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, import a collection from a CSV export or text file, or get the total value of a collection.',
  body: `# Managing collections with Ritual

Collections of owned cards live in \`collections/<name>.md\`. See the **ritual**
skill for the file format.

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill). \`add-card\`
works on collections and creates the collection if it does not exist yet:

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

\`ritual edit\` opens the interactive editor (covered in full by the **ritual-edit**
skill); pick a collection (or \`➕ New Collection\`) from its list selection menu to
bulk-add cards. It **requires a terminal**, so it is not suitable for non-interactive
agents — use the one-shot commands instead.

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

The shared \`--refresh <mode>\` option controls card-cache freshness: under \`ask\` (the default) a cache last fully downloaded more than a week ago prompts to redownload before the session starts; \`auto\` redownloads without prompting when the cached prices are more than a day old; \`no-bulk\` and \`never\` use the existing cache as-is.

Within the session, changes accumulate **in memory**: \`💾 Save\` writes the file and changelog without exiting (saving repeatedly in one session folds the later changes into that session's existing changelog entry and bumps its timestamp, so one editing session is always one changelog entry), and \`🚪 Exit\` (or Esc) opens an exit menu when changes are unsaved — save and exit, exit without saving (discards everything unsaved), or cancel to keep editing. \`🛠️ Switch to Edit Mode\` turns the search prompt into a picker over the collection's existing entries — change a card's printing, finish, condition, or note, or remove it — and \`↩️ Undo Last Edit\` reverts the latest edit. \`↩️ Undo Last Add\` removes the most recent card and \`📋 View Session Changes\` opens a picker over every change made this session — adds, edits, and removals — where selecting one offers to discard just that change (same-card changes must be discarded newest-first). Discarding an add frees that card's \`&N\` id and keeps the remaining session ids dense (each later card slides down one).

## Compare with another list

\`ritual diff\` compares any two lists — e.g. which wanted cards a collection already
covers, or what two collections share. \`--by name\` (the default) matches card names;
\`--by printing\` requires the exact set/collector-number/finish to match:

\`\`\`bash
ritual diff wanted:to-buy "collection:Main Binder"          # overlap = already owned
ritual diff "Main Binder" trade-binder --by printing --output json
\`\`\`

## Import from a text file

\`import\` turns a decklist-style text file into a new collection (quantities expand
to one bullet line per copy):

\`\`\`bash
ritual import binder.txt --type collection
ritual import binder.txt --type collection --overwrite --no-input
\`\`\`

Without \`--type\` an interactive run prompts for the list type; under the global
\`--no-input\` flag the type defaults to a deck, so agents should always pass
\`--type collection\`. Every line
must carry a printing (e.g. \`2 Sol Ring (C19:221)\`) — collections track specific
physical printings, so name-only lines are rejected.

## Import from a CSV file

A \`.csv\` source makes \`import\` import a CSV export (Moxfield, Deckbox, ManaBox, ...)
into a new collection, or append to an existing one (\`--csv\` forces CSV parsing for
other extensions). Non-interactive agents must pass all flags (running it bare opens
an interactive column-mapping wizard):

\`\`\`bash
ritual import binder.csv --type collection --name "Red Binder" \\
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
ritual import more.csv --type collection --name "Red Binder" --append \\
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

The unified \`price\` command covers all list types; scope it with \`--collection\` or a
name. An interactive browser opens on a TTY — for agents, always pass \`--summary\`,
\`--output json\`, or the global \`--no-input\` flag:

\`\`\`bash
ritual price --collection --summary            # every collection's totals
ritual price main-binder --no-input            # one collection's cards + totals
ritual price main-binder --output json --quiet
ritual price main-binder --sort price --descending --no-input
ritual price main-binder --prices eur          # usd | eur | tix (defaults to config defaultCurrency)
\`\`\`

Collection entries are priced at their exact printing and finish; totals include a
quantity-weighted unpriced-card count.
`,
}
