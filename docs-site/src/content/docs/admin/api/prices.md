---
title: 'Admin API: Prices and Selling'
description: Admin API routes for list prices, the sell report and cart, and Card Kingdom buylist quotes.
sidebar:
  label: 'Prices and selling'
  order: 4
---

Routes for list prices and for [sell mode](/public-site/sell/): the sell report, the sell cart, refreshing the buylist, and buylist quotes. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## Price Summary

```
GET /api/price/summary
```

Price every deck, collection, and wanted list from the local card cache and return per-list, per-type, and grand totals plus any list-parser warnings — the same payload as [`price --summary --output json`](/commands/price/). Prices are read strictly from the cache: an empty cache returns `503` without downloading anything (run [`ritual cache preload-all`](/commands/cache/) first), and a card the cache does not hold is reported as unpriced rather than fetched from Scryfall. `lastRefreshedAt` is the cache's last bulk-refresh time in Unix milliseconds, or `null` when unknown.

**Query Parameters:**

| Parameter | Description                                                                                                                                                                                                                                  | Required |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `type`    | Only price `deck`, `collection`, or `wanted` lists                                                                                                                                                                                           | No       |
| `source`  | The store, which sets the currency: `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), `cardhoarder` (Scryfall MTGO tix), or `cardkingdom` (Card Kingdom NM retail from the cached feed). Default: the configured `defaultPriceSource` | No       |

An unknown `type` or `source` returns `400`. There is no currency parameter: each store has one (`tcgplayer`/`cardkingdom` → `usd`, `cardmarket` → `eur`, `cardhoarder` → `tix`), and every response names both its `source` and its `currency`.

When the store resolves to `cardkingdom` (`source=cardkingdom`, or the configured default), the route reads the cached [buylist feed](/commands/sell/). With a feed cached, printings Card Kingdom does not sell are reported unpriced. With no feed downloaded it returns `503` with the refresh advice rather than falling back to Scryfall. The parameter is **not** gated on the [`priceSources`](/configuration/#price-stores-pricesources) config key; it needs only a cached feed.

`mode` discriminates the two price bodies: `"summary"` here, `"list"` on [Price List](#price-list).

`unpricedCount` counts copies whose price the data could not supply, and **only** those. `estimatedCount` counts deck and wanted-list copies whose price is an estimate: the line pins no printing (priced at a representative one) or has no price. Any at all makes `total` an estimate, which the CLI and sites render with a `~` prefix (`~$12.34`). Collections never estimate. Cards that carry no price [by rule](/custom-art/#custom-art-carries-no-price) — a `proxy` label, custom art, or both — are priced at `0` and counted in `cardCount`, but are left out of `unpricedCount`: they are not a gap in the price data.

**Response:**

```json
{
  "success": true,
  "mode": "summary",
  "source": "tcgplayer",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "lists": [
    {
      "type": "deck",
      "name": "my-deck",
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2,
      "estimatedCount": 12
    }
  ],
  "typeTotals": [
    {
      "type": "deck",
      "listCount": 1,
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2,
      "estimatedCount": 12
    }
  ],
  "totals": {
    "listCount": 1,
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2,
    "estimatedCount": 12
  },
  "warnings": []
}
```

## Price List

```
GET /api/price/:type/:slug
```

Price a single list and return its summary plus every priced card entry in file order — the same payload as the CLI's single-list `price <name> --output json`. `:type` is `deck`, `collection`, or `wanted`; `:slug` is the list's file basename, as on the load routes. Takes the same `source` query parameter as [Price Summary](#price-summary), with the same `503` when the card cache is empty (or when `source=cardkingdom` finds no cached feed). An unknown slug returns `404`.

**Response:**

```json
{
  "success": true,
  "mode": "list",
  "source": "tcgplayer",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "list": {
    "type": "deck",
    "name": "my-deck",
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2,
    "estimatedCount": 12
  },
  "cards": [
    {
      "listType": "deck",
      "listName": "my-deck",
      "section": "Main",
      "name": "Sol Ring",
      "quantity": 1,
      "set": "c21",
      "collectorNumber": "263",
      "pinned": true,
      "price": 2.5,
      "lowest": 1.1,
      "lowestSet": "cma",
      "lowestCollectorNumber": "215",
      "lowestFinish": "nonfoil",
      "cmc": 1,
      "edhrecRank": 1,
      "typeLine": "Artifact",
      "fileOrder": 0
    }
  ],
  "warnings": []
}
```

An entry that could not be priced also carries **`unpricedReason`**, absent on every priced card:

- Data gaps, which `unpricedCount` counts: `no-printings`, `printing-not-found`, `currency-unavailable`, `finish-unpriced-in-currency`, `no-price-data`.
- By-rule reasons, which it does not count (see [Price Summary](#price-summary)): `proxy` and `custom-art`. `custom-art` wins when a card is both.

By-rule entries still carry their printing and their `set`/`collectorNumber`: a proxy is a proxy _of_ a card, and custom art replaced the picture, not the card.

## Sell Report

:::note[The five sell routes are gated on the buyer feed being wanted]
`GET /api/sell/report`, `GET /api/sell/cart`, `POST /api/sell/refresh`, `GET /api/buylist/status`, and `POST /api/buylist/quotes` answer **`404`** unless something wants the buyer feed: [sell mode](/public-site/sell/) — [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) (off by default) or a server started with [`ritual admin --sell-mode`](/commands/admin/#sell-mode) — **or** the `cardkingdom` entry of [`priceSources`](/configuration/#price-stores-pricesources), whose retail prices come from the same feed.

The check reads the config per request, so a `config set` or a [`PUT /api/config`](/admin/api/site/#update-config) (the Settings page's **Offer sell mode** and **Price Stores** checkboxes) takes effect on the next request without a restart. [`GET /api/status`](/admin/api/auth/#server-status) reports the effective value so a client can hide its sell surfaces. The public site server (`serve --api`) gates its two buylist routes the same way.

A server running under `--sell-mode` opens these routes without anything on disk saying so; [`GET /api/config`](/admin/api/site/#get-config) reports it as `overrides: {"site.sellMode": true}` beside the stored `config`.

The refusal body is the standard [error envelope](/admin/api/#error-responses), `{"success": false, "message": "Not found", "messageKey": "admin.api.server.notFound"}`: the same body the admin server answers for a path it has no route for. The same gate applies to the MCP tools that reuse these handlers (`get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, `refresh_buylist`) — see [`mcp`](/commands/mcp/#sell-tools-need-sell-mode).
:::

```
GET /api/sell/report
```

Match listed cards against the locally cached [Card Kingdom buylist](/commands/sell/) and report what CK is buying, the cash quote per Near Mint copy, and their quantity caps — the same payload as [`sell --output json`](/commands/sell/). Strictly cache-backed: the card cache **and** a downloaded feed are prerequisites (`503` otherwise, each naming its remedy). This route never downloads anything; that is [Sell Refresh](#sell-refresh)'s job.

Copies that are [priceless by rule](/custom-art/#custom-art-carries-no-price) — labeled `proxy`, wearing custom art, or both — are dropped **before** matching, so they are never quoted and never counted as cards the buyer declined. They are dropped rather than merged, so an otherwise-identical real copy in the same list keeps its own quote and quantity.

### Parameters

| Parameter  | Description                                                                                                   | Required |
| ---------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `type`     | Match every `deck`, `collection`, or `wanted` list (default: every collection)                                | No       |
| `lists`    | Comma-separated `type:slug` refs to match exactly these lists (overrides `type`); unknown → 404               | No       |
| `tags`     | Comma-separated card tags (exact); scopes matching to lines carrying one, before CK's buy caps are shared out | No       |
| `sets`     | Comma-separated set codes to filter to                                                                        | No       |
| `min`      | Minimum per-copy offer (USD)                                                                                  | No       |
| `minOwned` | Minimum total owned copies (`ownedCopies.collection + ownedCopies.deck`, a whole number)                      | No       |
| `minRatio` | Minimum offer-to-market ratio (`offerRatio`, e.g. `0.8`); entries with no market price drop                   | No       |

A blank parameter (`?min=`) reads as absent. A malformed one is a `400` carrying the parser's message: a tag that breaks the [tag shape rule](/list-format/#card-tags), a `min`/`minRatio` that is not a plain non-negative decimal (`1.5`, not `1e1` or `-1`), or a `minOwned` that is not a whole number (`Invalid minOwned '2.5' (expected a whole number)`, key `errors.number.notWholeNumber`). A numeric refusal names the parameter as it is spelled in the query string.

**Response:**

```json
{
  "success": true,
  "feedCreatedAt": "2026-08-04 06:06:09",
  "feedRetrievedAt": 1785850800000,
  "filters": { "sets": ["fdn"], "minPrice": 0.5 },
  "lists": [
    {
      "type": "collection",
      "name": "Red Binder",
      "cardCount": 45,
      "sellableCount": 12,
      "totalValue": 123.45,
      "notBuyingCount": 30,
      "noMatchCount": 3
    }
  ],
  "entries": [
    {
      "listType": "collection",
      "listName": "Red Binder",
      "section": "Main",
      "name": "Arahbo, the First Fang",
      "quantity": 1,
      "set": "fdn",
      "collectorNumber": "294",
      "finish": "nonfoil",
      "condition": "NM",
      "pinned": true,
      "cardIds": [14],
      "edhrecRank": 812,
      "ownedCopies": { "collection": 3, "deck": 1 },
      "status": "buying",
      "matchVia": "scryfall-id",
      "ckProductId": 316734,
      "ckSku": "FDN-0294",
      "ckName": "Arahbo, the First Fang",
      "ckEdition": "Foundations Variants",
      "ckVariation": "0294 - Borderless",
      "ckUrl": "https://www.cardkingdom.com/mtg/foundations-variants/arahbo-the-first-fang",
      "ckFinish": "nonfoil",
      "priceBuy": 1.5,
      "priceRetail": 3.49,
      "qtyBuying": 25,
      "tcgplayerPrice": 2.1,
      "offerRatio": 0.714,
      "sellableQuantity": 1,
      "value": 1.5,
      "fileOrder": 1
    }
  ],
  "totals": {
    "listCount": 1,
    "cardCount": 45,
    "sellableCount": 12,
    "totalValue": 123.45,
    "notBuyingCount": 30,
    "noMatchCount": 3
  },
  "warnings": []
}
```

Entry fields:

- `status` is `buying`, `not-buying` (the product exists but CK's buy quantity is 0), or `no-match` (with `noMatchReason`: `no-printings`, `printing-not-found`, or `not-on-buylist`).
- `matchVia` names the join key that located the product (`scryfall-id`, `sku`, or `name`). `ambiguous` is set when several products matched; the quote is the best-paying one.
- An entry with `pinned: false` (an unpinned deck/wanted line) is quoted at the best-paying printing, whose set/collector/`ckFinish` it reports.
- `sellableQuantity` draws from a per-product budget of CK's `qtyBuying`, so entries sharing a product never sum past the cap. `value` prices only those copies.
- `cardIds` are the `&N` ids of the list lines aggregated into the entry, in file order (one per line; lines with no id yet contribute none). `tags` are those lines' tags; identically tagged lines aggregate together. `edhrecRank` is the card's EDHREC rank from the card cache, absent when unranked or uncached. `language` is the lines' language token (absent for English); a non-English entry is never quoted. `ownedCopies` counts the card's copies by name, across every printing, in all collections and all decks regardless of the report's scope (proxies and deck extras sections excluded).
- `tcgplayerPrice` is the quoted printing's TCGplayer market price (USD, from the card cache's Scryfall prices) at the quoted finish, and `offerRatio` is `priceBuy ÷ tcgplayerPrice` to three places. Both are absent when the cache has no price for that printing or the product is not tied to a cached printing.

## Sell Cart

```
GET /api/sell/cart
```

The entries CK is buying, rendered in their [sell-cart CSV import format](/commands/sell/#sell-cart-csv-export): `card name, edition, foil, quantity`, no header row, CK's own listing titles with variant note, quantities capped at their buy limits. Takes the same `?type=`/`?lists=`/`?tags=`/`?sets=`/`?min=`/`?minRatio=`/`?minOwned=` parameters and `503` prerequisites as [Sell Report](#sell-report). Backs the CLI's `sell --output csv`.

**Response:**

```json
{
  "success": true,
  "csv": "\"Arahbo, the First Fang (0294 - Borderless)\",Foundations Variants,false,3\n...",
  "titleCount": 12,
  "cardCount": 31,
  "warnings": []
}
```

`warnings` flags CK's upload caps (500 unique titles / 5,000 cards) and etched foils the format cannot express (exported as foil). Each is a [message](/admin/api/#the-message-triple): English `message` plus `messageKey` (`domain.buylist.cart.etchedAsFoil`, `domain.buylist.cart.tooManyTitles`, `domain.buylist.cart.tooManyCards`) and `messageParams`. The etched warning's `titles` is a `unit` list of CK's own titles; the cap warnings' `count` and `max` are numbers.

```json
{
  "message": "The CK CSV format cannot mark etched foils; exported as foil — adjust in the sell cart: Sol Ring",
  "messageKey": "domain.buylist.cart.etchedAsFoil",
  "messageParams": { "titles": { "list": ["Sol Ring"], "join": "unit" } }
}
```

## Sell Refresh

```
POST /api/sell/refresh
```

Download Card Kingdom's pricelist feed (~70 MB) when the cached copy is missing or stale (older than a day); `?force=true` redownloads regardless. The one sell route that reaches the network.

**Response:**

```json
{
  "success": true,
  "refreshed": true,
  "feedRetrievedAt": 1785850800000,
  "feedCreatedAt": "2026-08-04 06:06:09",
  "productCount": 149978,
  "skippedRows": [
    {
      "message": "Skipped Card Kingdom product data[3]: missing card name",
      "messageKey": "domain.cache.cardKingdom.feed.productSkipped",
      "messageParams": {
        "index": 3,
        "reason": { "messageKey": "domain.cache.cardKingdom.product.noName" }
      }
    }
  ]
}
```

`skippedRows` lists the downloaded feed's product rows that were malformed and left out, one [message triple](/admin/api/#the-message-triple) each (English whatever the server's UI language): the first ten are itemized (`domain.cache.cardKingdom.feed.productSkipped`, whose `index` is the row's position in the feed and whose `reason` nests a `domain.cache.cardKingdom.product.*` phrase), then one `domain.cache.cardKingdom.feed.moreSkipped` message counts the rest. It is empty when nothing was downloaded or every row parsed.

A failed download returns `502` only when no feed is cached at all. With a stale cache the call answers `200` with the stale feed's stamps, `refreshed: false`, and the failure as `staleFallback`. So `refreshed: false` without `staleFallback` means the cache was still fresh; with it, you are still on the stale feed.

The failure is a message triple, English whatever the server's UI language, both as the `502` body and as `staleFallback`:

```json
{
  "message": "Card Kingdom feed download failed: HTTP 503",
  "messageKey": "domain.cache.cardKingdom.downloadHttpFailed",
  "messageParams": { "status": 503 }
}
```

Its key is one of `domain.cache.cardKingdom.downloadFailed` (the request never got an answer; `error` is the underlying error), `downloadHttpFailed` (`status` is the HTTP status), `notJson` (`error` is the parser's message), or a `domain.cache.cardKingdom.feed.*` refusal of a feed that does not have the expected shape.

Every buylist route that needs a downloaded feed (the sell report and cart, [Buylist Status](#buylist-status), [Buylist Quotes](#buylist-quotes), and the [price report](#price-summary) under `?source=cardkingdom`) answers `503` without one, keyed `domain.cache.cardKingdom.missingApiAdvice`. Its `lead` param nests the `domain.cache.cardKingdom.noFeed` sentence, and `tool`, `route` and `command` are the identifiers it names: `refresh_buylist`, `POST /api/sell/refresh` and `ritual sell --refresh auto`.

## Buylist Quotes

```
POST /api/buylist/quotes
```

The buyer's current offer for specific printings, keyed by `set:collectorNumber:finish` (set lowercased). Use it to price an arbitrary set of cards without building a whole [Sell Report](#sell-report). Strictly cache-backed: `503` with the remedy when no feed has been downloaded.

**Request:**

```json
{
  "buyer": "cardkingdom",
  "printings": [{ "set": "dsk", "collectorNumber": "136", "finish": "nonfoil", "scryfallId": "…" }]
}
```

- `buyer` defaults to `cardkingdom` (the only buyer today).
- `scryfallId` is optional but is the primary join key when present. `set`/`collectorNumber` always form the response key and drive the sku fallback for the ~0.5% of Card Kingdom products with no Scryfall id.
- `language` (optional) is the entry's [language code](/configuration/#default-language); absent means English. The buyer feeds are English-only, so a non-`en` printing is never matched: its key is absent from `quotes`, never quoted at the English product's price.
- At most 500 printings per request.
- `buyer`, each `finish` and each `language` are matched case-insensitively (like the CLI's `--finish`), and `set` and `collectorNumber` are trimmed. The response's quote keys always use the canonical lowercase finish, so a request that sends `"finish": "FOIL"` finds its quote under `…:foil`.

A malformed body is refused with `400` in English plus its key: the [request-field family](/admin/api/#error-responses) (`admin.api.field.*`) with the offending entry's indexed path as `field` (`printings[3].set`), `errors.enum.*` for a `buyer` or `finish` outside its choices, and `domain.card.language.invalidField` for an unknown `language`.

**Response:**

```json
{
  "success": true,
  "buyer": "cardkingdom",
  "quotes": {
    "dsk:136:nonfoil": {
      "priceBuy": 2.5,
      "qtyBuying": 8,
      "priceRetail": 5.99,
      "qtyRetail": 12,
      "buying": true,
      "finish": "nonfoil",
      "matchVia": "scryfall-id",
      "productId": 281234,
      "name": "Overlord of the Balemurk",
      "edition": "Duskmourn: House of Horror",
      "variation": "298 - Borderless",
      "url": "https://www.cardkingdom.com/mtg/..."
    }
  },
  "feedCreatedAt": "2026-08-04 06:06:09",
  "feedRetrievedAt": 1785850800000,
  "stale": false,
  "productCount": 149978
}
```

- `quotes` is **sparse**: a requested printing the buyer has no product for is absent.
- `buying` is false when Card Kingdom publishes a price but has paused buying (`qtyBuying: 0`). Treat it as no offer. A present quote is not by itself an offer, since much of CK's catalog is paused at any time, so always check `buying`. Both cases read as "not on the buylist", which is the rule the sites' **On buylist** chip and grouping use.
- `variation` is CK's variant note for the matched product, present only when they publish one. A client rendering a [cart CSV](#sell-cart) row builds CK's listed title as `name (variation)`.
- `priceRetail`/`qtyRetail` are the buyer's own NM retail price and stock, which the sites' [Card Kingdom price view](/public-site/prices/) displays. A `qtyRetail` of `0` means out of stock with the listed price standing; a `priceRetail` of `0` means no published retail price.

The public site server (`ritual serve --api`) also mounts this route, unauthenticated, and answers `404` there too unless [sell mode](/public-site/sell/) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. The public site itself does not call it (sell mode reads buy prices built into each list's data); the admin editors are the one client that quotes live, as cards are added. The public server has no refresh route, so an unauthenticated caller can never trigger the ~70 MB download.

## Buylist Status

```
GET /api/buylist/status
```

Which buyers this server can quote against and how fresh the cached feed is, without quoting anything. Backs the admin **Refresh Cache** page's buylist card.

**Response:**

```json
{
  "success": true,
  "buyer": "cardkingdom",
  "buyers": ["cardkingdom"],
  "feedCreatedAt": "2026-08-04 06:06:09",
  "feedRetrievedAt": 1785850800000,
  "stale": false,
  "productCount": 149978
}
```

`503` with the remedy when no feed has been downloaded — a normal first-run state.
