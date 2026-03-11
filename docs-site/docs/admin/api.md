---
sidebar_position: 3
---

# Admin API Endpoints

The admin site exposes these API endpoints for deck and collection editing. All endpoints require authentication.

For general admin API endpoints (authentication, config, audit log, etc.), see the [admin command reference](/docs/commands/admin#http-api-reference).

## Card Autocomplete

```
GET /api/autocomplete?q=<query>
```

Search for card names using the in-memory card cache. Returns up to 20 results sorted by relevance (prefix matches first, then substring matches).

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

Save deck changes. Writes the updated deck file and appends to the changelog.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "deck": { "name": "...", "sections": [] },
  "frontMatter": {}
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

Save collection changes. Writes the updated collection file and creates a changelog entry.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "collection": { "name": "...", "cards": [] }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection"
}
```
