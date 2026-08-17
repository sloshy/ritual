---
title: 'price'
---

Browse the prices of every deck, collection, and wanted list in one place.

The same pricing engine backs the [MCP](/commands/mcp/) `get_price_report` tool. (For what a store would _pay you_ for those cards, see [`sell`](/commands/sell/).)

Run without flags in a terminal, `price` opens an interactive browser. It shows when prices were last updated, each list with its total (and its "lowest price" total for decks and wanted lists), how many cards in each list are unpriced, totals per list type, and a grand total across everything. From the main screen you can drill into a single list, search every list at once, refresh prices, or switch currency.

With scripting flags (or when stdin or stdout is piped, or the global `--no-input` flag is in force), the same information prints non-interactively.

## Usage

```bash
./ritual price [listName] [options]
```

## Arguments

| Argument     | Description                                        | Required |
| ------------ | -------------------------------------------------- | -------- |
| `[listName]` | Open (or print) a single list instead of all lists | No       |

The name is matched case- and accent-insensitively across all three list types, with a unique-substring fallback; an ambiguous name is rejected — disambiguate with `--deck`, `--collection`, or `--wanted`. See [List Resolution](/commands/list-resolution/).

## Options

| Option                 | Description                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--deck`               | Only decks (also disambiguates `listName`)                                                                                                                                            |
| `--collection`         | Only collections (also disambiguates `listName`)                                                                                                                                      |
| `--wanted`             | Only wanted lists (also disambiguates `listName`)                                                                                                                                     |
| `--prices <currency>`  | Price currency: `usd`, `eur`, or `tix` (default: the configured [`defaultCurrency`](/configuration/#default-currency))                                                                |
| `--source <store>`     | Price store: `tcgplayer` (Scryfall USD, the default behavior), `cardmarket` (Scryfall EUR), or `cardkingdom` (Card Kingdom NM retail from the cached [buylist feed](/commands/sell/)) |
| `--name <terms>`       | Print cards whose name contains every space-separated term                                                                                                                            |
| `--set <code>`         | Print cards from this set code                                                                                                                                                        |
| `--collector <number>` | Print cards with this collector number                                                                                                                                                |
| `--sort <field>`       | Sort cards by `name`, `price`, `lowest`, `set`, `cmc`, `edhrec`, or `quantity`                                                                                                        |
| `--descending`         | Reverse the sort direction                                                                                                                                                            |
| `--summary`            | Print the price summary instead of opening the browser                                                                                                                                |
| `--refresh <mode>`     | Card cache refresh policy: `ask` (default — prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never`                                                                 |
| `--output <format>`    | Output format (`text`, `json`, or `ndjson`)                                                                                                                                           |
| `--quiet`              | Suppress progress lines and the price disclaimer; never the payload or the parser warnings                                                                                            |

## The Interactive Browser

The main screen shows, at a glance:

- When prices were last updated and the active currency
- Every list with its total price, its lowest-price total (when it differs), how many cards are unpriced, and its card count
- Totals per list type (decks / collections / wanted lists) and across all lists

Selecting a list opens a card browser over that list; **🔎 Search all cards** opens the same browser over every list at once, with each card labelled by its source list. In a card browser, typing filters rows live by name, set code, or collector number, and menu items adjust the sort field/direction and set persistent set-code, collector-number, and (in the global search) list-type filters. Selecting a card shows a detail view — its printing, unit and line price, the cheapest printing, mana value, and EDHREC rank — and can list every printing with per-finish prices.

**🔄 Refresh prices** redownloads the card database (prices ride along inside it) and rebuilds the report; **💱 Change currency** re-prices everything in `usd`, `eur`, or `tix`. A browser launched with `--source cardkingdom` keeps that source for its USD views — switching to `eur` or `tix` reads Scryfall, and switching back to `usd` reads Card Kingdom retail again (the header labels it `USD (Card Kingdom retail)`).

## Price stores (`--source`)

A source names the store prices come from, and therefore its currency — `tcgplayer` and `cardkingdom` price in USD, `cardmarket` in EUR — so `--source cardmarket` is `--prices eur` by another name, and passing a `--prices` that disagrees with the source is a usage error.

`--source cardkingdom` prices every entry at Card Kingdom's **Near Mint retail** price from the cached [pricelist feed](/commands/sell/), matched by Scryfall ID (with the same SKU fallback the sell report uses). The feed follows this run's `--refresh` policy like the card cache; with no feed cached and bulk downloads disallowed, the command errors rather than silently falling back to Scryfall. Honesty over completeness: a printing Card Kingdom does not sell — and any non-English entry, which their English-only feed can never quote — is reported **unpriced**, and the "lowest" figure becomes the cheapest printing+finish CK actually sells. Structured payloads carry `"source": "cardkingdom"` beside `"currency": "usd"`.

