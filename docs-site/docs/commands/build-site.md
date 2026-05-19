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

| Option                      | Description                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `-v, --verbose`             | Show list of cards being fetched from Scryfall                                                                           |
| `--cache-images`            | Download and use local deck card images in `dist/images` instead of URLs                                                 |
| `--decks [names...]`        | Deck names or URLs to include in the site (default: all in `decks/`)                                                     |
| `--collections [names...]`  | Collection names to include in the site (default: all in `collections/`)                                                 |
| `--wanted-lists [names...]` | Wanted list names to include in the site (default: all in `wanted/`)                                                     |
| `--collection-sort <field>` | Default sort order for collection pages (`file-order`, `name`, `price`, `set-code`, `type`, `cmc`, `color-identity`)     |
| `--deck-sort <field>`       | Default sort order for deck pages (`name`, `cmc`, `price`, `type`, `edhrec`, `color-identity`)                           |
| `--currencies <list>`       | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three; first listed is default)     |
| `-y, --yes`                 | Skip confirmation prompts and auto-accept (e.g. bulk cache redownload)                                                   |
| `--theme <name>`            | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`. |
| `--theme-file <path...>`    | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.             |

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

Build with specific wanted lists:

```bash
./ritual build-site --wanted-lists "High Priority" "Trade Targets"
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

## Themes

The generated site ships with multiple themes selectable at runtime, or setting a default theme at build time. The `--theme` flag controls which theme is the **initial** one served (i.e. what users see on first visit before they pick something). Ten Magic-flavored "guild" palettes are available alongside the default, each with a primary background color and a contrasting highlight color used for buttons, focus rings, and accents:

| Theme      | Background     | Highlight |
| ---------- | -------------- | --------- |
| `default`  | dark cool blue | blue      |
| `orzhov`   | dark gray      | white     |
| `izzet`    | dark blue      | red       |
| `gruul`    | dark green     | red       |
| `rakdos`   | dark gray      | red       |
| `selesnya` | off-white      | green     |
| `azorius`  | off-white      | blue      |
| `boros`    | off-white      | red       |
| `dimir`    | dark gray      | blue      |
| `simic`    | dark blue      | green     |
| `golgari`  | dark gray      | green     |

Each theme also has an inverted variant accessible by appending `-inverted` to its name (e.g. `azorius-inverted`, `boros-inverted`). Inverted themes swap the background and highlight colors so the highlight becomes the dominant background and the original background becomes the accent — shade and intensity are adjusted so the resulting palette stays comfortable to read.

```bash
./ritual build-site --theme izzet
./ritual build-site --theme boros-inverted
```

### Custom themes

The header's **Theme** button opens a picker popover listing every built-in palette with a preview swatch. Clicking a palette switches the base theme; if the visitor has in-progress customizations, the picker first asks for confirmation before discarding them. Only the chosen theme name (and any explicit overrides) is stored in `localStorage` — when a future build ships updated built-in palettes, visitors who haven't customized see those updates automatically.

For per-variable tweaks, the picker has a **Customize theme…** entry that opens the in-browser **theme editor**. The editor exposes every CSS variable as a labeled control (OKLch sliders for colors, number inputs for sizes), lets the user start from any built-in palette, and live-previews changes across all pages. The user's edits persist in `localStorage` so subsequent visits restore their custom palette.

A **Download JSON** button in the editor exports the full set of variables as a `.json` file. To bake one of those palettes back into a build, pass it to `--theme-file`:

```bash
./ritual build-site --theme-file ./my-palette.json
./ritual build-site --theme-file ./palette-a.json --theme-file ./palette-b.json
./ritual build-site --theme-file ./my-palette.json --theme my-palette
```

Each `--theme-file` adds a custom theme alongside the built-ins under the `name` field declared in the JSON. Combining `--theme-file` with `--theme <custom-name>` makes that custom theme the initial default for new visitors. The JSON shape is:

