---
title: 'price'
---

Browse the prices of every deck, collection, and wanted list in one place.

Run in a terminal with no flags, `price` opens an [interactive browser](#the-interactive-browser). The same information prints non-interactively when you pass scripting flags, when stdin or stdout is piped, or under the global `--no-input` flag.

The same pricing engine backs the [MCP](/commands/mcp/) `get_price_report` tool. For what a store would _pay you_ for these cards, see [`sell`](/commands/sell/).

## Usage

```bash
ritual price [listName] [options]
```

## Arguments

| Argument     | Description                                        | Required |
| ------------ | -------------------------------------------------- | -------- |
| `[listName]` | Open (or print) a single list instead of all lists | No       |

The name is matched across all three list types; see [List Names](/list-resolution/). An ambiguous name is rejected. Disambiguate with `--deck`, `--collection`, or `--wanted`.

## Options

| Option                 | Description                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--deck`               | Only decks (also disambiguates list names)                                                                                    |
| `--collection`         | Only collections (also disambiguates list names)                                                                              |
| `--wanted`             | Only wanted lists (also disambiguates list names)                                                                             |
| `--prices <currency>`  | Price currency: `usd`, `eur`, or `tix` (default: the configured [`defaultCurrency`](/configuration/#default-currency))        |
| `--source <store>`     | Price store: `tcgplayer` (default), `cardmarket`, `cardhoarder`, or `cardkingdom`; see [Price stores](#price-stores---source) |
| `--name <terms>`       | Print cards whose name contains every space-separated term                                                                    |
| `--set <code>`         | Print cards from this set code                                                                                                |
| `--collector <number>` | Print cards with this collector number                                                                                        |
| `--sort <field>`       | Sort cards by `name`, `price`, `lowest`, `set`, `cmc`, `edhrec`, or `quantity`                                                |
| `--descending`         | Reverse the sort direction                                                                                                    |
| `--summary`            | Print the price summary instead of opening the browser                                                                        |
| `--refresh <mode>`     | Card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never`; see [Price Freshness](#price-freshness)            |
| `--output <format>`    | Output format (`text`, `json`, or `ndjson`)                                                                                   |
| `--quiet`              | Suppress progress lines and the price disclaimer; never the payload or the parser warnings                                    |

## The Interactive Browser

The main screen shows:

- When prices were last updated and the active currency
- Every list with its total price, its lowest-price total (when it differs), its unpriced count, and its card count
- Totals per list type (decks / collections / wanted lists) and across all lists

Selecting a list opens a card browser over it. **🔎 Search all cards** opens the same browser over every list, with each card labelled by its source list. In a card browser:

- Typing filters rows live by name, set code, or collector number.
- Menu items change the sort field and direction, and set persistent set-code, collector-number, and (in the global search) list-type filters.
- Selecting a card shows its printing, unit and line price, cheapest printing, mana value, and EDHREC rank. It can also list every printing with per-finish prices.

**🔄 Refresh prices** redownloads the card database (which carries the prices) and rebuilds the report. **💱 Change currency** re-prices everything in `usd`, `eur`, or `tix`. A browser launched with `--source cardkingdom` keeps that store for its USD views: `eur` and `tix` read Scryfall, and switching back to `usd` reads Card Kingdom retail again (the header reads `USD (Card Kingdom retail)`).

## Price stores (`--source`)

A source names the store prices come from, and so also its currency:

| Store         | Currency | Prices                                                                         |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `tcgplayer`   | USD      | Scryfall USD market price. The default.                                        |
| `cardmarket`  | EUR      | Scryfall EUR price.                                                            |
| `cardhoarder` | TIX      | Scryfall MTGO tix price.                                                       |
| `cardkingdom` | USD      | Card Kingdom Near Mint retail, from the cached [buylist feed](/commands/sell/) |

`--source cardmarket` means the same as `--prices eur`, and `--source cardhoarder` the same as `--prices tix`. A `--prices` value that disagrees with the source is a usage error.

Under `--source cardkingdom`:

- Entries match Card Kingdom products by Scryfall ID, with the same SKU fallback the sell report uses.
- The feed follows this run's `--refresh` policy, like the card cache. With no feed cached and bulk downloads disallowed, the command errors instead of falling back to Scryfall.
- No substitute price is ever shown. A printing Card Kingdom does not sell, and any non-English entry (their feed is English-only), is reported **unpriced**. The "lowest" figure becomes the cheapest printing+finish CK sells.
- An entry that names no printing is priced at a printing chosen from CK's own catalog (see [How Cards Are Priced](#how-cards-are-priced)). It goes unpriced only when CK carries no printing of the card at all.
- Structured payloads carry `"source": "cardkingdom"` beside `"currency": "usd"`.

## Price Freshness

Prices come from the local Scryfall card cache. The shared `--refresh <mode>` option decides how its freshness is handled (see [CLI conventions](/cli-conventions/)). On launch, `price` reports when the cache was last refreshed.

| Situation                  | `ask` (default)                 | `auto`                   | `no-bulk` / `never` |
| -------------------------- | ------------------------------- | ------------------------ | ------------------- |
| Prices more than a day old | Prompt to update (default no)   | Update without prompting | Leave as is         |
| Cache empty                | Offer to download (default yes) | Download                 | Error               |

Declining a download when the cache is empty also exits with an error, since nothing can be priced.

Under `never` the report is built from the cache **only**. A card the cache does not hold is reported as unpriced, not fetched one card at a time. (`ask`, `auto`, and `no-bulk` still fill such gaps with a per-card lookup.) This makes `--refresh never` usable offline; otherwise every uncached name waits out the full Scryfall request timeout.

Prompts never fire when they cannot be answered. Under `--no-input` / `RITUAL_NO_INPUT` or a non-TTY stdin, the `ask` prompts are declined. With `--output json`/`ndjson`, `ask` downgrades to `never` so the output stays parseable.

## How Cards Are Priced

- An entry pinned to a specific printing (set + collector number) is priced at that exact printing, at its own finish when recorded, otherwise the printing's default finish. Collection entries are always pinned.
- An unpinned entry is priced at a representative recent printing, the same pick the public site uses. Such printings are marked `*` in card listings. The pick uses the _active store's_ prices: under `--source cardkingdom` it is the newest printing Card Kingdom sells. A card CK carries no printing of keeps the Scryfall pick and reports unpriced.
- Every deck and wanted-list entry also carries a **lowest** price, the cheapest acceptable copy:
  - Deck entries and name-only wanted entries: the cheapest printing+finish overall.
  - A wanted entry pinned to a printing without a finish: that printing's cheapest finish.
  - A fully specified entry: its own price.
- Deck totals cover every section except extras (maybeboard/token sections), matching the public site.
- A card with no price in the active currency counts as **unpriced**. Unpriced counts are quantity-weighted.
- **A [proxy](/list-format/#card-labels) or [custom-art](/custom-art/) card is priced at zero, by rule.** A card is a proxy when its effective labels include `proxy` (its own `[proxy]` token, or the list's front-matter default). A card has custom art when the list's `.art.json` file gives it some. Either skips the price lookup entirely. Its price and lowest price are `0`, its unpriced reason is `proxy` or `custom-art`, and it counts toward the card count but **not** the unpriced count. A fully proxied deck therefore totals nothing and reports zero missing prices. In the browser and text views the price cell reads **PROXY** or **CUSTOM** instead of `N/A`, and the card detail explains it (`this copy is a proxy, so it carries no price` / `this copy has custom art, so it carries no price`). A card that is both reads **CUSTOM**.
- **Only `nonfoil`, `foil`, and `etched` participate in pricing.** These are the finishes Ritual records and the only ones Scryfall publishes prices for. A printing offered in some other finish is never quoted under that finish's name, in either the cheapest-printing pick or the all-printings listing. A printing offered in _no_ recorded finish is still priced at its base price and reported as `nonfoil`.
- **Etched euro prices are sparse.** Scryfall publishes `eur_etched` for only a few etched printings, so an etched entry priced in `eur` often reports as unpriced. It is not quoted at the nonfoil euro price, which would understate it. Price those lists in `usd` for a complete total.

## Non-Interactive Output

Three views, chosen by the flags:

```bash
# Summary of every list (the main screen as text)
ritual price --summary

# One list's cards and totals
ritual price "Red Binder" --no-input

# Search cards across all lists
ritual price --set neo --sort price --descending
ritual price --name "sol ring"
```

Each view supports `--output json` (one structured document) and `--output ndjson` (one JSON line per list or card). The summary JSON includes `lastRefreshedAt`, per-list summaries, per-type totals, grand totals, and a `warnings` array. The single-list and card-search payloads carry the same `warnings` field. Card listings include per-entry prices, lowest prices, and unpriced reasons.

`warnings` holds lines the list parsers could not read (prose, comments, malformed card lines). Such lines are not priced, so the totals exclude them. The warnings **also** print to stderr in every output mode, including under `--quiet`.

```bash
ritual price --summary --output json
ritual price --wanted --set otc --output ndjson
```

Prices reflect NM (Near Mint) values: Scryfall market prices, or Card Kingdom's NM retail under `--source cardkingdom`.
