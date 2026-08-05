---
title: Sell Mode
description: Show buylist prices from Card Kingdom on the public and admin sites, filter and group by them, and export a sell cart.
---

**Sell mode** puts a buyer's current buylist offer beside each card's retail price, and adds
filtering, grouping, sorting, and a cart export built around it. It answers "what would I get
for these cards today" without leaving the list you are looking at.

It is the browser-side companion to the [`sell`](/commands/sell/) command, and both quote the
same cards the same way — the site and the CLI share one matcher.

## Requirements

Sell mode needs a **live backend**, because buylist quotes are never baked into the built site:
Card Kingdom regenerates their pricelist daily, so a frozen copy in `dist/` would be stale about
half the time you looked at it. The toggle therefore appears only when:

1. the site is served by [`ritual serve --api`](/public-site/hosted/) (or a static build pointed
   at one via `site.apiBaseUrl`), **and**
2. `site.sellMode` is not set to `false` (see [Disabling it](#disabling-it-on-a-public-site)).

A fully static site never shows sell mode, whatever the config says.

Quotes additionally need a downloaded buylist — see
[Downloading the buylist](#downloading-the-buylist). Without one the controls still appear, and
the page says why no prices are shown.

The **admin site** always offers sell mode — `site.sellMode` governs what a _published_ site
discloses, not what your own tools can see.

## Downloading the buylist

Every read path is strictly cache-backed: no page load ever triggers the ~70 MB download. The
first one is always deliberate, with any of:

- the **Refresh buylist** button on the admin **Refresh Cache** page,
- `ritual sell --refresh auto` on the CLI,
- the `refresh_buylist` MCP tool,
- `POST /api/sell/refresh` on the admin API.

Until then, sell mode's controls appear but no card carries a quote, and the page shows the
reason beneath its totals.

Once a buylist exists, keeping it current is automatic: [`sell`](/commands/sell/) redownloads a
day-old feed as it runs, and [`admin`](/commands/admin/) and
[`serve --api`](/commands/serve/#live-api-mode---api) each do the same at startup — so quotes go
stale only while a server keeps running past a day, which a restart fixes. `--refresh no-bulk` and
`--refresh never` opt out of all of it.

## Using it

Turn on **Sell mode** in the list toolbar. It adds:

- **A buyer selector.** Card Kingdom is the only buyer today; the control is there so a second one
  is a choice rather than a surprise.
- **A buylist price on every card**, beside the retail price, in every view mode. Cards the buyer
  has no active offer for render exactly as they do outside sell mode.
- **A Buylist filter** in the filter menu: `On buylist` / `Not on buylist`. The two chips combine
  (selecting both, or neither, matches everything).
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

**Buylist vs Price** sorts on the buyer's offer _minus_ the card's retail price, so the cards
where they pay closest to — or above — what the card is worth come first. That is usually the
question worth asking: a $40 card at a $12 offer is a worse deal than a $2 card at a $1.90 offer,
even though the first pays more.

Both sides are read in dollars, so the comparison means the same thing whatever currency the page
is displaying. Cards with no computable spread — no active offer, or no dollar retail price to
compare against — sort last. Reversing the layer flips the whole order, so those cards come first
and the offers furthest below retail follow, exactly as reversing a price sort moves unpriced
cards to the front.

### Currency and condition

Buylist figures are always **Card Kingdom's USD cash offer for a Near Mint copy**, whatever
display currency the page is set to, so they are labeled `Buy $…` rather than rendered in the
page's currency, and sit against the card's trailing edge. Ritual does not grade down: a Lightly Played card shows the Near Mint quote, and
store-credit bonuses are not modeled.

A quote is shown only when Card Kingdom is _actively_ buying — they publish token prices on
products they have paused, and those read as "no offer".

## Selection totals

Selecting cards adds a **Selected** total to the page header and to the "All Selected" dialog.
This is not gated on sell mode: knowing what a handful of picked cards is worth is useful whether
or not you are selling them.

With sell mode on, a fourth figure appears — **Sell value** (abbreviated to `sell` in the
dialog): what the buyer would pay for the selection. It is capped at what they will actually take, so it matches `ritual sell` and what a
cart upload can ship. When some copies would not be bought, a note says so:

```
120 cards · Total: $840.00 · Selected: $95.00 · Sell value: $31.40 (3 cards not on buylist)
```

Copies the buyer _does_ want but is already full on are reported separately
(`2 over the buyer's limit`), since that is a different problem from not being wanted at all.

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

| Parameter                                  | Meaning                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `sell=1`                                   | Sell mode is on.                                         |
| `buyer=cardkingdom`                        | The selected buyer (only written while sell mode is on). |
| `buylist=on,off`                           | The buylist filter chips.                                |
| `group=buylist-price` / `group=on-buylist` | The buylist groupings.                                   |
| `sort=buylist-price`                       | Sort by buylist price (prefix with `-` to reverse).      |

Opening such a link on a site that does not offer sell mode simply ignores these parameters — you
never land on a list narrowed by a filter the toolbar cannot show or clear.

## Disabling it on a public site

Set `site.sellMode` to `false` to remove the feature from a published site entirely:

```bash
ritual config set site.sellMode false
```

The toggle disappears and the quote endpoints answer `404`, so a disabled deployment does not
even advertise the capability. It defaults to enabled; see
[Site config](/configuration/#site-config-site-key).