```json
{
  "name": "my-palette",
  "description": "Optional human-readable description",
  "variables": {
    "--bg-body": "oklch(20% 0.02 260)",
    "--accent": "oklch(60% 0.15 320)"
  }
}
```

Theme names must be lowercase letters, digits, and hyphens, and may not collide with any built-in theme name.

## Output

Generates a single-page application in the `dist/` directory containing:

- `index.html` — SPA shell that loads the application
- `app.js` — Bundled SPA with client-side routing
- `index.json` — Deck and collection listing used by the index page
- `decks/{slug}.json` — Full deck data loaded on demand
- `decks/{slug}.txt` — Exportable deck lists
- `collections/{slug}.json` — Full collection data with pricing loaded on demand
- `collections/{slug}.md` — Original collection Markdown file for download
- `collections/{slug}.csv` — Collection exported as CSV for importing into other sites
- `wanted/{slug}.json` — Full wanted list data with pricing loaded on demand
- `wanted/{slug}.md` — Original wanted list Markdown file for download
- `styles.css` — Bundled CSS
- Responsive design for desktop and mobile
- Dark mode support
- Client-side hash routing (`#/` for index, `#/deck/{slug}` for deck pages, `#/collection/{slug}` for collection pages, `#/wanted/{slug}` for wanted list pages)
- Navigation bar with "Decks", "Collections", and "Wanted Lists" links always visible
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

## Deck Cover Labels

On the home page deck list and in the Quick Switch dialog, each deck cover shows the deck's format rather than a raw card count. Format is read from the deck's `format:` frontmatter field, falling back to section heuristics (a `Commander` section implies Commander; an `Oathbreaker` / `Signature Spell` section implies Oathbreaker).

- Commander and Oathbreaker decks display just the format name (e.g. **Commander**).
- For other supported formats (Standard, Modern, Pioneer, Legacy, Vintage, Pauper, Historic, Brawl, Duel Commander, Pre-Modern, Limited), the format name appears alone when the main-deck card count matches the format's expected size (60 for most, 100 for Commander/Duel Commander, 40 for Limited).
- When the main-deck count is unusual for the format, a smaller parenthetical card count is shown next to the format name — e.g. **Modern (62 cards)** for a Modern deck with 62 mainboard cards.
- Decks without a recognized format (no `format:` field and no Commander/Oathbreaker section) fall back to the original `N cards` display.

The main-deck count includes the commander/oathbreaker section plus the mainboard, but excludes sideboard, maybeboard, and token sections so a 60-card format with a sideboard still reports 60.

Collections and wanted lists continue to display a plain `N cards` count, since their card count is the primary fact about them.

## Deck Index Toolbar

The decks tab of the home page includes a filter toolbar (matching the look of the deck and collection page toolbars) for re-sorting and grouping the deck list. State is per-session — selections reset on reload.

Sort options (default: **Alphabetical**):

