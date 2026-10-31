---
title: 'Admin API: Cards and Moves'
description: Admin API routes to look up cards, printings and prices, search the card cache, and move or remove cards across lists.
sidebar:
  label: 'Cards and moves'
  order: 3
---

Routes that look cards up (names, printings, prices, details, search, and which lists hold a card) and that move or remove cards across lists. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## Card Autocomplete

```
GET /api/autocomplete?q=<query>
```

Search card names in the in-memory card cache. The query is split on whitespace and **every term must appear in the name**, in any order — the same matching the CLI prompts use, so `in tre` finds "In the Trenches". Matching ignores case, accents, and punctuation (`jotun` matches `Jötun Grunt`; `jaces archivist` matches `Jace's Archivist`).

Returns up to 20 results, ranked by how directly each name answers the query:

1. A name the query spells out in full (the front face of a double-faced card counts as its whole name).
2. Names the query prefixes (`sol ri` → "Sol Ring").
3. Names whose words the terms begin, in order, then in any order.
4. Names matched mid-word (`in tre` → "Kin-Tree Warden").

Equally ranked names are alphabetical.

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

## Card Printings

```
GET /api/card-printings?name=<cardName>&limit=<n>
```

Get the printings of a card, newest first, from the card cache with a fallback to the Scryfall API.

**Query Parameters:**

| Parameter | Description                                                          | Required |
| --------- | -------------------------------------------------------------------- | -------- |
| `name`    | Exact card name                                                      | Yes      |
| `limit`   | Max printings returned. A positive integer; anything else is a `400` | No       |

