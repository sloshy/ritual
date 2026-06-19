import type { RitualSkill } from '../types'

export const editSkill: RitualSkill = {
  name: 'ritual-edit',
  description:
    'Edit cards in any Ritual deck, collection, or wanted list without a TUI — the right tools for agents and scripts. Use when the user wants to add or remove a card, set or clear a card note, move cards between lists, or compact a change history.',
  body: `# Editing cards in any Ritual list (non-interactive)

These commands edit a deck, collection, or wanted list **without an interactive
TUI**, so they are the right tools for agents and scripts. They keep the \`&N\` card
IDs and the \`.changes.md\` changelog correct — prefer them over hand-editing files.

The first argument is the list **name** (file basename). It is resolved across all
three types unless you pass \`--deck\`, \`--collection\`, or \`--wanted\`. When a name is
ambiguous across types, a type flag is required.

## Add a card

\`\`\`bash
ritual add-card "Winota Stax" "Sol Ring"                 # resolve across all types
ritual add-card "Winota Stax" "Sol Ring" --deck -q 2     # 2 copies (deck only)
ritual add-card "Main Binder" "Black Lotus" --collection -f foil -c NM
ritual add-card "To Buy" "Mox Ruby" --wanted
ritual add-card "Winota Stax" "Lightning Bolt" --exact   # skip the interactive name picker
\`\`\`

- \`--collection\` / \`--wanted\` create the list if it does not exist (\`--deck\` does not — use \`new-deck\`).
- \`-q\` quantity (deck only), \`-f\` finish (nonfoil/foil/etched), \`-c\` condition (NM/LP/MP/HP/DMG).
- \`-e\`/\`--exact\` matches the card name exactly so no prompt is shown.

## Add or replace a note

\`\`\`bash
ritual add-note "Winota Stax" "Sol Ring" -n "fast mana"
ritual add-note "Winota Stax" "Sol Ring" -n "ramp" --overwrite   # replace an existing note
ritual add-note "Winota Stax" "Sol Ring" --card-id 5 -n "..."    # disambiguate by &N
ritual add-note "Winota Stax" "Sol Ring" -n "..." --output json --quiet
\`\`\`

Omit \`-n\` to be prompted for the text (interactive). Use \`--card-id <N>\` (the \`&N\`
suffix in the file) when the same card name appears more than once. Without
\`--overwrite\`, adding a note to a card that already has one fails.

## Clear a note

\`\`\`bash
ritual clear-note "Winota Stax" "Sol Ring"
ritual clear-note "Winota Stax" "Sol Ring" --card-id 5
ritual clear-note "Winota Stax" "Sol Ring" --output json --quiet
\`\`\`

## Move cards between lists

\`ritual move\` is an interactive TUI (requires a terminal) for moving cards between
decks, collections, and wanted lists:

\`\`\`bash
ritual move
\`\`\`

For **non-interactive** moves, use the web admin's HTTP API or the MCP \`move_cards\`
tool (see the **ritual-site** skill).

You can also move a card **while editing a list** (in the admin or public in-browser
editor) instead of using the dedicated batch tool: a **Move to list…** item appears in
the per-card menu, the per-list **Selected** menu, and the cross-list **All Selected**
navbar menu, opening a picker of destination lists. The card leaves the list you're
editing, and on save **both** lists are
written — removed from the source, added to the destination, with a changelog entry on
each. Moving a printing-less card into a collection prompts for a specific printing first.

## Compact change history

\`ritual history\` interactively compacts and rewrites a list's \`.changes.md\` log.
Only the changelog is touched — the list file itself is never modified:

\`\`\`bash
ritual history "Winota Stax"
ritual history "Winota Stax" --deck
\`\`\`

Combining two change sets orders the merged lines oldest-set-first (newest changes
at the bottom) and cancels opposite changes — an add and a later remove of the same
card annihilate — mirroring the card editor's live change log.
`,
}
