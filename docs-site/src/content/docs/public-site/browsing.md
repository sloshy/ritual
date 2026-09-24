---
title: 'Browsing Lists'
description: View modes, the card modal, quick switch, multi-select, and what each kind of list page shows.
---

Every deck, collection, and wanted list on the public site has its own page, and the home page lists them all. This page describes what those pages show and how to move around the site.

## The home page

The home page has three tabs: **Decks**, **Collections**, and **Wanted Lists**. Each tab has a toolbar for sorting and grouping its lists. Each tab remembers its own settings for the session; they reset on reload.

Sort options (default: **Alphabetical**):

- **Alphabetical**: A–Z by name, locale-aware and case-insensitive.
- **Recently updated**: newest first, by the most recent changelog entry, or the file's modification time when there is no changelog. Lists with no timestamp sort last.
- **Current price**: highest current total first, in the active currency.
- **Lowest price** _(Decks only)_: highest "lowest possible" total first. This is the sum of the cheapest available printing of each card, in the active currency.

A **Reverse** toggle next to the selects flips the order.

Only the **Decks** tab has a **Group** selector (default: **None**):

- **None**: one flat grid.
- **Format**: one section per format (Commander, Modern, Standard, …). Decks without a recognized format land in a final **Other** section. The active sort applies within each group.

Collections and wanted lists have no format, so their tabs show only the Sort selector (Alphabetical, Recently updated, Current price) and the Reverse toggle.

### Deck cover labels

On the home page and in Quick Switch, each deck cover shows the deck's format instead of a raw card count. The format comes from the deck's `format:` front matter. Without it, a `Commander` section implies Commander and an `Oathbreaker` / `Signature Spell` section implies Oathbreaker.

- Commander and Oathbreaker decks show just the format name (**Commander**).
- Other supported formats (Standard, Modern, Pioneer, Legacy, Vintage, Pauper, Historic, Brawl, Duel Commander, Pre-Modern, Limited) show the format name alone when the main-deck count matches the format's expected size: 60 for most, 100 for Commander/Duel Commander, 40 for Limited.
- When the count is unusual for the format, a smaller card count follows the name: **Modern (62 cards)**.
- Decks with no recognized format show the plain `N cards` count.

The main-deck count includes the commander/oathbreaker section and the mainboard. It excludes sideboard, maybeboard, and token sections, so a 60-card deck with a sideboard still reports 60.

Collections and wanted lists always show a plain `N cards` count.

## Quick Switch

The **Quick switch** button (centered in the header on desktop, right-aligned on mobile) opens a dialog for jumping to any deck, collection, or wanted list. **Ctrl+K** (**Cmd+K** on macOS) opens it too.

With an empty search field, the dialog lists every list on the site. As you type, results fall into four tiers, highest priority first. Matching ignores case and accents, so `teferi` finds `Téferi`:

1. **Lists**: deck, collection, and wanted-list names.
2. **Commanders**: the commander of any deck. Selecting one opens that deck.
3. **Cards**: the name of any card in any list. Selecting one opens the list containing it. A card in several lists produces one row per list, and each row names its list in the subtitle.
4. **Printings**: the `set:collector` code of any card (`mkm:42`). The code is the primary label (uppercased, `MKM:42`) with the card name beside it in muted italics. Selecting one opens the list containing that printing.

