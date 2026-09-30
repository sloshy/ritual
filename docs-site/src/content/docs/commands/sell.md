---
title: 'sell'
---

Check what [Card Kingdom's buylist](https://www.cardkingdom.com/purchasing/mtg_singles) ("Sell us your cards") is currently paying for the cards in your lists.

The report uses Card Kingdom's public pricelist feed: one ~70 MB download covering their whole singles catalog, cached under `cache/cardkingdom.json` and considered fresh for a day. Every check after that is a local join, with no scraping and no per-card requests. The same engine backs the [MCP](/commands/mcp/) `get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, and `refresh_buylist` tools, the [admin sell endpoints](/admin/api/#sell-report), and [sell mode](/public-site/sell/) on the sites. A quote is the same wherever you read it.

:::note[Not gated on `site.sellMode`]
Every _other_ buylist surface (sell mode on the sites, the admin's sell routes and startup buylist refresh, the buylist part of [`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode)) is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. `ritual sell` ignores both keys. Running it is itself the request for Card Kingdom prices, so it downloads, refreshes, and quotes regardless. A feed downloaded this way is also what a later `--sell-mode` build uses.
:::

## Usage

```bash
ritual sell [list...] [options]
```

## Arguments

| Argument    | Description                                                                                                       | Required |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| `[list...]` | Lists to check, of any type; `deck:`/`collection:`/`wanted:` prefixes disambiguate. Default: **every collection** | No       |

Names resolve as for every list-taking command; see [List Names](/list-resolution/). With no arguments the report covers all collections. `--deck` / `--collection` / `--wanted` switch the scope to every list of that type.

## Options

| Option                | Description                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--deck`              | Only decks (also disambiguates list names)                                                                                                                                                                                           |
| `--collection`        | Only collections (also disambiguates list names)                                                                                                                                                                                     |
| `--wanted`            | Only wanted lists (also disambiguates list names)                                                                                                                                                                                    |
| `--tags <list>`       | Only cards carrying one of these [tags](/list-format/#card-tags) (comma-separated, exact and case-sensitive); scopes matching, so CK's buy limits go to these cards. See [Selling a Hand-Picked Batch](#selling-a-hand-picked-batch) |
| `--sets <codes>`      | Only cards from these set codes (comma-separated, e.g. `dsk,fdn`): the set of the entry's own printing, or of the quoted printing                                                                                                    |
| `--min <price>`       | Only offers of at least this much per copy (e.g. `0.50`)                                                                                                                                                                             |
| `--min-owned <count>` | Only cards you own at least `count` copies of in total, across every collection and deck and every printing; see [Entry Fields](#entry-fields)                                                                                       |
| `--min-ratio <ratio>` | Only offers worth at least this fraction of the card's TCGplayer market price (`0.8` = 80%); see [Offer vs. Market](#offer-vs-market)                                                                                                |
| `--all`               | Also itemize entries CK is **not** buying and unmatched entries in the text report (otherwise they are only counted)                                                                                                                 |
| `--out <file>`        | Write the output to a file instead of stdout (`-` for stdout); relative paths resolve against the base directory                                                                                                                     |
| `--refresh <mode>`    | Buylist + card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never`; see [Feed Freshness](#feed-freshness)                                                                                                           |
| `--output <format>`   | Output format: `text`, `json`, `ndjson`, or `csv`                                                                                                                                                                                    |
| `--quiet`             | Suppress progress lines and the disclaimer; never the payload or parser warnings                                                                                                                                                     |

## How Cards Are Matched

Card Kingdom's feed links almost every product (99.5%) to its Scryfall card, so matching uses the identifiers your lists already carry:

- An entry with a printing (set + collector number, which every collection entry has) resolves through the card cache to that printing's Scryfall id, then to the CK product in the entry's finish. Foil, nonfoil, and etched copies are distinct CK products and match exactly.
- When CK's feed lacks the Scryfall link (brand-new sets, some promos), a fallback matches CK's sku (`DSK-0136` ⇔ `DSK:136`) at the same finish.
- An entry with no printing (deck or wanted lines) is quoted at the **best-paying** CK product across all printings of the name: "what would CK pay if I sent the right copy". Such quotes carry `pinned: false` and report the quoted printing's set/collector number and finish (`ckFinish`). Like any entry where several products matched, they set `ambiguous` when more than one product was a candidate.
- For a deck, sections classified as extras (maybeboard/token sections) are excluded, matching [`price`](/commands/price/). Sideboards are included.

Each entry lands in one of three states:

- **buying**: CK has an active offer, the cash price per Near Mint copy, capped at their buy quantity (`×2 of 4` means they take 2 of your 4).
- **not buying**: the product is on CK's list but their buy quantity is 0. Their feed keeps token prices on paused offers, and those are not real quotes.
- **no match**: no CK product was found, with a reason. Either the card cache has no printings for the name, the entry's printing is not in the cache, the printing is not in CK's catalog, or the entry is **non-English** (a `[ja]`-style [language token](/list-format/#card-language)). CK's feed is English-only, so a foreign copy is reported as `no-match` with reason `non-english` rather than quoted at the English price.

**[Proxies](/list-format/#card-labels) and [custom-art](/custom-art/) cards never enter the report.** An entry whose effective labels include `proxy`, or that the list's `.art.json` file gives custom art, is dropped before matching. It is not quoted, counted, or reported as a no-match: there is nothing to sell. The drop happens before aggregation, so such a copy never merges into an identical real one and gets offered to the buyer.

Identical lines (same name, printing, finish, condition, language, and tags, within a section) are aggregated first, so a playset spelled as four collection lines reports as one entry with quantity 4. Entries matching the same CK product share one buy-quantity budget, so several lists holding the same card never sum past CK's cap.

## Offer vs. Market

Card Kingdom's own retail price (`priceRetail`) runs high, so it is a poor yardstick for whether an offer is good. Each matched entry also carries the quoted printing's **TCGplayer market price** (`tcgplayerPrice`, USD), read from the local card cache's Scryfall prices at the quoted product's finish, so a foil offer is weighed against the foil market. `offerRatio` is `priceBuy ÷ tcgplayerPrice` to three places: `0.8` means CK pays 80% of market. The text report closes each buying line with the same comparison (`· 63% of TCGplayer $2.40`).

Both fields are absent when the cache has no price for that printing, or when the CK product could not be tied to a cached printing (an unpinned entry matched only by CK's name index). `--min-ratio` drops such entries along with every offer below the ratio:

```bash
# Offers at 70% of market or better, as a sell cart
ritual sell --min-ratio 0.7 --output csv --out good-offers.csv
```

Market prices are as fresh as your card cache; refresh it (`ritual cache preload-all`) for today's numbers.

## Entry Fields

Beyond the match and quote, every entry in the `json`/`ndjson` output carries fields for acting on the result:

- **`cardIds`**: the [`&N` ids](/list-format/#card-ids-n) of the list lines behind the entry, in file order. Aggregation folds identical lines into one entry, so a collection's four one-copy lines give four ids, while a deck's `4 Card` line gives one. Pass one to [`set-card --card-id`](/commands/set-card/) (for example to tag the copy, `--tag "CK Batch"`), [`move`](/commands/move/), or [`remove-card`](/commands/remove-card/) to act on exactly that copy after the sale. A line with no id yet contributes none. `sell` never writes to your lists, so a line added by hand gets its id from the next command that edits the list (any `set-card`, `add-card`, `edit`, …), or from [`cleanup`](/commands/cleanup/).
- **`tags`**: the lines' [tags](/list-format/#card-tags). Identically tagged lines aggregate together, so every line behind `cardIds` carries exactly these tags. The text report names them after the card (`Sol Ring (C21:263) · tags: CK Batch`), so a tagged copy reads apart from an untagged one.
- **`edhrecRank`**: the card's [EDHREC](https://edhrec.com) rank (1 = the most-played Commander card), from the card cache. Absent when EDHREC has not ranked it or the card cache does not hold the card.
- **`ownedCopies`**: `{ "collection": n, "deck": n }`, how many copies of the card you hold, **by name and across every printing**, in _all_ your collections and _all_ your decks, whatever lists the report covers. Proxies never count, nor do a deck's extras sections (maybeboard, tokens); wanted lists are cards you do not own. The two are kept apart because whether a deck's cards are also in a collection depends on how you track them. `--min-owned <count>` keeps entries whose two counts add up to at least `count`, the quickest way to find duplicates worth selling:

```bash
# Cards you own 4+ copies of that CK pays at least $1 for
ritual sell --min-owned 4 --min 1 --output json
```

Buy prices are Card Kingdom's **cash** quotes for **Near Mint** copies. Played conditions are graded down on receipt, store credit usually pays more, and quotes change daily. The report is a planning tool, not an offer.

## Feed Freshness

The shared `--refresh <mode>` option governs two caches: the Scryfall card cache (needed to resolve printings) and the Card Kingdom feed.

| Situation             | `ask` (default)                  | `auto`     | `no-bulk` / `never` |
| --------------------- | -------------------------------- | ---------- | ------------------- |
| Card cache empty      | Offer to download (default yes)  | Download   | Error               |
| Feed missing          | Prompt to download (default yes) | Download   | Error               |
| Feed older than a day | Redownload **without prompting** | Redownload | Use as is           |

A failed download falls back to the stale feed when one exists.

Structured output (`json`, `ndjson`, `csv`) downgrades an unanswerable `ask` to `never`. That also opts out of the automatic stale-feed redownload, so `sell --output json` quotes from whatever is cached unless you pass `--refresh auto`. Under `never`, card names resolve from the cache only. When prompts are unavailable (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal), the `ask` prompts are declined, so a missing feed or an empty card cache exits `1` with advice to use `--refresh auto`.

## Sell-Cart CSV Export

`--output csv` renders the entries CK is buying in Card Kingdom's own [sell-cart CSV import format](https://www.cardkingdom.com/static/csvImport): `card name, edition, foil, quantity`, data rows only (their importer expects no header row). It uses CK's own listing title and edition spelling from the matched products, with quantities capped at their buy limits. A variant printing carries CK's variant note in parentheses, exactly as they title it (`Mishra's Factory (Autumn)`), so the row lands on that printing:

```bash
ritual sell --min 0.25 --output csv --out to-sell.csv
```

With nothing to sell the payload is empty. Upload the file on their CSV import page and the sell cart fills itself. Two caveats:

- Their importer caps one upload at 500 unique titles or 5,000 cards. The command warns when the file exceeds either.
- The format cannot express etched foils. Etched-quoted entries export as foil, with a warning to adjust the cart by hand.

The same rendering is available as [`GET /api/sell/cart`](/admin/api/#sell-cart) and the MCP `get_sell_cart` tool.

### Selling a Hand-Picked Batch

To build a cart from cards you chose one by one, [tag](/list-format/#card-tags) them, then scope the report to the tag:

```bash
# Tag the chosen copies (card ids come from `sell --output json`'s cardIds)
ritual set-card "Red Binder" --card-id 14 --tag "CK Batch"
ritual set-card "Red Binder" --card-id 27 --tag "CK Batch"

# The sell cart for exactly those copies
ritual sell --tags "CK Batch" --output csv --out ck-batch.csv
```

`--tags` differs from the other filters: it narrows **which lines are matched at all**, before copies are aggregated and CK's buy quantity is shared out. Their cap is a budget drawn down in file order, so an untagged copy of the same card earlier in the file would otherwise use it up first, and the cart could come out short of the batch you picked. The other filters (`--sets`, `--min`, `--min-ratio`, `--min-owned`) trim the finished report.

## Non-Interactive Output

```bash
# Everything CK is buying from your collections
ritual sell

# One list, showing skipped entries too
ritual sell 'Red Binder' --all

# Only Duskmourn and Foundations cards worth at least 50¢, as JSON
ritual sell --sets dsk,fdn --min 0.50 --output json

# One line per matched entry
ritual sell --output ndjson
```

`--output json` emits the full report payload: `feedCreatedAt`, `feedRetrievedAt`, the active `filters`, per-list summaries, every entry, grand totals, and parser `warnings`. `ndjson` emits one entry per line. Text reports sort each list's offers by value, best first.

## Exit Codes

| Code | Meaning                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Report produced (even when CK is buying nothing)                                                                                    |
| 1    | Runtime failure — empty card cache, missing feed under `never`, or a failed download                                                |
| 2    | Usage error — conflicting type flags, a `deck:`-style prefix contradicting a type flag, an ambiguous list name, or a bad flag value |
| 3    | A named list was not found                                                                                                          |
