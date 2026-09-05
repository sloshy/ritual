---
title: 'Browsing Lists'
description: View modes, the card modal, quick switch, multi-select, and what each kind of list page shows.
---

Every deck, collection, and wanted list on the public site gets its own page. This page describes what those pages show and how to move around the site.

## View Modes and Card Size

Deck and collection pages offer four view modes, toggled via buttons in the toolbar:

- **Binder** (▦) — dense card image grid
- **List** (☰) — compact text rows showing name, mana cost, and price
- **Row** (⧗) — horizontally scrolling fan of overlapping cards
- **Column** (▥) — vertical stacked columns of cards

In binder, row, and column modes, hovering a card shows its name and price in an overlay at the bottom of the card image.

Double-faced cards show a translucent **flip** button (⇄) on the left edge when hovered in these three image views (it is not shown in list view). Clicking it flips the card in place — with a short rotate animation that does not disturb the surrounding layout — to reveal the back face; clicking again flips back to the front. The flip is purely visual and does not change grouping, sorting, or any saved data.

When grouping by **type**, double-faced cards are categorized by their **front face only**: a card whose front is a creature and whose back is a land is grouped under Creature.

A card size selector (**L / M / S**) appears in the toolbar for binder, row, and column modes. The three sizes are:

| Size               | Card width |
| ------------------ | ---------- |
| L (Large, default) | 190 px     |
| M (Medium)         | 140 px     |
| S (Small)          | 100 px     |

Card size applies uniformly across all three image views. In row and column modes, the row width and column width shift automatically to match the selected card size.

## Card Detail Modal

Both deck and collection pages share a unified card detail modal. Clicking any card opens a modal showing:

- Card image with flip support for double-faced cards
- Card name, type line, mana cost, and oracle text
- Price, set info, rarity, and other metadata
- A "View on Scryfall" link to the card's Scryfall page
- An "Other Printings" button showing a paginated binder-style grid (8 per page) of all known printings, sorted by release date (newest first) by default, each linking to Scryfall. Every printing is priced under the selected [price store](/public-site/prices/), with its alternate finishes listed underneath, and the grid carries its own **Prices** selector — the same one the toolbar has. Sorting can be changed via a dropdown to release date, set name, or price (which follows the selected store too), with a toggle to reverse the sort direction.

