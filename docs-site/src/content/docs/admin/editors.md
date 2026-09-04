---
title: 'Editors'
---

The admin site provides a single **Edit Lists** page for managing decks, collections, and wanted lists. A tab at the top selects the list type — **Decks**, **Collections**, or **Wanted Lists** — and each shares the same core interaction model with minor differences per list type.

## Common Features

### Selecting a File

Pick a list type with the tabs at the top of the page, then choose the file to edit from the dropdown below them. Loading a file fetches full card data, printings, and pricing from the cache.

The address bar follows both choices — `#/edit/deck/Winota%20Stax` is the deck editor with that deck open — so the page can be bookmarked or shared, and reloading returns to the same list. See [page URLs](/admin/#page-urls) for the full scheme.

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

- **Hide Lands** / **Hide Unpriced** — toggle lands and cards without a known price. Hide Unpriced reads the price rather than the reason, so it also hides cards that are [priceless by rule](/custom-art/#custom-art-carries-no-price): proxies and custom-art copies price at `0`
- **Hide Extras** — deck pages only; hides the maybeboard/token sections
- **Name** — space-separated terms; a card matches when every term appears somewhere in its name, case- and accent-insensitively (`jotun` matches `Jötun Grunt`; the same matching the CLI session filter uses)
- **Color Identity** — toggle any combination of the five colors plus a **Colorless** swatch (select it alone to find cards with no color identity), then pick a match mode: **Subset** (the default) matches any card that could be played in a deck of the selected colors, **Include** matches cards using at least one of them, **Exclude** matches cards using none of them, and **Exact** matches cards whose identity is exactly the selection
- **Sets** — a tag input filtering by set code; type a code (space or comma finishes the tag) or pick from the autocomplete list of codes present in the list. **Include** (the default) keeps the selected sets; **Exclude** drops them
- **Card Type** / **Oracle Tags** / **Art Tags** — tag inputs sharing the same **Include / Exclude / Exact** match mode, defaulting to **Exact** (a card must carry every selected value)
- **Categories** — shown when the list's cards carry [categories](#card-categories); a tag input with the same **Include / Exclude / Exact** modes, defaulting to **Exact**. It commits on **commas only** (a space is part of a category name) and keeps each name's own capitalization. The toolbar's grouping menu also offers **Category** (primary only) and **Categories** (every category a card holds, non-primary appearances dimmed and badged), and its sort menu offers **Category** — see [grouping, sorting and filtering by category](/public-site/filtering/#grouping-sorting-and-filtering-by-category)
- **Tags** — shown when the list's cards carry [tags](#card-tags) — your own card tags, not the Scryfall oracle/art rows; a tag input with the same **Include / Exclude / Exact** modes, defaulting to **Exact**. It commits on **commas only** (a space is part of a tag) and matches exactly, case-sensitively: `Ramp` and `ramp` are two tags — see [grouping, sorting and filtering by tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags)
- **Labels** — label-carrying pages only; chips for **For Sale** / **For Trade** / **To Keep** / **Proxy** / **Unlabeled**, matched against each card's effective [labels](#card-labels). A deck page shows only the two chips a deck can answer, **Proxy** and **Unlabeled**; a wanted list shows the row not at all (see the public-site [filtering](/public-site/filtering/#available-filters) page for the selection rules)
- **Mana Value** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against a non-negative value (0 is valid)
- **Price** — shown while prices are displayed; a comparison (`=`, `<`, `≤`, `>`, `≥`) against the card's price from the selected [price store](/public-site/price-sources/). The label carries the currency (**Price ($)**), and switching the store clears the field
- **Copies** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against how many total copies of the card the list holds, with a **Name / Number / Exact** toggle picking what counts as the same card (see [what counts as a copy](/public-site/filtering/#what-counts-as-a-copy))
- **Buylist ($)** — sell mode only; a comparison against the buyer's per-copy offer, always in dollars
- **Buylist** — sell mode only; chips for **On buylist** / **Not on buylist**, matched against whether the selected buyer is currently buying the card's printing — a paused offer counts as **Not on buylist** (see [sell mode](/public-site/sell/))
- **Shares Cards With** / **Doesn't Share Cards With** — multi-selects of your other lists, keeping (or hiding) cards that also appear in them, with **Any / All** and **Name / Printing** toggles. Shown only when other lists exist, and compared against their **saved** contents — another list's unsaved editor session is not seen. Each compared list is loaded once per browser session, so saving it in another editor isn't picked up here until you reload. See the public-site [filtering](/public-site/filtering/#filtering-against-other-lists) page for the full rules

Filters combine, and the **Clear** action at the top of the panel resets everything. On deck pages the commander section is never filtered.

The toolbar also carries the [quick filter](/public-site/filtering/#quick-filter): start typing anywhere outside a field and a small **Quick filter** tab drops out of its bottom-right corner, holding the same **Name** filter as the panel. Empty it (or press Escape in it) and it goes away.

When [sell mode](/public-site/sell/) is enabled, the toolbar also carries a **Sell mode** toggle and a buyer selector, and buylist prices, the Buylist filters, the buylist grouping and sorting, and the Card Kingdom cart export become available in the editors. It is **off by default** on the admin site too — enable it with the **Offer sell mode** checkbox on the [Settings](/commands/admin/#settings) page, with `ritual config set site.sellMode true`, or by starting the server as [`ritual admin --sell-mode`](/commands/admin/#sell-mode); with it off the toggle and buyer selector are not rendered at all, and the sell routes behind them answer `404` unless the `cardkingdom` [price store](/public-site/price-sources/) — which rides on the same feed — is enabled. Saving the checkbox applies at once: reopen an editor and the toggle is there (or gone), with no reload.

The editors also follow the [`priceSources`](/configuration/#price-stores-pricesources) config: with both USD stores enabled their toolbar carries the same **Prices** source selector as the public site, and with an empty list their price displays hide entirely. Unlike the public site (which reads prices baked into its list data), the editors quote **live** against the admin's own API, so a card added mid-edit is priced immediately. Quotes come from the locally cached buylist. The first download is deliberate — the **Refresh Cache** page's _Refresh buylist_ button, or `ritual sell --refresh auto` — after which [`admin`](/commands/admin/) refreshes a day-old copy at startup and the button forces one mid-session. A button press that actually downloads a new feed also clears the quotes this browser session has already resolved, so an editor opened afterwards prices against the new feed rather than the one it had asked about before. See [Sell mode](/public-site/sell/).

Each card displays **+** and **−** buttons to add or remove copies. Reducing a card's quantity to zero removes it entirely.

In binder and overlap views, these appear as transparent overlay buttons on hover. In list view, they appear inline.

### Multi-Select

Cards can be selected across every view mode for bulk actions. Hovering a card in binder, row, or column view reveals a translucent checkbox in its top-left corner; in list view the checkbox sits at the far left of each row. Clicking it — or **Ctrl-clicking** (**⌘-clicking** on macOS) anywhere on the card — marks the card with an accent-colored checkmark, and a **Selected (N)** button appears in the toolbar showing the running count of selected copies for the list you're editing. The selection persists across grouping, sorting, and view-mode changes. A quantity group (e.g. `4×`) selects all of its copies at once and counts them individually; once some copies are removed it shows a **dash** instead of a checkmark.

Opening the button reveals a menu of actions over that list's selection:

- **Copy as Text** — copies a quantity-prefixed `N Card Name (SET:Collector Number)` list to the clipboard
- **Copy as CSV** — copies the selection as CSV (`Name,Set,Collector Number,Finish,Condition,Language,Quantity`)
- **Clear selection** — deselects the current list's cards only

The public site adds an **Add to Trade** action here; the admin site omits it because it has no Trade Planner page.

#### Bulk Edit Actions

While a list is open in edit mode, the **Selected (N)** menu also gains an **edit** section that applies the same operations as a single card's **+** / **−** buttons and **⋯** context menu, but over the whole selection at once:

- **Add a copy** / **Remove a copy** — bump each selected card up or down by one copy
- **Remove from list** (decks: **Remove from deck**) — remove every copy of each selected card
- **Set as Foil** / **Set as Nonfoil** — set the finish on each selected card that supports it (others are skipped). **Set as Foil** is disabled while any selected card names no printing — a finish belongs to a printing, so those cards need one pinned first ([Change Printing](#change-printing)). **Set as Nonfoil** stays available: it clears a finish token rather than asserting one.
- **Change Printing…** — runs the printing picker over the selected cards one at a time (cancelling skips that card and continues)
- **Swap Printings…** — decks and collections; opens the [Swap Printings](#swap-printings) wizard with the selected cards pre-checked
- **Set Language…** — opens the [language picker](#card-language) and applies the chosen language to every selected card
- **Set as Commander** — decks only; marks each selected card as a commander
- **Set Label…** — decks and collections; opens the [label picker](#card-labels) for the selection's list type (a deck is offered **Proxy** and **Use list default**) and applies the chosen override to every selected card. The item is hidden when the selection spans several list types, or is on a list type that carries no labels (wanted lists)
- **Move to section…** — opens a picker to move every selected card into an existing section, or **New section…** to name a new one
- **Move to list…** — opens a picker to move every selected card into another list (each card's [tags](#card-tags) and [custom art](#custom-art) go with it)

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

Prices follow the selected [price store](/public-site/price-sources/): the step carries its own **Prices** selector (the same one the list toolbar has, when both USD stores are enabled), each printing lists its alternate finishes underneath its main price, and the finish prices on the next step follow the same store. Card Kingdom quotes for printings no list carries are fetched from the admin API as the grid opens, so a printing the search just turned up is priced like any other.

The grid navigates in two dimensions: **←**/**→** move to the previous/next printing, and **↑**/**↓** move a whole row up or down (the row width follows the grid's responsive column count). Moving past the printings shown on the current page pages the grid automatically. **Enter** selects the highlighted printing.

**Type to filter.** Typing anywhere on this step builds a set-code / collector-number query in the filter box below the heading — the same grammar as the CLI's [collector mode](/commands/edit/#collector-number-mode). An all-letter token matches set codes as a substring; any other token matches set codes or collector numbers (`16` finds `#161`, not `#516`; leading zeros are trimmed, so `0161` finds it too). Every whitespace-separated term must match and their order never matters (`ds 12` and `12 ds` are the same query), and a `:` names the halves outright (`mkm:123`). The box is never focused automatically, so the arrow keys keep driving the grid while you type; **Backspace** erases and **Esc** clears the query (a second **Esc** closes the dialog). While a query is live the **No specific printing** tile is hidden. On touch devices, tap the box to type with the on-screen keyboard.

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

#### Card Options

Beneath the printing grid (and again on the finish/condition step, bound to the same values) the dialog offers two optional per-card settings:

- **Label** — the [label override](#card-labels) the new card starts under, listing what the list type carries: the full vocabulary on a collection, **Proxy** alone on a deck, nothing at all on a wanted list. The label rides the `add` change itself, so it lands on the copy being added and never on a same-named card already in the list.
- **Custom art** — a path inside the [art directory](/configuration/#directory-options) or an image URL, validated as you type; an unusable reference is explained under the field and blocks the add until it is fixed or cleared. Unlike the printing, the art is not part of the change: it is held until the save gives the new line its `&N`, and written straight after it (see [Custom Art](#custom-art)). Offered in the admin editors only — the public editor exports changes and has no sidecar to write.

Both fields reset for the next card, including after **Add Another Card**.

### Context Menu

Right-clicking a card (or clicking the **⋯** button in binder/overlap views) opens a context menu. **Set as Foil** (disabled until the card pins a printing), **Change Printing…** (**Set Printing…** on a card that pins none), [**Set Language…**](#card-language), [**Edit Tags…**](#card-tags), [**Edit Categories…**](#card-categories), [**Set Custom Art…**](#custom-art), and **Move to section…** are available in all editors. The Deck Editor additionally offers **Set as Commander**; the Deck and Collection Editors offer [**Set Label…**](#card-labels) with their type's choices, and [**Swap printing…**](#swap-printings), which opens the swap wizard on that one card (on a card that pins none, the wizard sets its printing from a copy owned in another list).

#### Move to Section

The **Move to section…** item opens a picker listing every section except the card's current one, plus a **New section…** entry that prompts for a name and moves the card into a freshly created section. Moving a card emits a `set-section` change (latest-wins: moving a card back to its original section cancels the pending move).

### Sections

Every list type supports named **sections** that render as headed groups on the public site. Decks use sections for Commander/Main/Sideboard/Maybeboard; collections and wanted lists can be split into any sections you like (e.g. _Trade Binder_, _Foils_, _High Priority_).

Click the **Sections** button in the bottom [action bar](#editor-action-bar) to open the **Manage Sections** dialog:

- **Add a section** — type a name and click **Add Section** (or press Enter). New sections start empty. Section names must be unique **case-insensitively**: typing a name that already exists (in any casing) marks the input invalid, highlights the clashing row, and disables **Add Section**.
- **Rename a section** — click **Rename** on a row; all cards in that section move with it. A rename that would collide with another section (case-insensitive) is rejected.
- **Delete a section** — click **Delete** on a row. Only **empty** sections can be deleted; the button is disabled while a section still holds cards.

One deck section does not survive a save while empty: an **extras** section (a name containing `maybeboard` or `token`) is dropped when it holds no cards, whether you just created it or just removed its last card. Extras count toward no total, so a header with nothing under it is a leftover rather than content — add a card to it in the same save if you want it to stick.

Cards with no explicit section belong to an implicit **Main** section, which is written out explicitly the next time the list is saved. On the public site, a list with two or more sections defaults to grouping by section, and **Section** becomes a selectable grouping option in the toolbar. The **Category** and **Categories** groupings and the **Category** sort are offered on every list (a list with no categories shows one **Uncategorized** group) — see [Card Categories](#card-categories).

On disk, sections are `## Section Name` (H2) headers beneath the list's `# Title`, with card lines grouped under each header. See the [collection](/commands/edit/#collection-files) and [wanted list](/commands/edit/#wanted-list-files) file formats.

#### Change Printing

**Change Printing…** reopens the same printing picker used when adding a card — starting directly on the printing-selection step for the card you clicked. Pick a printing (and finish/condition, where applicable) to retarget the card.

On a card whose line pins no printing yet there is nothing to change, so the menu row reads **Set Printing…** instead — as do the picker and its copy-count prompt. It is the same flow either way. (Collection entries always pin a printing, so only the Deck and Wanted List Editors ever show it.)

When the card represents more than one copy (a Deck Editor entry with quantity > 1, or a Collection Editor tile that groups identical copies), a prompt first asks **how many of the N copies** should get the new printing:

- **Decks** — Changing all copies retargets the entry in place (logged as a single set-printing change). Changing only some copies decreases the entry's quantity by that amount and adds the same number of copies of the new printing under a new card ID — logged as a quantity decrease plus a new add, so it is unambiguous which copies moved.
- **Collections** — Each copy is its own single-card entry, so the chosen number of entries are retargeted individually (one set-printing change each). Untouched copies keep the old printing and re-group into a separate tile.
- **Wanted lists** — Each row is a single entry and is retargeted directly.

Every printing change is recorded as a change event tagged with the card ID and the target printing, and appears in the changelog (e.g. `Set "Lightning Bolt" printing to M10:146 [foil] &5`).

### Swap Printings

The Deck and Collection Editors can re-pick printings for many cards at once using copies you already own in your **other** lists — upgrading a deck to the foils sitting in a binder, or downgrading it to the cheapest copies you have — expressing the result as cross-list moves rather than as edits to a single file. Lines that name **no printing yet** take part too: the wizard is also the way to batch-set printings on a deck's name-only lines from the copies your collections hold. There are three entry points, all in edit mode:

- **Swap Printings…** in the [action bar](#editor-action-bar) — every line of the list
- **Swap Printings…** in the multi-select **Selected (N)** menu — the wizard opens with the selected cards pre-checked
- **Swap printing…** in a card's **⋯** [context menu](#context-menu) — the wizard opens on that one card and goes straight to its picker

The wizard walks through:

1. **Cards** — every line of the list, pre-checked, each with a checkbox to leave it out. A line that names no printing shows a "no printing set" note in place of its printing: it has nothing to swap away from, and takes whatever printing you pick for it.
2. **Sources** — which other lists to draw replacements from, with the same per-type / per-list scope control as the Find page. Decks and collections are on by default; wanted lists are **off** by default but selectable. The list being edited is never a source. Only the **saved** contents of the other lists count — their pending, unsaved edits are not overlaid.
3. **Mode** — **Manual** (choose per card), **Most expensive**, or **Least expensive**. Two controls apply in every mode: a **finish** filter (any / foil / nonfoil) over the candidates, which also seeds the picker's quick-filter; and where **displaced** copies go — back to the list each replacement came from (default), or one chosen deck or collection for every displaced copy. The price modes add one more — what to do with a card that has an **unpriced** candidate (no declared market value, not "worthless"): **Skip** it unchanged and flag it for review (default), **Ignore** unpriced options and rank the rest, or **Ask me** (force a pick by hand in the picker). A name-only card's missing printing is not an unpriced option — the price modes plan it from its priced candidates. A displaced copy can never land in a wanted list: if a replacement comes from a wanted list and no override is set, the summary asks for a destination. In **every** mode, if a checked card has no printing, a third control appears (**Cards without a printing**) — **Replace the copies taken from other lists** (off by default). A name-only card displaces nothing, so the list its copy comes from is simply one copy short afterwards; with this on, a **Replacements** step asks which printing each of those lists gets back.
4. **Pick** (manual mode, forced cards, and any card you **Change…**) — per card, the candidate copies across the chosen sources (source list, printing, finish, price, copies available), with the same collector-grammar type-to-filter as the printing picker and a finish quick-filter. Copies are allocated per candidate row, so a card's copies may be filled from several printings; copies left unfilled keep their current printing. A candidate with **no printing** in its source (a wanted line, or a name-only deck line) first asks you to confirm it is that entry, then opens the full printing dialog to say which printing it actually is.
5. **Review** (price modes only — manual mode goes from picking straight on) — every card: current → chosen printing with prices where known, flags (unpriced candidates, no candidates, partial), and a **Change…** button to override the pick.
6. **Replacements** (only with the replace-taken option on, and only when a name-only card was given a printing) — one row per source list and printing taken from it (`1× Lightning Bolt (LEA:161) taken from Binder`), each with **Choose replacement…** (**Change printing…** once one is picked) opening the full printing grid for the card. Rows fold by source list and printing, so two cards taking the same printing from the same list share one row and one pick. A chosen printing is added back to that list in the same quantity when the swap is saved; a row left without one leaves the list a copy short. **No replacement** clears a pick.
7. **Summary** — the planned moves grouped by list (in / out, with any replacement going back to a source shown under its "Taken from" group), the edited list's value before → after with per-card deltas where priced, the displaced-copy destination when one is required, then **Discard** or **Apply**.

**Apply** records the plan into the editor's pending changes: each replacement is a **move in** from its source list, each displaced copy a **move out** to its destination, one change per physical copy (a deck line's copies share its `&N`; a collection tile's copies each carry their own). A copy arriving on a **name-only** line pins that line instead of adding to the list: the line keeps its `&N` and quantity when one printing fills it whole, and a deck line filled partially or from several printings is split — one copy comes off the name-only line for each pinned copy, which lands as an add would, and the name-only line goes (its id released) when its last copy is taken. No copy is displaced, so no move out accompanies it. The edited view updates immediately, the moves appear in the [Changes](#change-tracking) dialog, and undo walks them back one change at a time. Nothing is written until you **Save** — which, as with **Move to list…**, updates **both** sides: the edited list and every source/destination list, each with its own changelog entry; a source list that was promised a replacement gets that printing added (and logged as an `Added` line) in the same save. On the public site the moves travel in the exported bundle's top-level `moves` array instead, a pinning move marked with `pinsCardId` and carrying its `replacement`. The Wanted List Editor has no swap entry points.

### Card Language

Every card entry has a [language](/commands/edit/#card-language) — a Scryfall code written on the line as a lowercase bracket token (`[ja]`) and omitted for English, so a bare line always means `en`.

- **Set Language…** in a card's `⋯` context menu (and in the multi-select **Selected** menu) opens a picker over the 17 Scryfall languages, with the current one marked. Picking **English** clears the token. The change is a pending `set-language` edit like any other — undoable, listed in **Changes**, and written on save (changelog: `Set language of "Sol Ring" to Japanese &7`).
- **Adding never asks for a language**: new cards are stamped with the configured [`defaultLanguage`](/configuration/#default-language) (editable on the admin **Settings** page). Change an individual copy afterwards with **Set Language…**.
- The **printing picker** shows one tile per physical printing (set + collector number), never one per language object. Under a non-English default, a printing that does not exist in that language is marked with a notice — picking it records the copy in the language that does exist (English when available) rather than inventing a language Scryfall has no card object for.

### Card Tags

Every card entry on every list type can carry [tags](/commands/edit/#card-tags) — your own words for the card as a copy (`Signed`, `Trade Binder`), as many as you like; they follow the card when it moves to another list. Unlike a [label](#card-labels), a tag is not an instruction to Ritual; it is your word for the card, and it drives the **Tags** grouping, sort and filter row on the [public site](/public-site/filtering/#grouping-sorting-and-filtering-by-tags).

- **Edit Tags…** in a card's `⋯` context menu opens a dialog with one field holding the card's whole tag set, seeded with its current tags. Type tags **separated by commas** — `My Tag, My Other Tag` is two tags; spaces are part of a tag — and the field validates as you type (a tag cannot contain `#`, `,`, `&`, brackets, braces or parentheses; an invalid one is explained under the field and blocks **Save**). Tags already used on other cards in the list appear as one-click suggestions. Saving an empty field removes every tag. On a collection tile that groups identical copies, the edit applies to every copy.
- Saving records **one change per tag that differs** — an `add-tag` for each tag added, a `remove-tag` for each removed — rather than one whole-set change, and each is its own **Undo** step (undo reverts one tag at a time, most recent first). A `remove-tag` cancels a pending `add-tag` of the same tag (and vice versa), so adding a tag and removing it again in one session leaves nothing pending. Changes are listed in **Changes** and written on save (changelog: `Added tag "Ramp" to "Sol Ring" &5`).
- Tags are not offered in the multi-select **Selected** menu; edit them per card.

### Card Categories

Every list type can carry [categories](/commands/categories/) — a card's **role in this list** (`Ramp`, `Board Wipes`), ordered so the first is its **primary** category. Unlike a tag, a category belongs to a card **name in this list**: one assignment covers every line of that name, and it never follows a card to another list. Categories drive the [Category groupings, sort and filter](/public-site/filtering/#grouping-sorting-and-filtering-by-category) on the public site.

- **Edit Categories…** in a card's `⋯` context menu opens a dialog with one field holding the card's whole ordered category list, seeded with its current categories. Type categories **separated by commas** — `Ramp, Artifacts` is two, and spaces are part of a name — and the field validates as you type (the same shape rule tags use: no `#`, `,`, `&`, `*`, quotes, brackets, braces or parentheses; an invalid entry is explained under the field and blocks **Save**). Above the field, the parsed categories appear as chips in order, the first marked **primary**; the ◀ and ▶ buttons on a chip move it, so changing which category is primary is one click. Categories already used elsewhere in the list — followed by the configured [`defaultCategories`](/configuration/#default-categories) — appear as one-click suggestions. Saving an empty field clears the card's categories.
- Saving records **one** `set-categories` change for the card, whatever changed inside it, and it is **one** Undo step. Repeated edits of the same card consolidate into the last one, and restoring the card's on-disk categories cancels the pending change outright, leaving nothing in **Changes**.
- **Categories** in the bottom [action bar](#editor-action-bar) opens the **Manage categories** dialog: every category the list uses, with how many cards hold it, **▲ ▼** to reorder (that order is the site's group-heading order), **Rename** (refused if another category already has that name, compared case-insensitively) and **Remove**, which takes the category off every card holding it. The list here is the list's whole **vocabulary** — including categories its `order` declares that no card currently holds, which show a count of 0. Reorder and rename are one Undo step each; **Remove** records one `set-categories` change per card that held the category plus one order change, so undoing a removal takes one step per recorded change.
- Saving writes the list's `<list>.categories.json` sidecar and records the changes in its changelog. If the save's removals left the sidecar naming cards the list no longer holds, those entries are pruned and the status line names them. The same status line carries any categories-sidecar warning the save reported (an unreadable sidecar, entries for cards the list no longer holds), and a warning reported when the list **loads** is shown once as an editor error.

### Custom Art

**Set Custom Art…** in a card's `⋯` context menu opens the **Custom Art** dialog, where a card can
be shown with your own image instead of its Scryfall art — a proxy scan, an alter, commissioned art.
See [Custom Card Art](/custom-art/) for the sidecar format and how the image is published.

- Pick an **Image source**: _File in the art directory_ (a path like `proxies/sol-ring.jpg`,
  relative to [`artDir`](/configuration/#directory-options)) or _Image on the web_ (an `http(s)`
  URL). A live preview renders as you type, and says so when the image cannot be loaded.
- **Save** writes immediately through the [Card Art](/admin/api/#card-art) route; **Remove art**
  clears the card's entry. Both take effect in the editor at once — the tile and the card modal
  re-render with the new image.
- _Setting_ custom art is **metadata, not a pending change**: it is never listed in **Changes**,
  never part of a save, and never recorded in the changelog. It is also safe to set while card edits
  are pending, since the card lines and the art sidecar are disjoint files. A save still _re-files_
  the sidecar for the ids it changed — a removed card's art goes with it, a renumbered line takes
  its entry along, and **Move to list…** / **Swap Printings…** carry the entry to the destination, in either direction. See
  [Art follows the card](/custom-art/#art-follows-the-card).
- The dialog targets a card's `&N` id. A tile that groups identical copies applies the art to the
  **first** copy — the one the tile renders.
- A card **added during this session** has no card line yet, so there is nothing for the art route
  to write against. The dialog says so and holds the reference with your pending changes instead;
  the save that writes the card's line writes its art immediately afterwards. If that write fails
  (a file that is not there, for instance) the editor's error banner says which card and why — the
  list is saved either way, so re-open the dialog and fix the reference.
- **Undo** of a removal brings the card's art back with it, as long as the id has not been
  reused: the undo reclaims the card's original `&N`, and whatever art the list holds for it
  applies again. An undo that has to allocate a fresh id restores the card without its art.
- A card given custom art [carries no price](/custom-art/#custom-art-carries-no-price) —
  the same rule the `proxy` label carries, and `custom-art` is the reason that wins when a card
  has both. It shows **CUSTOM** where a price would be, counts as `0` in every total, and is
  never quoted against a buylist. That holds from the moment the reference is written, even if
  the image file itself is missing.
- A local file must already exist under the art directory: the route refuses a path with nothing
  behind it and names the exact location it checked. The admin server serves the art directory
  read-only (behind the same login) so the preview can show local files.

### Change Tracking

All edits are tracked as in-memory change events until explicitly saved.

- **Changes** button shows the count of pending changes and opens a dialog listing them
- Additive changes (add card, set commander, set finish, set printing, set language) are shown in green
- Destructive changes (remove card) are shown in red
- Opposite changes cancel out automatically (e.g., adding then removing the same card) — but only when the two copies are the same card in every respect, [label override](#card-labels) included: re-adding a card as a proxy does not cancel the removal of a real copy of it
- Card names in the changes dialog are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

### Cover Image

- The action bar's **Cover Image…** button opens a modal that writes the list's front-matter
  [`image:`](/list-images/) key through the [List Metadata](/admin/api/#list-metadata) route
  immediately — like the labels modal, this is front matter rather than a card change, so it needs
  no save, and the editor adopts the returned content hash so pending card edits still save cleanly
  afterward.
- Four modes: **Ritual's own choice** (removes the key), **a card from this list**, **an art file**,
  and **a URL**. The file and URL fields are the same control (and the same preview) the
  [Custom Art](#custom-art) dialog uses, and a value that does not parse is refused in the dialog
  with the same sentence the API would return.
- The card picker offers only cards that are already **on disk**: a card added in the current
  session has no `&N` in the file yet, and a cover naming one would be rejected by the route. Save
  the session first, then pick it. Rows that would otherwise read identically (several copies of one
  printing) are suffixed with the `&N` a pick would write, since which copy the cover names decides
  whether removing one clears it.
- Saving the dialog without changing anything writes nothing — the file already says what the form
  says, and a write would rotate its content hash to state it again.

### Editor Action Bar

A bar pinned to the bottom of the editor holds all editing controls, from left to right:

- **+ Add Card** — opens the card search modal (see [Adding Cards](#adding-cards)); also **Ctrl+Enter**
- **Add Card Defaults** — expands the [defaults panel](#add-card-defaults) upward
- **Sections** — opens the [Manage Sections](#sections) dialog
- **Categories** — opens the [Manage categories](#card-categories) dialog (all three editors)
- **Labels** — opens the [Default Labels](#card-labels) modal (deck and collection editors)
- **Cover Image…** — opens the [Cover Image](#cover-image) modal (all three editors)
- **Import…** — loads an exported [change bundle](/commands/admin/#loading-changes-into-an-editor) as pending edits
- **Swap Printings…** — opens the [Swap Printings](#swap-printings) wizard over the whole list (deck and collection editors)
- **Changes** — shows the pending-change count and opens the changes dialog
- **Undo** — reverts the most recent change
- **Save Changes** / **Discard Changes**
- **?** — opens the [Keyboard Shortcuts](#keyboard-shortcuts) reference

### Saving and Discarding

- **Save Changes** — Writes the updated file and appends to the changelog. Disabled when there are no pending changes. Saving more than once without leaving the editor folds the later changes into the same session's changelog entry (bumping its timestamp) rather than creating a new entry each time; reloading the file (or hitting a save conflict and reloading) starts a fresh session.
- **Discard Changes** — Shows a confirmation dialog listing all changes that would be lost.

The same confirmation also appears automatically whenever you navigate away with pending changes — selecting a different file in the dropdown, switching the **Decks** / **Collections** / **Wanted Lists** type tab, moving to another page via the admin sidebar, or logging out. Confirming discards the pending changes and proceeds; cancelling keeps you on the current file with your changes intact. Changes you want to keep must be saved explicitly first.

Reloading or closing the browser tab with pending changes triggers the browser's own "leave site?" prompt as a final safeguard.

A save re-serializes the whole file from its parsed cards, so it can only be applied to a file the
parsers read completely. If the file on disk holds a line the parser cannot read — a stray comment,
a malformed card line — or a [fenced code block](/commands/edit/#fenced-code-blocks), which parses
cleanly as prose but which the canonical serializer cannot emit, the save is
[refused with a `400`](/admin/api/#unreadable-lines-block-a-save) naming each offending piece, and
nothing is written. Fix or remove it in the file and reload. The same content is reported up front
in the editor's load, so the problem is visible before you start editing.

---

## Deck Editor

Open **Edit Lists** (admin sidebar or Dashboard card) and select the **Decks** tab.

### Context Menu

The **⋯** button opens a context menu with the [items every editor shares](#context-menu) —
**Set as Foil**, **Change Printing…**, [**Swap printing…**](#swap-printings), [**Set
Language…**](#card-language), [**Edit Tags…**](#card-tags), [**Edit
Categories…**](#card-categories), [**Set Custom Art…**](#custom-art), and
**Move to section…** — plus two the Deck Editor adds:

- **Set as Commander** — Move the card to the Commander section (supports multiple commanders)
- [**Set Label…**](#deck-labels) — Set the line's `proxy` override

**Change Printing…** on an entry with quantity > 1 first asks how many copies to retarget (see
[Change Printing](#change-printing)); **Set as Foil** is greyed out when the printing has no foil, and
on a card that pins no printing at all — set the printing first, and the row becomes available. The
same rule holds outside the editors: `ritual set-card --finish foil` and the MCP `apply_changes`
`set-finish` action both refuse a foil or etched finish on a printing-less line.

### Deck Labels

A deck carries exactly one [card label](/commands/edit/#card-labels), **Proxy**, and the deck
editor edits it at both levels:

- The action bar's **Labels** button opens the same **Default Labels** modal collections use,
  offering **No default** and **Proxy**. It writes the deck's front-matter `labels:` through the
  [List Metadata](/admin/api/#list-metadata) route immediately, exactly as it does for a
  collection — which is how you mark a whole playtest deck as proxies without touching a card
  line.
- **Set Label…** in a card's **⋯** context menu (and in the multi-select **Selected** menu) sets
  one line's override, offering **Proxy** and **Use list default** — the deck's whole vocabulary.
  It is a pending `set-label` change like any other: undoable, listed in **Changes**, and written
  on save.

Proxied cards render their badge and, in place of a price, the **PROXY** marker — in the editor
and on the public site alike. They count as `0` in every total and are never offered to a
buylist; see [Custom art carries no price](/custom-art/#custom-art-carries-no-price) for the one
rule both by-rule priceless flavours share.

### Adding Cards

The **No specific printing** shortcut is available — add a card without selecting a printing.

Condition (NM, LP, MP, HP, DMG) is optional and defaults to NM.

### Extended Deck Format

Cards can include optional printing metadata:

```
- 1 Sol Ring (2XM:1) [foil] &1
- 1 Lightning Bolt &2
- 4 Island &3
```

Fields in order (see [List File Format](/list-format/) for the full grammar):

- `(SET:CN)` — Set code and collector number
- `[finish]` — `nonfoil`, `foil`, or `etched`
- `[condition]` — `NM`, `LP`, `MP`, `HP`, or `DMG` (`NM` is the default and is not written)
- `[lang]` — a [Scryfall language code](#card-language); omitted for English
- `[labels]` — the card's [label override](/commands/edit/#card-labels); a deck carries `proxy` only
- `#tags` — the card's [tags](#card-tags), one comma-separated token; every list type carries them
- `{note}` — the card's [note](/commands/note/)
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

### Card Labels

Collections carry the whole [card label](/commands/edit/#card-labels) vocabulary — For sale / For trade / To keep / Proxy — where a deck carries **Proxy** alone:

- **Set Label…** in a card's `⋯` context menu (and in the multi-select **Selected** menu) opens a picker with the five label states plus **Use list default**, which clears the card's override. The change is a pending `set-label` edit like any other — undoable, listed in **Changes**, and written on save. Tiles badge cards whose _override_ differs from the list default.
- The picker offers only what the selected cards' list type carries, so in the **Selected** menu it is hidden altogether for a selection spanning several list types (their vocabularies differ) or one whose type carries no labels.
- The action bar's **Labels** button opens the **Default Labels** modal, which writes the list's front-matter `labels:` default through the [List Metadata](/admin/api/#list-metadata) route immediately (front matter is not part of the card-change pipeline, so it needs no save — and the editor adopts the returned content hash, so pending card edits still save cleanly afterward).

---

## Wanted List Editor

Open **Edit Lists** and select the **Wanted Lists** tab.

Wanted lists correspond to `.md` files in the `wanted/` directory.

### Differences from Deck Editor

- **No Set as Commander** — wanted lists have no reserved Commander section (but support arbitrary user-named [sections](#sections))
- **No condition** — wanted lists track desired cards, not owned cards
- **Printing optional** — cards can be added as name-only (cheapest printing), with a specific printing, or fully specified with a finish

---

## List description

A list's front-matter [`description:`](/commands/metadata/) — the blurb the built site prints above the cards — is shown at the top of every editor, exactly as the public site renders it (collapsed behind **Read more** past 200 characters). It is **display-only here**: write it with [`ritual metadata set <list> description …`](/commands/metadata/), the [List Metadata](/admin/api/#list-metadata) route, or the MCP `set_list_metadata` tool. Unlike the card lines, it is not part of the deferred change batch — an edit made elsewhere shows up on the editor's next load.

## Feature Comparison

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
