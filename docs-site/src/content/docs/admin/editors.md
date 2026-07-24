---
title: 'Editors'
---

The admin site provides a single **Edit Lists** page for managing decks, collections, and wanted lists. A tab at the top selects the list type — **Decks**, **Collections**, or **Wanted Lists** — and each shares the same core interaction model with minor differences per list type.

## Common Features

### Selecting a File

Pick a list type with the tabs at the top of the page, then choose the file to edit from the dropdown below them. Loading a file fetches full card data, printings, and pricing from the cache.

### Keyboard Shortcuts

The editors can be driven entirely from the keyboard. Page-level shortcuts are suppressed while any dialog is open, so a dialog's own keys always win:

| Key            | Action                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **?**          | Open the **Keyboard Shortcuts** reference — the same as clicking the **?** button at the end of the action bar     |
| **Ctrl+Enter** | Open the card search modal — the same as clicking **+ Add Card**                                                   |
| **Ctrl+B**     | Move focus into the bottom [action bar](#editor-action-bar), on its first enabled button                           |
| **←** / **→**  | While focus is in the action bar, move between its buttons (wrapping at either end); **Tab** still works as normal |
| **Esc**        | While focus is in the action bar, drop focus back to the page                                                      |

The **?** dialog lists every binding above plus the per-step keys of the [add-card dialog](#adding-cards), so the full set is discoverable from the editor itself. Because **?** is an ordinary character, it only triggers when you aren't typing in a text field.

On macOS, **Cmd** substitutes for **Ctrl**. The same shortcuts are available in the public site's editor, which shares the action bar and dialogs.

### Filters Menu

The list toolbar (shared with the public site pages) groups all card filters under a right-aligned **Filters** dropdown. The button shows a badge with the number of active filters, and the panel offers:

- **Hide Lands** / **Hide Unpriced** — toggle lands and cards without a known price
- **Hide Extras** — deck pages only; hides the maybeboard/token sections
- **Name** — space-separated terms; a card matches when every term appears somewhere in its name, case- and accent-insensitively (`jotun` matches `Jötun Grunt`; the same matching the CLI session filter uses)
- **Color Identity** — toggle any combination of the five colors plus a **Colorless** swatch (select it alone to find cards with no color identity), then pick a match mode: **Subset** (the default) matches any card that could be played in a deck of the selected colors, **Include** matches cards using at least one of them, **Exclude** matches cards using none of them, and **Exact** matches cards whose identity is exactly the selection
- **Sets** — a tag input filtering by set code; type a code (space or comma finishes the tag) or pick from the autocomplete list of codes present in the list. **Include** (the default) keeps the selected sets; **Exclude** drops them
- **Card Type** / **Oracle Tags** / **Art Tags** — tag inputs sharing the same **Include / Exclude / Exact** match mode, defaulting to **Exact** (a card must carry every selected value)
- **Mana Value** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against a non-negative value (0 is valid)

Filters combine, and the **Clear** action at the top of the panel resets everything. On deck pages the commander section is never filtered.

Each card displays **+** and **−** buttons to add or remove copies. Reducing a card's quantity to zero removes it entirely.

In binder and overlap views, these appear as transparent overlay buttons on hover. In list view, they appear inline.

### Multi-Select

Cards can be selected across every view mode for bulk actions. Hovering a card in binder, row, or column view reveals a translucent checkbox in its top-left corner; in list view the checkbox sits at the far left of each row. Clicking it — or **Ctrl-clicking** (**⌘-clicking** on macOS) anywhere on the card — marks the card with an accent-colored checkmark, and a **Selected (N)** button appears in the toolbar showing the running count of selected copies for the list you're editing. The selection persists across grouping, sorting, and view-mode changes. A quantity group (e.g. `4×`) selects all of its copies at once and counts them individually; once some copies are removed it shows a **dash** instead of a checkmark.

Opening the button reveals a menu of actions over that list's selection:

- **Copy as Text** — copies a quantity-prefixed `N Card Name (SET:Collector Number)` list to the clipboard
- **Copy as CSV** — copies the selection as CSV (`Name,Set,Collector Number,Finish,Condition,Quantity`)
- **Clear selection** — deselects the current list's cards only

The public site adds an **Add to Trade** action here; the admin site omits it because it has no Trade Planner page.

#### Bulk Edit Actions

While a list is open in edit mode, the **Selected (N)** menu also gains an **edit** section that applies the same operations as a single card's **+** / **−** buttons and **⋯** context menu, but over the whole selection at once:

- **Add a copy** / **Remove a copy** — bump each selected card up or down by one copy
- **Remove from list** (decks: **Remove from deck**) — remove every copy of each selected card
- **Set as Foil** / **Set as Nonfoil** — set the finish on each selected card that supports it (others are skipped)
- **Change Printing…** — runs the printing picker over the selected cards one at a time (cancelling skips that card and continues)
- **Set as Commander** — decks only; marks each selected card as a commander
- **Move to section…** — opens a picker to move every selected card into an existing section, or **New section…** to name a new one
- **Move to list…** — opens a picker to move every selected card into another list

These edits go through the same pending-changes/undo flow as per-card edits, so nothing is written until you **Save** (admin) or export (public). The selection is cleared once an action is applied.

Selections are held globally, so switching to another list (or list type) keeps them. Whenever anything is selected, an **All Selected (N)** button is shown in the admin header (on every page) with the total across all lists; its menu runs the copy actions over the whole cross-list selection and its **Clear all selections** entry wipes every list. The menu's **View all selections…** entry opens a dialog listing every selected card — with its quantity, printing, finish, and condition — and the list it came from, shown in selection order or grouped by source, where each row's ✕ removes one copy and the copy/clear actions are repeated.

The cross-list menu (and the **View all selections…** dialog) also offers **Remove all selected**, which deletes every selected card from its list. On the admin site this commits atomically to each list file across all lists in one pass (auto-committed to git when enabled), much like the [Move Cards](/admin/move-cards/) page. On the public site — which has no server — the list currently open in the editor is updated live, while removals for any other selected lists are merged into those lists' saved browser sessions, surfacing the next time each is opened in edit mode.

### Add Card Defaults

Each editor has an **Add Card Defaults** toggle in the bottom [action bar](#editor-action-bar), between the **+ Add Card** and **Changes** buttons. Clicking it expands a panel upward revealing the default fields; a dot on the toggle indicates when any default is currently active. It mirrors the session filters in the CLI's `edit` and `add-card` commands and is intended for batch entry — set defaults once, then add many cards in a row without confirming the same fields each time.

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

Click the **+ Add Card** button in the bottom [action bar](#editor-action-bar), or press **Ctrl+Enter**, to open the card search modal. The modal shows keyboard-shortcut hints along its bottom edge — they change per step — and every step is fully keyboard navigable. Dismiss it with **Esc** or by clicking outside it.

#### Step 1: Search

- Type at least 2 characters to search (debounced — 500 ms by default, configurable via [`searchDebounceMs`](/configuration/#search-debounce))
- What you type is split on whitespace and **every term must appear in the card name**, in any order — `in tre` finds "In the Trenches", `bolt light` finds "Lightning Bolt". Case, accents, and punctuation don't have to match (`jaces archivist` finds "Jace's Archivist"). This is the same matching the CLI prompts use. (The static [public site's editor](/commands/build-site/#editing-on-the-public-site) is the exception: it queries the Scryfall API directly, which matches the query as one plain contiguous string, so its results can differ. A public site [backed by a live API](/public-site/hosted/) gets this same term matching.)
- The closest matches lead: a name you have typed in full, then names your query prefixes, then names whose words your terms begin, then names matched mid-word
- Results are keyboard navigable (↑/↓ arrows, Enter to select)
- Hovering or navigating to a card shows a preview image of the cheapest printing

#### Step 2: Select Printing

Choose a specific printing from the grid showing set, collector number, and price. In the Deck Editor and Wanted List Editor, you may also choose **No specific printing** to add without printing details.

The grid navigates in two dimensions: **←**/**→** move to the previous/next printing, and **↑**/**↓** move a whole row up or down (the row width follows the grid's responsive column count). Moving past the printings shown on the current page pages the grid automatically. **Enter** selects the highlighted printing.

#### Step 3: Finish & Condition

This step appears when the selected printing has multiple finish options.

- Select a finish (nonfoil, foil, etched) if the printing has multiple options
- Select a condition (NM, LP, MP, HP, DMG) — only available in the Deck and Collection editors; defaults to NM
- Set a **Quantity** — how many copies of this exact printing to add. Starts at 1 and cannot go below it. Not shown when the dialog was opened via **Change Printing…**, which asks for a copy count of its own beforehand

Focus lands on the first group's selected option when the step opens.

- **←**/**→** move within the focused group: they change the selected finish or condition, and step the quantity up or down while the quantity ticker holds focus
- **↑**/**↓** (or **Tab**) move between the groups — finish, condition, quantity
- **+**/**-** adjust the quantity from anywhere in the step, without focusing the ticker first
- **Enter** adds the card with the current selections from anywhere in the step (except while the **← Back** button is focused, where it goes back)

The step offers two commit buttons, each with its shortcut shown in its corner (the corner hints are hidden on touch devices). Both add the chosen quantity of the chosen printing, and show a **×N** multiplier once the quantity is above one:

- **Add Card** (**Enter**) — adds the card and closes the modal
- **Add Another Card** (**Ctrl+Enter**) — adds the card, then returns to a fresh search step so the next card can be added without reopening the modal. Not offered when the dialog was opened via **Change Printing…**, which edits an existing card.

A deck folds the added copies into one entry with a quantity; collections and wanted lists store one entry per copy, since each copy carries its own condition and note.

### Context Menu

Right-clicking a card (or clicking the **⋯** button in binder/overlap views) opens a context menu. **Set as Foil**, **Change Printing…**, and **Move to section…** are available in all editors. The Deck Editor additionally offers **Set as Commander**.

#### Move to Section

The **Move to section…** item opens a picker listing every section except the card's current one, plus a **New section…** entry that prompts for a name and moves the card into a freshly created section. Moving a card emits a `set-section` change (latest-wins: moving a card back to its original section cancels the pending move).

### Sections

Every list type supports named **sections** that render as headed groups on the public site. Decks use sections for Commander/Main/Sideboard/Maybeboard; collections and wanted lists can be split into any sections you like (e.g. _Trade Binder_, _Foils_, _High Priority_).

Click the **Sections** button in the bottom [action bar](#editor-action-bar) to open the **Manage Sections** dialog:

- **Add a section** — type a name and click **Add Section** (or press Enter). New sections start empty. Section names must be unique **case-insensitively**: typing a name that already exists (in any casing) marks the input invalid, highlights the clashing row, and disables **Add Section**.
- **Rename a section** — click **Rename** on a row; all cards in that section move with it. A rename that would collide with another section (case-insensitive) is rejected.
- **Delete a section** — click **Delete** on a row. Only **empty** sections can be deleted; the button is disabled while a section still holds cards.

Cards with no explicit section belong to an implicit **Main** section, which is written out explicitly the next time the list is saved. On the public site, a list with two or more sections defaults to grouping by section, and **Section** becomes a selectable grouping option in the toolbar.

On disk, sections are `## Section Name` (H2) headers beneath the list's `# Title`, with card lines grouped under each header. See the [collection](/commands/edit/#collection-files) and [wanted list](/commands/edit/#wanted-list-files) file formats.

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

- **+ Add Card** — opens the card search modal (see [Adding Cards](#adding-cards)); also **Ctrl+Enter**
- **Add Card Defaults** — expands the [defaults panel](#add-card-defaults) upward
- **Sections** — opens the [Manage Sections](#sections) dialog
- **Changes** — shows the pending-change count and opens the changes dialog
- **Undo** — reverts the most recent change
- **Save Changes** / **Discard Changes**
- **?** — opens the [Keyboard Shortcuts](#keyboard-shortcuts) reference

### Saving and Discarding

- **Save Changes** — Writes the updated file and appends to the changelog. Disabled when there are no pending changes. Saving more than once without leaving the editor folds the later changes into the same session's changelog entry (bumping its timestamp) rather than creating a new entry each time; reloading the file (or hitting a save conflict and reloading) starts a fresh session.
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