- **Alphabetical** — A–Z by deck name (uses locale-aware case-insensitive comparison).
- **Recently updated** — newest first, derived from the most recent changelog entry, falling back to the deck file's mtime. Decks with no timestamp sort last.
- **Current price** — highest current total first, in the active currency.
- **Lowest price** — highest "lowest possible" total first (the value shown when the deck page's "Lowest Price" toggle is on), in the active currency.

A **Reverse** toggle next to the selects flips the resulting order.

Group options (default: **None**):

- **None** — single flat grid.
- **Format** — splits decks into one section per format (Commander, Modern, Standard, …) with the format label as the section heading. Decks without a recognized format land in a final **Other** bucket. The active sort is applied within each group.

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

## Quick Switch

A **Quick switch** button (centered in the site header on desktop, right-aligned on mobile) opens a command-palette-style dialog for jumping between any deck, collection, or wanted list on the site. The same dialog also opens with the keyboard shortcut **Ctrl+K** (or **Cmd+K** on macOS).

When the search field is empty, the dialog lists every deck, collection, and wanted list. As soon as you start typing, results are grouped into four priority tiers:

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

## Wanted Lists

When `--wanted-lists` is specified, wanted list files from the `wanted/` directory are included in the generated site. Unlike collections, wanted list entries can have varying levels of specificity — from just a card name to a fully pinned printing and finish.

Wanted list pages show:

- Total wanted list value based on current card prices
- Prices always reflect the cheapest option for each entry's state:
  - **Name only** entries use the cheapest printing across all sets
  - **Printing** entries use the cheapest finish of that exact printing
  - **Fully specified** entries use the exact printing and finish specified
- Individual card prices in the card detail modal
- State indicator showing whether each card is name-only, printing-specific, or fully specified
- Download as original Markdown
- No condition display (wanted lists track desired cards, not owned cards)

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

To build and serve in a single step, use [`serve-site`](./serve-site):

```bash
./ritual serve-site
```

## Trade Planner

The generated site includes a **Trade Planner** page accessible via the "Trade" link in the site navigation at `#/trade`. This is a fully client-side, ephemeral tool — no data is persisted between page refreshes.

The page provides a two-column layout for planning a trade:

### Left Column — My Cards

The left column is for cards you are offering. It searches cards from the collections included in this site. A "Include Decks in Search" toggle (disabled by default) extends the search to include cards from your decks as well.

- Type a card name in the search box to get autocomplete suggestions showing card name and source list
- Each result is deduplicated per source — if the same card appears in multiple collections, each collection shows up as a separate autocomplete result
- Cards show: thumbnail image, name, set code and collector number, finish, condition, and price
- If a deck card has no specific printing pinned, selecting it opens the printing picker so you can choose one (the deck source is preserved on the resulting trade row)
- Sort by card name or price (toggle ascending/descending independently)
- Price total shown at the bottom of the column

**Quantity caps:** Each trade row's quantity stepper caps at the maximum number of that exact variant available in its source — for collections this is the count of identical note-less entries (same name, set, collector number, finish, condition); for decks it is the sum across mainboard/sideboard/etc. for that printing in that deck. When only one copy exists the stepper is hidden and a fixed quantity of 1 is displayed.

**Editing picker-sourced rows:** Trade rows added via the printing picker (Scryfall searches on the right, deck cards without a pinned printing on the left) get a small yellow pencil button to the left of the quantity controls. Clicking it re-opens the printing picker for that card; choosing a printing replaces the row in place while preserving its quantity.

### Right Column — Their Cards

The right column is for cards the other party is offering. By default it searches your site's wanted lists. A "Search Scryfall" toggle switches to a direct Scryfall search.

**Wanted list mode (default):** Search across all wanted lists on this site instance. Results show card name and source wanted list name.

**Scryfall mode:** When enabled, autocomplete calls the Scryfall API directly from the browser. Selecting a card name opens a **printing picker** that shows all available printings, paginated 8 at a time. The picker has a set-code filter input (e.g. typing `mkm` or `lea` narrows the results) and hovering an entry shows the full card art preview. Choose a printing and finish, then click "Add to Trade" to add the card.

### Update Prices

The toolbar's **Update prices** button refetches current prices from Scryfall for the cards currently loaded on the trade page (only — not your full collection). It batches requests through Scryfall's `/cards/collection` endpoint (75 IDs per request) and updates each row's price and finish in place. A toast confirms how many cards were updated.

### Card Hover Previews

Hovering over a card thumbnail (in the trade list, autocomplete suggestions, or printing picker) shows an enlarged preview of the card art that follows the mouse cursor.

### Mobile Layout

On narrow screens (≤768px), the two-column layout collapses to a single-pane view. Tab buttons at the top switch between "My Cards" and "Their Cards". Each pane fills the full screen width, with its own search, sort controls, card list, and price total.
