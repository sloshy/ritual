---
title: 'Admin API Endpoints'
---

The admin site exposes these API endpoints for deck and collection editing. All endpoints require authentication.

For general admin API endpoints (authentication, config, audit log, etc.), see the [admin command reference](/commands/admin/#http-api-reference).

## Create Deck

```
POST /api/deck/create
```

Create a new deck file. The slug is auto-generated from the name.

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
[Deck Format](/commands/new-deck/#deck-format) for the full list. An unrecognized value
returns `400` and the deck is not created.

**Response:**

```json
{
  "success": true,
  "message": "Created deck 'My Commander Deck'",
  "slug": "My Commander Deck"
}
```

## Rename Deck

```
POST /api/deck/:slug/rename
```

Rename a deck. Updates the frontmatter `name` field and renames the file to match the new slug. Also renames any associated changelog and primer files.

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
  "newSlug": "New Deck Name"
}
```

## Delete Deck

```
DELETE /api/deck/:slug
```

Delete a deck. Requires the full deck name to be provided as confirmation. Removes the deck file along with any changelog and primer files.

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
  "message": "Deleted deck 'My Commander Deck'"
}
```

## Card Autocomplete

```
GET /api/autocomplete?q=<query>
```

Search for card names using the in-memory card cache. Matching ignores case, accents, and punctuation (`jotun` matches `Jötun Grunt`; `jaces archivist` matches `Jace's Archivist`). Returns up to 20 results sorted by relevance: a card whose whole name the query spells out comes first (the front face of a double-faced card counts as its whole name), then prefix matches, then substring matches.

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
GET /api/deck/:slug
```

Load a deck with full card data, printings, and mana symbol map.

**Response:**

```json
{
  "success": true,
  "deck": { "name": "...", "sections": [] },
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "frontMatter": {},
  "slug": "my-deck"
}
```

## Card Printings

```
GET /api/card-printings?name=<cardName>
```

Get all printings of a card. Uses the card cache with fallback to Scryfall API.

**Query Parameters:**

| Parameter | Description     | Required |
| --------- | --------------- | -------- |
| `name`    | Exact card name | Yes      |

**Response:**

```json
{
  "success": true,
  "printings": [{ "id": "...", "set": "2xm" }]
}
```

## Card Price

```
GET /api/card-price?name=<cardName>
```

Get price data for a card including representative and cheapest printings for all currencies. If the cached data is more than 24 hours old, fresh data is fetched from Scryfall and the cache is updated.

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

## Save Deck

```
POST /api/deck/:slug/save
```

Save deck changes. Writes the updated deck file and appends to the changelog. Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "deck": { "name": "...", "sections": [] },
  "frontMatter": {},
  "contentHash": "…",
  "continueSession": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Deck"
}
```

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

Load a collection with full card data, printings, and mana symbol map.

**Response:**

```json
{
  "success": true,
  "collection": { "name": "...", "cards": [] },
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "my-collection"
}
```

## Save Collection

```
POST /api/collection/:slug/save
```

Save collection changes. Writes the updated collection file and creates a changelog entry. Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "collection": { "name": "...", "cards": [] },
  "contentHash": "…",
  "continueSession": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection"
}
```

## Create Collection

```
POST /api/collection/create
```

Create a new collection file. The slug is derived from the name.

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

Rename a collection. Replaces the first `# <Title>` line in the file and renames both the `.md` and any `.changes.md` sidecar.

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
  "newSlug": "Renamed Collection"
}
```

## Delete Collection

```
DELETE /api/collection/:slug
```

Delete a collection file (and its `.changes.md` sidecar if present). Requires `confirmName` to match the parsed `# Title` exactly.

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
  "message": "Deleted collection 'My Collection'"
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

Load a wanted list with full card data, printings, and mana symbol map.

**Response:**

```json
{
  "success": true,
  "entries": [{ "name": "Sol Ring", "set": "2xm", "collectorNumber": "270" }],
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "high-priority"
}
```

## Save Wanted List

```
POST /api/wanted/:slug/save
```

Save wanted list changes. Writes the updated wanted list file and appends to the changelog. Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session.

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
  "message": "Saved 3 changes to high-priority"
}
```

## Create Wanted List

```
POST /api/wanted/create
```

Create a new wanted list file.

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

Rename a wanted list. Replaces the first `# <Title>` line in the file and renames both the `.md` and any `.changes.md` sidecar.

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
  "newSlug": "Renamed Wishlist"
}
```

## Delete Wanted List

```
DELETE /api/wanted/:slug
```

Delete a wanted list file (and its `.changes.md` sidecar if present). Requires `confirmName` to match the parsed `# Title` exactly.

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
  "message": "Deleted wanted list 'Holiday Wishlist'"
}
```

## Move Data

```
GET /api/move
```

Returns every list (deck, collection, wanted) and every movable card across them, used by the [Move Cards](/admin/move-cards/) page. The lightweight `cards` payload carries no Scryfall data; each card's `key` is a path-free session identifier echoed back on commit. Deck entries with quantity > 1 expand to one card per copy (`copyIndex`).

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
      "cardId": 1,
      "copyIndex": 0
    }
  ]
}
```

## Commit Moves

```
POST /api/move/commit
```

Apply a batch of queued moves atomically. The move state is rebuilt from disk and each move is applied via the shared move engine, writing the source/destination files and their changelogs. The optional printing fields override the destination printing (used when a printing-less card is moved into a collection). Moves whose `cardKey` or destination can no longer be resolved are skipped and reported. When git auto-commit is enabled, the written files are committed in a single commit, the same as the editor save endpoints.

**Request Body:**

