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
[`--currencies`](/commands/build-site/#currency-selection) excluded EUR, no offered currency
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

## The Card Kingdom view is honest

Card Kingdom retail prices ride on the same baked buylist quotes sell mode uses, so they work
on a fully static site. A printing Card Kingdom does not sell — or a non-English copy, which
their English-only catalog can never match — shows **no price** under this view; there is
deliberately no TCGplayer fallback, so a total under the Card Kingdom view is a real
"what these cards cost at CK" figure. An out-of-stock product keeps its listed price — the
price stands even when the shelf is empty.

In [sell mode](/public-site/sell/), the **spread** (`Buylist vs Price`) compares Card
Kingdom's offer against the _selected_ store's price. Entering sell mode defaults the view to
Card Kingdom retail when it is enabled — offer against the same store's asking price — and
switching the Prices selector to TCGplayer compares the offer against the market price
instead. An explicit choice always wins; leaving sell mode restores the default only if the
default was in force.

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
