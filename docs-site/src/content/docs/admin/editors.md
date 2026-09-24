---
title: 'Editors'
description: The Edit Lists page, where you add, remove, and change cards in a deck, collection, or wanted list, then save.
---

The admin site's **Edit Lists** page edits decks, collections, and wanted lists. Tabs at the top pick the list type, a dropdown picks the file, and the same editor opens for all three. The few per-type differences are covered at the [end of this page](#differences-between-list-types).

Every edit is held in memory as a pending change until you press **Save Changes**. Before then you can undo, review the pending list, or discard everything.

## Opening a list

Open **Edit Lists** from the admin sidebar or the Dashboard card. Pick a list type with the tabs, then choose the file from the dropdown below them. Loading a file fetches its card data, printings, and prices from the cache.

The address bar follows both choices: `#/edit/deck/Winota%20Stax` is the deck editor with that deck open. You can bookmark or share it, and a reload returns to the same list. See [page URLs](/admin/#page-urls).

A list's [`description:`](/commands/metadata/) (the blurb the built site prints above the cards) appears at the top of the editor as the public site renders it, collapsed behind **Read more** past 200 characters. It is read-only here. Write it with [`ritual metadata set <list> description …`](/commands/metadata/), the [List Metadata](/admin/api/#list-metadata) route, or the MCP `set_list_metadata` tool. It is not a pending change, so an edit made elsewhere shows up on the editor's next load.

## How editing works

Each card has **+** and **−** buttons to add or remove copies. Reducing a card to zero removes it. In binder and overlap views the buttons appear as overlays on hover; in list view they are inline. The **⋯** button (or a right-click) opens the card's [context menu](#context-menu) for everything else, and **+ Add Card** in the bottom [action bar](#editor-action-bar) adds new cards.

### Change Tracking

All edits are pending changes in memory until you save.

- The **Changes** button shows the pending count and opens a dialog listing them
- Additive changes (add card, set commander, set finish, set printing, set language) are green; removals are red
- Opposite changes cancel out (adding then removing the same card). This happens only when the two copies are the same card in every respect, [label override](#card-labels) included. Re-adding a card as a proxy does not cancel the removal of a real copy
- Card names in the dialog open the card detail modal; hovering one shows a preview image

### Saving and Discarding

**Save Changes** writes the file and appends to the changelog. It is disabled when nothing is pending. Saving again without leaving the editor folds the later changes into the same changelog entry (bumping its timestamp) rather than adding a new one. Reloading the file, or hitting a save conflict and reloading, starts a fresh session.

**Discard Changes** shows a confirmation dialog listing everything that would be lost.

The same confirmation appears whenever you navigate away with pending changes: picking another file, switching the **Decks** / **Collections** / **Wanted Lists** tab, moving to another page via the sidebar, or logging out. Confirming discards the changes; cancelling keeps you on the current file with them intact. Reloading or closing the tab raises the browser's own "leave site?" prompt.

A save rewrites the whole file from its parsed cards, so it can only be applied to a file the parser read completely. If the file holds a line the parser cannot read (a stray comment, a malformed card line) or a [fenced code block](/list-format/#fenced-code-blocks), the save is [refused with a `400`](/admin/api/#unreadable-lines-block-a-save) naming each offending piece, and nothing is written. Fix or remove it in the file and reload. The editor reports the same content when it loads, so you see the problem before you start editing.

### What a saved deck line looks like

A saved deck line carries the card's printing metadata as optional fields:

```
- 1 Sol Ring (2XM:1) [foil] &1
- 1 Lightning Bolt &2
- 4 Island &3
```

Fields in order (see [List File Format](/list-format/) for the full grammar):

- `(SET:CN)`: set code and collector number
- `[finish]`: `nonfoil`, `foil`, or `etched`
- `[condition]`: `NM`, `LP`, `MP`, `HP`, or `DMG` (`NM` is the default and is not written)
- `[lang]`: a [Scryfall language code](#card-language), omitted for English
- `[labels]`: the card's [label override](/list-format/#card-labels). A deck carries `proxy` only
- `#tags`: the card's [tags](#card-tags), one comma-separated token. Every list type carries them
- `{note}`: the card's [note](/commands/note/)
- `&N`: persistent card ID, auto-assigned and used internally for change tracking

Collections and wanted lists write one line per copy with no quantity. A collection line always carries `(SET:CN)`; a wanted line never carries `[condition]` or `[labels]`. See [List Files](/list-format/#card-lines).

## Keyboard Shortcuts

The editors can be driven entirely from the keyboard. Page-level shortcuts are suppressed while a dialog is open, so the dialog's own keys always win:

| Key            | Action                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **?**          | Open the **Keyboard Shortcuts** reference, the same as clicking the **?** button at the end of the action bar      |
| **Ctrl+Enter** | Open the card search modal, the same as clicking **+ Add Card**                                                    |
| **Ctrl+B**     | Move focus into the bottom [action bar](#editor-action-bar), on its first enabled button                           |
| **←** / **→**  | While focus is in the action bar, move between its buttons (wrapping at either end). **Tab** still works as normal |
| **Esc**        | While focus is in the action bar, drop focus back to the page                                                      |

The **?** dialog lists every binding above plus the per-step keys of the [add-card dialog](#adding-cards). Because **?** is an ordinary character, it only triggers when you are not typing in a text field.

On macOS, **Cmd** substitutes for **Ctrl**. The public site's editor shares the action bar and dialogs, so it has the same shortcuts.

## Editor Action Bar

A bar pinned to the bottom of the editor holds every editing control, left to right:

- **+ Add Card**: opens the card search modal (see [Adding Cards](#adding-cards)); also **Ctrl+Enter**
- **Add Card Defaults**: expands the [defaults panel](#add-card-defaults)
- **Sections**: opens the [Manage Sections](#sections) dialog
- **Categories**: opens the [Manage categories](#card-categories) dialog (all three editors)
- **Labels**: opens the [Default Labels](#card-labels) modal (deck and collection editors)
- **Cover Image…**: opens the [Cover Image](#cover-image) modal (all three editors)
- **Import…**: loads an exported [change bundle](/admin/import/#loading-changes-into-an-editor) as pending edits
- **Swap Printings…**: opens the [Swap Printings](#swap-printings) wizard over the whole list (deck and collection editors)
- **Changes**: shows the pending-change count and opens the changes dialog
- **Undo**: reverts the most recent change
- **Save Changes** / **Discard Changes**
- **?**: opens the [Keyboard Shortcuts](#keyboard-shortcuts) reference

## Adding Cards

Click **+ Add Card** or press **Ctrl+Enter** to open the card search modal. Shortcut hints along its bottom edge change per step, and every step works from the keyboard. Dismiss it with **Esc** or by clicking outside it.

### Step 1: Search

- Type at least 2 characters. The search waits 500 ms after your last keystroke by default; change it with [`searchDebounceMs`](/configuration/#search-debounce)
- Your text is split on whitespace and **every term must appear in the card name**, in any order. `in tre` finds "In the Trenches"; `bolt light` finds "Lightning Bolt". Case, accents, and punctuation need not match (`jaces archivist` finds "Jace's Archivist"). The CLI prompts match the same way
- Closest matches lead: a name you typed in full, then names your query prefixes, then names whose words your terms begin, then mid-word matches
- **↑**/**↓** move through results; **Enter** selects
- Hovering or moving to a card shows a preview image of its cheapest printing

The static [public site's editor](/public-site/editing/) is the exception. It queries the Scryfall API directly, which matches the query as one contiguous string, so its results can differ. A public site [backed by a live API](/public-site/hosted/) uses the term matching above.

### Step 2: Select Printing

Choose a printing from the grid, which shows set, collector number, and price. In the Deck and Wanted List Editors you can also choose **No specific printing**.

Prices follow the selected [price store](/public-site/prices/). The step has its own **Prices** selector (the same one as the list toolbar, shown when both USD stores are enabled). Each printing lists its alternate finishes under its main price, and the finish prices on the next step follow the same store. Card Kingdom quotes for printings no list carries are fetched as the grid opens, so a printing the search just found is priced like any other.

Keyboard: **←**/**→** move to the previous/next printing, **↑**/**↓** move a whole row (the row width follows the grid's column count). Moving past the current page turns the page. **Enter** selects the highlighted printing.

**Type to filter.** Typing anywhere on this step builds a set-code / collector-number query in the filter box below the heading. It uses the same grammar as the CLI's [collector mode](/commands/edit/#collector-number-mode):

- An all-letter token matches set codes as a substring
- Any other token matches set codes or collector numbers. `16` finds `#161`, not `#516`; leading zeros are trimmed, so `0161` finds it too
- Every whitespace-separated term must match, in any order (`ds 12` and `12 ds` are the same query)
- A `:` names the halves outright (`mkm:123`)

The box is never focused automatically, so the arrow keys keep driving the grid while you type. **Backspace** erases; **Esc** clears the query, and a second **Esc** closes the dialog. While a query is live the **No specific printing** tile is hidden. On touch devices, tap the box to type with the on-screen keyboard.

### Step 3: Finish & Condition

This step appears when the selected printing has more than one finish.

- Select a finish (nonfoil, foil, etched)
- Select a condition (NM, LP, MP, HP, DMG). Deck and Collection editors only; defaults to NM
- Set a **Quantity**: how many copies of this exact printing to add. Starts at 1 and cannot go below it. Not shown when the dialog was opened via **Change Printing…**, which asks for a copy count beforehand

Focus lands on the first group's selected option when the step opens.

- **←**/**→** move within the focused group: they change the finish or condition, and step the quantity while the quantity ticker has focus
- **↑**/**↓** (or **Tab**) move between the groups: finish, condition, quantity
- **+**/**-** adjust the quantity from anywhere in the step
- **Enter** adds the card from anywhere in the step, except while **← Back** is focused, where it goes back

Two commit buttons finish the step, each with its shortcut shown in its corner (hidden on touch devices). Both add the chosen quantity of the chosen printing and show a **×N** multiplier once the quantity is above one:

- **Add Card** (**Enter**) adds the card and closes the modal
- **Add Another Card** (**Ctrl+Enter**) adds the card, then returns to a fresh search step. Not offered when the dialog was opened via **Change Printing…**, which edits an existing card

A deck folds the added copies into one entry with a quantity. Collections and wanted lists store one entry per copy, since each copy carries its own condition and note.

### Card Options

Beneath the printing grid, and again on the finish/condition step (bound to the same values), the dialog offers two optional per-card settings:

- **Label**: the [label override](#card-labels) the new card starts with. The choices are what the list type carries: the full vocabulary on a collection, **Proxy** alone on a deck, nothing on a wanted list. The label is part of the `add` change itself, so it lands on the copy being added and never on a same-named card already in the list.
- **Custom art**: a path inside the [art directory](/configuration/#directory-options) or an image URL, validated as you type. An unusable reference is explained under the field and blocks the add until fixed or cleared. Unlike the printing, the art is not part of the change. It is held until the save gives the new line its `&N`, then written straight after (see [Custom Art](#custom-art)). Admin editors only: the public editor exports changes and has no art file to write.

Both fields reset for the next card, including after **Add Another Card**.

## Add Card Defaults

The **Add Card Defaults** toggle sits in the bottom [action bar](#editor-action-bar), between **+ Add Card** and **Changes**. Clicking it expands a panel with the default fields. A dot on the toggle shows when any default is active. This mirrors the session filters in the CLI's `edit` and `add-card` commands and is meant for batch entry: set the defaults once, then add many cards without confirming the same fields each time.

| Field     | Deck Editor   | Collection Editor | Wanted List Editor |
| --------- | ------------- | ----------------- | ------------------ |
| Set codes | ✅ Comma-list | ✅ Comma-list     | ✅ Comma-list      |
| Finish    | ✅            | ✅                | ✅                 |
| Condition | ✅            | ✅                | ❌ Not applicable  |

Defaults are kept per editor and persist across reloads in `localStorage` under `ritual:admin:defaults:{deck,collection,wanted}`.

### How defaults change the add-card flow

- **Set codes**: the printing picker shows only matching printings. If exactly one matches, it is auto-selected and the picker step is skipped. If none match, the picker shows all printings with a hint banner.
- **Finish**: pre-selected on the finish/condition step. If the chosen printing supports it, the step is skipped.
- **Condition**: pre-selected on the finish/condition step. The step is skipped only when both finish and condition are resolved.

When a default cannot be applied (the printing lacks the default finish, or the Collection Editor has no condition default) the finish/condition step still appears with the inputs pre-filled.

## Context Menu

Right-click a card, or click its **⋯** button in binder/overlap views, to open the context menu. Every editor offers:

- **Set as Foil**: greyed out when the printing has no foil, and on a card with no printing at all. Set the printing first and the row becomes available. The same rule holds outside the editors: `ritual set-card --finish foil` and the MCP `apply_changes` `set-finish` action both refuse a foil or etched finish on a line with no printing
- **Change Printing…** (**Set Printing…** on a card with no printing): see [Change Printing](#change-printing). On an entry with quantity > 1 it first asks how many copies to change
- [**Set Language…**](#card-language)
- [**Edit Tags…**](#card-tags)
- [**Edit Categories…**](#card-categories)
- [**Set Custom Art…**](#custom-art)
- **Move to section…**: see [Move to Section](#move-to-section)
- **Move to list…**: see [Moving Cards to Another List](#moving-cards-to-another-list)

The Deck Editor adds **Set as Commander**, which moves the card to the Commander section (several commanders are allowed). The Deck and Collection Editors add [**Set Label…**](#card-labels) with their type's choices, and [**Swap printing…**](#swap-printings), which opens the swap wizard on that one card. On a card with no printing, the wizard sets one from a copy owned in another list.

### Move to Section

**Move to section…** opens a picker listing every section except the card's current one, plus **New section…**, which asks for a name and moves the card into the new section. The move is a `set-section` change. Latest wins: moving a card back to its original section cancels the pending move.

### Change Printing

**Change Printing…** reopens the printing picker used when adding a card, starting on the printing step for the card you clicked. Pick a printing (and finish/condition where applicable) to change the card.

On a card whose line has no printing yet, the menu row, the picker, and its copy-count prompt read **Set Printing…** instead. It is the same flow. Collection entries always have a printing, so only the Deck and Wanted List Editors show it.

When the card represents more than one copy (a deck entry with quantity > 1, or a collection tile that groups identical copies), a prompt first asks **how many of the N copies** get the new printing:

- **Decks**: changing all copies changes the entry in place, logged as one set-printing change. Changing some copies lowers the entry's quantity by that amount and adds the same number of copies of the new printing under a new card ID, logged as a quantity decrease plus an add, so it is clear which copies moved.
- **Collections**: each copy is its own entry, so the chosen number of entries are changed individually (one set-printing change each). Untouched copies keep the old printing and re-group into a separate tile.
- **Wanted lists**: each row is a single entry and is changed directly.

Every printing change is recorded as a change event with the card ID and the target printing, and appears in the changelog (`Set "Lightning Bolt" printing to M10:146 [foil] &5`).

## Sections

Every list type supports named **sections**, which render as headed groups on the public site. Decks use them for Commander/Main/Sideboard/Maybeboard. Collections and wanted lists can use any sections you like (_Trade Binder_, _Foils_, _High Priority_).

Click **Sections** in the bottom [action bar](#editor-action-bar) to open the **Manage Sections** dialog:

- **Add a section**: type a name and click **Add Section** (or press Enter). New sections start empty. Names must be unique **case-insensitively**: typing a name that already exists in any casing marks the input invalid, highlights the clashing row, and disables **Add Section**.
- **Rename a section**: click **Rename** on a row. All cards in that section move with it. A rename that collides with another section (case-insensitive) is rejected.
- **Delete a section**: click **Delete** on a row. Only **empty** sections can be deleted; the button is disabled while the section holds cards.

One kind of deck section does not survive a save while empty. An **extras** section (`## Maybeboard`, `## Tokens` or `## Token`, matched exactly as on [List Files](/list-format/#title-and-sections)) is dropped when it holds no cards, whether you just created it or just removed its last card. Extras count toward no total, so an empty header is a leftover rather than content. Add a card to it in the same save if you want it to stick.

Cards with no explicit section belong to an implicit **Main** section, written out explicitly on the next save. On the public site, a list with two or more sections defaults to grouping by section, and **Section** becomes a grouping option in the toolbar. The **Category** and **Categories** groupings and the **Category** sort are offered on every list (a list with no categories shows one **Uncategorized** group). See [Card Categories](#card-categories).

On disk, sections are `## Section Name` headers beneath the list's `# Title`, with card lines grouped under each. See [Title and sections](/list-format/#title-and-sections).

## Multi-Select

Cards can be selected in every view mode for bulk actions. Hovering a card in binder, overlap, or stack view reveals a checkbox in its top-left corner; in list view the checkbox sits at the far left of each row. Click it, or **Ctrl-click** (**⌘-click** on macOS) anywhere on the card, to select it. A **Selected (N)** button then appears in the toolbar with the count of selected copies in the list you are editing. The selection survives grouping, sorting, and view-mode changes. A quantity group (`4×`) selects all of its copies at once and counts them individually; once some copies are removed it shows a **dash** instead of a checkmark.

The button opens a menu of actions over that list's selection:

- **Copy as Text**: copies a quantity-prefixed `N Card Name (SET:Collector Number)` list to the clipboard
- **Copy as CSV**: copies the selection as CSV (`Name,Set,Collector Number,Finish,Condition,Language,Quantity`)
- **Clear selection**: deselects the current list's cards only

The public site adds an **Add to Trade** action here. The admin site has no Trade Planner page, so it omits it.

### Bulk Edit Actions

While a list is open in edit mode, the **Selected (N)** menu gains an **edit** section. It applies the same operations as a single card's **+** / **−** buttons and **⋯** menu, over the whole selection at once:

- **Add a copy** / **Remove a copy**: bump each selected card up or down by one copy
- **Remove from list** (decks: **Remove from deck**): remove every copy of each selected card
- **Set as Foil** / **Set as Nonfoil**: set the finish on each selected card that supports it; others are skipped. **Set as Foil** is disabled while any selected card has no printing, since a finish belongs to a printing ([Change Printing](#change-printing) sets one). **Set as Nonfoil** stays available, since it clears a finish rather than asserting one
- **Change Printing…**: runs the printing picker over the selected cards one at a time (cancelling skips that card and continues)
- **Swap Printings…**: decks and collections. Opens the [Swap Printings](#swap-printings) wizard with the selected cards pre-checked
- **Set Language…**: opens the [language picker](#card-language) and applies the chosen language to every selected card
- **Set as Commander**: decks only. Marks each selected card as a commander
- **Set Label…**: decks and collections. Opens the [label picker](#card-labels) for the selection's list type (a deck is offered **Proxy** and **Use list default**) and applies the override to every selected card. Hidden when the selection spans several list types, or when the type carries no labels (wanted lists)
- **Add Tag…**: every editor. Opens the [tags dialog](#card-tags) empty, with the list's tags as suggestions, and adds the typed tags to every selected card's existing tags without replacing them. One pending `add-tag` per card per tag it lacked, each its own Undo step
- **Move to section…**: moves every selected card into an existing section, or **New section…** to name a new one
- **Move to list…**: moves every selected card into another list. Each card's [tags](#card-tags) and [custom art](#custom-art) go with it

These edits go through the same pending-changes/undo flow as per-card edits, so nothing is written until you **Save** (admin) or export (public). The selection is cleared once an action is applied.

### Selecting across lists

Selections are held globally, so switching to another list or list type keeps them. Whenever anything is selected, an **All Selected (N)** button appears in the admin header on every page, with the total across all lists. Its menu runs the copy actions over the whole cross-list selection, and **Clear all selections** wipes every list.

**View all selections…** in that menu opens a dialog listing every selected card with its quantity, printing, finish, condition, and source list, in selection order or grouped by source. Each row's ✕ removes one copy, and the copy/clear actions are repeated there. In the editor and on [Move Cards](/admin/move-cards/), the **Selected (N)** menu's **View selected cards…** opens the same dialog scoped to that page. A **Show** toggle switches between **This page** and **All lists**, and the dialog's actions apply to whichever it is showing.

The cross-list menu also offers **Remove all selected**, which deletes every selected card from its list. The dialog offers it, with **Move all to list…**, in its **Edit** row, acting on the cards it is showing. On the admin site this writes every affected list file atomically in one pass (auto-committed to git when enabled), much like [Move Cards](/admin/move-cards/). On the public site, which has no server, the list open in the editor is updated live, and removals for other selected lists are merged into those lists' saved browser sessions, appearing the next time each is opened in edit mode.

## Moving Cards to Another List

While editing a list you can move a card into another list without leaving the editor. This is separate from the [Move Cards](/admin/move-cards/) batch tool. A **Move to list…** item appears in three places:

- the per-card **⋯** context menu (moves that card),
- the per-list **Selected** menu (moves the current selection), and
- the cross-list **All Selected** header menu (moves every selected card from its own list).

Choosing it opens a picker listing your other decks, collections, and wanted lists. Pick one as the destination.

For the per-card and per-list **Selected** moves, choosing a destination removes the card from the list you are editing and **stages** a move. **When you Save, both lists are written.** The card is removed from the source (with a "Move … to …" changelog entry) and added to the destination (with a matching "Move … from …" entry). Moving a card with no printing into a collection, which requires one, opens a printing picker first.

The cross-list **All Selected** move does not go through the editor's Save button. It is applied **immediately** and atomically across every affected file via `POST /api/move/selected`, each card moving from its own list to the chosen destination.

### Incoming moves

Pending changes can also carry **incoming** moves: a `move-to` recording a copy that arrives in the list you are editing from another list. A printing swap that pulls a copy you own elsewhere produces one, as does a bundle loaded through **Import…**. Save handles these symmetrically: the copy is added here and **taken out of the source list**, and both changelogs are written ("Move … from …" here, "Move … to …" on the source). The source copy is found by the source line id the change names when that line still holds the card; otherwise by the exact printing; otherwise (for a source line with no printing, such as a wanted entry) by name.

A move from the **Swap Printings** wizard that gives one of this list's name-only lines a printing carries `replacesCardId` instead. The line is converted in place, keeping its `&N`, or split when only some of its copies are filled. No copy is added. Such a move may also carry a `replacement`: a printing added back to the source list in the section the departed line left, logged there as an `Added` line (see [Save Deck](/admin/api/#save-deck)).

Every move, in either direction, is validated in memory before anything is written. A missing list, a source with no copy left to take, or a card with no printing headed into a collection fails the save with nothing written. A swap that leaves and enters the same other list stages both halves against one copy of its file. The moved copy's tags and custom art follow it both ways.

## Swap Printings

The Deck and Collection Editors can re-pick printings for many cards at once using copies you already own in your **other** lists: upgrade a deck to the foils in a binder, or downgrade it to your cheapest copies. The result is a set of cross-list moves rather than edits to a single file. Lines with **no printing yet** take part too, so the wizard is also the way to batch-set printings on a deck's name-only lines from copies your collections hold. The Wanted List Editor has no swap entry points.

Three entry points, all in edit mode:

- **Swap Printings…** in the [action bar](#editor-action-bar): every line of the list
- **Swap Printings…** in the multi-select **Selected (N)** menu: the selected cards are pre-checked
- **Swap printing…** in a card's **⋯** [context menu](#context-menu): opens on that one card and goes straight to its picker

The wizard's steps:

1. **Cards**: every line of the list, pre-checked, with a checkbox to leave any out. A line with no printing shows a "no printing set" note; it has nothing to swap away from and takes whatever printing you pick.
2. **Sources**: which other lists to draw replacements from, with the same per-type / per-list scope control as the Find page. Decks and collections are on by default; wanted lists are off but selectable. The list being edited is never a source. Only the **saved** contents of other lists count; their unsaved edits are not seen.
3. **Mode**: **Manual** (choose per card), **Most expensive**, or **Least expensive**. Controls on this step:
   - A **finish** filter (any / foil / nonfoil) over the candidates, which also seeds the picker's quick-filter.
   - Where **displaced** copies go: back to the list each replacement came from (default), or one chosen deck or collection for all of them. A displaced copy can never land in a wanted list, so if a replacement comes from a wanted list and no override is set, the summary asks for a destination.
   - Price modes only: what to do with a card that has an **unpriced** candidate (no declared market value; not "worthless"). **Skip** it unchanged and flag it for review (default), **Ignore** unpriced options and rank the rest, or **Ask me** to force a pick by hand. A name-only card's missing printing is not an unpriced option; the price modes plan it from its priced candidates.
   - Every mode, when a checked card has no printing: **Cards without a printing** → **Replace the copies taken from other lists** (off by default). A name-only card displaces nothing, so its source list is simply one copy short afterwards. With this on, a **Replacements** step asks which printing each of those lists gets back.
4. **Pick** (manual mode, forced cards, and any card you **Change…**): per card, the candidate copies across the chosen sources (source list, printing, finish, price, copies available), with the same collector-grammar type-to-filter as the printing picker and a finish quick-filter. Copies are allocated per candidate row, so a card's copies may come from several printings. Unfilled copies keep their current printing. A candidate with **no printing** in its source (a wanted line, or a name-only deck line) first asks you to confirm it is that entry, then opens the full printing dialog to say which printing it actually is.
5. **Review** (price modes only; manual mode goes straight on from picking): every card, current → chosen printing with prices where known, flags (unpriced candidates, no candidates, partial), and a **Change…** button to override the pick.
6. **Replacements** (only with the replace-taken option on, and only when a name-only card was given a printing): one row per source list and printing taken from it (`1× Lightning Bolt (LEA:161) taken from Binder`), each with **Choose replacement…** (**Change printing…** once picked) opening the full printing grid. Rows fold by source list and printing, so two cards taking the same printing from the same list share one row and one pick. The chosen printing is added back to that list in the same quantity when the swap is saved. A row left empty leaves the list a copy short. **No replacement** clears a pick.
7. **Summary**: the planned moves grouped by list (in / out, with any replacement going back to a source shown under its "Taken from" group), the edited list's value before → after with per-card deltas where priced, the displaced-copy destination when one is required, then **Discard** or **Apply**.

**Apply** records the plan into the editor's pending changes. Each replacement is a **move in** from its source list and each displaced copy a **move out** to its destination, one change per physical copy (a deck line's copies share its `&N`; a collection tile's copies each carry their own). A copy arriving on a **name-only** line fills that line instead of adding to the list: the line keeps its `&N` and quantity when one printing fills it whole. A deck line filled partially or from several printings is split: one copy comes off the name-only line for each filled copy, which lands as an add would, and the name-only line goes (its id released) when its last copy is taken. No copy is displaced, so no move out accompanies it.

The edited view updates immediately, the moves appear in the [Changes](#change-tracking) dialog, and undo walks them back one change at a time. Nothing is written until you **Save**, which, as with **Move to list…**, updates **both** sides: the edited list and every source/destination list, each with its own changelog entry. A source list promised a replacement gets that printing added (logged as an `Added` line) in the same save. On the public site the moves travel in the exported bundle's top-level `moves` array instead, with a filling move marked `pinsCardId` and carrying its `replacement`.

## Card Language

Every card entry has a [language](/list-format/#card-language): a Scryfall code written on the line as a lowercase bracket token (`[ja]`) and omitted for English, so a bare line always means `en`.

- **Set Language…** in a card's **⋯** menu (and in the multi-select **Selected** menu) opens a picker over the 17 Scryfall languages, with the current one marked. Picking **English** clears the token. The change is a pending `set-language` edit like any other: undoable, listed in **Changes**, and written on save (changelog: `Set language of "Sol Ring" to Japanese &7`).
- **Adding never asks for a language.** New cards get the configured [`defaultLanguage`](/configuration/#default-language), editable on the admin **Settings** page. Change a copy afterwards with **Set Language…**.
- The **printing picker** shows one tile per physical printing (set + collector number), never one per language. Under a non-English default, a printing that does not exist in that language is marked with a notice. Picking it records the copy in a language that does exist (English when available) rather than inventing one Scryfall has no card for.

## Card Tags

Every card entry on every list type can carry [tags](/list-format/#card-tags): your own words for the card as a copy (`Signed`, `Trade Binder`), as many as you like. Tags follow the card when it moves to another list. Unlike a [label](#card-labels), a tag is not an instruction to Ritual. It is your word for the card, and it drives the **Tags** grouping, sort, and filter row on the [public site](/public-site/filtering/#grouping-sorting-and-filtering-by-tags).

- **Edit Tags…** in a card's **⋯** menu opens a dialog with one field holding the card's whole tag set. Type tags **separated by commas** (`My Tag, My Other Tag` is two tags; spaces are part of a tag). The field validates as you type: a tag cannot contain `#`, `,`, `&`, brackets, braces, or parentheses. An invalid one is explained under the field and blocks **Save**. Tags already used on other cards in the list appear as one-click suggestions. Saving an empty field removes every tag. On a collection tile that groups identical copies, the edit applies to every copy.
- Saving records **one change per tag that differs**: an `add-tag` for each tag added and a `remove-tag` for each removed. Each is its own **Undo** step, most recent first. A `remove-tag` cancels a pending `add-tag` of the same tag (and vice versa), so adding a tag and removing it again in one session leaves nothing pending. Changes are listed in **Changes** and written on save (changelog: `Added tag "Ramp" to "Sol Ring" &5`).
- To tag several cards at once, select them and use **Add Tag…** in the [**Selected** menu](#bulk-edit-actions). The same dialog opens empty (headed **Add tags**; it cannot be saved empty) and the typed tags are added on top of each selected card's own tags.

## Card Categories

Every list type can carry [categories](/commands/categories/): a card's **role in this list** (`Ramp`, `Board Wipes`), ordered so the first is its **primary** category. Unlike a tag, a category belongs to a card **name in this list**: one assignment covers every line of that name, and it never follows a card to another list. Categories drive the [Category groupings, sort, and filter](/public-site/filtering/#grouping-sorting-and-filtering-by-category) on the public site.

- **Edit Categories…** in a card's **⋯** menu opens a dialog with one field holding the card's ordered category list. Type categories **separated by commas** (`Ramp, Artifacts` is two; spaces are part of a name). The field validates as you type with the same shape rule tags use: no `#`, `,`, `&`, `*`, quotes, brackets, braces, or parentheses. An invalid entry is explained under the field and blocks **Save**. Above the field, the parsed categories appear as chips in order, the first marked **primary**; the ◀ and ▶ buttons on a chip move it, so changing the primary is one click. Categories already used in the list, followed by the configured [`defaultCategories`](/configuration/#default-categories), appear as one-click suggestions. Saving an empty field clears the card's categories.
- Saving records **one** `set-categories` change for the card, whatever changed inside it, and it is **one** Undo step. Repeated edits of the same card consolidate into the last one, and restoring the card's on-disk categories cancels the pending change outright.
- **Categories** in the bottom [action bar](#editor-action-bar) opens the **Manage categories** dialog: every category the list uses, with how many cards hold it. **▲ ▼** reorder (that order is the site's group-heading order), **Rename** (refused if another category already has that name, case-insensitively), and **Remove** takes the category off every card holding it. The list here is the list's whole **vocabulary**, including categories its `order` declares that no card currently holds (shown with a count of 0). Reorder and rename are one Undo step each. **Remove** records one `set-categories` change per card that held the category plus one order change, so undoing it takes one step per recorded change.
- Saving writes the list's `<list>.categories.json` file and records the changes in the changelog. If the save's removals left that file naming cards the list no longer holds, those entries are pruned and the status line names them. The same status line carries any categories-file warning the save reported (an unreadable file, entries for cards the list no longer holds). A warning reported when the list **loads** is shown once as an editor error.

## Card Labels

A [card label](/list-format/#card-labels) tells Ritual what a copy is for. Collections carry the whole vocabulary (**For sale**, **For trade**, **To keep**, **Proxy**). A deck carries **Proxy** alone; a wanted list carries none. Labels are set at two levels:

- **Set Label…** in a card's **⋯** menu (and in the multi-select **Selected** menu) sets one line's override. On a collection the picker offers the five label states plus **Use list default**, which clears the override. On a deck it offers **Proxy** and **Use list default**. The change is a pending `set-label` edit like any other: undoable, listed in **Changes**, and written on save. Tiles show a badge on cards whose _override_ differs from the list default.
- The action bar's **Labels** button opens the **Default Labels** modal, which sets the list's front-matter `labels:` default (**No default** or **Proxy** on a deck). It writes immediately through the [List Metadata](/admin/api/#list-metadata) route. Front matter is not a card change, so it needs no save, and the editor adopts the returned content hash so pending card edits still save cleanly afterward. This is how you mark a whole playtest deck as proxies without touching a card line.

In the **Selected** menu, the picker offers only what the selected cards' list type carries. It is hidden for a selection spanning several list types (their vocabularies differ) or one whose type carries no labels.

Proxied cards show their badge and, in place of a price, the **PROXY** marker, in the editor and on the public site alike. They count as `0` in every total and are never offered to a buylist. See [Custom art carries no price](/custom-art/#custom-art-carries-no-price) for the rule both priceless kinds share.

## Custom Art

**Set Custom Art…** in a card's **⋯** menu opens the **Custom Art** dialog, where a card can show your own image instead of its Scryfall art: a proxy scan, an alter, commissioned art. See [Custom Card Art](/custom-art/) for the file format and how the image is published.

- Pick an **Image source**: _File in the art directory_ (a path like `proxies/sol-ring.jpg`, relative to [`artDir`](/configuration/#directory-options)) or _Image on the web_ (an `http(s)` URL). A live preview renders as you type, and says so when the image cannot be loaded.
- **Save** writes immediately through the [Card Art](/admin/api/#card-art) route. **Remove art** clears the card's entry. Both take effect at once: the tile and the card modal re-render with the new image.
- _Setting_ custom art is **metadata, not a pending change**. It is never listed in **Changes**, never part of a save, and never recorded in the changelog. It is safe to set while card edits are pending. A save still moves art entries with the ids it changed: a removed card's art goes with it, a renumbered line takes its entry along, and **Move to list…** / **Swap Printings…** carry it to the destination in either direction. See [Art follows the card](/custom-art/#art-follows-the-card).
- The dialog targets a card's `&N` id. On a tile that groups identical copies, the art goes on the **first** copy, the one the tile renders.
- A card **added this session** has no card line yet, so there is nothing to write against. The dialog says so and holds the reference with your pending changes. The save that writes the card's line writes its art right after. If that write fails (a missing file, for instance) the error banner says which card and why; the list is saved either way, so re-open the dialog and fix the reference.
- **Undo** of a removal brings the card's art back as long as its id has not been reused. An undo that has to allocate a fresh id restores the card without its art.
- A card with custom art [carries no price](/custom-art/#custom-art-carries-no-price), like a `proxy` label; `custom-art` is the reason shown when a card has both. It shows **CUSTOM** where a price would be, counts as `0` in every total, and is never quoted against a buylist, even if the image file is missing.
- A local file must already exist under the art directory. The route refuses a path with nothing behind it and names the location it checked. The admin server serves the art directory read-only, behind the same login, so the preview can show local files.

## Cover Image

The action bar's **Cover Image…** button opens a modal that writes the list's front-matter [`image:`](/list-images/) key through the [List Metadata](/admin/api/#list-metadata) route immediately. Like the labels modal, this is front matter rather than a card change, so it needs no save, and the editor adopts the returned content hash so pending card edits still save cleanly afterward.

- Four modes: **Ritual's own choice** (removes the key), **a card from this list**, **an art file**, and **a URL**. The file and URL fields are the same control and preview the [Custom Art](#custom-art) dialog uses, and a value that does not parse is refused with the same sentence the API would return.
- The card picker offers only cards already **on disk**. A card added this session has no `&N` in the file yet, and a cover naming one would be rejected. Save first, then pick it. Rows that would otherwise read identically (several copies of one printing) are suffixed with the `&N` a pick would write, since which copy the cover names decides whether removing one clears it.
- Saving the dialog without changing anything writes nothing, since the file already says what the form says and a write would rotate its content hash.

## Toolbar and Filters

The list toolbar is the one the public site uses. Its right-aligned **Filters** dropdown groups every card filter, with a badge counting the active ones and a **Clear** action at the top. Filters combine, and on deck pages the commander section is never filtered. The [Filtering Cards](/public-site/filtering/) page has the full rules for each; in brief:

- **Hide Lands** / **Hide Unpriced** / **Hide Extras** (decks only: maybeboard and token sections). Hide Unpriced goes by the price, so it also hides cards [priceless by rule](/custom-art/#custom-art-carries-no-price): proxies and custom-art copies price at `0`
- **Name**: space-separated terms, every one of which must appear in the name, ignoring case and accents (`jotun` matches `Jötun Grunt`, as in the CLI session filter)
- **Color Identity**: the five colors plus **Colorless**, with **Subset** (default), **Include**, **Exclude**, and **Exact** modes
- **Sets**: set codes, with **Include** (default) and **Exclude**
- **Card Type** / **Oracle Tags** / **Art Tags**: tag inputs sharing one **Include / Exclude / Exact** mode, default **Exact**
- **Categories** and **Tags**: shown when the list's cards carry [categories](#card-categories) or [tags](#card-tags). Same three modes, default **Exact**, committing on commas only. Tags match case-sensitively. The grouping menu also offers **Category** (primary only) and **Categories** (every category a card holds, non-primary ones dimmed and badged), and the sort menu offers **Category**
- **Labels**: chips for **For Sale** / **For Trade** / **To Keep** / **Proxy** / **Unlabeled**, against each card's effective [labels](#card-labels). A deck shows only **Proxy** and **Unlabeled**; a wanted list has no row
- **Mana Value**: a comparison (`=`, `<`, `≤`, `>`, `≥`) against a non-negative value (0 is a valid value)
- **Price**: shown while prices are displayed. A comparison (`=`, `<`, `≤`, `>`, `≥`) against the card's price from the selected [price store](/public-site/prices/). The label carries the currency (**Price ($)**), and switching the store clears the field
- **Copies**: a comparison (`=`, `<`, `≤`, `>`, `≥`) against how many copies of the card the list holds, with a **Name / Number / Exact** toggle for [what counts as the same card](/public-site/filtering/#what-counts-as-a-copy)
- **Buylist ($)** and **Buylist**: [sell mode](#sell-mode-in-the-editors) only. A dollar comparison against the buyer's per-copy offer, and **On buylist** / **Not on buylist** chips (a paused offer counts as not on buylist)
- **Shares Cards With** / **Doesn't Share Cards With**: your other lists, with **Any / All** and **Name / Printing** toggles. Shown only when other lists exist. They read the other lists' **saved** files, so another editor's unsaved session is not seen, and each list is loaded once per browser session, so a later save is not picked up until you reload. See [Filtering against other lists](/public-site/filtering/#filtering-against-other-lists)

The toolbar also has the [quick filter](/public-site/filtering/#quick-filter): start typing anywhere outside a field and a **Quick filter** tab drops out of the toolbar's bottom-right corner, holding the same **Name** filter as the panel. Empty it (or press Escape) and it goes away.

### Prices in the editors

The editors follow the [`priceSources`](/configuration/#price-stores-pricesources) config. With both USD stores enabled the toolbar has the same **Prices** store selector as the public site; with an empty list, price displays hide entirely. The public site reads prices stored in its built list data, but the editors quote **live** against the admin's own API, so a card added mid-edit is priced immediately.

### Sell mode in the editors

When [sell mode](/public-site/sell/) is enabled, the toolbar gains a **Sell mode** toggle and a buyer selector, and the editors offer buylist prices, the Buylist filters, buylist grouping and sorting, and the Card Kingdom cart export. It is **off by default** on the admin site too. Enable it with the **Offer sell mode** checkbox on the [Settings](/admin/dashboard/#settings) page, with `ritual config set site.sellMode true`, or by starting the server as [`ritual admin --sell-mode`](/commands/admin/#sell-mode). With it off, the toggle and buyer selector are not rendered and the sell routes answer `404`, unless the `cardkingdom` [price store](/public-site/prices/), which uses the same feed, is enabled. Saving the checkbox applies at once: reopen an editor and the toggle is there (or gone) with no reload.

Quotes come from the locally cached buylist, and the first download never happens on its own. Press **Refresh buylist** on the **Refresh Cache** page, or run `ritual sell --refresh auto`. After that, [`admin`](/commands/admin/) refreshes a day-old copy at startup and the button forces one mid-session. A press that downloads a new feed also clears the quotes this browser session has already resolved, so an editor opened afterwards prices against the new feed.

## Differences Between List Types

The editor is the same for all three types. What differs is what a card line must carry.

### Deck Editor

- **Set as Commander** in the context menu and the **Selected** menu moves a card to the Commander section (several commanders are allowed).
- **No specific printing** is available when adding a card.
- Condition (NM, LP, MP, HP, DMG) is optional and defaults to NM.
- Labels: **Proxy** only. See [Card Labels](#card-labels).

### Collection Editor

Collections are `.md` files in the `collections/` directory.

- **No Set as Commander.** Collections have no reserved Commander section but support any user-named [sections](#sections).
- **Printing required.** **No specific printing** is not offered; you must pick a printing.
- **Finish and condition required.** Both must be set for collection entries.
- Labels: the full vocabulary. See [Card Labels](#card-labels).

### Wanted List Editor

Wanted lists are `.md` files in the `wanted/` directory.

- **No Set as Commander.** Wanted lists have no reserved Commander section but support any user-named [sections](#sections).
- **No condition.** Wanted lists track cards you want, not cards you own.
- **Printing optional.** Cards can be name-only (cheapest printing), a specific printing, or a printing with a finish.
- No labels, and no [Swap Printings](#swap-printings) entry points.

### Feature Comparison

| Feature                   | Deck Editor             | Collection Editor | Wanted List Editor |
| ------------------------- | ----------------------- | ----------------- | ------------------ |
| Set as Commander          | ✅                      | ❌                | ❌                 |
| Change printing           | ✅                      | ✅                | ✅                 |
| Multi-copy printing split | ✅ Entry                | ✅ Per-entry      | ❌ Single rows     |
| Swap printings            | ✅                      | ✅                | ❌ Not offered     |
| No specific printing      | ✅ Allowed              | ❌ Must select    | ✅ Allowed         |
| Condition field           | ✅ Optional             | ✅ Required       | ❌ Not applicable  |
| Finish field              | ✅ Optional             | ✅ Required       | ✅ Optional        |
| Card labels               | ✅ Proxy + list default | ✅ + list default | ❌                 |
| Card tags                 | ✅                      | ✅                | ✅                 |
| Card categories           | ✅                      | ✅                | ✅                 |
| Custom art                | ✅                      | ✅                | ✅                 |
| Cover image               | ✅                      | ✅                | ✅                 |
| Description               | 👁️ Read-only            | 👁️ Read-only      | 👁️ Read-only       |
| Sections                  | ✅ + reserved Commander | ✅ User-named     | ✅ User-named      |
| Add/rename/delete section | ✅                      | ✅                | ✅                 |
| Move card to section      | ✅                      | ✅                | ✅                 |
| Changelog on save         | ✅                      | ✅                | ✅                 |
| Add Card Defaults         | ✅ Set/F/C              | ✅ Set/F/C        | ✅ Set/F           |
