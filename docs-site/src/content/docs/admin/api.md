---
title: 'Admin API Endpoints'
---

The admin site exposes these API endpoints for deck and collection editing. All endpoints require authentication.

For general admin API endpoints (authentication, config, audit log, etc.), see the [admin command reference](/commands/admin/#http-api-reference).

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

## Price Summary

```
GET /api/price/summary
```

Price every deck, collection, and wanted list from the local card cache and return per-list, per-type, and grand totals plus any list-parser warnings — the same payload as [`price --summary --output json`](/commands/price/). Prices are read strictly from the cache: when it is empty the endpoint returns `503` without downloading anything (run [`ritual cache preload-all`](/commands/cache/) first). `lastRefreshedAt` is the cache's last bulk-refresh time in Unix milliseconds, or `null` when unknown.

**Query Parameters:**

| Parameter  | Description                                                        | Required |
| ---------- | ------------------------------------------------------------------ | -------- |
| `type`     | Only price `deck`, `collection`, or `wanted` lists                 | No       |
| `currency` | `usd`, `eur`, or `tix` (default: the configured `defaultCurrency`) | No       |

An unknown `type` or `currency` returns `400`.

**Response:**

```json
{
  "success": true,
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

Price a single list and return its summary plus every priced card entry (in file order) — the same payload as the CLI's single-list `price <name> --output json` view. `:type` is `deck`, `collection`, or `wanted`; `:slug` is the list's file basename, matching the load endpoints. Takes the same `currency` query parameter as the summary endpoint, with the same `503` when the card cache is empty. An unknown slug returns `404`.

**Response:**

```json
{
  "success": true,
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

Save collection changes. Writes the updated collection file and creates a changelog entry. Pass the optional boolean `continueSession` to merge this save into the previous save's changelog entry (bumping its timestamp) instead of opening a new one — the editor sets it on every save after the first within an editing session. Every collection entry must carry a printing: an `add`, `move-to`, or `set-printing` change missing `set` or `collectorNumber` returns `400` and leaves the file untouched.

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

Apply a batch of queued moves atomically. The move state is rebuilt from disk and each move is applied via the shared move engine, writing the source/destination files and their changelogs. The optional printing fields override the destination printing (used when a printing-less card is moved into a collection). The optional `toSection` (deck destinations only — `400` otherwise) places the card in that deck section, matched by exact name and created when missing; without it the default section is used. Moves whose `cardKey` or destination can no longer be resolved are skipped and reported. When git auto-commit is enabled, the written files are committed in a single commit, the same as the editor save endpoints.

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
      "condition": "NM"
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
  "message": "Moved 1 card."
}
```

## Move Selected Cards

```
POST /api/move/selected
```

Move a batch of selected cards across lists atomically — backs the cross-list **Move all selected** multi-select action. Each item addresses its source card by list + identity (the same `cardId`/`copyIndex` scheme as [Remove Cards](#remove-cards)) and its destination by `toType` + `toSlug`. The optional printing fields and `toSection` behave exactly as in [Commit Moves](#commit-moves). Cards or destinations that can no longer be resolved — or whose destination is the list they already live in — are skipped and reported.

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
  "a": { "type": "deck", "slug": "burn", "name": "Burn" },
  "b": { "type": "collection", "slug": "binder", "name": "Binder" },
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

## Deck Sync Status

```
GET /api/deck-sync
```

Returns every Archidekt-linked deck that can be synced — those whose front matter has both an
Archidekt `sourceUrl` and a `sourceId` — plus the stored Archidekt login. Backs the
[Sync Decks](/admin/sync-decks/) page and the MCP `deck_sync_status` tool.

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
| `ignoreUnreadableLines` | Sync decks whose files contain lines the parser cannot read, deleting those lines (default `false`).                                                                                                                          | No       |
| `only`                  | `additions` or `removals` — apply just one side of each deck's diff, relative to the sync destination (see [Change Filter](/commands/deck-sync/#change-filter)). Omitted applies every change; any other value returns `400`. | No       |

A sync rewrites each deck file, so a line the parser cannot read would be deleted by the save. There
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

`success` reports whether the run could be performed, **not** whether every deck synced — a run with
per-deck failures still returns `200` with `success: true` and a non-zero `report.failedCount`, so
callers can read each deck's `status` and `reason`. `report.unreadable` lists any deck whose file
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
every change), and `dryRun` / `ignoreUnreadableLines` take `true` or `false` (any other value is
rejected, so a flag that decides whether files are written can never be misread as "no").

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run: `{ kind: "deck-start", deck, index, total }`, `{ kind: "log", level, deck, message }` (`deck` is `null` for run-level lines), `{ kind: "deck-result", result }`, or `{ kind: "unreadable-lines", decks: [{ name, file, warnings }] }`. |
| `done`     | `{ message, report }` — the same message and report the JSON endpoint returns.                                                                                                                                                                              |
| `error`    | `{ message, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure).                                                                                                                              |

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

| Field                   | Description                                                                                                                                                                          | Required |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `direction`             | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value returns `400`.                                                                                             | Yes      |
| `lists`                 | Collection list slugs or names, resolved like CLI list arguments. Omitted or empty compares the whole collection; the remote side is always the entire Archidekt collection.         | No       |
| `into`                  | The list a pull adds new cards to, created if it does not exist. Omitted uses the `collectionSync.pullTarget` config key. A push ignores it.                                         | No       |
| `only`                  | `additions` or `removals` — apply just one side of the diff, relative to the sync destination. Omitted applies every change; any other value returns `400`.                          | No       |
| `removalPriority`       | Collection list names **in priority order** — the only lists an ambiguous removal may take copies from (see below). Must be an array of non-blank names or `400`. A push ignores it. | No       |
| `csv`                   | Upload a push's **new cards** as one CSV import instead of adding them one at a time (see below). Must be a boolean or `400`. A pull ignores it.                                     | No       |
| `dryRun`                | Report what would sync without writing files or touching Archidekt (default `false`).                                                                                                | No       |
| `ignoreUnreadableLines` | Sync lists whose files contain lines the parser cannot read, dropping those lines (default `false`).                                                                                 | No       |

A `csvFile` field is **rejected** with `400`: writing a CSV to a path the caller names is a CLI
affordance ([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)),
not something this API does. Refused rather than ignored, so a caller mirroring the CLI's flags is
told rather than watching its additions be uploaded instead.

### CSV import for new cards

Creating a record for a printing Archidekt does not have costs a search plus a create, both
[paced 500 ms apart](/commands/collection-sync/#rate-limiting), so a first push of a real collection
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

| Event      | Payload                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run: `{ kind: "list-start", list, index, total }`, `{ kind: "log", level, list, message }` (`list` is `null` for run-level lines), `{ kind: "list-result", result }`, or `{ kind: "unreadable-lines", lists }`. |
| `done`     | `{ message, report }` — the same message and report the JSON endpoint returns.                                                                                                                                                  |
| `error`    | `{ message, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure).                                                                                                  |

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
      "slug": "Winota Stax",
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
      "slug": "Winota Stax",
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

Render a CSV, JSON, plain-text, or Markdown export of cards from decks, collections, and wanted lists. Exposed as the MCP `export_cards` tool; shares its engine with the [`export`](/commands/export/) CLI command. Nothing is written to disk — the rendered export is returned as a string.

**Request Body:** every field is optional. With no `lists` and no `cards`, every list is exported.

```json
{
  "lists": [{ "type": "deck", "name": "Winota Stax" }],
  "cards": ["sol ring"],
  "filters": { "name": "sol", "set": "c21", "finish": "foil", "conditions": ["NM", "none"] },
  "format": "csv",
  "columns": ["name", "set", "collectorNumber", "quantity"],
  "header": true,
  "quoteAll": false,
  "dialect": "ritual",
  "preset": "trade-sheet"
}
```

`lists` names resolve like CLI list arguments (the optional `type` pins an ambiguous name). Each `cards` entry is whitespace-separated name terms; every entry across all lists whose name matches all terms is added (deduplicated against the selected lists). `filters.conditions` takes condition grades and/or `none` (cards with no condition marked), matching the CLI's `--condition` semantics. `preset` starts from a saved or built-in [export preset](/commands/export/#presets) — the built-in `archidekt` preset needs no config, and a saved preset of that name shadows it; the explicit fields override the preset's values.

`format` is one of `csv` (default), `json`, `text` (one flat merged decklist, quantities aggregated), or `md` (canonical list markdown without `&N` ids) — see [export formats](/commands/export/#formats). `columns`, `header`, `quoteAll`, and `dialect` shape `csv`/`json` output only and are ignored for `text`/`md` (unlike the CLI, the route does not reject the combination). `dialect` is the value vocabulary for finish and condition: `ritual` (the default — `nonfoil`/`foil`/`etched`, `NM`…`DMG`) or `archidekt` (`Normal`/`Foil`/`Etched` under a `Variant` header, and `NM|LP|MP|HP|D`) — see [dialects](/commands/export/#dialects). An unknown `dialect` or `preset` is a `400`. A selected `scryfallId` column is resolved from the local Scryfall cache.

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

`warnings` carries list parse warnings, `cards` terms that matched nothing, and — when the `scryfallId` column is selected — one entry per printing the local Scryfall cache does not hold (that cell renders empty). The response is `400` for an unknown list, preset, column, dialect, or filter value.