Omitting `limit` returns every printing. `limit` and `totalPrintings` count **distinct printings** (set + collector number). With an `all_cards`-backed cache (a non-English [`defaultLanguage`](/configuration/#default-language)) a printing can hold several card objects, one per language, each carrying its `lang`; every language object of an included printing is returned. When `limit` truncates the list, `totalPrintings` reports how many distinct printings there were.

There is no `includePrices` parameter; each client drops the price block itself if it does not need it.

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

`languages` lists every language the card's full printing list exists in (before any `limit` truncation), `en` first, folding an absent `lang` to `en` — `["en"]` for any `default_cards`-backed lookup.

`complete` is `false` when the card cache holds no printing list for the name and the response came from the single-card Scryfall fallback. The one printing returned is whatever that lookup found, **not** the card's only printing, so do not present the list as exhaustive. Run [`ritual cache preload-all`](/commands/cache/) to get a real one.

A refusal keeps the shape — `success: false`, `printings: []` — plus the [message triple](/admin/api/#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry. A missing `name` is `admin.api.field.required` and a malformed `limit` `admin.api.field.notPositiveInteger` (see [Error responses](/admin/api/#error-responses)); so is a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](/admin/api/#error-responses)'s do.

## Card Price

```
GET /api/card-price?name=<cardName>
```

Get price data for a card, including representative and cheapest printings for all currencies. Cached data older than 24 hours is refreshed from Scryfall. A card name with no printings returns `404` (`admin.api.card.noPrintings`, with the `name` sent); a missing `name` is a `400` (`admin.api.field.required`).

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

A failure answers `success: false`, `printings: []` and the four printing fields (`representative`, `lowestPriceCard`, `lowestPriceCardEur`, `lowestPriceCardTix`) `null`, plus the [message triple](/admin/api/#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](/admin/api/#error-responses)'s do.

## Card Details

```
GET /api/card-details?name=<cardName>
```

Everything Ritual knows about one card: oracle text, type line, mana cost and CMC, colors and color identity, keyword abilities, format legalities, and Scryfall Tagger oracle/art tags. The local card cache is read first, with a single-card Scryfall fetch when the cache holds no printings for the name.

Oracle fields are the same on every printing, so the response describes _the card_; the identity fields (`set`, `collectorNumber`, `prices`) come from its **most recent** printing and `printingCount` reports how many printings were found. `printingsComplete` is `false` when that count came from the single-card fallback rather than the cache; `printingCount` is then always `1` and says nothing about the card. Set codes are lowercase.

`colors`, `keywords`, and `legalities` are only present on cards written by a cache from this version onward; run [`ritual cache preload-all`](/commands/cache/) to backfill them.

**Query Parameters:**

| Parameter | Description     | Required |
| --------- | --------------- | -------- |
| `name`    | Exact card name | Yes      |

A name that matches nothing returns `404` with a message pointing at [`/api/autocomplete`](#card-autocomplete), keyed `admin.api.card.unknownName`: `name` is the name sent, and `route` (`/api/autocomplete`) and `tool` (`autocomplete_card`, the MCP tool) are identifiers that stay as they are in any language. A missing or blank `name` is a `400` (`admin.api.field.required`). Every error response keeps the success shape — `success: false` and `card: null` — plus the [message triple](/admin/api/#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](/admin/api/#error-responses)'s do.

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

Run a raw [Scryfall search query](https://scryfall.com/docs/syntax) and return one page of card summaries, most popular first — the same lookup as the [`scry`](/commands/scry/) CLI command.

One page is fetched per request. Walk further pages by incrementing `page` while `hasMore` is `true`.

### Plain read vs `warm=true`

By default the route returns Scryfall's page **verbatim** and touches no cache: tokens, Arena-only printings, and Art Series cards are _not_ filtered out, the order is Scryfall's own, and a page carries up to 175 cards.

With `warm=true` it instead:

- filters the page to **real printings** and maps them to the cache's card shape;
- writes each result into the local card cache under any name the cache does not already hold, leaving an already-cached name untouched (a warm-up, not a refresh);
- promotes a card whose **whole name** the query spells out ahead of Scryfall's popularity order;
- caps the result at **20** cards unless `limit` says otherwise.

The response's `warmed` field says which contract ran. The **error** contract below is the same in both modes.

**Query Parameters:**

| Parameter | Description                                                                                    | Required |
| --------- | ---------------------------------------------------------------------------------------------- | -------- |
| `q`       | Scryfall search query                                                                          | Yes      |
| `page`    | 1-based page number (defaults to `1`)                                                          | No       |
| `limit`   | Max cards returned, at most `175`. Defaults to `20` when `warm=true`, otherwise the whole page | No       |
| `warm`    | `true` or `false` (default). Any other value is a `400` — it is validated, never coerced       | No       |

A missing or blank `q` is a `400`; `q` is trimmed before it is sent on. `page` and `limit` may be omitted or left blank; any other value that is not a positive integer is a `400`.

Error handling:

- A Scryfall `404` (no matches) is a `200` with an empty `cards` array.
- A query Scryfall itself refuses (a syntax error, an unknown filter) is a `400` whose `message` carries Scryfall's explanation.
- A failure on Scryfall's side (a `5xx`, a network error) is a `500` — in `warm=true` mode too, never an empty `200`.

Every error response keeps the success shape — `success: false`, the requested `page`, `hasMore: false`, an empty `cards` array — plus the [message triple](/admin/api/#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](/admin/api/#error-responses)'s do. The query's own refusals are keyed too: a missing `q` (`admin.api.field.required`), a `page` or `limit` that is not a positive integer (`admin.api.field.notPositiveInteger`), a `limit` past one Scryfall page (`admin.api.cardSearch.limitTooLarge`, with `max` and the `value` sent) and an invalid `warm` (`errors.enum.invalid`). A Scryfall refusal is Scryfall's own text and has no key.

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

## Card Index

```
GET /api/card-index?name=&listType=&slug=&set=
```

Returns every list (deck, collection, wanted) and every physical card across them. Used by the [Move Cards](/admin/move-cards/) page and by any client that needs to find where a card physically lives. The lightweight `cards` payload carries no Scryfall data; each card's `key` is a path-free session identifier echoed back on commit. Deck entries with quantity > 1 expand to one card per copy (`copyIndex`).

**Query Parameters:** every filter is optional, and they intersect. A blank value is treated as absent, not as "match nothing".

| Parameter  | Description                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | Whitespace-separated name terms, matched as [autocomplete](#card-autocomplete) matches them: case-, accent-, and punctuation-insensitive, in any order (`in tre` finds "In the Trenches") |
| `listType` | `deck`, `collection`, or `wanted`; anything else is a `400`                                                                                                                               |
| `slug`     | Exact list slug (the file basename); a value with a path separator is a `400`                                                                                                             |
| `set`      | Set code, matched lowercase (`LEA` and `lea` both match a card stored as `lea`). A malformed code (anything but letters and digits) is a `400`                                            |

Only `cards` is filtered. `lists` is **always** the full roster, because clients render move destinations from it.

`warnings` is **always present** (possibly empty). It names each list file that could not be fully read — an unparseable card line, or a deck file that could not be read at all — so an empty result is never silently wrong. One bad file never fails the whole index; the other lists are still returned.

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

Apply a batch of queued moves atomically. The move state is rebuilt from disk and each move is applied through the shared move engine, writing the source/destination files and their changelogs. Moves whose `cardKey` or destination can no longer be resolved are skipped and reported. When git auto-commit is enabled, the written files are committed in a single commit, as the editor save routes do.

Optional fields per move:

- Printing fields (`set`, `collectorNumber`, `finish`, `condition`) override the destination printing, for a printing-less card moved into a collection.
- `language` overrides the card's language on arrival (`en` clears the token; a bare line means English). Without it the card's existing language is kept.
- `toSection` (deck destinations only; `400` otherwise) places the card in that deck section, matched by exact name and created when missing. Without it the default section is used.

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

- `droppedNotes` lists each note discarded by a deck quantity-merge: the card landed on an existing line whose single note slot already held a different value, and the existing note wins.
- `warnings` is **always present** (possibly empty). It names each list file that could not be fully read while the card index was rebuilt, so a skipped move is never unexplained.
- Categories never follow a moved card (a category belongs to a card **name in one list**), so the move engine prunes each list it writes down to the names that list still holds. When it dropped any, the response carries `prunedCategories` (omitted otherwise), with the same meaning as on the save routes; `<list>.categories.json` and its `.sha256` join the auto-commit. A list holding a card line the parser could not read is skipped entirely, keeping every entry.

## Move Selected Cards

```
POST /api/move/selected
```

Move a batch of selected cards across lists atomically — backs the cross-list **Move all selected** action. Each item addresses its source card by list + identity (the same `cardId`/`copyIndex` scheme as [Remove Cards](#remove-cards)) and its destination by `toType` + `toSlug`. The optional printing fields, `language`, and `toSection` behave exactly as in [Commit Moves](#commit-moves). Cards or destinations that can no longer be resolved, or whose destination is the list they already live in, are skipped and reported. The optional [`validateCardNames`](/admin/api/lists/#validatecardnames) flag applies here too.

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

`warnings` is **always present** (possibly empty) and works as on [Commit Moves](#commit-moves). As there, the written lists' categories sidecars are pruned to the names they still hold and `prunedCategories` is returned when anything was dropped.

## Remove Cards

```
POST /api/remove/commit
```

Remove a batch of cards across lists atomically — backs the cross-list **Remove all selected** action. The state is rebuilt from disk, each requested card is resolved to its physical key, and the source files and their changelogs are written in a single pass. Deck copies are addressed by `copyIndex` (one item per copy); collection and wanted entries use their `cardId` at `copyIndex` 0. Cards that can no longer be resolved are skipped and reported. The optional [`validateCardNames`](/admin/api/lists/#validatecardnames) flag applies here too. When git auto-commit is enabled, the written files are committed in a single commit (`Remove N cards`).

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

`warnings` is **always present** (possibly empty) and works as on [Commit Moves](#commit-moves). A removal that takes a list's last copy of a card name also drops that name's categories entry; the dropped names come back as `prunedCategories` when there were any.
