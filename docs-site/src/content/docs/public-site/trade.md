---
title: 'Trade Planner'
description: Plan a trade from the cards on the site, with printing pickers, live price updates, and shareable links.
---

The generated site includes a **Trade Planner** page accessible via the "Trade" link in the site navigation at `#/trade`. This is a fully client-side, ephemeral tool — no data is persisted between page refreshes.

The page provides a two-column layout for planning a trade:

## Left Column — My Cards

The left column is for cards you are offering. It searches cards from the collections included in this site. A "Include Decks in Search" toggle (disabled by default) extends the search to include cards from your decks as well.

- Type a card name in the search box to get autocomplete suggestions showing card name and source list
- Each result is deduplicated per source — if the same card appears in multiple collections, each collection shows up as a separate autocomplete result
- Cards show: thumbnail image, name, set code and collector number — with the language badged beside it for a non-English copy (`2XM:270 · JA`) — finish, condition, and price
- If a deck card has no specific printing pinned, selecting it opens the printing picker so you can choose one (the deck source is preserved on the resulting trade row)
- Sort by card name or price (toggle ascending/descending independently)
- A row whose card carries no price by rule — a [proxy](/public-site/browsing/#card-labels), or a card with [custom art](/custom-art/) — shows **PROXY** / **CUSTOM** where its price would be and counts as $0 in the column total and the balance between the columns
- Price total shown at the bottom of the column

**Quantity caps:** Each trade row's quantity stepper caps at the maximum number of that exact variant available in its source — for collections this is the count of identical note-less entries (same name, set, collector number, finish, condition); for decks it is the sum across mainboard/sideboard/etc. for that printing in that deck. When only one copy exists the stepper is hidden and a fixed quantity of 1 is displayed.

**Editing picker-sourced rows:** Trade rows added via the printing picker (everything on the right, deck cards without a pinned printing on the left) get a small yellow pencil button to the left of the quantity controls. Clicking it re-opens the printing picker for that card; choosing a printing replaces the row in place while preserving its quantity.

## Right Column — Their Cards

The right column is for cards the other party is offering. What it searches depends on whether the site has a [live backend](/public-site/hosted/).

**Static site — wanted list mode (default):** Search across all wanted lists on this site instance. Results show card name and source wanted list name. Cards no wanted list holds are only reachable through the "Search Scryfall instead" toggle.

**Static site — Scryfall mode:** When the toggle is on, autocomplete calls the Scryfall API directly from the browser, and only Scryfall's results are shown.

**Hosted site:** With `serve --api` behind the site, the server's card cache already covers every card, so the toggle is replaced by a note and each query searches your wanted lists **and** the cache at once. Wanted-list matches lead (with their source, printing and price), followed by cache matches labelled "Card cache". No request goes to Scryfall.

**Every right-column selection opens the printing picker.** A wanted list records the printing you'd _like_, not the one being offered, so picking a wanted card never assumes its printing: the picker opens with the printings your wanted lists ask for (across every list, for that card name) floated to the top and badged **Wanted**, and you choose what's actually on the table. The row keeps its wanted-list source and quantity cap whichever printing you take.

The picker shows all available printings, paginated 8 at a time, with a set-code / collector-number filter — the same query grammar as the CLI's [collector mode](/commands/edit/#collector-number-mode): `mkm` matches set codes as a substring, a bare `12` also matches collector numbers as a prefix, and `ds 12`, `12 ds` or `mkm:123` requires both halves — terms are searched independently, so their order never matters. Typing anywhere in the dialog feeds the filter box without focusing it (tap the box to type on a touch device); **Backspace** erases and **Esc** clears the query before a second **Esc** closes the picker. Hovering an entry shows the full card art preview. Choose a printing and finish, then click "Add to Trade" to add the card.

Non-English printings carry the same language badge as trade rows (`2XM:270 · JA`). Confirming a printing that exists **only** in a non-English language pauses on a notice — `This printing is only available in Japanese (ja) — it will be recorded as [ja].` — with a **Continue** button that accepts the language and a **Back** button that returns to the list. Shared trade URLs preserve each row's language, so the other party sees exactly the copies you encoded.

Rows added from a bare card name belong to no list of yours, so they're tagged with the backend that answered the lookup — **Cache** on a hosted site, **Scryfall** on a static one — and are encoded in the trade URL by Scryfall ID.

## Update Prices

The toolbar's **Update prices** button refetches current prices for the cards currently loaded on the trade page (only — not your full collection), and updates each row's price and finish in place. A toast confirms how many cards were updated. On a static site it batches requests through Scryfall's `/cards/collection` endpoint (75 IDs per request); on a site backed by a [live API](/public-site/hosted/) it goes through the backend's batch price endpoint instead, which updates its shared card cache server-side.

## Card Hover Previews

Hovering over a card thumbnail (in the trade list, autocomplete suggestions, or printing picker) shows an enlarged preview of the card art that follows the mouse cursor.

## Mobile Layout

On narrow screens (≤768px), the two-column layout collapses to a single-pane view. Tab buttons at the top switch between "My Cards" and "Their Cards". Each pane fills the full screen width, with its own search, sort controls, card list, and price total.
