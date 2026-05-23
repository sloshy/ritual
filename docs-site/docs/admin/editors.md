---
sidebar_position: 1
---

# Editors

The admin site provides three visual editors for managing decks, collections, and wanted lists. All editors share the same core interaction model with minor differences per list type.

## Common Features

### Selecting a File

Each editor has a dropdown at the top of the page to select the file to edit. Loading a file fetches full card data, printings, and pricing from the cache.

### Quantity Controls

Each card displays **+** and **−** buttons to add or remove copies. Reducing a card's quantity to zero removes it entirely.

In binder and overlap views, these appear as transparent overlay buttons on hover. In list view, they appear inline.

### Add Card Defaults

Each editor has an **Add Card Defaults** toggle in the bottom [action bar](#editor-action-bar), between the **+ Add Card** and **Changes** buttons. Clicking it expands a panel upward revealing the default fields; a dot on the toggle indicates when any default is currently active. It mirrors the session filters in the CLI's `collection`, `wanted`, and `add-card` commands and is intended for batch entry — set defaults once, then add many cards in a row without confirming the same fields each time.

The available defaults vary per editor:

| Field     | Deck Editor   | Collection Editor | Wanted List Editor |
| --------- | ------------- | ----------------- | ------------------ |
| Set codes | ✅ Comma-list | ✅ Comma-list     | ✅ Comma-list      |
| Finish    | ✅            | ✅                | ✅                 |
| Condition | ✅            | ✅                | ❌ Not applicable  |

Defaults are scoped per-editor and persist across reloads in `localStorage` under `ritual:admin:defaults:{deck,collection,wanted}`.

#### How defaults change the add-card flow

- **Set codes filter** — When set, the printing picker shows only matching printings. If exactly one printing matches, it is auto-selected and the picker step is skipped. If no printings match, the picker falls back to showing all printings with a hint banner.
- **Default finish** — Pre-selected on the finish/condition step. If the chosen printing supports the default finish, that step is skipped entirely.
- **Default condition** — Pre-selected on the finish/condition step. The step is skipped only when both finish and condition can be resolved.

When a default cannot be applied (e.g. the chosen printing doesn't support the default finish, or no condition default is set on the Collection Editor) the finish/condition step still appears but the inputs are pre-filled.

### Adding Cards

Click the **+ Add Card** button in the bottom [action bar](#editor-action-bar) to open the card search modal. The modal shows keyboard-shortcut hints along its bottom edge; dismiss it with **Esc** or by clicking outside it.

#### Step 1: Search

- Type at least 2 characters to search (debounced to 1 request per second)
- Results are keyboard navigable (↑/↓ arrows, Enter to select)
- Hovering or navigating to a card shows a preview image of the cheapest printing

#### Step 2: Select Printing

Choose a specific printing from the grid showing set, collector number, and price. In the Deck Editor and Wanted List Editor, you may also choose **No specific printing** to add without printing details.

#### Step 3: Finish & Condition

This step appears when the selected printing has multiple finish options.

- Select a finish (nonfoil, foil, etched) if the printing has multiple options
- Select a condition (NM, LP, MP, HP, DMG) — only available in the Deck and Collection editors; defaults to NM

### Context Menu

Right-clicking a card (or clicking the **⋯** button in binder/overlap views) opens a context menu. **Set as Foil** is available in all editors. The Deck Editor additionally offers **Set as Commander**.

### Change Tracking

All edits are tracked as in-memory change events until explicitly saved.

- **Changes** button shows the count of pending changes and opens a dialog listing them
- Additive changes (add card, set commander, set finish) are shown in green
- Destructive changes (remove card) are shown in red
- Opposite changes cancel out automatically (e.g., adding then removing the same card)
- Card names in the changes dialog are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

### Editor Action Bar

A bar pinned to the bottom of the editor holds all editing controls, from left to right:

- **+ Add Card** — opens the card search modal (see [Adding Cards](#adding-cards))
- **Add Card Defaults** — expands the [defaults panel](#add-card-defaults) upward
- **Changes** — shows the pending-change count and opens the changes dialog
- **Undo** — reverts the most recent change
- **Save Changes** / **Discard Changes**

### Saving and Discarding

- **Save Changes** — Writes the updated file and appends to the changelog. Disabled when there are no pending changes.
- **Discard Changes** — Shows a confirmation dialog listing all changes that would be lost.

---

## Deck Editor

Access via the admin sidebar or the **Deck Editor** card on the Dashboard.

### Context Menu

The **⋯** button opens a context menu with:

- **Set as Foil** — Mark the card as foil (greyed out if the printing doesn't support foil)
- **Set as Commander** — Move the card to the Commander section (supports multiple commanders)

### Adding Cards

The **No specific printing** shortcut is available — add a card without selecting a printing.

Condition (NM, LP, MP, HP, DMG) is optional and defaults to NM.

### Extended Deck Format

Cards can include optional printing metadata:

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

All fields are optional and backwards-compatible with the basic format.

---

## Collection Editor

Access via the admin sidebar or the **Collection Editor** card on the Dashboard.

Collections correspond to `.md` files in the `collections/` directory.

### Differences from Deck Editor

- **No Set as Commander** — collections don't have sections
- **Printing required** — the **No specific printing** shortcut is not available; a specific printing must be selected
- **Finish & condition required** — both must be set for collection entries

---

## Wanted List Editor

Access via the admin sidebar or the **Wanted List Editor** card on the Dashboard.

Wanted lists correspond to `.md` files in the `wanted/` directory.

### Differences from Deck Editor

- **No Set as Commander** — wanted lists are flat
- **No condition** — wanted lists track desired cards, not owned cards
- **Printing optional** — cards can be added as name-only (cheapest printing), with a specific printing, or fully specified with a finish

---

## Feature Comparison

| Feature                  | Deck Editor | Collection Editor | Wanted List Editor |
| ------------------------ | ----------- | ----------------- | ------------------ |
| Set as Commander         | ✅          | ❌                | ❌                 |
| No specific printing     | ✅ Allowed  | ❌ Must select    | ✅ Allowed         |
| Condition field          | ✅ Optional | ✅ Required       | ❌ Not applicable  |
| Finish field             | ✅ Optional | ✅ Required       | ✅ Optional        |
| Sections (Commander etc) | ✅ Yes      | ❌ Flat list      | ❌ Flat list       |
| Changelog on save        | ✅          | ✅                | ✅                 |
| Add Card Defaults        | ✅ Set/F/C  | ✅ Set/F/C        | ✅ Set/F           |