## Price Freshness

Prices come from the local Scryfall card cache; the shared `--refresh <mode>` option decides how its freshness is handled. On launch, `price` reports when the cache was last refreshed. If prices are more than a day old, `ask` (the default) prompts to update them (default no), `auto` updates them without prompting, and `no-bulk` / `never` leave them alone. When the cache is empty, `ask` offers to download the card database (default yes) and `auto` downloads it outright; declining — or an empty cache under `no-bulk` / `never` — exits with an error, since nothing can be priced.

Under `never` the report is built from the cache **only**: a card the cache does not hold is reported as unpriced rather than fetched one card at a time. (`ask`, `auto`, and `no-bulk` still fill such gaps with a per-card lookup.) That is what makes `--refresh never` usable offline — otherwise every uncached name waits out the full Scryfall request timeout in turn.

Prompts never fire when they can't be answered: under `--no-input` / `RITUAL_NO_INPUT` or a non-TTY stdin the `ask` prompts are declined, and in structured-output (`--output json`/`ndjson`) runs `ask` downgrades to `never` so the output stays parseable.

## How Cards Are Priced

- An entry pinned to a specific printing (set + collector number) is priced at that exact printing — at its own finish when recorded, otherwise the printing's default finish. Collection entries are always pinned.
- An unpinned entry is priced at a representative recent printing (the same pick the public site uses). Such printings are marked with `*` in card listings.
- Every deck and wanted-list entry also carries a **lowest** price — the cheapest acceptable copy. For deck entries and name-only wanted entries that is the cheapest printing+finish overall; for a wanted entry pinned to a printing without a finish it is that printing's cheapest finish; for fully-specified entries it is the entry price itself.
- Deck totals cover every section except extras (maybeboard/token sections), matching the public site.
- A card with no price in the active currency counts as **unpriced**; unpriced counts are quantity-weighted.
- **A [proxy](/commands/edit/#card-labels) or a [custom-art](/custom-art/) card is priced at zero, by rule.** Two things make a card priceless without any lookup failing: its effective labels include `proxy` (its own `[proxy]` token, or the list's front-matter default), or the list's `.art.json` sidecar gives it custom art. Either short-circuits before any price lookup — its price and lowest price are `0`, its unpriced reason is `proxy` or `custom-art`, and it counts toward the card count but **not** toward the unpriced count. A fully proxied deck therefore totals nothing and reports zero missing prices, rather than looking like a deck full of lookup failures. In the interactive browser and the text views the price cell reads **PROXY** or **CUSTOM** instead of `N/A`, and the card detail explains it (`this copy is a proxy, so it carries no price` / `this copy has custom art, so it carries no price`). A card that is both reads **CUSTOM**: custom art wins.
- **Only `nonfoil`, `foil` and `etched` participate in pricing.** Those are the finishes Ritual records and the only ones Scryfall publishes a price field for, so a printing offered in some other finish is never quoted under that finish's name — neither in the cheapest-printing pick nor in the all-printings listing. A printing offered in _no_ recorded finish is still priced, at its base price, reported as `nonfoil`.
- **Etched euro prices are sparse.** Scryfall publishes `eur_etched` only for the few etched printings Cardmarket actually quotes, so an etched entry priced in `eur` frequently reports as unpriced rather than being quoted at the printing's nonfoil euro price — which would understate exactly the cards whose finish is the reason for their value. Price those lists in `usd` for a complete total.

## Non-Interactive Output

Three views, chosen by the flags:

```bash
# Summary of every list (the main screen as text)
./ritual price --summary

# One list's cards and totals
./ritual price "Red Binder" --no-input

# Search cards across all lists
./ritual price --set neo --sort price --descending
./ritual price --name "sol ring"
```

Each view supports `--output json` (one structured document) and `--output ndjson` (one JSON line per list or card). The summary JSON includes `lastRefreshedAt`, per-list summaries, per-type totals, grand totals, and a `warnings` array of lines the list parsers could not read (prose, comments, malformed card lines — such lines are not priced); the single-list and card-search JSON payloads carry the same `warnings` field. The warnings **also** print to stderr in every output mode, including under `--quiet`: a skipped card line means the totals exclude cards, and nothing else would tell you. Card listings include per-entry prices, lowest prices, and unpriced reasons.

```bash
./ritual price --summary --output json
./ritual price --wanted --set otc --output ndjson
```

Prices reflect NM (Near Mint) values — Scryfall market prices, or Card Kingdom's NM retail under `--source cardkingdom`.
