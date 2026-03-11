---
sidebar_position: 12
---

# build-site

Generate a website for your decks and collections.

## Usage

```bash
./ritual build-site [options]
```

## Options

By default, deck card images use Scryfall URLs from card data. This can be overridden with the `--cache-images` option to download and use local images instead.

| Option                      | Description                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`             | Show list of cards being fetched from Scryfall                                                                       |
| `--cache-images`            | Download and use local deck card images in `dist/images` instead of URLs                                             |
| `--decks [names...]`        | Deck names or URLs to include in the site (default: all in `decks/`)                                                 |
| `--collections [names...]`  | Collection names to include in the site (default: all in `collections/`)                                             |
| `--collection-sort <field>` | Default sort order for collection pages (`file-order`, `name`, `price`, `set-code`, `type`, `cmc`, `color-identity`) |
| `--deck-sort <field>`       | Default sort order for deck pages (`name`, `cmc`, `price`, `type`, `edhrec`, `color-identity`)                       |
| `--currencies <list>`       | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three; first listed is default) |
| `-y, --yes`                 | Skip confirmation prompts and auto-accept (e.g. bulk cache redownload)                                               |

## Examples

Build site for all decks and collections:

```bash
./ritual build-site
```

Build site for specific decks:

```bash
./ritual build-site --decks "Atraxa Superfriends" "Mono Red Aggro"
```

Build with verbose output:

```bash
./ritual build-site --verbose
```

Build with downloaded local deck card images:

```bash
./ritual build-site --cache-images
```

Build directly from a URL:

```bash
./ritual build-site --decks https://archidekt.com/decks/12345
```

Build with specific collections:

```bash
./ritual build-site --collections "Red Binder" "ECL"
```

Build with custom collection sort order:

```bash
./ritual build-site --collections --collection-sort price
```

Build with EUR as the default price currency:

```bash
./ritual build-site --currencies eur
```

Build with only USD and EUR (no TIX):

```bash
./ritual build-site --currencies "usd,eur"
```

## Output

Generates a single-page application in the `dist/` directory containing:

- `index.html` — SPA shell that loads the Preact application
- `app.js` — Bundled SPA with client-side routing
- `index.json` — Deck and collection listing used by the index page
- `decks/{slug}.json` — Full deck data loaded on demand
- `decks/{slug}.txt` — Exportable deck lists
- `collections/{slug}.json` — Full collection data with pricing loaded on demand
- `collections/{slug}.md` — Original collection Markdown file for download
- `collections/{slug}.csv` — Collection exported as CSV for importing into other sites
- `styles.css` — Compiled Tailwind CSS
- Responsive design for desktop and mobile
- Dark mode support
- Client-side hash routing (`#/` for index, `#/deck/{slug}` for deck pages, `#/collection/{slug}` for collection pages)
- Navigation bar with "Decks" and "Collections" links always visible
- Page transition animations

## View Modes and Card Size

Deck and collection pages offer four view modes, toggled via buttons in the toolbar:

- **Binder** (▦) — dense card image grid
- **List** (☰) — compact text rows showing name, mana cost, and price
- **Row** (⧗) — horizontally scrolling fan of overlapping cards
- **Column** (▥) — vertical stacked columns of cards

In binder, row, and column modes, hovering a card shows its name and price in an overlay at the bottom of the card image.

A card size selector (**L / M / S**) appears in the toolbar for binder, row, and column modes. The three sizes are:

| Size               | Card width |
| ------------------ | ---------- |
| L (Large, default) | 190 px     |
| M (Medium)         | 140 px     |
| S (Small)          | 100 px     |

Card size applies uniformly across all three image views. In row and column modes, the row width and column width shift automatically to match the selected card size.

## Deck Features

Deck pages include a "Lowest Price" toggle that swaps all cards to their cheapest available printing. When enabled, card images and prices update to reflect the lowest-priced version. Only printings with a listed price are considered.

## Price Currency Switching

The generated site includes a **Prices** dropdown in the header for switching between USD (TCGPlayer), EUR (Cardmarket), and TIX (MTGO) at runtime. The dropdown only shows currencies selected by the `--currencies` flag. When switching currencies:

- All displayed prices update to the selected currency
- Deck totals and section totals recalculate
- Collection prices recompute using the card's finish-specific price in the new currency
- The "Lowest Price" toggle finds the cheapest printing per the active currency — images update accordingly
- Price bracket grouping labels adapt to the active currency symbol

The `--currencies` flag controls which currencies are available on the site. The first currency listed becomes the default shown on load. Users can switch between available currencies at any time using the dropdown.

## Price Disclaimer

