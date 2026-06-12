---
title: 'Editors'
---

The admin site provides a single **Edit Lists** page for managing decks, collections, and wanted lists. A tab at the top selects the list type — **Decks**, **Collections**, or **Wanted Lists** — and each shares the same core interaction model with minor differences per list type.

## Common Features

### Selecting a File

Pick a list type with the tabs at the top of the page, then choose the file to edit from the dropdown below them. Loading a file fetches full card data, printings, and pricing from the cache.

### Filters Menu

The list toolbar (shared with the public site pages) groups all card filters under a right-aligned **Filters** dropdown. The button shows a badge with the number of active filters, and the panel offers:

- **Hide Lands** / **Hide Unpriced** — toggle lands and cards without a known price
- **Hide Extras** — deck pages only; hides the maybeboard/token sections
- **Name** — space-separated terms; a card matches when every term appears somewhere in its name (the same matching the CLI session filter uses)
- **Color Identity** — toggle any combination of the five colors. **Exclusive** (the default) matches cards whose color identity is exactly the selection; **Inclusive** matches any card that could be played in a deck of the selected colors
- **Sets** — a tag input filtering by set code; type a code (space or comma finishes the tag) or pick from the autocomplete list of codes present in the list
- **Mana Value** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against a non-negative value (0 is valid)

Filters combine, and **Clear all filters** resets everything. On deck pages the commander section is never filtered.

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

Right-clicking a card (or clicking the **⋯** button in binder/overlap views) opens a context menu. **Set as Foil**, **Change Printing…**, and **Move to section** are available in all editors. The Deck Editor additionally offers **Set as Commander**.

#### Move to Section

The **Move to section** group lists every section except the card's current one, plus a **New section…** entry that prompts for a name and moves the card into a freshly created section. Moving a card emits a `set-section` change (latest-wins: moving a card back to its original section cancels the pending move).

### Sections

Every list type supports named **sections** that render as headed groups on the public site. Decks use sections for Commander/Main/Sideboard/Maybeboard; collections and wanted lists can be split into any sections you like (e.g. _Trade Binder_, _Foils_, _High Priority_).

