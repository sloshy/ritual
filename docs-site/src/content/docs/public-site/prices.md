---
title: 'Prices'
description: Currencies, price stores, per-page price updates, and cards the site prices at zero.
---

Every card on the site carries a price, and every list a total. Prices are written into the site at build time, in up to three currencies and from up to four **stores**.

Two controls share the label **Prices**. The header's dropdown picks the **currency**. The list toolbar's selector picks the **store** behind USD prices. This page calls the first the currency selector and the second the Prices selector.

## Currencies

A site offers exactly the currencies its enabled [price stores](#price-stores) quote in: USD (TCGplayer or Card Kingdom retail), EUR (Cardmarket), and TIX (MTGO, via Cardhoarder). The default `priceSources: ["tcgplayer"]` offers USD only. TIX appears only when [`priceSources`](/configuration/#price-stores-pricesources) includes `cardhoarder`.

The `--currencies` flag on [`build-site`](/commands/build-site/) can narrow that set for one build. It never adds a currency with no enabled store behind it, and a value naming only such currencies is refused. Under `serve --api` the flag is refused outright, since the live server always offers the configured stores' currencies.

When more than one currency is offered, the site header shows the currency selector. With a single currency, or an empty `priceSources`, it is hidden.

Switching currency:

- Updates every displayed price
- Recalculates deck and section totals
- Recomputes collection prices with the card's finish-specific price in the new currency
- Re-runs the "Lowest Price" toggle for the active currency and [price store](#which-printing-a-card-is-priced-at), updating images to match
- Relabels price bracket groups with the new currency symbol

The site opens in the configured [`defaultCurrency`](/configuration/#default-currency) when that currency is offered, otherwise in the first offered currency.

A disclaimer below the header shows when prices were retrieved: "Prices accurate as of &lt;date&gt;". Prices are fetched from Scryfall at build time.

## Price stores

Prices on the public and admin sites come from the stores declared by the [`priceSources`](/configuration/#price-stores-pricesources) config key. Each store quotes in one currency:

| Store         | Currency | Where the price comes from                                                                          |
| ------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `tcgplayer`   | USD      | Scryfall's USD market price (TCGplayer). The default.                                               |
| `cardmarket`  | EUR      | Scryfall's EUR trend price (Cardmarket).                                                            |
| `cardkingdom` | USD      | Card Kingdom's Near Mint **retail** price, from the same feed [sell mode](/public-site/sell/) uses. |
| `cardhoarder` | TIX      | Scryfall's MTGO tix price (Cardhoarder).                                                            |

### The Prices selector

When **both** USD stores are enabled, every list page's toolbar gets a **Prices** selector that switches the USD view between TCGplayer and Card Kingdom retail. Switching re-prices every card, total, sort, and grouping on the page and clears the price filter, just as a currency switch does.

The choice is part of the [shareable view URL](/public-site/filtering/#sharing-a-configured-view) as `prices=cardkingdom` or `prices=tcgplayer`. Only an _explicit_ choice is written: the untouched default stays out of the URL, and so does the Card Kingdom default that sell mode applies (`sell=1` reproduces it). An explicit TCGplayer pick inside sell mode is written, so a shared link can show "offer versus market price". The choice survives navigation for the session.

The same selector appears inside the dialogs that show one card's printings: the card modal's **Other Printings** grid, the trade/edit printing picker, and the add-card dialog's printing step. It is one choice, not a second one: switching it in a dialog switches the page behind it, and vice versa. Each printing there is priced under the selected store. A printing sold in more than one finish lists its **alternate finishes underneath** its main price. The grid's price sort follows the selected store too.

### Card Kingdom prices never fall back

Card Kingdom retail prices come from the same buylist quotes sell mode writes into the site, so they work on a fully static site. A printing Card Kingdom does not sell, or a non-English copy (their catalog is English-only), shows **no price** under this view. There is no TCGplayer fallback, so a Card Kingdom total is what these cards really cost at CK. An out-of-stock product keeps its listed price.

Printing dialogs follow the same rule. A build with the `cardkingdom` store enabled stores a Card Kingdom quote for **every printing a list carries**, in each finish, not just the printings its tiles display, so a static site can price the whole other-printings grid with no backend. Where there _is_ a live backend (`serve --api`, or the admin site), printings the build never saw (anything the add-card dialog's search turns up) are quoted on demand.

In [sell mode](/public-site/sell/), the **spread** (`Buylist vs Price`) compares Card Kingdom's offer against the _selected_ store's price. Entering sell mode defaults the view to Card Kingdom retail when that store is enabled. Switching the Prices selector to TCGplayer compares the offer against the market price instead. An explicit choice always wins. Leaving sell mode restores the default only if the default was in force.

### Enabling Card Kingdom prices

```bash
ritual config set priceSources tcgplayer cardkingdom
```

Enabling `cardkingdom` makes `build-site`, `serve --api`, and `admin` want the Card Kingdom feed, exactly as [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) does:

- Builds refresh the feed under the run's `--refresh` policy.
- Servers refresh a day-old feed at startup.
- The buylist API routes open.
- The first ~70 MB download still has to be deliberate (for example `ritual sell --refresh auto`, or the admin **Refresh Cache** page).

A build with no feed ships the site without Card Kingdom prices (every card shows unpriced under that view) and never fails over it. Sell mode stays a separate toggle.

### Turning prices off entirely

An empty `priceSources` array hides every price surface on both sites: per-card prices, page and section totals, the price sort, filter, and grouping, the card modal's price rows, the **Update Prices** button, and the currency selector. Sell mode (buylist prices) and the CLI [`price`](/commands/price/) command are unaffected.

```bash
ritual config set priceSources --remove tcgplayer   # from the default, leaves []
```

## Which printing a card is priced at

A card line that names no printing (`4 Lightning Bolt`, not `4 Lightning Bolt (M10:146)`) gets a **representative** printing from the build: among the five most recent printings that have a price, the newest that is not priced far above their median. The "Lowest Price" toggle swaps in a second pick, the cheapest printing of the card.

Both picks are made **per store**, with that store's own prices over that store's own catalog. Under Card Kingdom the representative is the newest printing _CK sells_, and the lowest price is the cheapest printing+finish _CK sells_ (a foil counts, since Card Kingdom sells it as its own product). Switching the Prices selector therefore swaps the printing a name-only card displays, art and set included. A build that offers Card Kingdom prices stores both sets of picks, so the switch needs no rebuild.

The admin editors get the same picks from the admin API's list-load routes, so an editor and the published page never disagree about which printing a line is. The picks are made when the list loads, so a card added mid-session has no Card Kingdom pick yet and uses its Scryfall pick until the next load.

Two things do not move:

- **A line that names its printing** displays and prices at that printing under every store. If Card Kingdom does not sell it, it reads as unpriced. Another printing is never substituted.
- **A card Card Kingdom stocks no printing of** keeps its Scryfall pick, so it still shows its art and text, with only the price reading as unavailable.

`ritual price --source cardkingdom` applies the same rule, so a deck priced on the CLI and on the site reads the same printings.

## Update Prices (per page)

Every deck, collection, and wanted-list page has an **Update Prices** button (also shown while editing) in the button group above the filter toolbar. It does nothing until pressed. Pressing it fetches current prices for that page's cards from Scryfall in one batch and updates the displayed per-card prices and totals in place. Nothing is written to disk; the refresh lives only in the current browser tab. On a site backed by a [live API](/public-site/hosted/), the refresh instead goes through the backend's batch price endpoint, which updates its shared card cache server-side.

If a refresh only updates some cards (for example, a card Scryfall no longer returns by id), the remaining cards keep their older build-time price. When a page ends up with mixed price dates, a small expandable warning lists the cards whose prices are now older than the rest. Refreshing again so every card is covered clears it. The refreshed prices are shared with the card search in the public editor and the Trade Planner, so a card fetched once is reused without another request.

## Missing prices

When a card cannot be priced in the selected currency (a paper-only card has no TIX price, an MTGO-only card has no USD/EUR price), it is left out of price totals. A collapsible warning banner at the top of the deck page lists the cards with missing prices for the active currency, and updates when you switch currencies. [Proxies and custom-art cards](#cards-priced-at-zero) are not "missing": they are priced at zero by rule and never appear in this banner.

On the index page, deck and collection entries with missing prices show **"At least $X.XX (missing N cards)"** instead of the raw total. The "lowest price" variant is hidden when a deck has missing prices.

## Cards priced at zero

A **proxy** (a card whose effective [labels](/list-format/#card-labels) include `proxy`) is not a real card, so the build prices it at **0** in every currency. It is left out of list totals and of the missing-price counts and banner, and it is never offered to a buyer in [sell mode](/public-site/sell/). Switching currency or pressing **Update Prices** cannot give it a price; the rule is applied in the browser too.

A card wearing [custom art](/custom-art/) is treated the same way, since it is no longer the printing a price would be quoted for. Wherever a per-card price is shown (grid and list views, the card modal, the [Trade Planner](/public-site/trade/)), such a card reads **CUSTOM**, and a proxy without custom art reads **PROXY**. A card that is both reads **CUSTOM**.