A card carrying [custom art](/custom-art/) shows that image on its tile in every view (grid, binder, stacks, and the list view's hover preview) and as the modal's main picture. Only the front is replaced — a double-faced card flips to its real back — and the **Other Printings** grid keeps real thumbnails, since showing you actual printings is what it is for.

## Quick Switch

A **Quick switch** button (centered in the site header on desktop, right-aligned on mobile) opens a command-palette-style dialog for jumping between any deck, collection, or wanted list on the site. The same dialog also opens with the keyboard shortcut **Ctrl+K** (or **Cmd+K** on macOS).

When the search field is empty, the dialog lists every deck, collection, and wanted list. As soon as you start typing, results are grouped into four priority tiers. Matching is case- and accent-insensitive throughout, so `teferi` finds `Téferi` and vice versa:

1. **Lists** — matches against deck, collection, and wanted-list names (highest priority).
2. **Commanders** — matches against the commander of any deck. Selecting one opens the deck containing that commander.
3. **Cards** — matches against the name of any card in any list. Selecting one opens the list containing that card. The same card can produce multiple entries (one per containing list), and each row identifies the destination list in its subtitle.
4. **Printings** — matches against the `set:collector` code of any card (e.g. `mkm:42`). The set:collector code is shown as the primary label (uppercased, e.g. `MKM:42`) and the card's name appears alongside in muted italics for context. Selecting one opens the list containing that printing.

Each row shows a thumbnail (the list's featured art for list rows, the card art for commander and card rows), a kind tag (`Deck` / `Collection` / `Wanted` / `Commander` / `Card`), and the destination context. Commander and card matches require per-list detail data; the dialog pre-fetches that data the first time it opens, so card matches start appearing once the data has loaded.

Keyboard controls inside the dialog:

| Key                         | Action                      |
| --------------------------- | --------------------------- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move the highlighted result |
| <kbd>Enter</kbd>            | Open the highlighted entry  |
| <kbd>Esc</kbd>              | Close the dialog            |

Clicking a result also opens it. Clicking the darkened backdrop closes the dialog. The dialog closes automatically after navigation.

## Index Toolbar

Every tab of the home page — **Decks**, **Collections**, and **Wanted Lists** — includes a shared filter toolbar (matching the look of the deck and collection page toolbars) for re-sorting and grouping the list. Each tab keeps its own selections, and state is per-session — selections reset on reload.

Sort options (default: **Alphabetical**):

- **Alphabetical** — A–Z by name (uses locale-aware case-insensitive comparison).
- **Recently updated** — newest first, derived from the most recent changelog entry, falling back to the source file's mtime. Items with no timestamp sort last.
- **Current price** — highest current total first, in the active currency.
- **Lowest price** — highest "lowest possible" total first (the sum of the cheapest available printing of each card), in the active currency. **Decks only** — this option does not appear on the Collections or Wanted Lists tabs, where a per-card cheapest-printing total isn't meaningful.

A **Reverse** toggle next to the selects flips the resulting order.

Grouping applies only to the **Decks** tab, which adds a **Group** selector (default: **None**):

- **None** — single flat grid.
- **Format** — splits decks into one section per format (Commander, Modern, Standard, …) with the format label as the section heading. Decks without a recognized format land in a final **Other** bucket. The active sort is applied within each group.

The **Collections** and **Wanted Lists** tabs have no format dimension to group by, so the Group selector is omitted from their toolbars entirely — they show only the Sort selector (Alphabetical, Recently updated, Current price) and the Reverse toggle.

## Deck Cover Labels

On the home page deck list and in the Quick Switch dialog, each deck cover shows the deck's format rather than a raw card count. Format is read from the deck's `format:` frontmatter field, falling back to section heuristics (a `Commander` section implies Commander; an `Oathbreaker` / `Signature Spell` section implies Oathbreaker).

- Commander and Oathbreaker decks display just the format name (e.g. **Commander**).
- For other supported formats (Standard, Modern, Pioneer, Legacy, Vintage, Pauper, Historic, Brawl, Duel Commander, Pre-Modern, Limited), the format name appears alone when the main-deck card count matches the format's expected size (60 for most, 100 for Commander/Duel Commander, 40 for Limited).
- When the main-deck count is unusual for the format, a smaller parenthetical card count is shown next to the format name — e.g. **Modern (62 cards)** for a Modern deck with 62 mainboard cards.
- Decks without a recognized format (no `format:` field and no Commander/Oathbreaker section) fall back to the original `N cards` display.

The main-deck count includes the commander/oathbreaker section plus the mainboard, but excludes sideboard, maybeboard, and token sections so a 60-card format with a sideboard still reports 60.

Collections and wanted lists continue to display a plain `N cards` count, since their card count is the primary fact about them.

## Exporting a list

Every list page (deck, collection, or wanted list) carries a **Copy** and a **Download** button in its header. Clicking either opens a dropdown of three formats:

- **Text (.txt)** — for a deck, the [Moxfield export dialect](/commands/export/#dialects): bare `Commander` / `Deck` / `Sideboard` board markers over `N Card Name (SET) Collector Number` lines, with Moxfield's `*F*` / `*E*` finish marker between the set and the collector number — no `##` headers, no `-` bullets, and none of the ids, notes, conditions or labels a Ritual line carries, so it pastes straight into Moxfield or Arena. The file is the whole decklist: the command zone, every main-deck section, and the sideboard under its own `Sideboard` marker. Maybeboard and token sections are **not** included — they are deck-building extras rather than part of a decklist, and no dialect has a board for them. Collections and wanted lists render one line per card in Ritual's own quantity-prefixed form (`N Card Name (SET:Collector Number)`).
- **Markdown (.md)** — the canonical source Markdown, with `## Section` headers and full bulleted card lines (`- 2 Lightning Bolt (2XM:157) [foil] &5`: printing, finish, condition, note, and internal id).
- **CSV (.csv)** — spreadsheet rows under a `Name,Set,Collector Number,Finish,Condition,Language,Quantity` header, for importing into other sites.

**Copy** writes the chosen format to the clipboard; **Download** saves it as a file named after the list. A small tooltip ("Copied!" / "Downloaded!") confirms the action — the button labels never change. The list is serialized in the browser from the data already on the page, so no extra files are generated at build time.

## Multi-Select

Any list page (deck, collection, or wanted list) lets you select cards across every view mode and act on the whole selection at once. Hovering a card in binder, row, or column mode reveals a translucent checkbox in its top-left corner; clicking it marks the card with a checkmark in the current theme's accent color. In list view the checkbox sits at the far left of each row. You can also **Ctrl-click** (or **⌘-click** on macOS) anywhere on a card in any view to toggle its selection without opening the card modal.

A card shown with a quantity (e.g. `4×` in a deck, or a grouped duplicate in a collection) is selected as all of its copies at once, and the count reflects the individual copies (selecting `4× Lightning Bolt` counts as four). When you later remove some — but not all — of a group's copies (from the dialog below), its checkbox shows a **dash** instead of a checkmark to indicate the partial selection.

Once at least one card is selected, a **Selected (N)** button appears in the toolbar (N is the running count of selected copies for the list you're viewing). The selection survives changes to grouping, sorting, and view mode. Opening the button reveals a menu of bulk actions over that list's selection:

- **Copy as Text** — copies a quantity-prefixed list (`N Card Name (SET:Collector Number)`) to the clipboard, scoped to the selected cards. This is Ritual's own printing form — the same as the header **Copy → Text** on a collection or wanted list; a deck's header text export is the Moxfield decklist dialect instead
- **Copy as CSV** — copies the same selection as CSV with a `Name,Set,Collector Number,Finish,Condition,Language,Quantity` header, matching the header **Copy → CSV** output but scoped to the selected cards
- **Add to Trade** — adds the selected cards to the active [Trade Planner](/public-site/trade/) (deck and collection cards go to the offering side, wanted-list cards to the receiving side). Name-only cards (no pinned printing) prompt for a printing one at a time, exactly like the single-card add
- **Clear selection** — deselects the current list's cards only

Identical printings are merged and their quantities summed in both copy formats.

### Selecting across lists

Selections are held globally, so they persist as you navigate between lists. Whenever anything is selected, an **All Selected (N)** button is shown in the top navbar (N is the total across every list) — on every page, including the index and Trade Planner, not just list pages. Its menu offers the same actions but over the entire cross-list selection, and its **Clear all selections** entry wipes every list at once. This makes it easy to gather cards from several decks, collections, and wanted lists and then copy or trade them together.

The menu's **View all selections…** entry opens a dialog listing every selected card — with its quantity, printing, foil/etched finish, and condition — alongside the list it came from. The cards can be shown in selection order or grouped by source, hovering a row previews the card art, and each row's ✕ removes a single copy (so a `4×` group drops to `3×`). The dialog repeats the **Copy as Text** / **Copy as CSV** and **Clear all selections** actions.

## Card Labels

Cards carry [labels](/commands/edit/#card-labels) — `sale`, `trade`, `keep`, `proxy` on a collection, `proxy` on a deck — and the site filters on each card's _effective_ labels (its own override, else the list's front-matter default) through the toolbar's [Labels filter](/public-site/filtering/#available-filters), which offers only the chips the page's lists can answer. Tiles **badge** the entry's own override, in a themable color per label; a list-wide default is not badged on every tile (in a [combined view](/public-site/combined-view/), where there is no one ambient default, the badge shows the effective labels instead).

A **proxy** is not a real card, so the build prices it at **0** in every currency: it is left out of the list totals, left out of the missing-price counts and banner, and never offered to a buyer in [sell mode](/commands/build-site/#sell-mode---sell-mode). Switching currency or pressing **Update Prices** cannot resurrect a price for it — the rule is applied client-side too.

A card wearing [custom art](/custom-art/) is treated exactly the same way, for the same reason: it is no longer the printing a price would be quoted for. Wherever a per-card price is shown — the grid and list views, the card modal, the [Trade Planner](/public-site/trade/) — such a card reads **CUSTOM**, and a proxy without custom art reads **PROXY**, in place of the amount. A card that is both reads **CUSTOM**: custom art wins.

## Change History

When a deck or collection has a `.changes.md` changelog file (created by the admin editor when saving changes), its edit history is included in the generated site.

- A **View Changes** button appears next to the **Copy** and **Download** buttons in the page header
- Clicking it opens a modal dialog showing paginated change entries, sorted most recent first
- Each page shows one editing session with its timestamp and a list of additions, removals, and other changes (every save within a single session is grouped into that one entry)
- Prev/Next buttons allow paging through older and newer changes
- Card names in the change list are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

Cards referenced in changelogs that are no longer in the deck or collection are automatically resolved during the build so their card data is available for previews and modals.

## Deck Features

Deck pages include a "Lowest Price" toggle that swaps all cards to their cheapest available printing — cheapest in the active currency and at the active [price store](/public-site/prices/), so under Card Kingdom it is the cheapest printing CK actually sells. When enabled, card images and prices update to reflect the lowest-priced version. Only printings with a listed price are considered.

Deck pages include:

- Total deck price (mainboard + sideboard) displayed at the top, updating when the "Lowest Price" toggle is enabled
- When extras are visible, a separate parenthetical "all cards" total is shown next to the main price
- "Lowest Price" toggle that swaps all cards to their cheapest available printing (images and prices update)
- Card detail modal with Scryfall link, other printings (paginated, sortable by release date, set name, or price, and priced under the selected [price store](/public-site/prices/)), and full card details
- Section/group price totals shown next to card counts
- Grouping by type, section, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), or ungrouped — applies to the mainboard only
- Grouping by [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category) instead nests inside every board: headings read `Main › Ramp`, `Sideboard › Draw`
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- Under the non-category groupings, the sideboard is always displayed in its own section at the bottom, ungrouped
- Extras (maybeboard, tokens) displayed below the sideboard under the non-category groupings, and as their own nested boards (`Maybeboard › Ramp`) under the category ones; the "Hide Extras" checkbox removes them either way
- Only printings with a listed price are considered for price analysis
- **View Changes** button (when a changelog exists) opens a paginated modal showing the edit history

## Collections

Collections are included in the build by default — every list allowed by `site.includeCollections`, or exactly the ones named by `--collections`. Collection files come from the `collections/` directory. Each collection card must have a set code and collector number (e.g., `- Sol Ring (C19:221)`). Cards without this information are skipped with a warning.

Collection pages show:

- Total collection value based on specific printing and finish prices
- Individual card prices, conditions, finishes, and set/collector number in the card detail modal
- Non-English copies labelled with their [language](/commands/edit/#card-language) beside the finish and condition — `(Foil · JA)` on card tiles in the art views, and as part of the parenthesised list-view label
- A "View on Scryfall" link in the card detail modal that opens the card's Scryfall page
- An "Other Printings" button that shows a paginated binder-style grid (8 per page) of all known printings of the card, sorted by release date (newest first) by default, each linking to Scryfall, priced under the selected [price store](/public-site/prices/) with alternate finishes underneath. Sorting can be changed via a dropdown to release date, set name, or price, with a toggle to reverse the sort direction.
- Cards displayed individually by default (not grouped), with a "Group Duplicates" toggle
- File order as the default sort, with options for name, price, set code, type, mana value, and color identity
- Grouping by section (the default when the collection has two or more sections), type, mana value, color identity, price brackets, [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category), or ungrouped
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- A "No Price Data" group that appears at the bottom when grouping by price, collecting cards without price data for their finish
- Download as original Markdown or CSV for importing into other sites
- Section/group price totals that update dynamically

## Wanted Lists

Wanted lists are included in the build by default — every list allowed by `site.includeWantedLists`, or exactly the ones named by `--wanted-lists`. Wanted list files come from the `wanted/` directory. Unlike collections, wanted list entries can have varying levels of specificity — from just a card name to a fully pinned printing and finish.

Wanted list pages show:

- Total wanted list value based on current card prices
- Prices always reflect the cheapest option for each entry's state:
  - **Name only** entries use the cheapest printing across all sets
  - **Printing** entries use the cheapest finish of that exact printing
  - **Fully specified** entries use the exact printing and finish specified
- Individual card prices in the card detail modal
- State indicator showing whether each card is name-only, printing-specific, or fully specified
- Grouping by section (the default when the wanted list has two or more sections), type, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category), or ungrouped
- Download as original Markdown
- No condition display (wanted lists track desired cards, not owned cards)
