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

| Option              | Description                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--deck`            | Only decks (also disambiguates list names)                                                                                        |
| `--collection`      | Only collections (also disambiguates list names)                                                                                  |
| `--wanted`          | Only wanted lists (also disambiguates list names)                                                                                 |
| `--sets <codes>`    | Only cards from these set codes (comma-separated, e.g. `dsk,fdn`): the set of the entry's own printing, or of the quoted printing |
| `--min <price>`     | Only offers of at least this much per copy (e.g. `0.50`)                                                                          |
| `--all`             | Also itemize entries CK is **not** buying and unmatched entries in the text report (otherwise they are only counted)              |
| `--out <file>`      | Write the output to a file instead of stdout (`-` for stdout); relative paths resolve against the base directory                  |
| `--refresh <mode>`  | Buylist + card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never`; see [Feed Freshness](#feed-freshness)        |
| `--output <format>` | Output format: `text`, `json`, `ndjson`, or `csv`                                                                                 |
| `--quiet`           | Suppress progress lines and the disclaimer; never the payload or parser warnings                                                  |

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

Identical lines (same name, printing, finish, condition, and language, within a section) are aggregated first, so a playset spelled as four collection lines reports as one entry with quantity 4. Entries matching the same CK product share one buy-quantity budget, so several lists holding the same card never sum past CK's cap.

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
