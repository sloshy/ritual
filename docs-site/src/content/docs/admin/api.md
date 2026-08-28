---
title: 'Admin API Endpoints'
---

The admin site exposes these API endpoints for deck and collection editing. All endpoints require authentication.

For general admin API endpoints (authentication, config, audit log, etc.), see the [admin command reference](/commands/admin/#http-api-reference).

## The message triple

Every response body — success or refusal — carries user-facing prose as up to three fields:

| Field           | Presence | Meaning                                                                                                                                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`       | always   | The sentence, rendered in **English**. What `curl`, scripts, and the MCP server read; it never follows the operator's UI locale.                                                         |
| `messageKey`    | optional | The message-catalog key `message` was rendered from — locale-invariant, so a client may match on it instead of on prose. Absent when the handler has no catalog entry for that sentence. |
| `messageParams` | optional | The parameters `messageKey` interpolates. Absent for a message that takes none.                                                                                                          |

The pair is additive: a client that ignores it sees exactly what it always did. The admin SPA
prefers it, which is what relabels an alert already on screen when the UI language changes without
a round trip. Match on `messageKey`, never on the English text.

## Error responses

Every route refuses a request with the same body, whatever the status:

```json
{
  "success": false,
  "message": "…",
  "messageKey": "admin.api.…",
  "messageParams": { "…": "…" }
}
```

`messageKey`/`messageParams` follow [the message triple](#the-message-triple) above — present on a
keyed refusal, absent on one whose prose has no catalog entry.

A handful of routes carry extra fields on failure, and only where they are a wire contract rather than duplication: [Card Details](#card-details) adds `card: null`, [Card Search](#card-search) keeps its paging fields and an empty `cards` array, and [Card Autocomplete](#card-autocomplete) and [Card Printings](#card-printings) fold success and failure into one shape. A save that loses an optimistic-concurrency race additionally carries `conflict: true` with its `409`.

## Create Deck

```
POST /api/deck/create
```

Create a new deck file, named as the deck is named — see
[List file names](/commands/new/#list-file-names). A name left with no usable file-name
characters returns `400`.

**Request Body:**

```json
{
  "name": "My Commander Deck",
  "format": "commander"
}
```

| Field    | Description                           | Required |
| -------- | ------------------------------------- | -------- |
| `name`   | Deck name (used to generate the slug) | Yes      |
| `format` | Deck format (default: `"commander"`)  | No       |

`format` must be one of the canonical deck format keys — see
[Deck Format](/commands/new/#deck-format) for the full list. An unrecognized value
returns `400` and the deck is not created.

**Response:**

```json
{
  "success": true,
  "message": "Created deck 'My Commander Deck'",
  "slug": "My Commander Deck"
}
```

### List lifecycle responses

Create, rename, and delete answer identically for **every** list type — decks, collections, and
wanted lists share one handler apiece, differing only in how a slug resolves to a file:

| Operation | Success body                                                    |
| --------- | --------------------------------------------------------------- |
| Create    | `{ success: true, message, slug }`                              |
| Rename    | `{ success: true, message, newSlug, newFilePath, oldFilePath }` |
| Delete    | `{ success: true, message, deletedFiles }`                      |

`newFilePath`/`oldFilePath` are the list's paths after and before the rename; `deletedFiles` is
every path the delete removed (the list plus whichever sidecars it had).

A refusal is the shared error envelope (`{ success: false, message }`, plus the optional
[`messageKey`/`messageParams`](#the-message-triple) pair) at the status the refusal carries: `400` for a missing or invalid argument, `404` for a list that is not there, `409` for a
target name already taken.

`409` covers more than a byte-identical file name: create and rename refuse any name that
[resolves](/commands/list-resolution/#names-that-would-collide-are-refused-at-creation) to an
existing list of the same type — `atraxa superfriends` is refused while `Atraxa Superfriends`
exists, with `A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends'
under list-name folding).` Renaming a list to another spelling of its own name (a capitalization
or punctuation fix) is not a collision and succeeds, moving the file and its sidecars even on a
case-insensitive file system.

## Rename Deck

```
POST /api/deck/:slug/rename
```

Rename a deck. Updates the frontmatter `name` field and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "New Deck Name"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed deck to 'New Deck Name'",
  "newSlug": "New Deck Name",
  "newFilePath": "decks/New Deck Name.md",
  "oldFilePath": "decks/My Commander Deck.md"
}
```

## Delete Deck

```
DELETE /api/deck/:slug
```

Delete a deck (and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses)). Requires the full deck name to be provided as confirmation.

**Request Body:**

```json
{
  "confirmName": "My Commander Deck"
}
```

The `confirmName` must match the deck's `name` field exactly. Returns `400` if they don't match.

**Response:**

```json
{
  "success": true,
  "message": "Deleted deck 'My Commander Deck'",
  "deletedFiles": ["decks/My Commander Deck.md", "decks/My Commander Deck.md.sha256"]
}
```

## Card Autocomplete

```
GET /api/autocomplete?q=<query>
```

Search for card names using the in-memory card cache. The query is split on whitespace and **every term must appear in the name**, in any order — the same matching the CLI prompts use, so `in tre` finds "In the Trenches". Matching ignores case, accents, and punctuation (`jotun` matches `Jötun Grunt`; `jaces archivist` matches `Jace's Archivist`).

Returns up to 20 results, ranked by how directly each name answers the query: a name the query spells out in full comes first (the front face of a double-faced card counts as its whole name), then names the query prefixes (`sol ri` → "Sol Ring"), then names whose words the terms begin — in order, then in any order — and finally names matched mid-word (`in tre` → "Kin-Tree Warden"). Equally ranked names are alphabetical.

**Query Parameters:**

| Parameter | Description                         | Required |
| --------- | ----------------------------------- | -------- |
| `q`       | Search query (minimum 2 characters) | Yes      |

**Response:**

```json
{
  "success": true,
  "names": ["Sol Ring", "Soltari Champion"]
}
```

## Load Deck

```
GET /api/deck/:slug?view=<full|cards|summary>&section=<name>&nameContains=<terms>&limit=<n>&offset=<n>
```

