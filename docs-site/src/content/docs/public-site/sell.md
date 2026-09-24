---
title: Sell Mode
description: Show buylist prices from Card Kingdom on the public and admin sites, filter and group by them, and export a sell cart.
---

**Sell mode** shows a buyer's current buylist offer beside each card's retail price, and adds filtering, grouping, sorting, and a cart export built around it. It is the browser-side companion to the [`sell`](/commands/sell/) command, and both quote the same cards the same way.

## Turning it on

Sell mode is **off by default** everywhere: the public site, the admin site, and the servers' sell routes. Enabling it means every build and cache refresh downloads and indexes Card Kingdom's ~70 MB pricelist, so it is opt-in:

```bash
ritual config set site.sellMode true
```

The **Offer sell mode** checkbox on the admin's [Settings](/admin/dashboard/#settings) page writes the same key, and the admin's sell surfaces and routes follow a save immediately. One exception: on a server started with `--sell-mode` the flag wins for that session, so unticking the checkbox saves the change but turns nothing off until that process restarts.

A single run can opt in without a config write, with `--sell-mode` on [`build-site`](/commands/build-site/#sell-mode---sell-mode), [`serve`](/commands/serve/), [`admin`](/commands/admin/), or [`mcp`](/commands/mcp/#sell-tools-need-sell-mode):

```bash
ritual build-site --sell-mode
```

The flag is enable-only. There is no `--no-sell-mode`; omit it to follow the config.

### No backend required

The build writes quotes **into each list's JSON** (and [`serve`](/commands/serve/#live-api-mode---api) computes them the same way for its live payloads), so a fully static site on a CDN offers sell mode exactly as a [hosted](/public-site/hosted/) one does. The site never calls the quotes API; that API exists for other clients, such as the admin editors.

A static site's quotes are as fresh as its build. Card Kingdom regenerates the pricelist daily, so rebuild to refresh them. A [live server](/public-site/hosted/) recomputes on request, so refreshing its feed (from the admin site or a CLI run) updates its lists without a rebuild.

A build that could not get a buylist still ships the site. It warns, and the pages say why no prices are shown. See [Downloading the buylist](#downloading-the-buylist).

### The admin site

The **admin site** follows the same key. With sell mode off, its editors show no sell toggle, the **Refresh buylist** card is hidden, and its `/api/sell/*` and `/api/buylist/*` routes answer `404` unless the [`cardkingdom` price store](/public-site/prices/) (which uses the same feed) is enabled. Run `ritual admin --sell-mode`, set the config key, or tick **Offer sell mode** on the admin's [Settings](/admin/dashboard/#settings) page to use it there.

The admin editors quote **live** against their own server, so a card added mid-edit is priced immediately, and a [**Refresh buylist**](/admin/dashboard/#refresh-cache) that brings down a new feed drops the quotes already held in the browser.

[`ritual sell`](/commands/sell/) on the CLI is never gated. Running it is itself the request for Card Kingdom prices.

## Downloading the buylist

Every read path uses the cache only. No page load ever triggers the ~70 MB download. The first download is always deliberate, with any of:

- the **Refresh buylist** button on the admin **Refresh Cache** page,
- `ritual sell --refresh auto` on the CLI,
- [`ritual cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) with sell mode on (it refreshes under `auto`, so a **missing** feed is downloaded with no prompt),
- the `refresh_buylist` MCP tool,
- `POST /api/sell/refresh` on the admin API,
- a [`build-site`](/commands/build-site/#sell-mode---sell-mode) run with sell mode on. Its buylist refresh follows the run's `--refresh` policy: `--refresh auto` downloads a first feed without asking, and the default `ask` prompts for it.

Until then, sell mode's controls appear but no card carries a quote, and the page shows the reason beneath its totals. For a site built without a feed, that is "buylist prices are unavailable: this list was built without buylist data".

Once a buylist exists, keeping it current is automatic wherever sell mode or the `cardkingdom` price store is enabled:

- [`sell`](/commands/sell/) redownloads a day-old feed as it runs (gated on nothing).
- [`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) refreshes it alongside the card cache.
- `build-site` refreshes it before writing quotes.
- [`admin`](/commands/admin/) and [`serve --api`](/commands/serve/#live-api-mode---api) refresh it at startup.

A served site's quotes therefore go stale only while its process runs past a day, which a restart fixes. A static site's are as old as its last build. `--refresh no-bulk` and `--refresh never` opt out of all of it.

## Using it

Turn on **Sell mode** in the list toolbar. It adds:

- **A buyer selector.** Card Kingdom is the only buyer today.
- **A buylist price on every card**, beside the retail price, in every view mode. Cards the buyer has no active offer for look exactly as they do outside sell mode. Some copies never carry a quote:
  - Non-English copies (a `[ja]`-style [language token](/list-format/#card-language)), since the feed is English-only and the English price would overstate them.
  - Cards labeled [`proxy`](/list-format/#card-labels) and cards wearing [custom art](/custom-art/). Neither is quoted, counted in the page or selection buylist totals, or written into a cart export. Both show **PROXY** / **CUSTOM** where a price would be.
- **A Buylist filter** in the filter menu: `On buylist` / `Not on buylist`. Selecting both, or neither, matches everything. "On buylist" means the buyer is _actively_ buying the printing; a paused offer counts as "not on buylist".
- **A Buylist ($) threshold** in the filter menu. It works like the Price filter but against the buyer's per-copy offer. It is always in dollars, whatever currency the page displays, so it survives a currency switch. A card with no active offer never matches it.
- **Group by Buylist Price** (the same brackets as the ordinary price grouping) and **Group by On Buylist**.
- **Sort by Buylist Price**, and by **Buylist vs Price** (see below).
- **A cart export.** See [Exporting a cart](#exporting-a-cart).

Turning sell mode off clears the buylist filters and returns a buylist grouping or sort to the page's default, so nothing keeps narrowing or reordering the list once its controls are gone.

### Sorting by Buylist vs Price

**Buylist vs Price** sorts on the buyer's offer _minus_ the card's retail price, ascending. The cards the buyer pays furthest _below_ retail for come first, and the ones paid closest to (or above) retail come last: a $40 card at a $12 offer sorts before a $2 card at a $1.90 offer. Reverse the sort to put the best offers first.

Both sides are read in dollars, so the comparison means the same thing whatever currency the page displays. The retail side is the **selected [price store](/public-site/prices/)**'s dollar price. Entering sell mode defaults the view to Card Kingdom retail when that store is enabled (offer versus what CK charges for the same card); switching the toolbar's Prices selector to TCGplayer compares the offer against the market price instead. A missing or paused offer and a missing dollar price both count as $0, so a card the buyer does not stock ranks by its full retail price, and a card with no dollar price ranks by the offer alone. Unquoted cards are not forced to either end of the list.

The price store moves the **buy** side too, for a card line that names no printing. Under Card Kingdom such a line is shown at the printing CK sells, and its offer (and the header's Buylist total) is that printing's quote, which can differ from the TCGplayer view's. Because entering sell mode defaults the store to Card Kingdom, turning sell mode on can itself change which printing a name-only card displays. Lines that name their printing never move. See [Which printing a card is priced at](/public-site/prices/#which-printing-a-card-is-priced-at).

### Currency and condition

Buylist figures are always **Card Kingdom's USD cash offer for a Near Mint copy**, whatever display currency the page uses. They are labeled `Buy $…` and sit at the card's trailing edge. Ritual does not grade down: a Lightly Played card shows the Near Mint quote, and store-credit bonuses are not modeled.

A quote is shown only when Card Kingdom is _actively_ buying. They publish token prices on paused products, and those read as "no offer".

## Page and selection totals

With sell mode on, the header's price line gains a **Buylist total**: what the buyer would pay for the cards the current view shows. It follows the filter, and wherever the header offers a cart export it prices exactly the cards that export would ship. A deck page scopes it like its **Total**: commander, mainboard, and sideboard, without maybeboard and tokens, with the commander counted whether or not the filter would hide it.

```
120 cards · Total: $840.00 · Buylist total: $214.60 (18 cards not on buylist)
```

Selecting cards adds a **Selected** total to the page header and to the **Selected Cards** dialog. This is not gated on sell mode.

With sell mode on, the selection also gets a **Sell value** (abbreviated `sell` in the dialog): what the buyer would pay for the selected cards:

```
120 cards · Total: $840.00 · Buylist total: $214.60 · Selected: $95.00 · Sell value: $31.40 (3 cards not on buylist)
```

Both buylist figures are capped at what the buyer will take, so they match `ritual sell` and what a cart upload can ship. Both note the copies that would not be bought. Copies the buyer wants but is already full on are reported separately (`2 over the buyer's limit`), and non-English copies get their own note (`2 non-English cards — not quotable`).

## Exporting a cart

With Card Kingdom selected as the buyer, two exports appear:

- **Copy Card Kingdom cart CSV** in the selection menu and the **Selected Cards** dialog: just the selected cards.
- **Card Kingdom cart (.csv)** in the page header's Copy/Download menus: every card in the current _filtered_ view.

Both produce Card Kingdom's sell-cart import format (`card name,edition,foil,quantity`, data rows only, no header row) using Card Kingdom's own listing titles, including their parenthesized variant note for variant printings, with quantities capped at their buy limits. Upload the file at [cardkingdom.com/static/csvImport](https://www.cardkingdom.com/static/csvImport).

Warnings appear when they apply: the format cannot express etched foils (they export as foil, and the affected cards are named), and Card Kingdom imports at most 500 unique titles or 5,000 cards per upload.

## Shareable links

Sell mode's state is part of the URL hash, like every other toolbar and filter value:

| Parameter                                  | Meaning                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `sell=1`                                   | Sell mode is on.                                          |
| `buyer=cardkingdom`                        | The selected buyer (only written while sell mode is on).  |
| `buylist=on,off`                           | The buylist filter chips.                                 |
| `group=buylist-price` / `group=on-buylist` | The buylist groupings.                                    |
| `sort=buylist-price`                       | Sort by buylist price (prefix with `-` to reverse).       |
| `sort=buylist-spread`                      | Sort by Buylist vs Price (prefix with `-` to reverse).    |
| `prices=cardkingdom`                       | An explicitly chosen [price store](/public-site/prices/). |

The Card Kingdom default that sell mode applies is not written to `prices=`; `sell=1` reproduces it by itself.

Opening such a link on a site that does not offer sell mode ignores these parameters. You never land on a list narrowed by a filter the toolbar cannot show or clear.

## Turning it off again

Disabling sell mode means clearing whatever turned it on:

```bash
ritual config set site.sellMode false   # or: config unset site.sellMode
```

Unticking **Offer sell mode** on the admin's [Settings](/admin/dashboard/#settings) page is the `config unset` form of this. A server started with `--sell-mode` is the exception: the flag is a session override, so that process keeps offering sell mode until it is restarted without it.

Then rebuild. The toggle disappears. Unless [`priceSources`](/configuration/#price-stores-pricesources) still names `cardkingdom`, the next build stores no Card Kingdom quotes and does no Card Kingdom work, and a server's sell and buylist endpoints answer `404` (read per request, so a running server picks the change up without a restart). A site built _earlier_ with sell mode on keeps its stored prices until it is rebuilt.

See [Site config](/configuration/#offering-sell-mode-sellmode).