```json
{
  "moves": [
    {
      "cardKey": "collection:binder:1:0",
      "toType": "deck",
      "toSlug": "my-deck",
      "set": "2xm",
      "collectorNumber": "270",
      "finish": "nonfoil",
      "condition": "NM"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "moved": 1,
  "skipped": 0,
  "message": "Moved 1 card."
}
```

## Remove Cards

```
POST /api/remove/commit
```

Remove a batch of cards across lists atomically — backs the cross-list **Remove all selected** multi-select action. The state is rebuilt from disk, each requested card is resolved to its physical key and marked for removal, and the source files and their changelogs are written in a single pass. Deck copies are addressed by `copyIndex` (one item per copy); collection and wanted entries use their `cardId` at `copyIndex` 0. Cards that can no longer be resolved are skipped and reported. When git auto-commit is enabled, the written files are committed in a single commit (`Remove N cards`).

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
  "message": "Removed 1 card."
}
```

## List Histories

```
GET /api/history
```

Returns every list (deck, collection, wanted) as a slug-keyed summary, used to populate the [Change History](/admin/history/) page's list picker.

**Response:**

```json
{
  "success": true,
  "lists": [{ "type": "deck", "slug": "my-deck", "name": "My Deck" }]
}
```

## Load Change History

```
GET /api/history/:type/:slug
```

Returns the parsed change sets of a list's change log (newest first) plus the raw change lines a "rewrite with defaults" would produce. `:type` is `deck`, `collection`, or `wanted`. The list file is read only to derive `defaultLines`; a list with no change log yet returns an empty `sets` array.

**Response:**

```json
{
  "success": true,
  "header": "# Changelog for My Deck",
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"]
    }
  ],
  "defaultLines": ["- Added \"Sol Ring\" (LEA:1) &1"]
}
```

## Save Change History

```
POST /api/history/:type/:slug/save
```

Overwrite the list's change log with the supplied change sets. Each set needs a valid ISO-8601 `timestamp` and a `lines` array of strings, each starting with `- `. Only the `.changes.md` file is written; the list's own `.md` is never touched, and the existing header is preserved. When git auto-commit is enabled, the change log is committed (`Rewrite change history for <slug>`).

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

## Import CSV

```
POST /api/import-csv
```

Import cards from CSV text into a deck, collection, or wanted list. Used by the admin site's **Import CSV** page and exposed as the MCP `import_csv` tool; shares its parsing, normalization, and column-mapping engine with the [`import-csv`](/commands/import-csv/) CLI command.

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
[Deck Format](/commands/new-deck/#deck-format). An unrecognized value returns `400`.

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
  ]
}
```

Rows that fail validation are returned in `failures` while the valid rows still import; the response is `400` only when the request itself is invalid or **no** rows could be imported. Appends record each added card in the list's changelog. When git auto-commit is enabled, the list file (and changelog) are committed.

## Import Changes

```
POST /api/import-changes
```

Apply a change bundle exported from the site editor to the underlying lists. Used by the admin site's **Import Changes** page and exposed as the MCP `import_changes` tool; shares its apply engine with the [`import-changes`](/commands/import-changes/) CLI command.

**Request Body:** the exported JSON, verbatim — a `ritual-change-bundle` covering one or more lists:

```json
{
  "format": "ritual-change-bundle",
  "version": 1,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "lists": [
    {
      "kind": "deck",
      "slug": "winota-stax",
      "name": "Winota Stax",
      "changes": [{ "id": "a1", "timestamp": 1, "action": "add", "cardName": "Counterspell" }]
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Applied 1 change across 1 list",
  "lists": [
    {
      "kind": "deck",
      "slug": "winota-stax",
      "name": "Winota Stax",
      "applied": 1,
      "conflicts": []
    }
  ]
}
```

Each list is loaded fresh and its changes re-targeted to the current card IDs (by ID when it still exists, otherwise by card name). Changes whose target card no longer exists are skipped and reported in that list's `conflicts` (`{ change, reason: "target-not-found" }`). A list that fails to load or save carries an `error` string (and `applied: 0`) without stopping the remaining lists; `success` is `true` only when no list errored. `move-from` changes also write their destination lists, and every applied list gets a changelog entry — the same save path as the editors. The response is `400` when the body is not a valid change bundle.

## Export Cards

```
POST /api/export
```

Render a CSV or JSON export of cards from decks, collections, and wanted lists. Exposed as the MCP `export_cards` tool; shares its engine with the [`export`](/commands/export/) CLI command. Nothing is written to disk — the rendered export is returned as a string.

**Request Body:** every field is optional. With no `lists` and no `cards`, every list is exported.

```json
{
  "lists": [{ "type": "deck", "name": "winota-stax" }],
  "cards": ["sol ring"],
  "filters": { "name": "sol", "set": "c21", "finish": "foil", "conditions": ["NM", "none"] },
  "format": "csv",
  "columns": ["name", "set", "collectorNumber", "quantity"],
  "header": true,
  "quoteAll": false,
  "preset": "trade-sheet"
}
```

`lists` names resolve like CLI list arguments (the optional `type` pins an ambiguous name). Each `cards` entry is whitespace-separated name terms; every entry across all lists whose name matches all terms is added (deduplicated against the selected lists). `filters.conditions` takes condition grades and/or `none` (cards with no condition marked), matching the CLI's `--condition` semantics. `preset` starts from a saved [export preset](/commands/export/#presets); the explicit fields override its values.

**Response:**

```json
{
  "success": true,
  "format": "csv",
  "entryCount": 2,
  "content": "Name,Set,Collector Number,Quantity\nSol Ring,C21,263,1\n...",
  "warnings": []
}
```

`warnings` carries list parse warnings and `cards` terms that matched nothing. The response is `400` for an unknown list, preset, column, or filter value.