Click the **Sections** button in the bottom [action bar](#editor-action-bar) to open the **Manage Sections** dialog:

- **Add a section** — type a name and click **Add Section** (or press Enter). New sections start empty. Section names must be unique **case-insensitively**: typing a name that already exists (in any casing) marks the input invalid, highlights the clashing row, and disables **Add Section**.
- **Rename a section** — click **Rename** on a row; all cards in that section move with it. A rename that would collide with another section (case-insensitive) is rejected.
- **Delete a section** — click **Delete** on a row. Only **empty** sections can be deleted; the button is disabled while a section still holds cards.

Cards with no explicit section belong to an implicit **Main** section, which is written out explicitly the next time the list is saved. On the public site, a list with two or more sections defaults to grouping by section, and **Section** becomes a selectable grouping option in the toolbar.

On disk, sections are `## Section Name` (H2) headers beneath the list's `# Title`, with card lines grouped under each header. See the [collection](/commands/collection/) and [wanted](/commands/wanted/) command docs for the file format.

#### Change Printing

**Change Printing…** reopens the same printing picker used when adding a card — starting directly on the printing-selection step for the card you clicked. Pick a printing (and finish/condition, where applicable) to retarget the card.

When the card represents more than one copy (a Deck Editor entry with quantity > 1, or a Collection Editor tile that groups identical copies), a prompt first asks **how many of the N copies** should get the new printing:

- **Decks** — Changing all copies retargets the entry in place (logged as a single set-printing change). Changing only some copies decreases the entry's quantity by that amount and adds the same number of copies of the new printing under a new card ID — logged as a quantity decrease plus a new add, so it is unambiguous which copies moved.
- **Collections** — Each copy is its own single-card entry, so the chosen number of entries are retargeted individually (one set-printing change each). Untouched copies keep the old printing and re-group into a separate tile.
- **Wanted lists** — Each row is a single entry and is retargeted directly.

Every printing change is recorded as a change event tagged with the card ID and the target printing, and appears in the changelog (e.g. `Set "Lightning Bolt" printing to M10:146 [foil] &5`).

### Change Tracking

All edits are tracked as in-memory change events until explicitly saved.

- **Changes** button shows the count of pending changes and opens a dialog listing them
- Additive changes (add card, set commander, set finish, set printing) are shown in green
- Destructive changes (remove card) are shown in red
- Opposite changes cancel out automatically (e.g., adding then removing the same card)
- Card names in the changes dialog are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

### Editor Action Bar

A bar pinned to the bottom of the editor holds all editing controls, from left to right:

- **+ Add Card** — opens the card search modal (see [Adding Cards](#adding-cards))
- **Add Card Defaults** — expands the [defaults panel](#add-card-defaults) upward
- **Sections** — opens the [Manage Sections](#sections) dialog
- **Changes** — shows the pending-change count and opens the changes dialog
- **Undo** — reverts the most recent change
- **Save Changes** / **Discard Changes**

### Saving and Discarding

- **Save Changes** — Writes the updated file and appends to the changelog. Disabled when there are no pending changes.
- **Discard Changes** — Shows a confirmation dialog listing all changes that would be lost.

The same confirmation also appears automatically whenever you navigate away with pending changes — selecting a different file in the dropdown, switching the **Decks** / **Collections** / **Wanted Lists** type tab, moving to another page via the admin sidebar, or logging out. Confirming discards the pending changes and proceeds; cancelling keeps you on the current file with your changes intact. Changes you want to keep must be saved explicitly first.

Reloading or closing the browser tab with pending changes triggers the browser's own "leave site?" prompt as a final safeguard.

---

## Deck Editor

Open **Edit Lists** (admin sidebar or Dashboard card) and select the **Decks** tab.

### Context Menu

The **⋯** button opens a context menu with:

- **Set as Foil** — Mark the card as foil (greyed out if the printing doesn't support foil)
- **Change Printing…** — Pick a new printing for the card; for an entry with quantity > 1 you are first asked how many copies to retarget (see [Change Printing](#change-printing))
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

Open **Edit Lists** and select the **Collections** tab.

Collections correspond to `.md` files in the `collections/` directory.

### Differences from Deck Editor

- **No Set as Commander** — collections have no reserved Commander section (but support arbitrary user-named [sections](#sections))
- **Printing required** — the **No specific printing** shortcut is not available; a specific printing must be selected
- **Finish & condition required** — both must be set for collection entries

---

## Wanted List Editor

Open **Edit Lists** and select the **Wanted Lists** tab.

Wanted lists correspond to `.md` files in the `wanted/` directory.

### Differences from Deck Editor

- **No Set as Commander** — wanted lists have no reserved Commander section (but support arbitrary user-named [sections](#sections))
- **No condition** — wanted lists track desired cards, not owned cards
- **Printing optional** — cards can be added as name-only (cheapest printing), with a specific printing, or fully specified with a finish

---

## Feature Comparison

| Feature                   | Deck Editor             | Collection Editor | Wanted List Editor |
| ------------------------- | ----------------------- | ----------------- | ------------------ |
| Set as Commander          | ✅                      | ❌                | ❌                 |
| Change printing           | ✅                      | ✅                | ✅                 |
| Multi-copy printing split | ✅ Entry                | ✅ Per-entry      | ❌ Single rows     |
| No specific printing      | ✅ Allowed              | ❌ Must select    | ✅ Allowed         |
| Condition field           | ✅ Optional             | ✅ Required       | ❌ Not applicable  |
| Finish field              | ✅ Optional             | ✅ Required       | ✅ Optional        |
| Sections                  | ✅ + reserved Commander | ✅ User-named     | ✅ User-named      |
| Add/rename/delete section | ✅                      | ✅                | ✅                 |
| Move card to section      | ✅                      | ✅                | ✅                 |
| Changelog on save         | ✅                      | ✅                | ✅                 |
| Add Card Defaults         | ✅ Set/F/C              | ✅ Set/F/C        | ✅ Set/F           |