Each row shows a thumbnail (the list's featured art, or the card art), a kind tag (`Deck` / `Collection` / `Wanted` / `Commander` / `Card`), and where it leads. Commander and card matches appear once the dialog has fetched the per-list detail data, which it does the first time it opens.

Keyboard controls inside the dialog:

| Key                         | Action                      |
| --------------------------- | --------------------------- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move the highlighted result |
| <kbd>Enter</kbd>            | Open the highlighted entry  |
| <kbd>Esc</kbd>              | Close the dialog            |

Clicking a result opens it. Clicking the darkened backdrop closes the dialog, and it closes on its own after navigation.

## View Modes and Card Size

Deck and collection pages offer four view modes, switched with toolbar buttons:

- **Binder** (▦): a dense card image grid
- **List** (☰): compact text rows showing name, mana cost, and price
- **Overlap** (⧗): a horizontally scrolling fan of overlapping cards
- **Stack** (▥): vertical stacked columns of cards

In the three image views, hovering a card shows its name and price in an overlay at the bottom of the image.

Double-faced cards show a translucent **flip** button (⇄) on their left edge when hovered in the image views (not in list view). Clicking it flips the card in place with a short animation to show the back face; clicking again flips it back. The flip is visual only. It changes no grouping, sorting, or saved data.

When grouping by **type**, a double-faced card is grouped by its **front face only**. A creature with a land on the back is grouped under Creature.

A card size selector (**L / M / S**) appears in the toolbar for the image views:

| Size               | Card width |
| ------------------ | ---------- |
| L (Large, default) | 190 px     |
| M (Medium)         | 140 px     |
| S (Small)          | 100 px     |

The size applies to all three image views. Overlap and stack rows and columns resize to match.

## Card Detail Modal

Clicking any card on a deck or collection page opens the card detail modal. It shows:

- The card image, with flip support for double-faced cards
- Card name, type line, mana cost, and oracle text
- Price, set, rarity, and other metadata
- A **View on Scryfall** link
- An **Other Printings** button that opens a paginated binder-style grid (8 per page) of every known printing, each linking to Scryfall. The default order is release date, newest first. A dropdown switches the sort to release date, set name, or price, with a toggle to reverse it. Every printing is priced under the selected [price store](/public-site/prices/), with its alternate finishes listed underneath, and the grid has its own **Prices** selector, the same one the toolbar has. The price sort follows the selected store too.

A card with [custom art](/custom-art/) shows that image on its tile in every view (including the list view's hover preview) and as the modal's main picture. Only the front face is replaced. A double-faced card still flips to its real back, and the **Other Printings** grid keeps real thumbnails.

## Card Labels

Cards can carry [labels](/list-format/#card-labels): `sale`, `trade`, `keep`, and `proxy` on a collection, and `proxy` on a deck. A card's _effective_ labels are its own override, or else the list's front-matter default. The toolbar's [Labels filter](/public-site/filtering/#available-filters) filters on effective labels and offers only the chips the page's lists can answer.

Tiles show a **badge** only for a card's own override, in a themable color per label. A list-wide default is not badged on every tile. In a [combined view](/public-site/combined-view/), where there is no single list default, the badge shows the effective labels instead.

A **proxy** is not a real card, so the site prices it at zero. See [Cards priced at zero](/public-site/prices/#cards-priced-at-zero).

## Exporting a list

Every list page has **Copy** and **Download** buttons in its header. Either opens a dropdown of three formats:

- **Text (.txt)**: for a deck, the [Moxfield export dialect](/commands/export/#dialects): bare `Commander` / `Deck` / `Sideboard` board markers over `N Card Name (SET) Collector Number` lines, with Moxfield's `*F*` / `*E*` finish marker between the set and the collector number. It has no `##` headers, `-` bullets, ids, notes, conditions, or labels, so it pastes straight into Moxfield or Arena. It covers the whole decklist: the command zone, every main-deck section, and the sideboard under its own `Sideboard` marker. Maybeboard and token sections are **not** included. For collections and wanted lists, the text is one line per card in Ritual's own form: `N Card Name (SET:Collector Number)`.
- **Markdown (.md)**: the source Markdown, with `## Section` headers and full card lines (`- 2 Lightning Bolt (2XM:157) [foil] &5`, including printing, finish, condition, note, and internal id).
- **CSV (.csv)**: spreadsheet rows under a `Name,Set,Collector Number,Finish,Condition,Language,Quantity` header, for importing into other sites.

**Copy** writes the chosen format to the clipboard. **Download** saves it as a file named after the list. A small tooltip ("Copied!" / "Downloaded!") confirms the action. The export is built in the browser from the data already on the page.

## Multi-Select

On any list page you can select cards in every view mode and act on the whole selection at once.

- In binder, overlap, and stack modes, hovering a card reveals a checkbox in its top-left corner. Clicking it marks the card with a checkmark in the theme's accent color.
- In list view the checkbox sits at the far left of each row.
- **Ctrl-click** (**⌘-click** on macOS) anywhere on a card, in any view, toggles its selection without opening the card modal.

A card shown with a quantity (`4×` in a deck, or a grouped duplicate in a collection) is selected as all of its copies at once, and the count reflects the copies: selecting `4× Lightning Bolt` counts as four. If you later remove some but not all of a group's copies (from the dialog described below), its checkbox shows a **dash** to mark the partial selection.

Once anything is selected, a **Selected (N)** button appears in the toolbar, where N counts the selected copies in this list. The selection survives changes to grouping, sorting, and view mode. The button opens a menu of actions:

- **Copy as Text**: copies the selected cards as `N Card Name (SET:Collector Number)` lines, Ritual's own form. This is the same as the header **Copy → Text** on a collection or wanted list; a deck's header text export uses the Moxfield dialect instead.
- **Copy as CSV**: copies the selected cards as CSV with the same header as the page's **Copy → CSV**.
- **Add to Trade**: adds the selected cards to the active [Trade Planner](/public-site/trade/). Deck and collection cards go to the offering side, wanted-list cards to the receiving side. Cards with no pinned printing prompt for one, one at a time, just like a single-card add.
- **Clear selection**: deselects this list's cards only.

Both copy formats merge identical printings and sum their quantities.

### Selecting across lists

Selections are global and persist as you move between lists. Whenever anything is selected, an **All Selected (N)** button appears in the navbar on every page, including the home page and Trade Planner, with N the total across every list. Its menu offers the same actions over the whole cross-list selection, and **Clear all selections** wipes every list at once. This lets you gather cards from several lists and copy or trade them together.

**View all selections…** in that menu opens a dialog listing every selected card with its quantity, printing, foil/etched finish, condition, and source list. The toolbar's per-list **Selected** menu has a matching **View selected cards…** entry that opens the same dialog for the list in view. On a list page (including a [combined view](/public-site/combined-view/)), a **Show** toggle at the top switches between **This page** and **All lists**, each with its count, starting on the scope of the menu you opened it from (**This page** from **Selected**, **All lists** from **All Selected**).

In the dialog:

- Cards can be shown in selection order or grouped by source list.
- Hovering a row previews the card art.
- Each row's ✕ removes one copy (a `4×` group drops to `3×`).
- Actions are grouped by intent: **Copy** (**Copy as Text** / **Copy as CSV**, plus the buyer's cart CSV in [sell mode](/public-site/sell/)), **Edit** (in edit mode: **Move all to list…** and **Remove all selected**), and **Selection** (**Clear selection** for this page, or **Clear all selections**). Every action applies to the cards the dialog is showing.

## Change History

When a deck or collection has a `.changes.md` changelog (Ritual writes one whenever it saves changes), its edit history is included in the site.

- A **View Changes** button appears next to **Copy** and **Download** in the page header.
- It opens a dialog of paginated change entries, most recent first.
- Each page is one editing session, with its timestamp and its additions, removals, and other changes. Every save within a session is grouped into that one entry.
- Prev/Next buttons page through older and newer entries.
- Card names are links that open the card detail modal, and hovering one previews the card.

Cards named in the changelog that are no longer in the list still have their card data available for previews and the modal.

## Deck Pages

Deck pages show:

- The total deck price (commander, mainboard, and sideboard) at the top. When extras are visible, a separate "all cards" total appears in parentheses next to it.
- A **Lowest Price** toggle that swaps every card to its cheapest available printing. Cheapest means cheapest in the active currency at the active [price store](/public-site/prices/), so under Card Kingdom it is the cheapest printing CK sells. Card images and prices update to match. Only printings with a listed price are considered.
- The [card detail modal](#card-detail-modal), with its Scryfall link and Other Printings grid.
- Section and group price totals next to card counts.
- Grouping by type, section, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), or ungrouped. These groupings apply to the mainboard only.
- An **ANY** marker on every card whose line pins no printing (`1 Sol Ring` rather than `1 Sol Ring (C19:221)`): on the art just below the mana cost in the binder and stack views, and inline after the name in list view. Its color is the **Any printing** swatch in the theme editor's Labels group, which follows the theme's accent. Wanted lists and the [combined view](/public-site/combined-view/) show the same marker; collections never do, since every collection line pins a printing.
- Grouping by [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category), which nests inside every board instead: headings read `Main › Ramp`, `Sideboard › Draw`.
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10.
- Under the non-category groupings, the sideboard is always its own ungrouped section at the bottom.
- Extras (maybeboard, tokens) below the sideboard under the non-category groupings, and as nested boards (`Maybeboard › Ramp`) under the category ones. **Hide Extras** removes them either way.
- A **View Changes** button (when a changelog exists) that opens the [change history](#change-history).

## Collection Pages

Collection pages show:

- The total collection value, based on each card's specific printing and finish.
- Individual card prices, conditions, finishes, and set/collector number in the card detail modal.
- Non-English copies labelled with their [language](/list-format/#card-language) beside the finish and condition: `(Foil · JA)` on tiles in the image views, and inside the parenthesised label in list view.
- The [card detail modal](#card-detail-modal), with its Scryfall link and Other Printings grid.
- Cards displayed individually by default, with a **Group Duplicates** toggle.
- File order as the default sort, with options for name, price, set code, type, mana value, and color identity.
- Grouping by section (the default when the collection has two or more sections), type, mana value, color identity, price brackets, [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category), or ungrouped.
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10.
- A **No Price Data** group at the bottom when grouping by price, holding cards with no price for their finish.
- Copy or download as text, Markdown, or CSV (see [Exporting a list](#exporting-a-list)).
- Section and group price totals that update with the filters and price settings.

## Wanted List Pages

Wanted list entries vary in specificity, from a bare card name to a fully pinned printing and finish. Wanted list pages show:

- The total wanted list value at current prices.
- A price for each entry that is always the cheapest option for its state:
  - **Name only** entries use the cheapest printing across all sets
  - **Printing** entries use the cheapest finish of that exact printing
  - **Fully specified** entries use the exact printing and finish
- Individual card prices in the card detail modal.
- A state indicator showing whether each card is name-only, printing-specific, or fully specified.
- The same **ANY** marker [deck pages](#deck-pages) show, on name-only entries in every view.
- Grouping by section (the default when the list has two or more sections), type, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), [tags](/public-site/filtering/#grouping-sorting-and-filtering-by-tags), [category or categories](/public-site/filtering/#grouping-sorting-and-filtering-by-category), or ungrouped.
- Copy or download as text, Markdown, or CSV (see [Exporting a list](#exporting-a-list)).
- No condition display, since wanted lists track cards you want, not cards you own.
