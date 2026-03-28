---
sidebar_position: 1
---

# Deck Editor

The Deck Editor provides a visual interface for editing deck contents through the admin site.

## Accessing the Editor

Navigate to the **Deck Editor** page from the admin sidebar, or click the "Deck Editor" card on the Dashboard.

## Selecting a Deck

Choose a deck from the dropdown at the top of the page. The editor loads the full deck view with card images, pricing, and all the same viewing options (binder/list/overlap/stack views, grouping, sorting) as the main site.

## Editing Cards

### Quantity Controls

Each card displays edit controls:

- **+** — Add one copy of the card
- **−** — Remove one copy (removes the card entirely if quantity reaches 0)
- **⋯** — Open the context menu

In binder and overlap views, these appear as transparent overlay buttons on hover. In list view, they appear as inline buttons.

### Context Menu

The **⋯** button opens a context menu with:

- **Set as Foil** — Mark the card as foil (greyed out if the printing doesn't support foil)
- **Set as Commander** — Move the card to the Commander section (supports multiple commanders)

### Adding Cards

Click the **+ Add Card** button in the deck header to open the card search modal.

#### Step 1: Search

- Type at least 2 characters to search (debounced to 1 request per second)
- Results are keyboard navigable (↑/↓ arrows, Enter to select)
- Hovering or navigating to a card shows a preview image of the cheapest printing

#### Step 2: Select Printing

- Choose "No specific printing" to add without printing details
- Or select a specific printing from the grid showing set, collector number, and price
- Keyboard navigable with arrow keys

#### Step 3: Finish & Condition

This step appears when the selected printing has multiple finish options.

- Select a finish (nonfoil, foil, etched) if the printing has multiple options
- Select a condition (NM, LP, MP, HP, DMG) — defaults to NM
- Click "Add Card" to confirm

## Change Tracking

All edits are tracked as in-memory change events until explicitly saved.

- **Changes** button shows the count of pending changes and opens a dialog listing them
- Additive changes (add card, set commander, set finish) are shown in green
- Destructive changes (remove card) are shown in red
- Opposite changes cancel out automatically (e.g., adding then removing the same card)
- Card names in the changes dialog are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

## Saving and Discarding

- **Save Changes** — Writes the updated deck file and appends to the changelog (`<deck-slug>.changes.md`)
- **Discard Changes** — Shows a confirmation dialog listing all changes that would be lost

The save button is disabled when there are no pending changes.

## Extended Deck Format

Cards can now include optional printing metadata:

```
1 Sol Ring (2XM:1) [foil] [NM] &1
1 Lightning Bolt &2
4 Island &3
```

Fields in order:

- `(SET:CN)` — Set code and collector number
- `[finish]` — `nonfoil`, `foil`, or `etched`
- `[condition]` — `NM`, `LP`, `MP`, `HP`, or `DMG`
- `&N` — Persistent card ID (auto-assigned, used internally for change tracking)

All fields are optional and backwards-compatible with the existing format.