The generated site displays a disclaimer below the header showing the date prices were retrieved. Prices are fetched from Scryfall at build time and reflect values as of the build date. The disclaimer reads: "Prices accurate as of &lt;date&gt;".

## Bulk Cache Redownload Prompt

Before fetching card data, `build-site` checks how many cards have prices older than 24 hours. If more than 100 cards need refreshing, it will prompt:

```
287 of 320 card(s) have prices older than 24 hours.
Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.
Redownload the latest Scryfall card cache now? [y/N]
```

Accepting redownloads the full Scryfall bulk card dataset, which includes current prices for all cards, and updates timestamps so the subsequent build uses the fresh data without making additional per-card price requests. This is equivalent to running `./ritual cache preload-all` manually.

If stdin is not a TTY (e.g. a CI pipeline), the prompt defaults to **No** and per-card price refreshing proceeds as normal.

Use `--yes` to skip the prompt and always accept the redownload when the threshold is exceeded:

```bash
./ritual build-site --yes
```

## Card Detail Modal

Both deck and collection pages share a unified card detail modal. Clicking any card opens a modal showing:

- Card image with flip support for double-faced cards
- Card name, type line, mana cost, and oracle text
- Price, set info, rarity, and other metadata
- A "View on Scryfall" link to the card's Scryfall page
- An "Other Printings" button showing a paginated binder-style grid (8 per page) of all known printings, sorted by release date (newest first) by default, each linking to Scryfall with prices. Sorting can be changed via a dropdown to release date, set name, or price, with a toggle to reverse the sort direction.

## Missing Card Warnings

When a card cannot be priced in a selected currency (e.g., a paper-only card has no TIX price, or an MTGO-only card has no USD/EUR price), it is omitted from price totals. A collapsible warning banner appears at the top of the deck page listing cards with missing prices for the active currency. The banner updates reactively when switching currencies.

On the index page, deck and collection entries with missing prices display the total as **"At least $X.XX (missing N cards)"** instead of the raw total, making it clear the price is incomplete. The "lowest price" variant is hidden when a deck has missing prices to avoid confusion.

## Collections

When `--collections` is specified, collection files from the `collections/` directory are included in the generated site. Each collection card must have a set code and collector number (e.g., `- Sol Ring (C19:221)`). Cards without this information are skipped with a warning.

Collection pages show:

- Total collection value based on specific printing and finish prices
- Individual card prices, conditions, finishes, and set/collector number in the card detail modal
- A "View on Scryfall" link in the card detail modal that opens the card's Scryfall page
- An "Other Printings" button that shows a paginated binder-style grid (8 per page) of all known printings of the card, sorted by release date (newest first) by default, each linking to Scryfall. Sorting can be changed via a dropdown to release date, set name, or price, with a toggle to reverse the sort direction.
- Cards displayed individually by default (not grouped), with a "Group Duplicates" toggle
- File order as the default sort, with options for name, price, set code, type, mana value, and color identity
- Grouping by type, mana value, color identity, price brackets, or ungrouped
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- A "No Price Data" group that appears at the bottom when grouping by price, collecting cards without price data for their finish
- Download as original Markdown or CSV for importing into other sites
- Section/group price totals that update dynamically

## Deck Features

Deck pages include:

- Total deck price (mainboard + sideboard) displayed at the top, updating when the "Lowest Price" toggle is enabled
- When extras are visible, a separate parenthetical "all cards" total is shown next to the main price
- "Lowest Price" toggle that swaps all cards to their cheapest available printing (images and prices update)
- Card detail modal with Scryfall link, other printings (paginated, sortable by release date, set name, or price), and full card details
- Section/group price totals shown next to card counts
- Grouping by type, section, mana value, color identity, price brackets, or ungrouped — applies to mainboard only
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- Sideboard always displayed in its own section at the bottom, ungrouped
- Extras (maybeboard, tokens) displayed below sideboard, toggled via "Hide Extras" checkbox
- Only printings with a listed price are considered for price analysis
- **View Changes** button (when a changelog exists) opens a paginated modal showing the edit history

## Change History

When a deck or collection has a `.changes.md` changelog file (created by the admin editor when saving changes), its edit history is included in the generated site.

- A **View Changes** button appears next to the download buttons in the page header
- Clicking it opens a modal dialog showing paginated change entries, sorted most recent first
- Each page shows one editing session with its timestamp and a list of additions, removals, and other changes
- Prev/Next buttons allow paging through older and newer changes
- Card names in the change list are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

Cards referenced in changelogs that are no longer in the deck or collection are automatically resolved during the build so their card data is available for previews and modals.

## Serving the Site

After building, use the [`serve`](./serve) command to preview locally:

```bash
./ritual serve
```
