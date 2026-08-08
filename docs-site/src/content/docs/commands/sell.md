---
title: 'sell'
---

Check what [Card Kingdom's buylist](https://www.cardkingdom.com/purchasing/mtg_singles) ("Sell us your cards") is currently paying for cards in your lists.

The report is built from Card Kingdom's public pricelist feed — one ~70 MB download covering their entire singles catalog, cached locally under `cache/cardkingdom.json` and considered fresh for a day (matching their daily regeneration). Every check after that is a purely local join: no scraping, no per-card requests. The same engine backs the [MCP](/commands/mcp/) `get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, and `refresh_buylist` tools, the [admin sell endpoints](/admin/api/#sell-report), and [sell mode](/public-site/sell/) on the admin site and on published sites — so a quote is the same wherever you read it.

:::note[Not gated on `site.sellMode`]
Every _other_ buylist surface — sell mode on the sites, the admin's sell routes and its startup buylist refresh, the buylist half of [`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) — is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on. `ritual sell` is the exception: running it is itself the explicit request for Card Kingdom prices, so it downloads, refreshes, and quotes whatever that key says. Downloading a feed this way is also what a later `--sell-mode` build has to bake from.
:::

## Usage

```bash
./ritual sell [list...] [options]
```

## Arguments

| Argument    | Description                                                                                                       | Required |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| `[list...]` | Lists to check, of any type; `deck:`/`collection:`/`wanted:` prefixes disambiguate. Default: **every collection** | No       |

Names resolve case- and accent-insensitively with a unique-substring fallback, like every list-taking command — see [List Resolution](/commands/list-resolution/). With no arguments the report covers all collections (the lists that hold physically owned, sellable cards); `--deck` / `--collection` / `--wanted` switch the scope to every list of that type.

## Options

| Option              | Description                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--deck`            | Check every deck (also disambiguates list names)                                                                                                                  |
| `--collection`      | Check every collection (the default scope; also disambiguates list names)                                                                                         |
| `--wanted`          | Check every wanted list (also disambiguates list names)                                                                                                           |
| `--sets <codes>`    | Only cards from these set codes (comma-separated, e.g. `dsk,fdn`): an entry's own pin, or the quoted printing's set                                               |
| `--min <price>`     | Only offers of at least this much per copy (e.g. `0.50`)                                                                                                          |
| `--all`             | Also itemize entries CK is **not** buying and unmatched entries in the text report (they are otherwise only counted)                                              |
| `--out <file>`      | Write the output to a file instead of stdout (`-` for stdout); relative paths resolve against the base directory                                                  |
| `--refresh <mode>`  | Buylist + card cache refresh policy: `ask` (default — a day-old buylist is redownloaded automatically; a first-ever download prompts), `auto`, `no-bulk`, `never` |
| `--output <format>` | Output format: `text`, `json`, `ndjson`, or `csv`                                                                                                                 |
| `--quiet`           | Suppress progress lines and the disclaimer; never the payload or parser warnings                                                                                  |

## How Cards Are Matched

Card Kingdom's feed links almost every product (99.5%) to its Scryfall card, so matching runs on the same identifiers your lists already pin:

- An entry pinned to a printing (set + collector number — every collection entry) resolves through the card cache to that printing's Scryfall id, then to the CK product in the entry's finish. Foil, nonfoil, and etched copies of the same card are distinct CK products and are matched exactly.
- When CK's feed lacks the Scryfall link (brand-new sets, some promos), a fallback matches CK's sku (`DSK-0136` ⇔ `DSK:136`) at the same finish.
- An unpinned entry (deck or wanted lines without a printing) is quoted at the **best-paying** CK product across all printings of the name, so the report answers "what would CK pay if I sent the right copy". Such quotes carry `pinned: false`, report the quoted printing's set/collector number and finish (`ckFinish`), and — like any entry where several products matched — set `ambiguous`.
- When you point it at a deck, sections classified as extras (maybeboard/token sections) are excluded, matching [`price`](/commands/price/); sideboards are included.

Each entry lands in one of three states:

- **buying** — CK lists an active offer: the cash price per Near Mint copy, capped at their buy quantity (`×2 of 4` means they'll take 2 of your 4).
- **not buying** — the product exists on CK's list but their buy quantity is 0 (their feed keeps token prices on paused offers; those are not real quotes).
- **no match** — no CK product was found, with a reason: the card cache has no printings for the name, the pinned printing isn't in the cache, the printing simply isn't in CK's catalog — or the entry is **non-English** (a `[ja]`-style [language token](/commands/edit/#card-language)): Card Kingdom's feed is English-only, so a foreign copy is reported as `no-match` with reason `non-english` rather than silently quoted at the English price.

Identical variant lines (same name, printing, finish, condition, and language, within a section) are aggregated first, so a playset spelled as four collection lines reports as one entry with quantity 4. Entries matching the same CK product draw down one shared buy-quantity budget, so several lists holding the same card never sum past CK's cap.

Buy prices are Card Kingdom's **cash** quotes for **Near Mint** copies: played conditions are graded down on receipt, store credit typically pays more, and quotes change daily. Treat the report as a planning tool, not a locked-in offer.

## Feed Freshness

The shared `--refresh <mode>` option governs two caches: the Scryfall card cache (needed to resolve printings; an empty one is an error, and `ask`/`auto` offer to download it) and the Card Kingdom feed itself. A missing feed downloads under `auto`, prompts under `ask` (default yes), and errors under `no-bulk`/`never`. A stale feed (older than a day, so quoting yesterday's offers) is redownloaded **without prompting** under both `ask` and `auto` — the same automatic treatment the Scryfall bulk cache gets, since consenting to the first download is what licenses keeping it current — and is used as-is under `no-bulk`/`never`. A failed download falls back to the stale feed when one exists.

As with every command, structured output (`json`, `ndjson`, `csv`) downgrades an unanswerable `ask` to `never` — which also opts out of the automatic stale-feed redownload, so `sell --output json` quotes from whatever is cached unless you pass `--refresh auto` — and under `never` card names resolve from the cache only. When prompts are unavailable (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal) the `ask` prompts are declined — so a missing feed or an empty card cache exits `1` with the `--refresh auto` advice instead of hanging.

## Sell-Cart CSV Export

`--output csv` renders the entries CK is buying as Card Kingdom's own [sell-cart CSV import format](https://www.cardkingdom.com/static/csvImport) — `card name, edition, foil, quantity`, data rows only (their importer expects no header row and prompts for column matching itself) — using CK's own listing title and edition spelling from the matched products, with quantities capped at their buy limits. A variant printing carries CK's variant note in parentheses, exactly as they title it (`Mishra's Factory (Autumn)`), so the row lands on that printing rather than the base one:

```bash
./ritual sell --min 0.25 --output csv --out to-sell.csv
```

With nothing to sell the payload is empty rather than a lone header line. Upload the file on their CSV import page and the sell cart fills itself. Their importer caps one upload at 500 unique titles or 5,000 cards (the command warns when the file exceeds either), and the format cannot express etched foils — etched-quoted entries export as foil with a warning to adjust the cart by hand. The same rendering is available to other clients as [`GET /api/sell/cart`](/admin/api/#sell-cart) and the MCP `get_sell_cart` tool.

## Non-Interactive Output

```bash
# Everything CK is buying from your collections
./ritual sell

# One list, showing skipped entries too
./ritual sell 'Red Binder' --all

# Only Duskmourn and Foundations cards worth at least 50¢, as JSON
./ritual sell --sets dsk,fdn --min 0.50 --output json

# One line per matched entry
./ritual sell --output ndjson
```

`--output json` emits the full report payload (`feedCreatedAt`, `feedRetrievedAt`, the active `filters`, per-list summaries, every entry, and grand totals, plus parser `warnings`); `ndjson` emits one entry per line. Text reports sort each list's offers by value, best first.

## Exit Codes

| Code | Meaning                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Report produced (even when CK is buying nothing)                                                                                    |
| 1    | Runtime failure — empty card cache, missing feed under `never`, or a failed download                                                |
| 2    | Usage error — conflicting type flags, a `deck:`-style prefix contradicting a type flag, an ambiguous list name, or a bad flag value |
| 3    | A named list was not found                                                                                                          |
