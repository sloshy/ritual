import type { RitualSkill } from '../types'

export const wantedSkill: RitualSkill = {
  name: 'ritual-wanted',
  description:
    'Manage and price a Magic: The Gathering wanted list (cards to acquire) with Ritual. Use when the user wants to track cards they want to buy, add cards to a wishlist, or price a wanted list.',
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