Load a deck, at the depth `view` asks for. The same parameters apply to [Load Collection](#load-collection) and [Load Wanted List](#load-wanted-list).

### List load parameters

| Parameter      | Description                                                                                                         | Required |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `view`         | `full` (default), `cards`, or `summary`. Anything else is a `400` naming the three                                  | No       |
| `section`      | Exact `## Section` heading, matched case-sensitively. A section that does not exist yields no entries, not an error | No       |
| `nameContains` | Whitespace-separated name terms; every term must appear, in any order (as `/api/autocomplete` matches)              | No       |
| `limit`        | Max entries returned. A positive integer; anything else is a `400`                                                  | No       |
| `offset`       | Entries to skip before `limit` applies. A non-negative integer (`0` is allowed)                                     | No       |

`view` is what makes the filters worth using. `summary` and `cards` return **before** the changelog-name pass, the Scryfall card/printing/price load, and the mana-symbol fetch — the expensive part of a load — so a filtered read costs the server almost nothing rather than merely returning less. `full` still applies the filters and then loads card data for the filtered names only.

`totalCount` is always present: the number of entries that matched **before** `limit`/`offset` applied — the list's whole line count when nothing was filtered — so a client can page. `offset`/`limit` count lines, and a line is never split: a `4 Lightning Bolt` deck entry travels whole.

Any of `section`, `nameContains`, `limit`, or `offset` makes the body a **slice**: the response then carries `"partial": true` and **no** `contentHash`. That is deliberate — the deck and wanted save routes persist the payload they are handed, so saving a slice back would truncate the file. Reload without the filters to get a hash you can save with. This applies to **every** view, `summary` included: a filtered summary's counts describe the slice, and the hash is the token the save routes read as "this is the whole file".

`warnings` is always present on all three views: everything in the file a re-serializing write would not reproduce, as an array of messages (empty for a clean file). That is the body lines the parser could not read — malformed card lines, but also prose, comments, or any other text the list grammar does not model — plus one summary entry per file holding a [fenced code block](/commands/edit/#fenced-code-blocks) (`Fenced code block content (N line(s)) — …`). A fenced block parses cleanly, so it produces no per-line warning; it is reported here because the canonical serializers cannot emit it. One thing a write does not reproduce is deliberately **not** listed: a deck's empty extras section (`## Maybeboard`, `## Tokens`), which holds nothing to lose and is cleared by the next write rather than blocking it. `warnings` is an always-present array rather than an optional one on purpose — a list holding an unreadable line would otherwise load as merely shorter, and a client that never checks an optional field would never learn the difference.

**A non-empty `warnings` also blocks saving that list.** The three save routes re-serialize the whole file from parsed entries, so anything the parse could not carry is content the write would delete — releasing any `&N` ids it held back into the reuse pool for some other card. Rather than let that happen, a save whose _baseline_ (the file as it stands on disk) yields any `warnings` is refused with `400`, naming the file and each entry. The file is left untouched; fix the line (or remove the fenced block) and retry. MCP mutations surface the same refusal as a tool error.

A missing list is a `404` whose message names `GET /api/lists` as the way to find the real slugs. A slug carrying a path separator is a `400` (`Invalid list slug`) on all three routes.

**Response (`view=full`, the default):**

```json
{
  "success": true,
  "view": "full",
  "deck": { "name": "...", "sections": [] },
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "cardsCardKingdom": { "Sol Ring": {} },
  "symbolMap": { "{W}": "https://..." },
  "frontMatter": {},
  "slug": "my-deck",
  "contentHash": "...",
  "warnings": []
}
```

A `full` deck load also carries `lowestPriceCards`, `lowestPriceCardsEur` and `lowestPriceCardsTix` — the cheapest printing per card name, per currency.

`cardsCardKingdom` (and, on decks, `lowestPriceCardsCardKingdom`) is [Card Kingdom's own printing pick](/public-site/price-sources/#which-printing-a-card-is-priced-at) for each card name: the printing CK actually sells, chosen at CK's prices, which a client displays instead of the Scryfall pick while the Card Kingdom price store is selected. Both are **sparse** — a card CK stocks no printing of has no entry, and the client falls back to the Scryfall pick — and both are **absent entirely** unless [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` and a buylist feed is cached. Nothing is downloaded to answer a load: with no cached feed the fields are simply absent.

**Response (`view=cards`):**

```json
{
  "success": true,
  "slug": "my-deck",
  "view": "cards",
  "deck": { "name": "...", "sections": [] },
  "frontMatter": {},
  "totalCount": 42,
  "contentHash": "...",
  "warnings": []
}
```

Front matter travels with the deck's `cards` view because the save route re-sends it; a collection or wanted list returns `entries` + `sectionOrder` instead, plus a top-level `description` — the list's front-matter blurb, absent when it declares none (a deck's rides inside `deck.description`). A deck and a collection additionally carry a top-level `labels` — the list's [front-matter default](/commands/edit/#card-labels), a deck's being `proxy` alone — and each of their cards may carry its own `labels` override. A narrowed request replaces `contentHash` with `"partial": true`.

Every non-summary load also carries `customArt` when the list has any: a `{ "<cardId>": { "file": … } | { "url": … } }` record of the **raw** [custom art](/custom-art/) references for the cards in the body (clients derive display URLs themselves, since an editor needs the path the user typed). It is omitted when none of the returned cards has art.

Problems with the `.art.json` sidecar — it cannot be read, or it holds art filed under a card id the **whole** list no longer has — come back as a separate `artWarnings` array rather than failing the load. It is deliberately not folded into `warnings`: that channel means card lines the parser could not read, and the [save routes refuse](#unreadable-lines-block-a-save) a list that has any, while bad custom art blocks nothing. `artWarnings` is omitted when the sidecar is clean or absent. The orphan check ignores the filters, so a paged read never reports the cards it did not ask for.

**Response (`view=summary`):**

```json
{
  "success": true,
  "slug": "my-deck",
  "view": "summary",
  "counts": {
    "entryCount": 42,
    "cardCount": 99,
    "sections": [{ "name": "Commander", "entryCount": 1, "cardCount": 1 }]
  },
  "contentHash": "...",
  "warnings": []
}
```

`entryCount` is lines, `cardCount` is copies (summed quantity). Collections and wanted lists hold one card per line, so the two are equal there. A summary honours `section`/`nameContains` and ignores `limit`/`offset` — the counts describe the whole filtered set. A _narrowed_ summary is `"partial": true` with no `contentHash`, like every other narrowed view.

## Card Printings

```
GET /api/card-printings?name=<cardName>&limit=<n>
```

Get the printings of a card, newest first. Uses the card cache with fallback to the Scryfall API.

**Query Parameters:**

| Parameter | Description                                                          | Required |
| --------- | -------------------------------------------------------------------- | -------- |
| `name`    | Exact card name                                                      | Yes      |
| `limit`   | Max printings returned. A positive integer; anything else is a `400` | No       |

`limit` is **opt-in**: omitting it returns every printing, which is what the public/hosted site's printing pickers depend on. `limit` and `totalPrintings` count **distinct printings** (set + collector number): with an `all_cards`-backed cache (a non-English [`defaultLanguage`](/configuration/#default-language)) a printing can hold several card objects — one per language, each carrying its `lang` — and every language object of an included printing rides along, so a client never sees a printing with half its languages missing. When `limit` truncates the list, `totalPrintings` reports how many distinct printings there were.

There is deliberately no `includePrices` parameter — dropping a printing's price block is a projection, and each client projects what it needs from one honest response (the MCP `get_card_printings` tool does exactly that).

**Response:**

```json
{
  "success": true,
  "printings": [{ "id": "...", "set": "2xm" }],
  "totalPrintings": 37,
  "languages": ["en"],
  "complete": true
}
```

`languages` summarizes every language the card's full printing list exists in (before any `limit` truncation), `en` first, folding an absent `lang` to `en` — `["en"]` for any `default_cards`-backed lookup.

`complete` is `false` when the card cache holds no printing list for the name and the response came from the single-card Scryfall fallback: the one printing returned is whatever that lookup found, **not** the card's only printing. A client must not present such a list as exhaustive — run [`ritual cache preload-all`](/commands/cache/) to get a real one.

## Card Price

```
GET /api/card-price?name=<cardName>
```

Get price data for a card including representative and cheapest printings for all currencies. If the cached data is more than 24 hours old, fresh data is fetched from Scryfall and the cache is updated. A card name with no printings returns `404`.

**Query Parameters:**

| Parameter | Description     | Required |
| --------- | --------------- | -------- |
| `name`    | Exact card name | Yes      |

**Response:**

```json
{
  "success": true,
  "printings": [{ "id": "...", "set": "2xm", "prices": { "usd": "1.23" } }],
  "representative": { "id": "...", "set": "2xm" },
  "lowestPriceCard": { "id": "...", "set": "a25" },
  "lowestPriceCardEur": { "id": "...", "set": "a25" },
  "lowestPriceCardTix": { "id": "...", "set": "vma" }
}
```

| Field                | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `representative`     | The USD representative printing (recent, mid-priced) |
| `lowestPriceCard`    | The cheapest USD printing across all printings       |
| `lowestPriceCardEur` | The cheapest EUR printing                            |
| `lowestPriceCardTix` | The cheapest MTGO Tix printing                       |

## Card Details

```
GET /api/card-details?name=<cardName>
```

Everything Ritual knows about one card: oracle text, type line, mana cost and CMC, colors and color identity, keyword abilities, format legalities, and Scryfall Tagger oracle/art tags. The local card cache is read first, falling back to a single-card Scryfall fetch when the cache holds no printings for the name.

Oracle-level fields are identical across printings, so the response describes _the card_ — the identity fields (`set`, `collectorNumber`, `prices`) come from its **most recent** printing, and `printingCount` reports how many printings were found. `printingsComplete` is `false` when that count came from the single-card fallback rather than the cache's own printing list, in which case `printingCount` is always `1` and means nothing about the card. Set codes are returned lowercase.

`colors`, `keywords`, and `legalities` are only present on cards written by a cache from this version onward; run [`ritual cache preload-all`](/commands/cache/) to backfill them.

**Query Parameters:**

| Parameter | Description     | Required |
| --------- | --------------- | -------- |
| `name`    | Exact card name | Yes      |

A name that matches nothing returns `404` with a message pointing at [`/api/autocomplete`](#card-autocomplete) for resolving a partial name. A missing or blank `name` is a `400`. Every error response keeps the success shape — `success: false` and `card: null` — plus a `message`.

**Response:**

```json
{
  "success": true,
  "card": {
    "scryfallId": "...",
    "name": "Lightning Bolt",
    "set": "2xm",
    "collectorNumber": "129",
    "rarity": "uncommon",
    "releasedAt": "2020-08-07",
    "finishes": ["nonfoil"],
    "prices": { "usd": "1.23", "eur": "0.99", "tix": "0.03" },
    "manaCost": "{R}",
    "cmc": 1,
    "typeLine": "Instant",
    "oracleText": "Lightning Bolt deals 3 damage to any target.",
    "colorIdentity": ["R"],
    "layout": "normal",
    "colors": ["R"],
    "keywords": [],
    "legalities": { "commander": "legal", "standard": "not_legal" },
    "oracleTags": ["burn"],
    "artTags": ["lightning"],
    "printingCount": 42
  }
}
```

A multi-faced card also carries `faces`, one `{ name, manaCost, typeLine, oracleText }` object per face.

## Card Search

```
GET /api/card-search?q=<query>&page=<n>&limit=<n>&warm=<true|false>
```

Run a raw [Scryfall search query](https://scryfall.com/docs/syntax) and return one page of card summaries, most popular first — the same lookup the [`scry`](/commands/scry/) CLI command performs.

Exactly one page is fetched per request. Walk further pages by incrementing `page` while `hasMore` is `true`.

### Plain read vs `warm=true`

This route carries both halves of what used to be two routes (the cache-warming `POST /api/search-cards` has been folded in and removed).

By default the route returns Scryfall's page **verbatim** and touches no cache: tokens, Arena-only printings, and Art Series cards are _not_ filtered out, the order is Scryfall's own, and a page carries up to 175 cards.

With `warm=true` it instead:

- filters the page to **real printings** and maps them to the cache's card shape;
- writes each result into the local card cache under any name the cache does not already hold, leaving an already-cached name untouched (this is a warm-up, not a refresh);
- promotes a card whose **whole name** the query spells out ahead of Scryfall's popularity order;
- caps the result at **20** cards unless `limit` says otherwise.

The response's `warmed` field says which contract ran. The **error** contract is the strict one in both modes — see below.

**Query Parameters:**

| Parameter | Description                                                                                    | Required |
| --------- | ---------------------------------------------------------------------------------------------- | -------- |
| `q`       | Scryfall search query                                                                          | Yes      |
| `page`    | 1-based page number (defaults to `1`)                                                          | No       |
| `limit`   | Max cards returned, at most `175`. Defaults to `20` when `warm=true`, otherwise the whole page | No       |
| `warm`    | `true` or `false` (default). Any other value is a `400` — it is validated, never coerced       | No       |

A missing or blank `q` is a `400`; `q` is trimmed before it is sent on. `page` and `limit` may be omitted or left blank; any other value that is not a positive integer is a `400`.

A Scryfall `404` (no matches) is a `200` with an empty `cards` array — an empty result set is not an error. A query Scryfall itself refuses (a syntax error, an unknown filter) is a `400` whose `message` carries Scryfall's own explanation; a failure on Scryfall's side (a `5xx`, a network error) is a `500`. Every error response keeps the success shape — `success: false`, the requested `page`, `hasMore: false`, an empty `cards` array — plus a `message`. This holds for `warm=true` too: a Scryfall server error is a `500`, never an empty `200`.

**Response:**

```json
{
  "success": true,
  "page": 1,
  "hasMore": true,
  "totalCards": 412,
  "warmed": false,
  "cards": [
    {
      "scryfallId": "...",
      "name": "Lightning Bolt",
      "set": "2xm",
      "collectorNumber": "129",
      "rarity": "uncommon",
      "releasedAt": "2020-08-07",
      "finishes": ["nonfoil"],
      "prices": { "usd": "1.23" },
      "manaCost": "{R}",
      "cmc": 1,
      "typeLine": "Instant",
      "oracleText": "Lightning Bolt deals 3 damage to any target.",
      "colorIdentity": ["R"]
    }
  ]
}
```

`totalCards` is absent when Scryfall reported no matches.

## Cache Status

```
GET /api/cache/status
```

Report the card cache's size, freshness, tag coverage, and source — the same payload [`ritual cache status --output json`](/commands/cache/) prints. Diagnostic only: asking never refreshes or writes the cache. Tag presence is checked over a bounded sample of cached cards, not a full scan, so a configured cache server is never asked for its whole contents.

**Response:**

```json
{
  "success": true,
  "empty": false,
  "cardCount": 31240,
  "lastCardRefresh": "2026-07-28T04:00:00.000Z",
  "priceAgeHours": 6,
  "priceStale": false,
  "tagsPresent": true,
  "source": "local",
  "defaultLanguage": "en",
  "cardBulkType": "default_cards",
  "bulkTypeStale": false
}
```

| Field             | Description                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`           | Whether the cache holds no cards at all                                                                                                                       |
| `cardCount`       | Distinct card **names** cached (each holds an array of printings)                                                                                             |
| `lastCardRefresh` | ISO-8601 time of the last bulk refresh, or `null` until one has run                                                                                           |
| `priceAgeHours`   | Whole hours since that refresh (prices ride in the bulk data), or `null`                                                                                      |
| `priceStale`      | `true` when prices are older than 24 hours, or their age is unknown                                                                                           |
| `tagsPresent`     | Whether any sampled card carries oracle/art tags                                                                                                              |
| `source`          | `local`, or `cache-server` when a [cache server](/commands/cache/) is configured                                                                              |
| `defaultLanguage` | The configured [`defaultLanguage`](/configuration/#default-language)                                                                                          |
| `cardBulkType`    | Which bulk built the cache (`default_cards`/`all_cards`), or `null` when no ingest has recorded provenance                                                    |
| `bulkTypeStale`   | `true` when the cache's bulk disagrees with `defaultLanguage` — a full refresh is needed (see [bulk selection](/commands/cache/#bulk-selection-and-language)) |

## Price Summary

```
GET /api/price/summary
```

Price every deck, collection, and wanted list from the local card cache and return per-list, per-type, and grand totals plus any list-parser warnings — the same payload as [`price --summary --output json`](/commands/price/). Prices are read strictly from the cache: when it is empty the endpoint returns `503` without downloading anything (run [`ritual cache preload-all`](/commands/cache/) first), and a card the cache does not hold is reported as unpriced rather than fetched from Scryfall one card at a time. `lastRefreshedAt` is the cache's last bulk-refresh time in Unix milliseconds, or `null` when unknown.

**Query Parameters:**

| Parameter  | Description                                                                                                             | Required |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| `type`     | Only price `deck`, `collection`, or `wanted` lists                                                                      | No       |
| `currency` | `usd`, `eur`, or `tix` (default: the configured `defaultCurrency`)                                                      | No       |
| `source`   | `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), or `cardkingdom` (Card Kingdom NM retail from the cached feed) | No       |

An unknown `type`, `currency`, or `source` returns `400`. A `source` implies its currency
(`tcgplayer`/`cardkingdom` → `usd`, `cardmarket` → `eur`), so a conflicting explicit `currency` is a
`400` too. `source=cardkingdom` reads the cached [buylist feed](/commands/sell/) — strictly
cache-backed like everything else here, so with no feed downloaded it returns `503` with the refresh
advice rather than falling back to Scryfall — and the response then carries `"source":
"cardkingdom"` beside `"currency": "usd"`, with printings Card Kingdom does not sell reported
unpriced. The parameter is an explicit request and is deliberately **not** gated on the
[`priceSources`](/configuration/#price-stores-pricesources) config key (the same way `ritual sell`
is never gated): it needs only a cached feed.

`mode` discriminates the two price bodies — `"summary"` here, `"list"` on
[Price List](#price-list) — so a client that can receive either reads one field to know which it got.

`unpricedCount` counts copies whose price the data could not supply, and **only** those. Cards that
carry no price [by rule](/custom-art/#custom-art-carries-no-price) — a `proxy` label, custom art, or
both — are priced at `0` and counted in `cardCount` like any other card, but are deliberately left
out of `unpricedCount`: they are not a gap in the price data, and a client showing "2 unpriced" for
a deck of deliberate proxies would be reporting a problem that does not exist.

**Response:**

```json
{
  "success": true,
  "mode": "summary",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "lists": [
    {
      "type": "deck",
      "name": "my-deck",
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2
    }
  ],
  "typeTotals": [
    {
      "type": "deck",
      "listCount": 1,
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2
    }
  ],
  "totals": {
    "listCount": 1,
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2
  },
  "warnings": []
}
```

## Price List

```
GET /api/price/:type/:slug
```

Price a single list and return its summary plus every priced card entry (in file order) — the same payload as the CLI's single-list `price <name> --output json` view. `:type` is `deck`, `collection`, or `wanted`; `:slug` is the list's file basename, matching the load endpoints. Takes the same `currency` and `source` query parameters as the summary endpoint, with the same `503` when the card cache is empty (or when `source=cardkingdom` finds no cached feed). An unknown slug returns `404`.

**Response:**

```json
{
  "success": true,
  "mode": "list",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "list": {
    "type": "deck",
    "name": "my-deck",
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2
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

An entry that could not be priced also carries **`unpricedReason`**, absent on every priced card.
It is one of `no-printings`, `printing-not-found`, `currency-unavailable`,
`finish-unpriced-in-currency`, `no-price-data` — the data gaps, which `unpricedCount` counts — or
one of the two **by-rule** reasons, `proxy` and `custom-art`, which it does not (see
[Price Summary](#price-summary)). `custom-art` wins when a card is both. The by-rule entries still
carry their printing and their `set`/`collectorNumber`: a proxy is a proxy _of_ a card, and custom
art replaced the picture, not the card.

## Sell Report

:::note[The five sell routes are gated on the buyer feed being wanted]
`GET /api/sell/report`, `GET /api/sell/cart`, `POST /api/sell/refresh`, `GET /api/buylist/status`,
and `POST /api/buylist/quotes` answer **`404`** unless something wants the buyer feed:
[sell mode](/public-site/sell/) — [`site.sellMode`](/configuration/#offering-sell-mode-sellmode)
(off by default) or a server started with [`ritual admin --sell-mode`](/commands/admin/#sell-mode) —
**or** the `cardkingdom` entry of [`priceSources`](/configuration/#price-stores-pricesources), whose
retail prices ride on the same feed. The check reads the config per
request, so a `config set` — or a [`PUT /api/config`](/commands/admin/#put-apiconfig) from the
Settings page's **Offer sell mode** checkbox or **Price Stores** checkboxes — takes effect on the
very next request, without a restart, and
[`GET /api/status`](/commands/admin/#get-apistatus) reports the effective value so a client can hide
its sell surfaces instead of offering controls that only ever 404. The public site server
(`serve --api`) gates its two buylist routes the same way.

A server running under `--sell-mode` opens these routes without anything on disk saying so.
[`GET /api/config`](/commands/admin/#get-apiconfig) is where that shows up: alongside the stored
`config` it reports `overrides: {"site.sellMode": true}`, which is the only way to tell an instance
running with the flag from one whose config simply has the key unset.

The refusal body is the standard [error envelope](#error-responses) — `{"success": false, "message":
"Not found"}` — with no `messageKey`: it is a machine-facing refusal, so the text stays English.

This applies to the MCP tools that reuse these handlers — `get_sell_report`, `get_sell_cart`,
`get_buylist_quotes`, and `refresh_buylist` — see [`mcp`](/commands/mcp/#sell-tools-need-sell-mode).
:::

```
GET /api/sell/report
```

Match listed cards against the locally cached [Card Kingdom buylist](/commands/sell/) and report what CK is buying, the cash quote per Near Mint copy, and their quantity caps — the same payload as [`sell --output json`](/commands/sell/). Strictly cache-backed: the card cache **and** a downloaded feed are prerequisites (`503` otherwise, each naming its remedy), and this endpoint never downloads anything — that is [Sell Refresh](#sell-refresh)'s job.

Copies that are [priceless by rule](/custom-art/#custom-art-carries-no-price) — labeled `proxy`, wearing custom art, or both — are dropped **before** matching, so they are never quoted and never counted as cards the buyer declined. A proxy is not a card CK would take, and a copy wearing art of its own is not the printing a quote would be for. They are dropped rather than merged, so an otherwise-identical real copy in the same list keeps its own quote and its own quantity.

### Parameters

| Parameter | Description                                                                                     | Required |
| --------- | ----------------------------------------------------------------------------------------------- | -------- |
| `type`    | Match every `deck`, `collection`, or `wanted` list (default: every collection)                  | No       |
| `lists`   | Comma-separated `type:slug` refs to match exactly these lists (overrides `type`); unknown → 404 | No       |
| `sets`    | Comma-separated set codes to filter to                                                          | No       |
| `min`     | Minimum per-copy offer (USD)                                                                    | No       |

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

`status` is `buying`, `not-buying` (the product exists but CK's buy quantity is 0), or `no-match` (with `noMatchReason`: `no-printings`, `printing-not-found`, or `not-on-buylist`). `matchVia` names the join key that located the product (`scryfall-id`, `sku`, or `name`), `ambiguous` is set when several products matched (the quote is the best-paying one), and an entry with `pinned: false` (an unpinned deck/wanted line) is quoted at the best-paying printing, whose set/collector/`ckFinish` it reports. `sellableQuantity` draws from a per-product budget of CK's `qtyBuying` — entries sharing a product never sum past their cap — and `value` prices only those copies.

## Sell Cart

```
GET /api/sell/cart
```

The entries CK is buying, rendered as their [sell-cart CSV import format](/commands/sell/#sell-cart-csv-export) (`card name, edition, foil, quantity`, no header row — CK's own listing titles, variant note included, quantities capped at their buy limits), over the same `?type=`/`?lists=`/`?sets=`/`?min=` parameters and 503 prerequisites as [Sell Report](#sell-report). The capability behind the CLI's `sell --output csv`.

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

`warnings` flags CK's upload caps (500 unique titles / 5,000 cards) and etched foils the format cannot express (exported as foil).

## Sell Refresh

```
POST /api/sell/refresh
```

Download Card Kingdom's pricelist feed (~70 MB) when the cached copy is stale (older than a day) or missing; `?force=true` redownloads regardless. The one sell route that reaches the network.

**Response:**

```json
{
  "success": true,
  "refreshed": true,
  "feedRetrievedAt": 1785850800000,
  "feedCreatedAt": "2026-08-04 06:06:09",
  "productCount": 149978,
  "warnings": []
}
```

A failed download returns `502` only when no feed is cached at all; with a stale cache the call answers `200` with the stale feed's stamps, `refreshed: false`, and the failure in `warnings`. So `refreshed: false` with empty `warnings` means the cache was still fresh, and with a warning it means you are still on the stale feed.

## Buylist Quotes

```
POST /api/buylist/quotes
```

The buyer's current offer for specific printings, keyed by `set:collectorNumber:finish` (set
lowercased). Use this to price an arbitrary set of cards — a trade, a selection, whatever a page is
displaying — without building a whole [Sell Report](#sell-report). Strictly cache-backed, like every
sell read path: `503` with the remedy when no feed has been downloaded.

**Request:**

```json
{
  "buyer": "cardkingdom",
  "printings": [{ "set": "dsk", "collectorNumber": "136", "finish": "nonfoil", "scryfallId": "…" }]
}
```

`buyer` defaults to `cardkingdom` (the only buyer today). `scryfallId` is optional but is the
primary join key when the caller has it; `set`/`collectorNumber` always form the response key and
drive the sku fallback for the ~0.5% of Card Kingdom products with no Scryfall id. The optional
`language` is the entry's [language code](/configuration/#default-language) (absent means English):
the buyer feeds are English-only, so a non-`en` printing is never matched — its key is simply
absent from `quotes`, never quoted at the English product's price. At most 500 printings per
request.

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

`quotes` is **sparse**: a requested printing the buyer has no product for is simply absent.
`buying` is false when Card Kingdom publishes a price but has paused buying (`qtyBuying: 0`) —
that is not money you can get today, so treat it as no offer. Both cases read as "not on the
buylist", which is the rule the sites' **On buylist** chip and grouping use: roughly half of CK's
catalog is paused at any time, so a present quote is not by itself an offer.
`variation` is CK's variant note for the matched product, present only when they publish one; a
client rendering a [cart CSV](#sell-cart) row builds CK's listed title from `name (variation)`.
`priceRetail`/`qtyRetail` are the buyer's own NM retail price and stock — what the sites'
[Card Kingdom price view](/public-site/price-sources/) displays; a `qtyRetail` of `0` means out of
stock with the listed price standing, and a `priceRetail` of `0` means no published retail price.

This route is also mounted by the public site server (`ritual serve --api`), unauthenticated, and
answers `404` there too unless [sell mode](/public-site/sell/) is on or
[`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. The public **site** no longer
calls it — [sell mode](/public-site/sell/) reads buy prices baked into each list's data — so it is
there for other clients; the admin editors are the one client that still quotes live, since they
price cards as they are added. The public server deliberately has no refresh route: an
unauthenticated endpoint must never be able to trigger a ~70 MB download.

## Buylist Status

```
GET /api/buylist/status
```

Which buyers this server can quote against and how fresh the cached feed is, without quoting
anything. Backs the admin **Refresh Cache** page's buylist card.

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

`503` with the remedy when no feed has been downloaded — a normal first-run state, not an error.

## Save Deck

```
POST /api/deck/:slug/save
```

Save deck changes. Writes the updated deck file and appends to the changelog. Cross-list moves in `changes` write the other list too — a `move-from {to}` adds the copy to its destination, a `move-to {from}` (an incoming move) takes the copy out of its source (by the `sourceCardId` line when it still holds the card, else by printing, else by name for a printing-less source line); a `move-to` carrying `replacesCardId` pins one of this list's own name-only lines rather than adding a copy (equal to its `cardId`: the line is converted in place; otherwise one copy leaves that line and lands on `cardId`), and one carrying `replacement` (`{ set, collectorNumber, finish?, language? }`) adds that printing to the source list in place of the copy taken, logged there as an `Added` line — each with its own changelog entry, every one validated in memory before anything is written (a missing list, a source with no copy to take, or a printing-less card headed into a collection fails the save with nothing written). Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session.

`set-label` changes (and label-carrying `add`s and deck cards) are accepted here, validated against what a deck line can carry: `proxy` alone. Any other label — or an illegal combination — is a `400` and nothing is written.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "deck": { "name": "...", "sections": [] },
  "frontMatter": {},
  "contentHash": "…",
  "continueSession": false,
  "validateCardNames": false
}
```

### Unreadable lines block a save

All three save routes parse the file as it stands on disk before applying anything, and refuse with `400` when that parse yields any [`warnings`](#load-deck) — a line the parser cannot read, or a [fenced code block](/commands/edit/#fenced-code-blocks), is content the re-serializing write would delete along with any `&N` ids it held. The message names the file and each entry (each entry states its own extent, so no aggregate line count is claimed). Nothing is written. Fix the line, or remove the fenced block, and retry; `GET /api/{type}/:slug` reports the same list in its `warnings` field.

### Language validation

All three save routes validate every [language](/commands/edit/#card-language) a request carries — a `set-language` change **requires** its `language` field, an unknown code anywhere is a `400` naming the offender and listing the 17 valid Scryfall codes, and `en` on an entry folds to no token on the written line (a bare line always means English).

### `validateCardNames`

The three save routes and both [Move Selected Cards](#move-selected-cards) / [Remove Cards](#remove-cards) routes accept an optional boolean `validateCardNames`, default `false`. It is validated, never coerced: any non-boolean value is a `400`.

With it set, every card name the request mentions is checked against the local Scryfall card cache before anything is written:

- A name **already present in the affected list** is accepted with no lookup at all — the file is the authority on what is in it, which is what keeps a custom, proxied, or unreleased card removable and editable.
- Any other name must be one the cache knows. An unknown one is a `400` naming up to three of the closest cached spellings.
- An **empty** cache is also a `400`, with a message naming both remedies (the MCP `refresh_cache` tool, or `ritual cache preload-all`). This differs from [Price List](#price-list)'s `503` deliberately: `validateCardNames: true` is a precondition the _client_ asserted, so a request the server cannot satisfy as asked is a client error — whereas a cold cache blocks the price routes' whole purpose regardless of what the caller asked.

Off by default so the admin UI's behavior is unchanged: it only ever sends names it read from a list, and it cannot assume a warm cache. The MCP write tools set it on every request they build (the import tools excepted — their engines already report per-row failures).

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Deck",
  "contentHash": "…",
  "droppedNotes": [],
  "effects": [
    {
      "action": "added",
      "cardId": 7,
      "name": "Sol Ring",
      "section": "Main",
      "quantity": 1,
      "printing": { "set": "c21", "collectorNumber": "167" }
    }
  ]
}
```

### `effects`

All three save routes answer with an `effects` array describing what the save did to individual card
lines, and a `contentHash` for the next save. Each entry is
`{ action, cardId, name, section?, quantity, printing?, previousCardId? }`, where `action` is
`added`, `removed`, or `updated`.

`previousCardId` appears only on an `updated` effect whose line was **renumbered**: another entry in
the same save arrived claiming its `&N` (a cross-list move carrying its source id, a replayed change
bundle), so the serializer handed the older line a fresh number. Without it, a card the list has held
all along would be reported as newly `added`.

The response is the **only** place these ids can appear: a card's persistent `&N` id is allocated at
serialization time, inside the save, so a client that added a card cannot know the id its line got
until the response says so. That is what removes the follow-up load an MCP agent (or any API client)
would otherwise make just to learn one number. Set codes inside `printing` are lowercase, per the
project's data-payload convention.

A save also re-files the list's [custom-art](/custom-art/) sidecar as part of the same write, and it
reads the **changes** to do it, not the file it produced: a card the payload removes loses its art
even when the payload re-adds the same card and the new line takes the same `&N` back. A client that
wants art on a card it is adding therefore holds the reference until the save answers, then aims a
[Card Art](#card-art) write at the id the effects report (following `previousCardId` where a line was
renumbered) — the admin editors' [add-card dialog](/admin/editors/#card-options) does exactly this.

### `artWarnings`

When that re-filing could not happen — the list's own `.art.json` cannot be read, or neither can
that of a list this save's cross-list moves ([**Move to list…**](/admin/editors/#custom-art),
[**Swap Printings…**](/admin/editors/#swap-printings)) send cards to or take them from — and when a
moved copy's art has no destination line to follow onto, that too is reported here — the save still succeeds and reports the problem in an **`artWarnings`** array,
one message per sidecar it had to leave alone. The field is omitted
when everything re-filed cleanly, and it carries the same channel name the load routes use for
[sidecar problems](#load-deck), so a client reads one field on both.

It is a warning rather than a failure on purpose: the card lines were written correctly, and the
only casualty is that art may now sit under an `&N` the save freed or renumbered. The remedy is to
fix the sidecar by hand — the message names the file and the parse failure — and the art then
applies again, or comes off the list with the next art write.

## List Collections

```
GET /api/collections
```

Returns the list of available collections.

**Response:**

```json
{
  "success": true,
  "collections": ["my-collection", "trade-binder"]
}
```

## Load Collection

```
GET /api/collection/:slug
```

Load a collection with full card data, printings, and mana symbol map. Accepts the same [list load parameters](#list-load-parameters) as [Load Deck](#load-deck); the `cards` view returns `entries` + `sectionOrder` rather than a deck. The top-level `description` is the collection's front-matter blurb (absent when it declares none), and the top-level `labels` is its [default card labels](/commands/edit/#collection-front-matter) (absent when none are declared), and an entry's own `labels` is its per-card override — effective labels are the override when present, else the default.

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [
    { "name": "Sol Ring", "set": "2xm", "collectorNumber": "270", "labels": ["keep"], "cardId": 1 }
  ],
  "sectionOrder": ["Main"],
  "description": "Everything I will trade away.",
  "labels": ["sale", "trade"],
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "my-collection",
  "contentHash": "...",
  "warnings": []
}
```

## Save Collection

```
POST /api/collection/:slug/save
```

Save collection changes. Writes the updated collection file and creates a changelog entry. Cross-list moves in `changes` (`move-from {to}` / incoming `move-to {from}`) write the other list and its changelog too, pre-validated before anything is written — see [Save Deck](#save-deck). Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session. Every collection entry must carry a printing: an `add`, `move-to`, or `set-printing` change missing `set` or `collectorNumber` returns `400` and leaves the file untouched. A change whose target entry does not exist (matching is exact and case-sensitive on name, with `cardId` taking priority) also returns `400` naming the unapplied changes, and nothing is written — a save must never report success while dropping changes. The optional [`validateCardNames`](#validatecardnames) flag applies here too. `set-label` changes (and label-carrying `add`s) are accepted here — their `labels` are validated against the label vocabulary, the labels a collection carries, and the `keep`/`proxy` exclusivity rule (`400` on an illegal combination) and normalized to canonical order before the write; the file's front-matter block always rides through a save untouched.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "contentHash": "…",
  "sectionOrder": ["Main", "Trade Binder"],
  "continueSession": false
}
```

The handler re-parses the file and **replays the changes itself** — no entry list is sent. The
optional `sectionOrder` gives section display order (including empty sections); when omitted, the
file's parsed order is kept.

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection",
  "contentHash": "…",
  "droppedNotes": [],
  "effects": [{ "action": "removed", "cardId": 4, "name": "Lightning Bolt", "quantity": 1 }]
}
```

See [`effects`](#effects) for what the array reports and why it is the response's job.

## Create Collection

```
POST /api/collection/create
```

Create a new collection file, named as the collection is named — see
[List file names](/commands/new/#list-file-names).

**Request Body:**

```json
{
  "name": "My Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Created collection 'My Collection'",
  "slug": "My Collection"
}
```

## Rename Collection

```
POST /api/collection/:slug/rename
```

Rename a collection. Replaces the first `# <Title>` line in the file and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "Renamed Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed collection to 'Renamed Collection'",
  "newSlug": "Renamed Collection",
  "newFilePath": "collections/Renamed Collection.md",
  "oldFilePath": "collections/My Collection.md"
}
```

## Delete Collection

```
DELETE /api/collection/:slug
```

Delete a collection file (and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses)). Requires `confirmName` to match the parsed `# Title` exactly.

**Request Body:**

```json
{
  "confirmName": "My Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Deleted collection 'My Collection'",
  "deletedFiles": ["collections/My Collection.md", "collections/My Collection.md.sha256"]
}
```

## List Wanted Lists

```
GET /api/wanted
```

Returns the list of available wanted lists.

**Response:**

```json
{
  "wantedLists": [{ "slug": "high-priority", "name": "High Priority" }]
}
```

## Load Wanted List

```
GET /api/wanted/:slug
```

Load a wanted list with full card data, printings, and mana symbol map. Accepts the same [list load parameters](#list-load-parameters) as [Load Deck](#load-deck); the `cards` view returns `entries` + `sectionOrder` rather than a deck, plus the top-level `description` when the list declares one.

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [{ "name": "Sol Ring", "set": "2xm", "collectorNumber": "270", "cardId": 1 }],
  "sectionOrder": ["Main"],
  "description": "Cards I still need.",
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "high-priority",
  "contentHash": "...",
  "warnings": []
}
```

## Save Wanted List

```
POST /api/wanted/:slug/save
```

Save wanted list changes. Writes the updated wanted list file and appends to the changelog. Cross-list moves in `changes` (`move-from {to}` / incoming `move-to {from}`) write the other list and its changelog too, pre-validated before anything is written — see [Save Deck](#save-deck). Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session. The optional [`validateCardNames`](#validatecardnames) flag applies here too.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "entries": [{ "name": "Sol Ring", "set": "2xm", "collectorNumber": "270" }],
  "contentHash": "…",
  "continueSession": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to high-priority",
  "contentHash": "…",
  "droppedNotes": [],
  "effects": [{ "action": "added", "cardId": 9, "name": "Sol Ring", "quantity": 1 }]
}
```

See [`effects`](#effects) for what the array reports and why it is the response's job.

## Create Wanted List

```
POST /api/wanted/create
```

Create a new wanted list file, named as the wanted list is named — see
[List file names](/commands/new/#list-file-names).

**Request Body:**

```json
{
  "name": "Holiday Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Created wanted list 'Holiday Wishlist'",
  "slug": "Holiday Wishlist"
}
```

## Rename Wanted List

```
POST /api/wanted/:slug/rename
```

Rename a wanted list. Replaces the first `# <Title>` line in the file and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "Renamed Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed wanted list to 'Renamed Wishlist'",
  "newSlug": "Renamed Wishlist",
  "newFilePath": "wanted/Renamed Wishlist.md",
  "oldFilePath": "wanted/Holiday Wishlist.md"
}
```

## Delete Wanted List

```
DELETE /api/wanted/:slug
```

Delete a wanted list file (and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses)). Requires `confirmName` to match the parsed `# Title` exactly.

**Request Body:**

```json
{
  "confirmName": "Holiday Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Deleted wanted list 'Holiday Wishlist'",
  "deletedFiles": ["wanted/Holiday Wishlist.md", "wanted/Holiday Wishlist.md.sha256"]
}
```

## Card Index

```
GET /api/card-index?name=&listType=&slug=&set=
```

Returns every list (deck, collection, wanted) and every physical card across them, used by the [Move Cards](/admin/move-cards/) page and by any client that needs to find where a card physically lives. The lightweight `cards` payload carries no Scryfall data; each card's `key` is a path-free session identifier echoed back on commit. Deck entries with quantity > 1 expand to one card per copy (`copyIndex`).

**Query Parameters:** every filter is optional, and they intersect. A blank value is treated as absent, not as "match nothing".

| Parameter  | Description                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | Whitespace-separated name terms, matched as [autocomplete](#card-autocomplete) matches them: case-, accent-, and punctuation-insensitive, in any order (`in tre` finds "In the Trenches") |
| `listType` | `deck`, `collection`, or `wanted`; anything else is a `400`                                                                                                                               |
| `slug`     | Exact list slug (the file basename); a value with a path separator is a `400`                                                                                                             |
| `set`      | Set code, matched lowercase — `LEA` and `lea` both match a card stored as `lea`. A malformed code (anything but letters and digits) is a `400`                                            |

Only `cards` is filtered. `lists` is **always** the full roster, because clients render move destinations from it.

`warnings` is **always present** (possibly empty), so a client can tell "nothing went wrong" from "this server does not report warnings". It names each list file that could not be fully read — an unparseable card line, or a deck file that could not be read at all — so an empty result is never silently wrong. One bad file never fails the whole index; the other lists are still returned.

**Response:**

```json
{
  "success": true,
  "lists": [{ "type": "collection", "slug": "binder", "name": "Binder" }],
  "cards": [
    {
      "key": "collection:binder:1:0",
      "listType": "collection",
      "listSlug": "binder",
      "name": "Lightning Bolt",
      "set": "lea",
      "collectorNumber": "161",
      "finish": "nonfoil",
      "condition": "NM",
      "note": "signed",
      "cardId": 1,
      "copyIndex": 0
    }
  ],
  "warnings": ["decks/burn.md: could not be read or parsed; its cards are missing from the index."]
}
```

`set`, `collectorNumber`, `finish`, `condition`, `language`, and `note` are each present only when the card line carries them.

## Commit Moves

```
POST /api/move/commit
```

Apply a batch of queued moves atomically. The move state is rebuilt from disk and each move is applied via the shared move engine, writing the source/destination files and their changelogs. The optional printing fields override the destination printing (used when a printing-less card is moved into a collection); the optional `language` overrides the card's language on arrival (`en` clears the token — a bare line means English), and without it the card's existing language rides along. The optional `toSection` (deck destinations only — `400` otherwise) places the card in that deck section, matched by exact name and created when missing; without it the default section is used. Moves whose `cardKey` or destination can no longer be resolved are skipped and reported. When git auto-commit is enabled, the written files are committed in a single commit, the same as the editor save endpoints.

**Request Body:**

```json
{
  "moves": [
    {
      "cardKey": "collection:binder:1:0",
      "toType": "deck",
      "toSlug": "my-deck",
      "toSection": "Sideboard",
      "set": "2xm",
      "collectorNumber": "270",
      "finish": "nonfoil",
      "condition": "NM",
      "language": "ja"
    }
  ]
}
```

**Response:**

`droppedNotes` lists each note discarded by a deck quantity-merge (the card landed on an existing line whose single note slot already held a different value — the existing note wins).

```json
{
  "success": true,
  "moved": 1,
  "requested": 1,
  "skipped": 0,
  "droppedNotes": [{ "cardName": "Sol Ring", "cardId": 3, "note": "from trade" }],
  "warnings": [],
  "message": "Moved 1 card."
}
```

`warnings` is **always present** (possibly empty): it names each list file that could not be fully read while the card index this route resolves against was rebuilt, so a skipped move is never silently unexplained.

## Move Selected Cards

```
POST /api/move/selected
```

Move a batch of selected cards across lists atomically — backs the cross-list **Move all selected** multi-select action. Each item addresses its source card by list + identity (the same `cardId`/`copyIndex` scheme as [Remove Cards](#remove-cards)) and its destination by `toType` + `toSlug`. The optional printing fields, `language`, and `toSection` behave exactly as in [Commit Moves](#commit-moves). Cards or destinations that can no longer be resolved — or whose destination is the list they already live in — are skipped and reported. The optional [`validateCardNames`](#validatecardnames) flag applies here too.

**Request Body:**

```json
{
  "moves": [
    {
      "listType": "deck",
      "listSlug": "my-deck",
      "name": "Sol Ring",
      "cardId": 1,
      "copyIndex": 0,
      "toType": "collection",
      "toSlug": "binder",
      "set": "c21",
      "collectorNumber": "167"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "moved": 1,
  "requested": 1,
  "skipped": 0,
  "droppedNotes": [],
  "warnings": [],
  "message": "Moved 1 card."
}
```

`warnings` is **always present** (possibly empty): it names each list file that could not be fully read while the card index this route resolves against was rebuilt, so a skipped move is never silently unexplained.

## Remove Cards

```
POST /api/remove/commit
```

Remove a batch of cards across lists atomically — backs the cross-list **Remove all selected** multi-select action. The state is rebuilt from disk, each requested card is resolved to its physical key and marked for removal, and the source files and their changelogs are written in a single pass. Deck copies are addressed by `copyIndex` (one item per copy); collection and wanted entries use their `cardId` at `copyIndex` 0. Cards that can no longer be resolved are skipped and reported. The optional [`validateCardNames`](#validatecardnames) flag applies here too. When git auto-commit is enabled, the written files are committed in a single commit (`Remove N cards`).

**Request Body:**

```json
{
  "removes": [
    {
      "listType": "collection",
      "listSlug": "binder",
      "name": "Lightning Bolt",
      "cardId": 1,
      "copyIndex": 0
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "removed": 1,
  "requested": 1,
  "skipped": 0,
  "warnings": [],
  "message": "Removed 1 card."
}
```

`warnings` is **always present** (possibly empty): it names each list file that could not be fully read while the card index this route resolves against was rebuilt, so a skipped removal is never silently unexplained.

## List All Lists

```
GET /api/lists
```

Returns every list (deck, collection, wanted) as a slug-keyed summary. The single canonical enumeration endpoint — it populates the [Change History](/admin/history/) page's list picker and the cross-list move targets.

**Response:**

```json
{
  "success": true,
  "lists": [{ "type": "deck", "slug": "my-deck", "name": "My Deck" }]
}
```

## Diff Lists

```
GET /api/diff?a=<[type:]name>&b=<[type:]name>&by=<name|printing>
```

Compare two lists (any mix of deck, collection, and wanted list) and return the matched identities
with per-side quantities plus the entries only one side has. Exposed as the MCP `diff_lists` tool;
shares its engine with the [`diff`](/commands/diff/) CLI command — see that page for the identity
rules (nonfoil folding, the no-printing bucket, all sections included).

**Query Parameters:**

| Parameter | Description                                                                                          | Required |
| --------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `a`       | First list, resolved like CLI list arguments; a `deck:`/`collection:`/`wanted:` prefix pins the type | Yes      |
| `b`       | Second list, same form as `a`                                                                        | Yes      |
| `by`      | Identity to compare by: `name` (default) or `printing`                                               | No       |

A missing `a`/`b`, an invalid `by`, or a name that resolves to no list (or ambiguously) returns `400`.

**Response:**

```json
{
  "success": true,
  "a": { "listType": "deck", "slug": "burn", "name": "Burn" },
  "b": { "listType": "collection", "slug": "binder", "name": "Binder" },
  "by": "name",
  "matches": [
    {
      "name": "Lightning Bolt",
      "a": {
        "quantity": 2,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 2 }
        ]
      },
      "b": {
        "quantity": 1,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 1 }
        ]
      }
    }
  ],
  "onlyInA": [
    {
      "name": "Fireblast",
      "quantity": 1,
      "printings": [{ "set": "vis", "collectorNumber": "78", "finish": "foil", "quantity": 1 }]
    }
  ],
  "onlyInB": [],
  "warnings": []
}
```

`matches` includes identities whose quantities are equal on both sides — clients decide what counts
as interesting. `warnings` carries list parse warnings from either side.

## Load Change History

```
GET /api/history/:type/:slug
```

Returns the parsed change sets of a list's change log (newest first) plus the raw change lines a "rewrite with defaults" would produce. `:type` is `deck`, `collection`, or `wanted`. The list file is read only to derive `defaultLines`; a list with no change log yet returns an empty `sets` array. A set that is followed by hand-written non-change text carries it in a `trailing` array (absent otherwise) — the text is preserved through an edit-and-save round trip (each line kept as written, re-emitted after the set's change lines; blank lines between them are not kept).

**Response:**

```json
{
  "success": true,
  "header": "# Changelog for My Deck",
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"],
      "trailing": ["NOTE TO SELF: the FNM tuning session."]
    }
  ],
  "defaultLines": ["- Added \"Sol Ring\" (LEA:1) &1"]
}
```

## Save Change History

```
POST /api/history/:type/:slug/save
```

Overwrite the list's change log with the supplied change sets. Each set needs a valid ISO-8601 `timestamp` and a `lines` array of strings, each starting with `- `. A set may also carry a `trailing` array of preserved hand-written lines — these must **not** start with `- ` or `## ` (they would be re-parsed as change lines or set headers on the next load), and are written back verbatim after the set's change lines. Only the `.changes.md` file is written; the list's own `.md` is never touched, and the existing header is preserved. When git auto-commit is enabled, the change log is committed (`Rewrite change history for <slug>`).

**Request Body:**

```json
{
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"]
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 1 change set.",
  "setCount": 1
}
```

## List Metadata

```
PUT /api/metadata/:type/:slug
```

Write a list's YAML front matter. Decks take the deck vocabulary below; both decks and collections take `labels` (their [default card labels](/commands/edit/#card-labels)); **all three types** take `description` (the blurb the built site prints above the cards) and `image` (the list's [cover image](/list-images/)), which are the only two fields a wanted list accepts — a `labels` key on a wanted body is a `400` naming the field. Shares its engine with the [`metadata`](/commands/metadata/) CLI command (which covers all three types and does not write `image`) and with [`set-list-image`](/commands/set-list-image/) and the MCP `set_list_metadata` tool.

Only the fields present in the body are written; every other front-matter key (including user-authored ones) round-trips untouched. A field sent as `null` is deleted, as is a `description` sent as an empty string. The markdown body below the front matter is left byte for byte as it was — card lines are never re-serialized and no card IDs are assigned. **No changelog entry is written**: the change log is card-level, and metadata is not a card change.

**Request Body (deck):**

```json
{
  "description": "A ramp deck.",
  "tags": ["ramp", "budget"],
  "format": "commander",
  "image": { "card": 12 },
  "sourceId": "123456",
  "sourceUrl": "https://archidekt.com/decks/123456",
  "contentHash": "abc123..."
}
```

**Request Body (collection):**

```json
{
  "description": "Everything I will trade away.",
  "labels": ["sale", "trade"],
  "image": { "card": 12 },
  "contentHash": "abc123..."
}
```

**Request Body (wanted list):**

```json
{
  "description": "Cards I still need.",
  "image": { "url": "https://example.com/cover.jpg" },
  "contentHash": "abc123..."
}
```

| Field         | Validation                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | All three types. String (trimmed) or `null`; an empty (or blank) string clears it                                                                                                                                                         |
| `tags`        | Deck only. Array of non-empty strings (trimmed, deduplicated, order preserved); `null` or `[]` clears the key                                                                                                                             |
| `format`      | Deck only. A [deck format](/commands/new/#deck-format) name, canonicalized (`EDH` → `commander`); `null` clears it and the deck falls back to section inference                                                                           |
| `sourceId`    | Deck only. Non-empty string or `null`                                                                                                                                                                                                     |
| `sourceUrl`   | Deck only. An `http`/`https` URL or `null`                                                                                                                                                                                                |
| `labels`      | Deck and collection. Array of `sale`/`trade` (combinable) or `keep`/`proxy` (each alone), case-insensitive, normalized to canonical order — a **deck** accepts `proxy` alone; `null` or `[]` clears the default (removing an empty block) |
| `image`       | All three types. A single-key mapping — `{"card": N}`, `{"file": "rel/path"}` or `{"url": "https://…"}` — or `null` to clear it. Scalars are rejected: there is no string spelling of a cover. See below                                  |
| `contentHash` | Optional concurrency token from the list's load endpoint; a non-string value is a `400`                                                                                                                                                   |

`name` is rejected with a `400` pointing at [`POST /api/deck/:slug/rename`](#rename-deck), which also renames the file and its sidecars. `created` and `lastSynced` are stamped by Ritual (deck creation and [deck sync](/commands/deck-sync/) respectively) and are likewise rejected, as is any unknown field — a deck-only field on a collection (and vice versa) is an unknown field. A flat-list (collection or wanted) write refuses (`400`) when the file's existing front matter cannot be read as a YAML mapping, since merging over keys it cannot see would clobber them.

`image` is validated exactly as the front-matter grammar is (see [List cover images](/list-images/)), with one addition the route alone can make: a `{"card": N}` reference is checked against the very file being written, so an `&N` the list does not carry is a `400` naming the raw id and nothing is written. A `{"file": …}` path is checked for shape only — the image need not exist yet, and a missing one is a build-time warning — and a `{"url": …}` is never fetched. This is where that check lives for every client: the CLI, the MCP tool, and the admin editors all inherit it rather than re-implementing it.

Setting `sourceId` together with an `archidekt.com` `sourceUrl` is what makes a deck sync-linked, so these fields change which decks [`POST /api/deck-sync`](#sync-decks) operates on.

The two must name the **same** Archidekt deck once merged over what the file already carries — a
sync addresses the deck by `sourceId` while every surface shows `sourceUrl`, so a mismatched pair
would push one deck's cards into another. A request that produces one is a `400`
(`sourceUrl names Archidekt deck 999 but sourceId is 123. …`) and writes nothing. A `sourceUrl` on
another service is not constrained: its `sourceId` follows that service's own scheme.

When `contentHash` is supplied and no longer matches the file, the response is `409` with `"conflict": true` — the same optimistic-concurrency contract the editor save endpoints use. Omit it for a plain read-modify-write. Because the write updates the file's hash, an editor that had the deck open sees a conflict on its next save rather than silently clobbering the new metadata.

**Response:**

```json
{
  "success": true,
  "slug": "my-deck",
  "frontMatter": {
    "name": "My Deck",
    "format": "commander",
    "created": "2026-01-01T00:00:00.000Z",
    "description": "A ramp deck.",
    "tags": ["ramp", "budget"],
    "image": { "card": 12 }
  },
  "contentHash": "def456..."
}
```

An unknown deck is a `404`.

When git auto-commit is enabled, the deck file and its `.sha256` hash sidecar are committed with the message `Update metadata for deck <slug>`.

## Card Art

```
PUT /api/art/:type/:slug
```

Set or clear one card's [custom art](/custom-art/) on any list type. Like the metadata route this is a **direct** write: no change event, no changelog entry, and **no `contentHash` round trip** — card lines and the `<list>.art.json` sidecar are disjoint files, so the write is safe alongside an editor's pending card edits.

**Request Body:**

```json
{ "cardId": 5, "art": { "file": "proxies/sol-ring.jpg" } }
```

| Field    | Validation                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cardId` | Required. A card line's `&N` id (a positive integer) that the list actually holds                                                                                                                                                          |
| `art`    | Required. `{ "file": "<art-dir-relative path>" }` (ending in `.avif`/`.gif`/`.jpeg`/`.jpg`/`.png`/`.webp`), `{ "url": "<http(s) URL>" }`, or `null` to clear the card's art. Exactly one of `file`/`url`, and no other key, may be present |

Any other field is a `400` naming it — a typo must not look like a write that changed nothing.

A `cardId` the list does not hold yet — a card an editing session has added but not saved — is a `400`: write the card's line first, then aim this route at the id the save's [`effects`](#effects) report.

The reverse direction needs no route: the save endpoints and the move/remove routes re-file this sidecar themselves. A save or removal that drops a card drops its art (including a removal the same save re-adds the card after), a renumbered line takes its entry with it, and a cross-list move carries the entry to the destination list's sidecar under the new line's `&N` (a copy that merges onto a line the destination already had keeps that line's own art). The sidecars land in the same auto-commit as the list files they describe. See [Art follows the card](/custom-art/#art-follows-the-card).

**Response:**

```json
{
  "success": true,
  "slug": "my-deck",
  "cardId": 5,
  "art": { "file": "proxies/sol-ring.jpg" },
  "message": "Set custom art on 'my-deck'"
}
```

Refusals are `400` for a malformed body, a `cardId` the list does not hold, a reference that does not parse (a backslash, an absolute path, a `..` escape, a `file` whose extension is not one the art route serves, a non-`http(s)` URL), a `file` with no image behind it in the configured art directory (the message names the exact path that was checked), or an existing `.art.json` that cannot be read — the route refuses rather than overwrite it, since that would erase art for cards the request never mentioned. An unknown list is a `404`.

Clearing the last card's art removes the sidecar rather than writing `{}`. When git auto-commit is enabled the sidecar is committed with the message `Update custom art for <type> <slug>` — but only when a file was actually written or removed.

The images themselves are served read-only, behind the same login, at `GET /art/<relpath>` from the configured [`artDir`](/configuration/#directory-options), which is what lets the editor preview a local file. Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served — the same allowlist a `file` reference is validated against, so anything that parses is answerable; any path leaving the art directory is a `404`.

## Deck Sync Status

```
GET /api/deck-sync
```

Returns every Archidekt-linked deck that can be synced — those whose front matter has both an
Archidekt `sourceUrl` and a `sourceId` — plus the stored Archidekt login. Backs the
[Sync Decks](/admin/sync-decks/) page and the MCP `get_sync_status` tool.

**Response:**

```json
{
  "success": true,
  "decks": [
    {
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "sourceId": "12345",
      "sourceUrl": "https://archidekt.com/decks/12345",
      "lastSynced": "2026-07-20T12:00:00.000Z"
    }
  ],
  "archidekt": {
    "loggedIn": true,
    "username": "someuser",
    "accessTokenExpiration": "2026-07-24T18:00:00.000Z",
    "accessTokenValid": true,
    "refreshTokenExpiration": "2026-08-20T12:00:00.000Z",
    "refreshTokenValid": true,
    "loginRequired": false
  }
}
```

`lastSynced` is `null` for a deck that has never synced.

## Sync Decks

```
POST /api/deck-sync
```

Sync decks with Archidekt, using the same engine as the [`deck-sync`](/commands/deck-sync/) CLI
command. Exposed as the MCP `sync_decks` tool. Requires a stored Archidekt login; without one the
response is `401` with `loginRequired: true`.

**Request Body:**

```json
{
  "direction": "pull",
  "decks": ["Winota Stax"],
  "dryRun": false
}
```

| Field                   | Description                                                                                                                                                                                                                   | Required |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `direction`             | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value returns `400`.                                                                                                                                      | Yes      |
| `decks`                 | Deck slugs or names, resolved like CLI list arguments. Omitted or empty syncs every linked deck.                                                                                                                              | No       |
| `dryRun`                | Report what would sync without writing files or pushing changes (default `false`).                                                                                                                                            | No       |
| `ignoreUnreadableLines` | Sync decks whose files hold content a rewrite cannot reproduce — unreadable lines or a fenced code block — deleting it (default `false`).                                                                                     | No       |
| `only`                  | `additions` or `removals` — apply just one side of each deck's diff, relative to the sync destination (see [Change Filter](/commands/deck-sync/#change-filter)). Omitted applies every change; any other value returns `400`. | No       |
| `force`                 | Push a deck whose remote copy changed since its recorded sync, overwriting those remote changes (default `false`). Must be a boolean or `400`. A pull ignores it.                                                             | No       |
| `syncPrintings`         | Also sync each card's exact printing — set, collector number, and foil/etched finish (default `false`). Must be a boolean or `400`. See [Printing Sync](/commands/deck-sync/#printing-sync---sync-printings).                 | No       |

A `push` refuses any deck whose Archidekt `updatedAt` is newer than the `sourceUpdatedAt` its last
sync recorded — pushing would silently revert the remote edits. Such a deck is reported `failed`
with `Remote deck changed since last sync (…) — pull first, or pass --force to overwrite remote
changes.`, and the rest of the run continues. A `pull` of that deck records the new baseline (even
when it finds no card changes), after which the push succeeds; `force: true` overrides the guard
outright. See [Divergence Guard](/commands/deck-sync/#divergence-guard-push).

A sync rewrites each deck file, so a line the parser cannot read — or a
[fenced code block](/commands/edit/#fenced-code-blocks) — would be deleted by the save. There
is nobody to prompt over HTTP, so such decks **fail** (`N unreadable lines would be dropped by a
sync`) unless the request sets `ignoreUnreadableLines` — the API equivalent of the CLI's
[`--yes`](/commands/deck-sync/#unreadable-lines). The affected decks and their exact lines are
reported both in `report.unreadable` and, on the stream, as a `progress` frame with
`kind: "unreadable-lines"` emitted before the decision is applied. A `dryRun` request is exempt: it
writes nothing, so those decks are previewed rather than refused.

**Response:**

```json
{
  "success": true,
  "message": "Pulled 2 decks, 1 skipped.",
  "summary": {
    "clauses": [
      {
        "message": "Pulled 2 decks",
        "messageKey": "admin.api.deckSync.pulled",
        "messageParams": { "count": 2 }
      },
      {
        "message": "1 skipped",
        "messageKey": "admin.api.deckSync.skipped",
        "messageParams": { "count": 1 }
      }
    ]
  },
  "report": {
    "direction": "pull",
    "decks": [
      { "name": "Winota Stax", "status": "synced" },
      { "name": "Oops All Soldiers", "status": "synced", "reason": "no changes" },
      {
        "name": "Borrowed Deck",
        "status": "skipped",
        "reason": "you do not own Archidekt deck 12345"
      }
    ],
    "failedCount": 0,
    "unreadable": []
  }
}
```

`summary` is **required** on a completed run: the same sentence as `message`, split into ordered
keyed clauses so a client with a translator renders it in the reader's locale — with that locale's
plural categories and list separators — instead of re-parsing the English. Each clause is a
[message triple](#the-message-triple); clauses carry no final punctuation, since the renderer
supplies the terminator. `message` stays byte for byte what it always was.

`success` reports whether the run could be performed, **not** whether every deck synced — a run with
per-deck failures still returns `200` with `success: true` and a non-zero `report.failedCount`, so
callers can read each deck's `status` and `reason` (plus, when the request set `syncPrintings`,
its `printingsChanged` count — or, when it did not, the `printingsUnaligned` card names whose
printings the two sides disagree about). `report.unreadable` lists any deck whose file
holds lines the parser could not read (`{ name, file, warnings }`), so a caller that never sees the
stream can still show what a retry with `ignoreUnreadableLines` would delete. When git auto-commit is
enabled, deck files written by the run are committed (`Sync decks with Archidekt (<direction>)`).

## Deck Sync Stream

```
GET /api/deck-sync/stream?direction=pull&deck=<slug>&deck=<slug>&only=additions&dryRun=true
```

The same sync as `POST /api/deck-sync`, streamed as server-sent events. `EventSource` can only issue
a bodyless `GET`, so the request arrives as query parameters: `direction` is required, `deck` repeats
once per deck (omit entirely to sync all), `only` takes `additions` or `removals` (omit it to apply
every change), and `dryRun` / `ignoreUnreadableLines` / `force` / `syncPrintings` take `true` or
`false` (any other value is rejected, so a flag that decides whether files are written can never be
misread as "no").

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the deck being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message }` (`item` is `null` for run-level lines), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items: [{ name, file, warnings }] }`. |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](#the-message-triple), keyed `summary`, and report the JSON endpoint returns.                                                                                                                                                                 |
| `error`    | `{ message, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure).                                                                                                                                                                                                       |

Failures are reported inside the stream rather than as an HTTP status, since `EventSource` exposes no
response body for a non-2xx open.

## Collection Sync Status

```
GET /api/collection-sync
```

Returns every collection list a run can be scoped to, the stored Archidekt login, when the account
last synced, and the list a pull adds new cards to.

**Response:**

```json
{
  "success": true,
  "lists": [{ "slug": "binder", "name": "Blue Binder" }],
  "archidekt": {
    "loggedIn": true,
    "username": "someuser",
    "accessTokenExpiration": "2026-07-24T18:00:00.000Z",
    "accessTokenValid": true,
    "refreshTokenExpiration": "2026-08-20T12:00:00.000Z",
    "refreshTokenValid": true,
    "loginRequired": false
  },
  "lastSynced": "2026-07-26T12:00:00.000Z",
  "pullTarget": "Inbox",
  "csvThreshold": 25
}
```

`lastSynced` is account-level rather than per-list — an Archidekt account has one collection while
ritual has many collection lists — and is `null` until a run applies something for real. A dry run
records nothing, and neither does a run that stopped without writing (an ambiguous removal nothing
could place — see [Sync Collection](#sync-collection) below), so the stamp always means "the lists
and the account agreed at this time". `pullTarget` is the
[`collectionSync.pullTarget`](/configuration/#collection-sync) config
key, the list a pull adds new cards to unless the request names another. `csvThreshold` is how many
new printings a push adds one at a time before the [CSV import path](#csv-import-for-new-cards) takes
over — reported so a caller can explain (or decide) the `csv` field without restating the number.

## Sync Collection

```
POST /api/collection-sync
```

Sync the account's Archidekt collection with the local collection lists, using the same engine as the
[`collection-sync`](/commands/collection-sync/) CLI command. Requires a stored Archidekt login; without
one the response is `401` with `loginRequired: true`. A login that predates recording which account it
belongs to is refused the same way — a collection is fetched by numeric user id, so signing in again is
the fix.

**Request Body:**

```json
{
  "direction": "pull",
  "lists": ["Blue Binder"],
  "into": "Inbox",
  "removalPriority": ["Long Box", "Blue Binder"],
  "dryRun": false
}
```

| Field                   | Description                                                                                                                                                                                                                      | Required |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `direction`             | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value returns `400`.                                                                                                                                         | Yes      |
| `lists`                 | Collection list slugs or names, resolved like CLI list arguments. Omitted or empty compares the whole collection; the remote side is always the entire Archidekt collection.                                                     | No       |
| `into`                  | The list a pull adds new cards to, created if it does not exist. A name **two** lists answer to fails the run before anything is fetched or written. Omitted uses the `collectionSync.pullTarget` config key. A push ignores it. | No       |
| `only`                  | `additions` or `removals` — apply just one side of the diff, relative to the sync destination. Omitted applies every change; any other value returns `400`.                                                                      | No       |
| `removalPriority`       | Collection list names **in priority order** — the only lists an ambiguous removal may take copies from (see below). Must be an array of non-blank names or `400`. A push ignores it.                                             | No       |
| `csv`                   | Upload a push's **new cards** as one CSV import instead of adding them one at a time (see below). Must be a boolean or `400`. A pull ignores it.                                                                                 | No       |
| `dryRun`                | Report what would sync without writing files or touching Archidekt (default `false`).                                                                                                                                            | No       |
| `ignoreUnreadableLines` | Sync lists whose files contain lines the parser cannot read, dropping those lines (default `false`).                                                                                                                             | No       |

A `csvFile` field is **rejected** with `400`: writing a CSV to a path the caller names is a CLI
affordance ([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)),
not something this API does. Refused rather than ignored, so a caller mirroring the CLI's flags is
told rather than watching its additions be uploaded instead.

### CSV import for new cards

Creating a record for a printing Archidekt does not have costs a search plus a create, both
[paced](/commands/collection-sync/#rate-limiting), so a first push of a real collection
would take hundreds of requests. `csv: true` sends those additions through Archidekt's own collection
importer instead — one upload, with every row built from the local Scryfall cache — exactly as the
CLI's [`--csv`](/commands/collection-sync/#csv-import-for-new-cards) does, however few there are.

There is nobody to prompt over HTTP, so a push adding more new printings than `csvThreshold` without
`csv: true` **fails before writing anything to Archidekt**: the guidance lands in `report.errors`,
`report.csv` stays `null`, and no record is created, grown, or deleted. A `dryRun` never needs the
flag — over the threshold it reports the upload it would make and resolves nothing, which is what
keeps a first preview from being rate limited. Quantity changes and removals never ride the CSV
(removals use Archidekt's bulk-delete endpoint), and additions whose printing the local cache does
not hold cannot become rows: they are added one at a time and counted in `report.csv.uncached`.

The rows are keyed by the Scryfall ids the **local card cache** holds, and there is nobody here to ask
about it either, so a run taking this path treats cache freshness as
[`--refresh auto`](/commands/collection-sync/#cache-freshness): an empty or day-old cache is
redownloaded before the file is built, reported as a `log` event on the stream and in the run's
messages.

A pull removal is **ambiguous** when only _some_ of a printing's copies are going and those copies
live in several lists — nothing says which list the card physically left. (Taking every copy, or
copies held in a single list, never is.) There is nobody to prompt over HTTP, so `removalPriority` is
the caller's decision made up front: copies come only from the lists it names, walking them in the
order given. Names are matched exactly, never by the substring rule other list lookups use, and an
unknown name fails the run. Without a priority — or with one that cannot cover a removal — the run
**fails and writes nothing at all**: the reason lands in `report.errors`, `report.ambiguous` carries
each removal with its per-list copy counts, no list file is touched, and the account's `lastSynced`
is left alone. A `dryRun` request never fails on an ambiguity itself; it reports it instead. (An
unknown `removalPriority` name still fails a `dryRun` request — that is a bad argument rather than
an unresolved removal.)

A pull rewrites each list file and a push treats those files as the truth, so a line the parser cannot
read would be lost either way. There is nobody to prompt over HTTP, so such lists **fail** unless the
request sets `ignoreUnreadableLines` — the API equivalent of the CLI's `--yes`. The affected lists and
their exact lines are reported both in `report.unreadable` and, on the stream, as a `progress` frame
with `kind: "unreadable-lines"`. A `dryRun` request is exempt: it writes nothing, so those lists are
previewed rather than refused.

**Response:**

```json
{
  "success": true,
  "message": "Pulled +1 added, -0 removed into \"Inbox\".",
  "summary": {
    "clauses": [
      {
        "message": "Pulled +1 added, -0 removed into \"Inbox\"",
        "messageKey": "admin.api.collectionSync.pulled",
        "messageParams": { "added": 1, "removed": 0, "into": "Inbox" }
      }
    ]
  },
  "report": {
    "direction": "pull",
    "into": "Inbox",
    "dryRun": false,
    "lists": [{ "name": "binder", "status": "synced", "added": 1, "removed": 0, "pending": 0 }],
    "failedCount": 0,
    "errors": [],
    "unreadable": [],
    "ambiguous": [],
    "localIncomplete": false,
    "csv": null,
    "totals": { "added": 1, "removed": 0, "skipped": 0, "pending": 0 }
  }
}
```

`summary` is **required**, and works exactly as it does for [Sync Decks](#sync-decks): the same
sentence as `message` split into keyed clauses for a client that renders it in the reader's locale.

`success` reports whether the run could be performed, **not** whether every list synced — a run with
per-list failures still returns `200` with `success: true` and a non-zero `report.failedCount`.
`report.errors` carries failures that belong to the run rather than to one list (the collection fetch,
or deleting records for cards no list holds any more), and `report.ambiguous` every removal a pull
could not place on its own — reported whether a `removalPriority` placed them or the run failed on
them. Counts are in copies, not lists, since one card can live in several.

`report.localIncomplete` is `true` when a list in scope did not make it into the comparison — an
unresolvable name, a file that could not be read, or one held back for unreadable lines. The local
side is then short of cards it really holds, so the run withholds exactly the changes that shortfall
would manufacture: a pull adds nothing (those cards would be duplicated into the target list) and a
push removes nothing (they would be deleted from Archidekt). Fix or accept the listed lists and run
again. When git auto-commit is enabled, list files written by the run are
committed (`Sync collection with Archidekt (<direction>)`).

`report.csv` describes what the [CSV import](#csv-import-for-new-cards) did with a push's new cards,
and is `null` on any run that did not take that path (every pull, a push that added nothing new, and
one refused for lacking `csv: true`). Every shape carries `cards` (copies), `rows` (one per printing),
and `uncached` (additions the cache could not resolve, added one at a time instead), plus:

| `status`   | Extra fields                                | Meaning                                                        |
| ---------- | ------------------------------------------- | -------------------------------------------------------------- |
| `uploaded` | `chunks`, `failures[]`, `unconfirmedChunks` | Imported; `failures` names the rows Archidekt refused          |
| `planned`  | `destination` (`upload`)                    | What a `dryRun` would have done — nothing was sent             |
| `failed`   | `message`                                   | The whole import failed; the rest of the run still applied     |
| `empty`    | —                                           | No row could be keyed at all: `uncached` covers every new card |

`unconfirmedChunks` counts chunk responses Ritual could not read: their rows are counted as imported
because nothing said otherwise, so a non-zero value means part of that outcome is assumed rather than
confirmed (the run log carries what Archidekt replied).

Each entry of `failures` is `{ row, card, ambiguous, notFound, errors }` — the 0-based row of the
uploaded CSV, the card it carried, and why it was dropped. The lists holding those cards are reported
as failed. (`exported` — the CLI's `--csv-file` outcome — cannot occur here, since the request parser
refuses `csvFile`. `report.totals.pending` therefore stays `0` on this surface.)

## Collection Sync Stream

```
GET /api/collection-sync/stream?direction=pull&list=<slug>&into=Inbox&only=additions&removalPriority=<slug>&csv=true&dryRun=true
```

The same sync as `POST /api/collection-sync`, streamed as server-sent events. `EventSource` can only
issue a bodyless `GET`, so the request arrives as query parameters: `direction` is required, `list`
repeats once per list (omit entirely to sync the whole collection), `removalPriority` repeats once
per list **in priority order** (the order of the parameters is the priority; a blank one is
rejected), `only` and `into` are omitted (or
empty) to accept their defaults, and `csv` / `dryRun` / `ignoreUnreadableLines` take `true` or
`false` (any other value is rejected, so a flag that decides whether files are written — or how a
large batch of cards reaches Archidekt — can never be misread as "no"). A `csvFile` parameter is
rejected here too.

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the collection list being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message }` (`item` is `null` for run-level lines), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items }`. |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](#the-message-triple), keyed `summary`, and report the JSON endpoint returns.                                                                                                                                                |
| `error`    | `{ message, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure).                                                                                                                                                                                      |

Failures are reported inside the stream rather than as an HTTP status, since `EventSource` exposes no
response body for a non-2xx open.

## Import CSV

```
POST /api/import-csv
```

Import cards from CSV text into a deck, collection, or wanted list. Used by the admin site's **Import CSV** page and exposed as the MCP `import_csv` tool; shares its parsing, normalization, and column-mapping engine with the [`import`](/commands/import/#csv-imports) CLI command's CSV mode.

**Request Body:**

```json
{
  "listType": "collection",
  "name": "Red Binder",
  "mode": "append",
  "content": "Name,Set,Collector Number,Quantity\nSol Ring,C19,221,2",
  "columns": "name=1,set=2,collector-number=3,quantity=4",
  "hasHeader": true
}
```

| Field       | Description                                                                      | Required |
| ----------- | -------------------------------------------------------------------------------- | -------- |
| `listType`  | `deck`, `collection`, or `wanted`                                                | Yes      |
| `name`      | New list name (`create`/`overwrite`) or an existing list to append to (`append`) | Yes      |
| `mode`      | `create` (default — fails if the list exists), `overwrite`, or `append`          | No       |
| `format`    | Deck format; required when creating or overwriting a deck                        | No       |
| `content`   | Raw CSV text                                                                     | Yes      |
| `columns`   | 1-based column mapping spec, e.g. `name=1,set=2,collector-number=3`              | Yes      |
| `hasHeader` | Whether the first row is a header row (default `true`)                           | No       |

`format`, when given, must be one of the canonical deck format keys — see
[Deck Format](/commands/new/#deck-format). An unrecognized value returns `400`.

**Response:**

```json
{
  "success": true,
  "message": "Appended 2 card(s) to collection 'Red Binder'",
  "cardCount": 2,
  "failures": [
    {
      "lineNumber": 3,
      "raw": "No Printing,,",
      "reason": "Missing set code (required for collections)"
    }
  ],
  "failedCount": 1,
  "warnings": ["Skipped header row: Name,Set,Collector Number,Quantity"]
}
```

In a **deck**, rows naming the same card **and** the same printing merge into one line with their quantities summed, whether the list is created, overwritten, or appended to — the same file always produces the same list. **Collections and wanted lists** keep one line per physical copy in every mode, so N rows of the same printing stay N lines.

`warnings` reports what `hasHeader` caused, since there is no wizard here to ask: the row that was skipped as a header, plus a second entry when that row does not look like one (`… — set hasHeader to false to import it as a card.`). It is empty when `hasHeader` is `false`.

`cardCount`, `failures`, `failedCount`, and `warnings` are **always** present. Rows that fail validation are returned in `failures` while the valid rows still import, and `success` is a pure envelope flag: a request where _every_ row failed is still a `200` carrying `cardCount: 0` and the per-row report, since the report is the whole point of the call. The response is `400` only when the **request** is invalid (bad body shape, unknown `listType`/`format`, an unparseable column spec, a mapped column number the file has no column for (`Column 99 (mapped to 'name') does not exist: the file has 6 column(s)`), an unparseable CSV, no data rows, or an append to a list that does not exist). Appends record each added card in the list's changelog. When git auto-commit is enabled, the list file (and changelog) are committed.

## Import Changes

```
POST /api/import-changes
```

Apply a change bundle exported from the site editor to the underlying lists. Used by the admin site's **Import Changes** page and exposed as the MCP `import_change_bundle` tool; shares its apply engine with the [`import-changes`](/commands/import-changes/) CLI command.

**Request Body:** the exported JSON, verbatim — a version-2 `ritual-change-bundle` covering one or more lists. Each list's own edits sit in `lists[].changes`; cross-list moves are normalized into the top-level `moves` array (one entry per copy, naming its source and destination list by kind + name, with the slug as a best-effort hint; a move may also carry `toCardId`, the destination line's `&N` as the exporting editor allocated it, which the import re-targets like an `add`'s id) and never appear as `move-from`/`move-to` inside a list's `changes`:

```json
{
  "format": "ritual-change-bundle",
  "version": 2,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "lists": [
    {
      "kind": "deck",
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "changes": [{ "id": "a1", "timestamp": 1, "action": "add", "cardName": "Counterspell" }]
    }
  ],
  "moves": [
    {
      "id": "m1",
      "timestamp": 2,
      "cardName": "Sol Ring",
      "from": { "kind": "deck", "slug": "Winota Stax", "name": "Winota Stax" },
      "to": { "kind": "collection", "slug": "binder", "name": "Binder" },
      "set": "c19",
      "collectorNumber": "221",
      "cardId": 5,
      "toCardId": 9
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Applied 2 changes across 2 lists",
  "failedCount": 0,
  "lists": [
    {
      "kind": "deck",
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "applied": 1,
      "conflicts": []
    },
    {
      "kind": "collection",
      "slug": "binder",
      "name": "Binder",
      "applied": 1,
      "conflicts": []
    }
  ]
}
```

Every list's changes and every move are merged into one timestamp-ordered stream and applied in batches (consecutive events aimed at the same list); each batch loads its list fresh immediately before saving it. Changes are re-targeted to the list's current card IDs (by ID when it still exists, otherwise by card name — a copy the same import just added first). Changes whose target card no longer exists — or whose action cannot apply to that list, such as a commander change aimed at a collection, or which would set a foil/etched finish on a card that pins no printing — are skipped and reported in that list's `conflicts` (`{ change, reason }`, where `reason` is `"target-not-found"`, `"not-applicable"`, or `"needs-printing"`). Each entry of `moves` is applied on its **destination** list as a `move-to`: that save adds the copy there, takes it out of the source list (by the source line id the move names, else by the exact printing, else by name for a printing-less source line), and writes both changelogs. A destination named only by a move is resolved by its slug, then by its name, and reported as a list of its own (`slug` is the file basename it resolved to). `lists[].applied` counts moves arriving in the list (a replacement printing written back to a move's source list is not counted — it rides on the destination's move). A list that fails to resolve, load, or save carries an `error` string — the failing batch applied nothing, that list's later batches are skipped, batches already applied stay applied and counted — without stopping the other lists, and is counted in `failedCount`. `success` stays `true` on a partial import — the request was processed, and the per-list report is what says which lists failed. Read `failedCount` (and each list's `error`), not the envelope. Every list that received changes gets a changelog entry — the same save path as the editors. The response is `400` when the body is not a valid change bundle.

## Export Cards

```
POST /api/export
```

Render a CSV, JSON, plain-text, or Markdown export of cards from decks, collections, and wanted lists. Exposed as the MCP `export_cards` tool; shares its engine with the [`export`](/commands/export/) CLI command. By default the rendered export is returned inline as a string; with `write: true` it is written to a server-named file instead.

**Request Body:** every field is optional. With no `lists` and no `cards`, every list is exported.

```json
{
  "lists": [{ "type": "deck", "name": "Winota Stax" }],
  "cards": ["sol ring"],
  "filters": {
    "name": "sol",
    "set": "c21",
    "finish": "foil",
    "conditions": ["NM", "none"],
    "labels": ["trade"]
  },
  "format": "csv",
  "columns": ["name", "set", "collectorNumber", "quantity"],
  "header": true,
  "quoteAll": false,
  "dialect": "ritual",
  "preset": "trade-sheet",
  "write": false
}
```

`lists` names resolve like CLI list arguments (the optional `type` pins an ambiguous name). Each `cards` entry is whitespace-separated name terms; every entry across all lists whose name matches all terms is added (deduplicated against the selected lists). `filters.conditions` takes condition grades and/or `none` (cards with no condition marked), matching the CLI's `--condition` semantics; `filters.labels` takes label values (`sale`, `trade`, `keep`, `proxy`) and/or `none` (unlabeled), matched against each deck and collection card's effective labels like the CLI's `--labels` (wanted entries carry no labels and never match). `preset` starts from a saved or built-in [export preset](/commands/export/#presets) — the built-in `archidekt` preset needs no config, and a saved preset of that name shadows it; the explicit fields override the preset's values.

`format` is one of `csv` (default), `json`, `text` (one flat merged decklist, quantities aggregated), or `md` (canonical list markdown without `&N` ids) — see [export formats](/commands/export/#formats). `columns`, `header`, `quoteAll`, and `dialect` shape `csv`/`json` output only and are ignored for `text`/`md` (unlike the CLI, the route does not reject the combination). `dialect` is the value vocabulary for finish and condition: `ritual` (the default — `nonfoil`/`foil`/`etched`, `NM`…`DMG`) or `archidekt` (`Normal`/`Foil`/`Etched` under a `Variant` header, and `NM|LP|MP|HP|D`) — see [dialects](/commands/export/#dialects). An unknown `dialect` or `preset` is a `400`. A selected `scryfallId` column is resolved from the local Scryfall cache.

**Response:** the body is discriminated by `mode`.

Content mode (the default, or `write: false`):

```json
{
  "success": true,
  "mode": "content",
  "format": "csv",
  "entryCount": 2,
  "warnings": [],
  "content": "Name,Set,Collector Number,Quantity\nSol Ring,C21,263,1\n..."
}
```

File mode (`write: true`):

```json
{
  "success": true,
  "mode": "file",
  "format": "csv",
  "entryCount": 2,
  "warnings": [],
  "path": "exports/Binder-20260728.csv",
  "bytes": 214
}
```

`write` must be a boolean; anything else is a `400`.

The file lands under an `exports/` directory in the base dir, which [`init-site`](/commands/init-site/) adds to `.gitignore`. The server picks the name — `<scope>-<YYYYMMDD>.<ext>`, where scope is the single selected list's sanitized name, `cards` for a card-pick-only export, or `all-lists` otherwise, and the date is UTC. A name already taken gains the lowest free `-2`, `-3`, … suffix, so a write never overwrites an earlier export. `path` is **base-dir-relative** by design: a relative path cannot be walked outside the workspace by a caller that trusts it. The written file is newline-terminated, byte-identical to what the CLI's `export --out` writes.

`warnings` carries list parse warnings, `cards` terms that matched nothing, and — when the `scryfallId` column is selected — one entry per printing the local Scryfall cache does not hold (that cell renders empty). The response is `400` for an unknown list, preset, column, dialect, or filter value.
