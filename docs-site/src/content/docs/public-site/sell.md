---
title: Sell Mode
description: Show buylist prices from Card Kingdom on the public and admin sites, filter and group by them, and export a sell cart.
---

**Sell mode** puts a buyer's current buylist offer beside each card's retail price, and adds
filtering, grouping, sorting, and a cart export built around it. It answers "what would I get
for these cards today" without leaving the list you are looking at.

It is the browser-side companion to the [`sell`](/commands/sell/) command, and both quote the
same cards the same way — the site and the CLI share one matcher.

## Turning it on

Sell mode is **off by default**, on every surface — the public site, the admin site, and the
servers' sell routes. Enabling it means every build and cache refresh downloads and indexes Card
Kingdom's ~70 MB pricelist, so it is opt-in:

```bash
ritual config set site.sellMode true
```

The admin's [Settings](/commands/admin/#settings) page has the same switch — an **Offer sell mode**
checkbox writing the same key — and both the admin's own sell surfaces and its sell routes follow a
save immediately, with no reload or restart. One exception: on a server started with `--sell-mode`
the flag wins for that session, so unticking the checkbox stores the change without turning
anything off until that process restarts.

A single run can opt in without a config write, with `--sell-mode` on
[`build-site`](/commands/build-site/#sell-mode---sell-mode),
[`serve`](/commands/serve/), [`admin`](/commands/admin/), or
[`mcp`](/commands/mcp/#sell-tools-need-sell-mode):

```bash
ritual build-site --sell-mode
```

The flag is enable-only — there is no `--no-sell-mode`; omit it to follow the config.

### No backend required

Quotes are **baked into each list's JSON** by the build (and computed the same way by
[`serve`](/commands/serve/#live-api-mode---api) for its live payloads), so a fully static site on a
CDN offers sell mode exactly as a [hosted](/public-site/hosted/) one does. The site never calls the
quotes API; that API still exists for other clients, such as the admin editors.

Because the prices are baked, they are as fresh as the build that produced them. Card Kingdom
regenerates the pricelist daily, so a static site's offers age with the site: rebuild to refresh
them. A [live server](/public-site/hosted/) instead re-bakes on request, so refreshing its feed
(from the admin site or a CLI run) updates its lists without a rebuild.

A build that could not get a buylist still ships the site — it warns, and the pages say why no
prices are shown. See [Downloading the buylist](#downloading-the-buylist).

### The admin site

The **admin site** follows the same key: with sell mode off its editors show no sell toggle and the
**Refresh buylist** card is hidden; its `/api/sell/*` and `/api/buylist/*` routes answer `404`
unless the [`cardkingdom` price store](/public-site/price-sources/) — which rides on the same
feed — is enabled.
Run `ritual admin --sell-mode`, set the config key, or tick **Offer sell mode** on the admin's
[Settings](/commands/admin/#settings) page to use it there — the checkbox takes effect as soon as it
is saved, without a reload. Unlike the public site, the admin editors quote **live** against their
own server, so a card added mid-edit is priced immediately, and a
[**Refresh buylist**](/commands/admin/#refresh-cache) that brings down a new feed drops the quotes
already resolved in the browser so the next editor prices against the new one.

[`ritual sell`](/commands/sell/) on the CLI is never gated: running it is itself the request for
Card Kingdom prices.

## Downloading the buylist

Every read path is strictly cache-backed: no page load ever triggers the ~70 MB download. The
first one is always deliberate, with any of:

- the **Refresh buylist** button on the admin **Refresh Cache** page,
- `ritual sell --refresh auto` on the CLI,
- [`ritual cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) with sell
  mode on — it refreshes under `auto`, so a **missing** feed is downloaded with no prompt at all,
- the `refresh_buylist` MCP tool,
- `POST /api/sell/refresh` on the admin API.

A [`build-site`](/commands/build-site/#sell-mode---sell-mode) run with sell mode on counts too: its
buylist refresh follows the run's `--refresh` policy, so `--refresh auto` downloads a first feed
without asking and the default `ask` prompts for it.

Until then, sell mode's controls appear but no card carries a quote, and the page shows the reason
beneath its totals — for a site built without a feed, "buylist prices are unavailable: this list was
built without buylist data".

Once a buylist exists, keeping it current is automatic wherever sell mode is enabled:
[`sell`](/commands/sell/) redownloads a day-old feed as it runs (gated on nothing),
[`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) refreshes it
alongside the card cache, `build-site` refreshes it before baking, and [`admin`](/commands/admin/)
and [`serve --api`](/commands/serve/#live-api-mode---api) each do the same at startup — so a served
site's quotes go stale only while its process keeps running past a day, which a restart fixes, and a
static site's are as old as its last build. `--refresh no-bulk` and `--refresh never` opt out of all
of it.

## Using it

Turn on **Sell mode** in the list toolbar. It adds:

- **A buyer selector.** Card Kingdom is the only buyer today; the control is there so a second one
  is a choice rather than a surprise.
- **A buylist price on every card**, beside the retail price, in every view mode. Cards the buyer
  has no active offer for render exactly as they do outside sell mode. Non-English copies (a
  `[ja]`-style [language token](/commands/edit/#card-language)) never carry a quote — the feed is
  English-only, and quoting the English price for a foreign copy would overstate it. Neither do
  copies that carry no price by rule — a card labeled [`proxy`](/commands/edit/#card-labels) is not
  a real copy, and one wearing [custom art](/custom-art/) is not the printing a buyer is quoting —
  so neither is ever quoted, counted in the page or selection buylist totals, or written into a
  cart export. Both show **PROXY** / **CUSTOM** where a price would be.
- **A Buylist filter** in the filter menu: `On buylist` / `Not on buylist`. The two chips combine
  (selecting both, or neither, matches everything). "On buylist" means the buyer is _actively_
  buying the printing — a paused offer counts as "not on buylist", matching what the card shows.
- **A Buylist ($) threshold** in the filter menu, working like the Price filter but against the
  buyer's per-copy offer. It is always in dollars whatever currency the page displays, so unlike
  the Price filter it survives a currency switch. A card with no active offer never matches it,
  just as an unpriced card never matches a price filter.
- **Group by Buylist Price** (the same brackets as the ordinary price grouping) and
  **Group by On Buylist**.
- **Sort by Buylist Price**, and by **Buylist vs Price** — see below.
- **A cart export** — see [Exporting a cart](#exporting-a-cart).

Turning sell mode off clears the buylist filters and returns a buylist grouping or sort to the
page's default, so nothing keeps narrowing or reordering the list once its controls are gone.

### Sorting by Buylist vs Price

**Buylist vs Price** sorts on the buyer's offer _minus_ the card's retail price, ascending — so
the cards they pay furthest _below_ retail for come first, and the ones they pay closest to, or
above, what the card is worth come last. That gap is usually the question worth asking: a $40 card
at a $12 offer is a worse deal than a $2 card at a $1.90 offer, even though the first pays more.
Reversing the layer puts the best offers first.

Both sides are read in dollars, so the comparison means the same thing whatever currency the page
is displaying. The retail side is the **selected [price store](/public-site/price-sources/)**'s
dollar price: entering sell mode defaults the view to Card Kingdom retail when that store is
enabled (offer versus what CK charges for the same card), and switching the toolbar's Prices
selector to TCGplayer compares the offer against the market price instead. A missing or paused
offer and a missing dollar retail price both count as $0: a
card the buyer does not stock ranks by the full retail price you would be giving up, and a card
with no dollar price ranks by the offer alone. Nothing is pinned to either end of the list, so an
unquoted cheap card sits among the offers that land near retail rather than clustering with the
other unquoted cards.

### Currency and condition

Buylist figures are always **Card Kingdom's USD cash offer for a Near Mint copy**, whatever
display currency the page is set to, so they are labeled `Buy $…` rather than rendered in the
page's currency, and sit against the card's trailing edge. Ritual does not grade down: a Lightly Played card shows the Near Mint quote, and
store-credit bonuses are not modeled.

A quote is shown only when Card Kingdom is _actively_ buying — they publish token prices on
products they have paused, and those read as "no offer".

## Page and selection totals

With sell mode on, the header's price line gains a **Buylist total**: what the buyer would pay for
the cards the current view is showing. It follows the filter — narrow the list to a set, a color or
the on-buylist chip and the figure narrows with it — so wherever the header offers a cart export,
the figure prices exactly the cards that export would ship. A deck page scopes it the same way its **Total** is scoped: the
deck proper (commander, mainboard, sideboard), with the maybeboard and tokens left out, and the
commander counted whether or not the filter would hide it.

```
120 cards · Total: $840.00 · Buylist total: $214.60 (18 cards not on buylist)
```

Selecting cards adds a **Selected** total to the page header and to the "All Selected" dialog.
This is not gated on sell mode: knowing what a handful of picked cards is worth is useful whether
or not you are selling them.

With sell mode on, the selection gets its own buylist figure too — **Sell value** (abbreviated to
`sell` in the dialog): what the buyer would pay for the selected cards:

```
120 cards · Total: $840.00 · Buylist total: $214.60 · Selected: $95.00 · Sell value: $31.40 (3 cards not on buylist)
```

Both buylist figures are capped at what the buyer will actually take, so they match `ritual sell`
and what a cart upload can ship, and both note the copies that would not be bought. Copies the
buyer _does_ want but is already full on are reported separately (`2 over the buyer's limit`),
since that is a different problem from not being wanted at all, and non-English copies get a note
of their own (`2 non-English cards — not quotable`), since the buyer's feed is English-only.

## Exporting a cart

With Card Kingdom selected as the buyer, two exports appear:

- **Copy Card Kingdom cart CSV** in the selection menu and the "All Selected" dialog — just the
  selected cards.
- **Card Kingdom cart (.csv)** in the page header's Copy/Download menus — every card in the
  current _filtered_ view.

Both produce Card Kingdom's sell-cart import format (`card name,edition,foil,quantity`, data rows
only — their importer expects no header row) using Card Kingdom's own listing titles, including
their parenthesized variant note for variant printings, with quantities capped at their buy
limits. Upload the file at
[cardkingdom.com/static/csvImport](https://www.cardkingdom.com/static/csvImport).

Warnings are shown when they apply: the format cannot express etched foils (they export as foil,
and the affected cards are named), and Card Kingdom imports at most 500 unique titles or 5,000
cards per upload.

## Shareable links

Sell mode's state rides in the URL hash like every other toolbar and filter value:

| Parameter                                  | Meaning                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sell=1`                                   | Sell mode is on.                                                                                                                                             |
| `buyer=cardkingdom`                        | The selected buyer (only written while sell mode is on).                                                                                                     |
| `buylist=on,off`                           | The buylist filter chips.                                                                                                                                    |
| `group=buylist-price` / `group=on-buylist` | The buylist groupings.                                                                                                                                       |
| `sort=buylist-price`                       | Sort by buylist price (prefix with `-` to reverse).                                                                                                          |
| `sort=buylist-spread`                      | Sort by Buylist vs Price (prefix with `-` to reverse).                                                                                                       |
| `prices=cardkingdom`                       | An explicitly chosen [price store](/public-site/price-sources/); the courtesy default sell mode applies is reproduced by `sell=1` itself and is not written. |

Opening such a link on a site that does not offer sell mode simply ignores these parameters — you
never land on a list narrowed by a filter the toolbar cannot show or clear.

## Turning it off again

Sell mode is off unless something turned it on, so "disabling" it means clearing what did:

```bash
ritual config set site.sellMode false   # or: config unset site.sellMode
```

Unticking **Offer sell mode** on the admin's [Settings](/commands/admin/#settings) page is the
`config unset` form of this. A server started with `--sell-mode` is the exception: the flag is a
session override, so that process keeps offering sell mode until it is restarted without it.

Then rebuild. The toggle disappears, and — unless [`priceSources`](/configuration/#price-stores-pricesources)
still names `cardkingdom` — the next build bakes no Card Kingdom quotes and does no Card Kingdom
work at all, and a server's sell and buylist endpoints answer `404` — read per request, so a running
server picks the change up without a restart. A site built _earlier_ with sell mode on keeps the
prices baked into its JSON until it is rebuilt.

See [Site config](/configuration/#offering-sell-mode-sellmode).
