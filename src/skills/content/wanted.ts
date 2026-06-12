import type { RitualSkill } from '../types'

export const wantedSkill: RitualSkill = {
  name: 'ritual-wanted',
  description:
    'Manage and price a Magic: The Gathering wanted list (cards to acquire) with Ritual. Use when the user wants to track cards they want to buy, add cards to a wishlist, import a wanted list from a CSV or text file, or price a wanted list.',
  body: `# Managing wanted lists with Ritual

Wanted lists (cards to acquire) live in \`wanted/<name>.md\`. Entries may be
name-only — no printing required. See the **ritual** skill for the file format.

## Add cards (non-interactive — best for agents)

Use \`add-card\` (covered by the **ritual-edit** skill). It works on wanted lists and
creates the list if it does not exist yet:

\`\`\`bash
ritual add-card "To Buy" "Mox Ruby" --wanted
ritual add-card "To Buy" "Lightning Bolt" --wanted          # name-only is fine
ritual add-card "To Buy" "Ragavan" --wanted -f foil         # -f finish (optional)
\`\`\`

## Interactive management

\`ritual wanted\` opens an interactive TUI. It **requires a terminal**, so it is not
suitable for non-interactive agents — use \`add-card\` instead.

\`\`\`bash
ritual wanted                          # alias: ritual wanted-list
ritual wanted --sets "FDN,SPG"         # restrict to these set codes
ritual wanted --finish foil
ritual wanted --collector              # enter cards by collector number
ritual wanted --allow-digital-only-cards
\`\`\`

Within the session, changes accumulate **in memory**: \`💾 Save\` writes the file and changelog without exiting, \`✅ Done\` saves and exits, and \`🚪 Exit Without Saving\` discards everything unsaved. \`🛠️ Switch to Edit Mode\` turns the search prompt into a picker over the list's existing entries — change a card's printing (or make it name-only), finish, or note, or remove it — and \`↩️ Undo Last Edit\` reverts the latest edit. \`↩️ Undo Last Add\` removes the most recent card and \`🗑️ Discard a Card Added This Session\` opens a picker to drop any card you added this session. Discarding frees that card's \`&N\` id and keeps the remaining session ids dense (each later card slides down one).

## Import from a text file

\`import\` turns a decklist-style text file into a new wanted list (quantities expand
to one bullet line per copy):

\`\`\`bash
ritual import wants.txt --type wanted
ritual import wants.txt --type wanted --overwrite --non-interactive
\`\`\`

Without \`--type\` an interactive run prompts for the list type; non-interactive runs
default to a deck, so agents should always pass \`--type wanted\`.

## Import from a CSV file

\`import-csv\` imports a CSV file into a new wanted list, or appends to an existing
one. Non-interactive agents must pass all flags (running it bare opens an interactive
column-mapping wizard):

\`\`\`bash
ritual import-csv wants.csv --type wanted --name "To Buy" \\
  --columns "name=1,set=2,collector-number=3,finish=4,quantity=5"
ritual import-csv more.csv --type wanted --name "To Buy" --append --columns "name=1"
\`\`\`

\`--columns\` maps fields to 1-based column numbers; only \`name\` is required and
wanted lists carry no \`condition\` column. Add \`--no-header\` when the first row is
data, \`--overwrite\` to replace an existing list, or \`--append\` to add to one
(appends continue card IDs and record the changelog). Failed rows are reported with
line numbers on stderr and the rest still import (exit code 1 on partial failure).

## Price

\`\`\`bash
ritual price-wanted-list                       # every wanted list
ritual price-wanted-list to-buy                # one list
ritual price-wanted-list to-buy --output json --quiet
ritual price-wanted-list to-buy --sort price --descending
ritual price-wanted-list to-buy --prices eur   # usd | eur | tix
\`\`\`

Alias: \`ritual pwl\`.
`,
}
