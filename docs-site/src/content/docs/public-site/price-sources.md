---
title: Price Stores
description: Choose which store's prices the site displays — TCGplayer, Cardmarket, or Card Kingdom retail — per currency, shareable by link.
---

The prices on the public and admin sites come from a configurable set of **stores**, declared
by the [`priceSources`](/configuration/#price-stores-pricesources) config key. Each store
quotes in exactly one currency:

| Store         | Currency | Where the price comes from                                                                          |
| ------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `tcgplayer`   | USD      | Scryfall's USD market price (TCGplayer). The default.                                               |
| `cardmarket`  | EUR      | Scryfall's EUR trend price (Cardmarket).                                                            |
| `cardkingdom` | USD      | Card Kingdom's Near Mint **retail** price, from the same feed [sell mode](/public-site/sell/) uses. |

MTGO tix stays a Scryfall-only currency with no store behind it; it is offered whenever any
prices are.

One misconfiguration worth knowing: with `priceSources: ["cardmarket"]` on a build whose
[`--currencies`](/commands/build-site/#options) excluded EUR, no offered currency
remains — the currency selector hides, and the pages keep showing the built default currency's
Scryfall prices. Enable a store for a currency the site was actually built with.

## The Prices selector

The header's currency selector works as before, but only offers currencies an enabled store
can answer for: USD needs `tcgplayer` or `cardkingdom`, EUR needs `cardmarket`. When **both**
USD stores are enabled, every list page's toolbar grows a **Prices** selector that switches
the USD view between TCGplayer and Card Kingdom retail. Switching it re-prices every card,
total, sort, and grouping on the page — and clears the price filter, exactly as a currency
switch does, since its threshold was written against the old prices.

The choice is part of the [shareable view URL](/public-site/filtering/#sharing-a-configured-view)
as `prices=cardkingdom` or `prices=tcgplayer`. Only an _explicit_ choice is written — the
untouched default stays out of the URL, and so does sell mode's courtesy Card Kingdom default
(which `sell=1` reproduces by itself on the recipient's side); an explicit TCGplayer pick inside
sell mode is written precisely so a shared link can pin "offer versus market price". The choice
survives navigation for the session.

The same selector appears inside the dialogs that show one card's printings — the card modal's
**Other Printings** grid, the trade/edit printing picker, and the add-card dialog's printing
step. It is the same one choice, not a second one: switching it in a dialog switches the page
behind it, and vice versa. Each printing there is priced under the selected store, and a
printing sold in more than one finish lists its **alternate finishes underneath** its main
price — the price you would pay for the copy as displayed, then what the foil (or etched)
costs. The grid's price sort follows the selected store too.

## The Card Kingdom view is honest

Card Kingdom retail prices ride on the same baked buylist quotes sell mode uses, so they work
on a fully static site. A printing Card Kingdom does not sell — or a non-English copy, which
their English-only catalog can never match — shows **no price** under this view; there is
deliberately no TCGplayer fallback, so a total under the Card Kingdom view is a real
"what these cards cost at CK" figure. An out-of-stock product keeps its listed price — the
price stands even when the shelf is empty.

Printing dialogs are covered by the same rule, and pay for it in advance. A build with the
`cardkingdom` store enabled bakes a Card Kingdom quote for **every printing a list carries** —
each finish of each printing in its other-printings grid, not just the printings its tiles
display — so a fully static site can price the whole grid with no backend. Where there _is_ a
live backend (`serve --api`, or the admin site), printings the build never saw — anything the
add-card dialog's search turns up — are quoted on demand instead.

In [sell mode](/public-site/sell/), the **spread** (`Buylist vs Price`) compares Card
Kingdom's offer against the _selected_ store's price. Entering sell mode defaults the view to
Card Kingdom retail when it is enabled — offer against the same store's asking price — and
switching the Prices selector to TCGplayer compares the offer against the market price
instead. An explicit choice always wins; leaving sell mode restores the default only if the
default was in force.

## Which printing a card is priced at

A card line that names no printing (`4 Lightning Bolt`, not `4 Lightning Bolt (M10:146)`) has no
printing of its own, so the build picks a **representative** one for it: among the five most
recent printings that have a price, the newest that is not priced far above their median. The
"Lowest Price" toggle swaps in a second pick — the cheapest printing of the card.

Both picks are made **per store**, with that store's own prices over that store's own catalog.
Under Card Kingdom the representative is the newest printing _CK actually sells_, and the
lowest price is the cheapest printing+finish _CK actually sells_ — a foil counts, since Card
Kingdom sells it as its own product. Switching the Prices selector therefore swaps the printing a
name-only card displays (its art and set change with the price), and a build that offers Card
Kingdom prices bakes both sets of picks so the switch needs no rebuild.

This holds on both sites. The admin editors get the same picks from the admin API's list-load
routes, computed by the same function against the same cached feed, so an editor and the published
page can never disagree about which printing a line is. One difference follows from editing itself:
the picks are made when the list loads, so a card added mid-session has no Card Kingdom pick yet and
falls back to its Scryfall one until the next load.

Two things deliberately do not move:

- **A line that names its printing** displays and prices at that printing under every store. If
  Card Kingdom does not sell it, it reads as unpriced — pinning a printing is a statement about
  the card you want, not an invitation to substitute another.
- **A card Card Kingdom stocks no printing of** keeps its Scryfall pick, so it still shows its
  art and text, with only the price reading as unavailable.

`ritual price --source cardkingdom` applies the same rule, so a deck priced on the CLI and the
same deck on the site read the same printings.

## Turning prices off entirely

An empty `priceSources` array hides every price surface on both sites: per-card prices, page
and section totals, the price sort, filter, and grouping, the card modal's price rows, the
**Update Prices** button, and the currency selector itself. Sell mode (buylist prices) and
the CLI [`price`](/commands/price/) command are deliberately unaffected.

```bash
ritual config set priceSources --remove tcgplayer   # from the default, leaves []
```

## Enabling Card Kingdom prices

```bash
ritual config set priceSources tcgplayer cardkingdom
```

Enabling `cardkingdom` makes `build-site`, `serve --api`, and `admin` want the Card Kingdom
feed exactly as [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) does: builds
refresh it under the run's `--refresh` policy, servers refresh a day-old feed at startup, the
buylist API routes open, and the first ~70 MB download still has to be deliberate (for
example `ritual sell --refresh auto`, or the admin **Refresh Cache** page). A build with no
feed ships the site without Card Kingdom prices — the view then shows every card unpriced —
and never fails over it. Sell mode itself stays a separate, independent toggle.
