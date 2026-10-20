---
title: 'Admin API'
description: Every HTTP route the admin server exposes, shared by the admin site, the MCP server, and any other client.
---

The admin server exposes an HTTP API under `/api/`. The admin site, the [MCP server](/commands/mcp/), and any client you write use the same routes. Unless a route says otherwise, every request needs an authenticated session.

The page starts with the conventions every route shares (response messages, error bodies, authentication), then documents one route per section.

## The message triple

Every response body, success or refusal, carries its user-facing prose as up to three fields:

| Field           | Presence | Meaning                                                                                                                 |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `message`       | always   | The sentence, in **English**; what `curl`, scripts, and the MCP server read. It never follows the operator's UI locale. |
| `messageKey`    | optional | The message-catalog key `message` was rendered from. Locale-invariant. Absent when the sentence has no catalog entry.   |
| `messageParams` | optional | The parameters `messageKey` interpolates. Absent for a message that takes none.                                         |

Match on `messageKey`, never on the English text.

A few responses build their sentence from counted nouns — an import's "Applied 3 changes across 2 lists" — and there a param may itself be a message (`{ messageKey, messageParams }`) or a list (`{ list, join }`, where `join` is `and`, `unit`, `clauses` or `concat`), rendered in the same locale as the sentence around it, so the counts pluralize in the reader's language. [Import CSV](#import-csv), [Import Changes](#import-changes) and [Import Deck](#import-deck) say so where they do, and so do the refusals of change JSON — a [change bundle](#import-changes), a [save](#save-a-list)'s changes and a [history rewrite](#save-change-history)'s events — whose `domain.changes.problem.*` sentence nests the record it is about (`Move #1 "from"`, `changes[2]`) as its `subject`, an [error a route did not expect](#error-responses), such as a cache-lock time-out, the [list-file engines' refusals](#error-responses) (a list's unknown keys or valid formats as a `unit` list, an unreadable `.art.json`'s reason, a rewrite gate's problems), the [config validator's refusals](#update-config) (a block's refusal nesting its field's, the accepted values as a `unit` list, a malformed `uiLocale`'s nested tag-parser reason), a list load's [`warnings`](#load-deck) (a card-line diagnostic nested as `text` inside its `domain.card.line.atLine` location, its hint inside `domain.card.line.withHint`), the [card vocabulary's refusals](#error-responses) (a tag or category refusal nesting its shape `rule`, a card language's valid codes as a `unit` list), [Export Cards](#export-cards)' and [Diff Lists](#diff-lists)' `warnings` (a list's parse warning nested as `warning`, a decklist's omitted sections as a `unit` list, each `section` a `domain.board.*` message for a standard board and the heading as written otherwise) and export refusals (the accepted columns or values as a `unit` list), and the [cache refresh stream](#refresh-cache-stream)'s progress lines, whose download sizes are a size (`{ sizeBytes }`, rendered as a two-decimal mebibyte figure in the reader's locale), the buylist routes' `503` when no feed is downloaded (`domain.cache.cardKingdom.missingApiAdvice`, whose `lead` nests the `domain.cache.cardKingdom.noFeed` sentence), [Sell Refresh](#sell-refresh)'s `staleFallback` and `skippedRows` (a failed download's underlying `error`, a skipped feed row's `reason`), and [Sell Cart](#sell-cart)'s `warnings` (the etched titles as a `unit` list). The [Archidekt sync routes](#sync-decks) nest too: a deck's per-card change lines and the stream's `log` lines (and each item's `reasonParams`) name a standard board (`Main`, `Sideboard`, …) as a `domain.board.*` message, so it is worded in the reader's language. Every other response's params are plain strings and numbers.

## Error responses

Every route refuses a request with the same body, whatever the status — and so does the server itself when it refuses a request before any route runs (an address or User-Agent its allow/deny lists turn away, a signed-in route before the first account exists or without a session, a path with no route or file when no admin site is built, an unexpected failure):

```json
{
  "success": false,
  "message": "…",
  "messageKey": "admin.api.…",
  "messageParams": { "…": "…" }
}
```

`messageKey` and `messageParams` follow [the message triple](#the-message-triple): present on a keyed refusal, absent when the prose has no catalog entry. A refusal naming a list that does not resolve ([Diff Lists](#diff-lists), [Export Cards](#export-cards)) carries the list resolver's `errors.resolveList.*` key, and its params may nest (the ambiguous matches are a list of messages).

A request whose shape is wrong is refused with a shared family of keys wherever a route's check is a generic one (a route with a field of its own, such as `columns` on [Export Cards](#export-cards), words its refusal for that field). The body itself: `admin.api.body.notJson` (not valid JSON), `admin.api.body.notObject` (JSON, but not an object) and `admin.api.body.tooLarge` (a `413`, see [Request size limits](#request-size-limits)). A field or query parameter: `admin.api.field.*`, whose `field` param names it exactly as the request spelled it, an indexed path included (`printings[3].set`). The family is `required`, `notBoolean`, `notString`, `blank` (missing, or empty once trimmed), `notObject`, `notArray`, `notStringArray`, `tooMany` (more entries than one request may carry, the maximum as `count`), `notPositiveInteger` and `notNonNegativeInteger` (the value sent, trimmed, as `value`: an invalid `limit`, `page` or `offset`), plus `credentialsRequired` for a sign-in form missing its `username` or `password`. The English quotes the field: `"printings[3].set" must be a non-empty string.`, `Invalid "limit" 'abc'. Use a positive integer.` A value outside a fixed set of choices is `errors.enum.invalid` (or `errors.enum.type` for one that is not a string), with `field`, `value` and the comma-joined `choices`.

The list-file engines' refusals are keyed the same way: a [create, rename or delete](#list-lifecycle-responses) refused (`domain.list.lifecycle.*`, or `domain.list.name.unusable` for a name with no usable file-name characters), an unknown deck format (`domain.list.deckFormat.invalid`, whose `formats` is a `{ list, join: "unit" }`), a cover image, custom-art reference or description the grammar refuses (`domain.list.image.*`, `domain.list.art.*`, `domain.list.description.*`; the keys it does not accept nest as a `{ list, join: "unit" }`), a metadata or cover write over front matter that is not a readable mapping, a cover naming no card of the list, an unreadable `.art.json`, and a [save](#save-a-list) refused because a rewrite would delete content the parser cannot re-emit (`domain.list.unreadableContent`, whose `problems` param is a `{ list, join: "clauses" }` of nested messages: the parser's own warnings, keyed like the load's [`warnings`](#load-deck), and, for a fenced code block, `domain.list.fencedContent`), and a save whose cross-list moves cannot reach their other list (`domain.list.move.*`: the list is gone, holds no copy to take, or cannot be staged — the last nests the staging refusal as its `reason`, and each names the list as a nested `domain.change.listRef` message).

The card vocabulary's refusals are keyed too (`domain.card.*`): a label set a request names (`domain.card.label.*`, or `errors.label.exclusive` / `errors.label.contradictory` for a combination the rule forbids), a tag or category (`domain.card.tag.*`, `domain.card.category.*`, whose `rule` param nests the shape rule as its own message), a note (`domain.card.note.invalid`), a set code (`domain.card.setCode.invalid`) and a card language (`domain.card.language.invalidField`). A change payload one of them refused nests it as the `detail` of `domain.changes.problem.fieldRejected`.

An error a route did not expect — one raised deep in an engine — is answered the same way, in English plus its key whenever it has one. A card-cache error is one: a cache-lock time-out (`domain.cache.lockTimedOut`, whose `timeout` param is a duration `{ durationMs }` and whose `holder` is a message of its own), a failed request to a [`--cache-server`](/commands/cache/) (`domain.cache.serverRequestFailed`, …), a card-cache refresh that failed or was cancelled (`domain.cache.refresh.*`), or a failed Scryfall request a route made (`domain.cache.scryfall.timedOut`, whose `timeout` is a duration `{ elapsedMs }`, and `domain.cache.scryfall.symbologyFailed`, whose params are the HTTP `status` and `statusText`). A remote cache server's own reply arrives nested: its message — a failed Scryfall price batch (`domain.cache.scryfall.pricesFailed`), the server's refusal of the request (`domain.cache.serverReply.*`, such as `invalidRoute` or `keyMalformed`), or a `--deny-http` server's refusal to download a price (`domain.cache.serverReply.httpDenied`) — is the `body` of `domain.cache.serverRequestFailedWithBody`, or the `error` of `domain.cache.serverStreamEntryError` (which names the entry's `key`) or `domain.cache.serverStreamError`. A reply this server cannot render whole (a newer cache server's key or param) is nested as its English text instead, and a reply that is not a message at all (an older cache server's keyless body, a proxy's error page) as its text, cut to about 1,000 characters and stripped of control characters (as is every text param of a nested reply). These params nest the way a [sync's](#sync-decks) do.

A `ritual.config.json` edited by hand into something that is not a JSON object while the server runs fails **every** request with a `500` (the server re-reads the file per request), keyed `domain.config.fileNotJson`: `file` is the config file's name (`ritual.config.json`), `path` the file's location and `reason` the JSON parser's own complaint (plain text) or, for valid JSON that is not an object, a nested `domain.config.fileNotObject` message.

`499` is the status a route answers when an **in-process** caller cancels the request part way (the MCP tools do this on a client's `notifications/cancelled`). HTTP requests are never cancelled this way: closing the connection leaves the handler running to completion.

A few routes carry extra fields on failure where they are part of the wire contract:

- [Card Details](#card-details) adds `card: null`.
- [Card Search](#card-search) keeps its paging fields and an empty `cards` array.
- [Card Autocomplete](#card-autocomplete) uses one shape for success and failure. [Card Printings](#card-printings) fails with `printings: []`, [Card Price](#card-price) with `printings: []` and its printing fields `null`, and Cards with `cards: []`, each beside the message triple.
- A save that loses an optimistic-concurrency race carries `conflict: true` with its `409`.
- A [save](#save-a-list) refused because a change missed its card carries `unmatched`, one entry per change.

### Request size limits

Every route caps its request body and answers `413` past the cap, keyed `admin.api.body.tooLarge` with the route's limit in exact bytes as `messageParams.count` (`"Request body too large (limit 10240 bytes)"`). The bytes are counted as they arrive, so the cap holds for a chunked body or one that declares no `Content-Length`.

| Routes                                                                                                                    | Cap           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Credentials, settings, list names, and other small bodies                                                                 | 10 KiB        |
| [List metadata](#list-metadata) (a description can be long)                                                               | 1 MiB         |
| [Saves](#save-a-list) (at most 50,000 changes), moves, removals, [sync](#sync-decks) and [export](#export-cards) requests | about 9.5 MiB |
| [Buylist quotes](#buylist-quotes) (at most 500 printings)                                                                 | about 117 KiB |
| Uploads: [CSV](#import-csv) and decklist imports, [change bundles](#import-changes), history rewrites                     | 16 MiB        |

Beneath the per-route caps, the server refuses any body larger than 16 MiB plus a small allowance; that refusal comes from the runtime and has no JSON body.

## Authentication

The admin uses **session-based authentication**. Send `POST /api/login` with your credentials (and a TOTP code if TOTP is enabled). The response sets a session cookie in a `Set-Cookie` header, and later requests authenticate with that cookie.

- Sessions expire after 24 hours. `POST /api/logout` ends one early.
- Unauthenticated requests to protected routes receive `401` with the shared [error envelope](#error-responses) (`messageKey: admin.api.server.unauthorized`). Before the first admin account exists they receive `403` (`admin.api.server.setupRequired`).
- Rate-limited sign-ins receive `429 Too Many Requests`: the shared error envelope (`messageKey: admin.api.login.rateLimited`) plus `retryAfterSeconds`, the remaining lockout, which the `Retry-After` header also carries.

## Server Status

```
GET /api/status
```

No authentication is required.

Returns server health, whether first-time setup is needed, and which optional capabilities this server offers.

**Response:**

```json
{
  "ok": true,
  "setupRequired": false,
  "totpEnabled": true,
  "sellMode": false,
  "about": {
    "version": "1.0.0",
    "license": "AGPL-3.0-only",
    "sourceUrl": "https://github.com/sloshy/ritual",
    "revisionUrl": "https://github.com/sloshy/ritual/tree/v1.0.0"
  }
}
```

`about` is the running Ritual's source offer: its version, its license, the repository holding its source, and `revisionUrl`, the source of exactly this version (the release tag's tree, or the commit's for a development build). The admin UI shows it at the foot of its navigation. See [Source Code](/attribution/#source-code).

`sellMode` is the **effective** value: `site.sellMode`, or `true` when the server was started with [`--sell-mode`](/commands/admin/#sell-mode). When it is false a client hides its sell surfaces. The `/api/sell/*` and `/api/buylist/*` routes themselves stay open while the `cardkingdom` [price store](/configuration/#price-stores-pricesources) is enabled, because Card Kingdom retail prices come from the same feed.

## Create Admin Account

```
POST /api/setup
```

No session is required. Instead the request carries the one-time setup token `ritual admin` printed when it started (see [First-Time Setup](/commands/admin/#first-time-setup)). A missing or wrong token returns `403 Forbidden`. Only works when no admin user exists; returns `409 Conflict` otherwise.

**Request body:**

```json
{
  "username": "admin",
  "password": "mypassword",
  "setupToken": "Qm9yb3NDaGFybUJvbHQxMjM0"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Admin account created successfully"
}
```

## Log In

```
POST /api/login
```

No authentication is required.

Authenticate with username, password, and optionally a TOTP code. On success, the response sets a session cookie.

**Request body:**

```json
{
  "username": "admin",
  "password": "mypassword",
  "totpCode": "123456"
}
```

| Field      | Type   | Required | Description                             |
| ---------- | ------ | -------- | --------------------------------------- |
| `username` | string | Yes      | Admin username                          |
| `password` | string | Yes      | Admin password                          |
| `totpCode` | string | No       | TOTP code (required if TOTP is enabled) |

**Response (success):**

```json
{
  "success": true
}
```

The response includes a `Set-Cookie` header with the session token.

**Response (TOTP required):**

```json
{
  "success": false,
  "message": "TOTP code required",
  "messageKey": "admin.api.login.totpRequired",
  "totpRequired": true
}
```

**Response (locked out, `429`):**

```json
{
  "success": false,
  "message": "Too many failed attempts. Try again later.",
  "messageKey": "admin.api.login.rateLimited",
  "retryAfterSeconds": 240
}
```

## Log Out

```
POST /api/logout
```

Destroys the current session.

**Request body:** None

**Response:**

```json
{
  "success": true
}
```

## Audit Log

```
GET /api/audit-log
```

Returns recent login attempts, most recent first.

**Query parameters:**

| Parameter | Type   | Default | Description                    |
| --------- | ------ | ------- | ------------------------------ |
| `limit`   | number | `100`   | Max entries to return (1–1000) |

**Response:**

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-02-26T19:00:00.000Z",
      "ip": "127.0.0.1",
      "username": "admin",
      "success": true,
      "reason": "Login successful",
      "userAgent": "Mozilla/5.0 ..."
    }
  ]
}
```

Every login attempt, successful or failed, is written to `.logins/admin-audit.log` with timestamp, IP address, username, result, reason, and user agent. The admin UI shows the same log under "Audit Log".

## Create Deck

```
POST /api/deck/create
```

Create a new deck file, named after the deck — see [List file names](/commands/new/#list-file-names). A name with no usable file-name characters returns `400`.

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

`format` must be a canonical deck format key — see [Deck Format](/commands/new/#deck-format). An unrecognized value returns `400` and creates nothing.

**Response:**

```json
{
  "success": true,
  "message": "Created deck 'My Commander Deck'",
  "slug": "My Commander Deck"
}
```

### List lifecycle responses

Create, rename, and delete answer identically for decks, collections, and wanted lists:

| Operation | Success body                                                    |
| --------- | --------------------------------------------------------------- |
| Create    | `{ success: true, message, slug }`                              |
| Rename    | `{ success: true, message, newSlug, newFilePath, oldFilePath }` |
| Delete    | `{ success: true, message, deletedFiles, trashDir }`            |

`newFilePath`/`oldFilePath` are the list's paths after and before the rename. `deletedFiles` is every path the delete removed: the list plus its sidecar files. They are moved, not erased: `trashDir` is the [trash folder](/commands/delete/#restoring-a-deleted-list) now holding them, where each keeps its workspace-relative path. All of these paths are absolute; `message` names the trash folder relative to the workspace.

A refusal is the shared [error envelope](#error-responses) at one of these statuses:

- `400` — a missing or invalid argument.
- `404` — a list that does not exist.
- `409` — a target name already taken.

`409` covers more than an identical file name. Create and rename refuse any name that [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) to an existing list of the same type: `atraxa superfriends` is refused while `Atraxa Superfriends` exists, with `A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends' under list-name folding).` Renaming a list to another spelling of its own name (a capitalization or punctuation fix) is not a collision. It succeeds and moves the file and its sidecars, even on a case-insensitive file system.

## Rename Deck

```
POST /api/deck/:slug/rename
```

Rename a deck. Rewrites the `# Title` heading and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

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
  "newFilePath": "/home/me/mtg/decks/New Deck Name.md",
  "oldFilePath": "/home/me/mtg/decks/My Commander Deck.md"
}
```

## Delete Deck

```
DELETE /api/deck/:slug
```

Delete a deck and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "confirmName": "My Commander Deck"
}
```

`confirmName` must match the deck's `# Title` (its first H1) exactly; `400` otherwise.

**Response:**

```json
{
  "success": true,
  "message": "Deleted deck 'My Commander Deck'; its files are in .trash/2026-10-05T14-03-22Z-deck-My Commander Deck",
  "deletedFiles": [
    "/home/me/mtg/decks/My Commander Deck.md",
    "/home/me/mtg/decks/My Commander Deck.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-deck-My Commander Deck"
}
```

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

## Load Deck

```
GET /api/deck/:slug?view=<full|cards|summary>&section=<name>&nameContains=<terms>&limit=<n>&offset=<n>
```

Load a deck at the depth `view` asks for. The same parameters apply to [Load Collection](#load-collection) and [Load Wanted List](#load-wanted-list).

### List load parameters

| Parameter      | Description                                                                                               | Required |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `view`         | `full` (default), `cards`, or `summary`. Anything else is a `400` naming the three                        | No       |
| `section`      | Exact `## Section` heading, case-sensitive. A section that does not exist yields no entries, not an error | No       |
| `nameContains` | Whitespace-separated name terms; every term must appear, in any order (as `/api/autocomplete` matches)    | No       |
| `limit`        | Max entries returned. A positive integer; anything else is a `400`                                        | No       |
| `offset`       | Entries to skip before `limit` applies. A non-negative integer (`0` is allowed)                           | No       |

`summary` and `cards` return **before** the changelog-name pass, the Scryfall card/printing/price load, and the mana-symbol fetch, so a filtered read is cheap for the server. `full` applies the filters and then loads card data for the filtered names only.

`totalCount` is always present: the number of entries that matched **before** `limit`/`offset` applied (the list's whole line count when nothing was filtered), so a client can page. `offset`/`limit` count lines, and a line is never split: a `4 Lightning Bolt` deck entry travels whole.

Any of `section`, `nameContains`, `limit`, or `offset` makes the body a **slice**: the response carries `"partial": true` and **no** `contentHash`, because only a full load shows the whole list a save's changes are replayed over. Reload without filters to get a hash you can save with. This applies to every view, `summary` included.

`warnings` is always present on all three views. It lists everything in the file a re-serializing write would not reproduce, as an array of [message triples](#the-message-triple) (empty for a clean file): the English `message`, plus `messageKey` and `messageParams`. A line the card-line grammar refused is located (`domain.card.line.atLine`, `{ line, text }`) with the grammar's own diagnostic nested as `text` (`domain.card.line.*` — for example `domain.card.line.unknownToken`, wrapped in `domain.card.line.withHint` when it suggests a fix):

- Body lines the parser could not read — malformed card lines, prose, comments, or any other text the list grammar does not model.
- One summary entry per file holding a [fenced code block](/list-format/#fenced-code-blocks) (`Fenced code block content (N lines) — …`). A fenced block parses cleanly, so it gets no per-line warning, but the serializers cannot emit it.
- Held deck lines (`domain.card.line.suspectQuantityInName`, located like a refused line): a deck line with no quantity whose name starts with four or more digits (`- 1234 Sol Ring`). It loads as one card of that whole name, but it may be 1,234 copies an earlier version wrote without the `x`, and the write would re-emit it as `- 1 1234 Sol Ring` for good. Only the user can settle it, by editing the file (`- 1234x Sol Ring` or `- 1 1234 Sol Ring`).

A deck's empty extras section (`## Maybeboard`, `## Tokens`) is deliberately **not** listed: it holds nothing to lose and the next write clears it.

**A non-empty `warnings` also blocks saving that list** — see [Unreadable lines block a save](#unreadable-lines-block-a-save).

A missing list is a `404` whose message points at `GET /api/lists` for the real slugs. A slug carrying a path separator is a `400` (`Invalid list slug`) on all three routes.

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

A `full` deck load also carries `lowestPriceCards`, `lowestPriceCardsEur` and `lowestPriceCardsTix`: the cheapest printing per card name, per currency.

`cardsCardKingdom` (and, on decks, `lowestPriceCardsCardKingdom`) is [Card Kingdom's own printing pick](/public-site/prices/#which-printing-a-card-is-priced-at) per card name — the printing CK sells, chosen at CK's prices — which a client shows instead of the Scryfall pick while the Card Kingdom price store is selected. Both are **sparse** (a card CK stocks no printing of has no entry; fall back to the Scryfall pick) and both are **absent entirely** unless [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` and a buylist feed is cached. A load never downloads the feed.

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

A deck's `cards` view also returns its front matter. A collection or wanted list returns `entries` + `sectionOrder` instead, plus a top-level `description` (the list's front-matter blurb, absent when none is declared; a deck's is inside `deck.description`). Per-card fields:

- `labels` — a deck and a collection carry a top-level `labels` (the list's [front-matter default](/list-format/#card-labels); a deck's can only be `proxy`), and each of their cards may carry its own signed `labels` override (`["no-proxy"]`), which adjusts that default. Every deck card and collection entry also carries `effectiveLabels`: the labels in force, resolved by the server.
- `tags` — every card on every list type carries `tags` when its line has any: its [tags](/list-format/#card-tags) in canonical order (trimmed, sorted, without the `#`). There is no list-level tag default.

A narrowed request replaces `contentHash` with `"partial": true`.

**Custom art.** Every non-summary load carries `customArt` when the list has any: a `{ "<cardId>": { "file": … } | { "url": … } }` record of the **raw** [custom art](/custom-art/) references for the cards in the body. Clients derive display URLs themselves, since an editor needs the path the user typed. Omitted when none of the returned cards has art.

Problems with the `.art.json` sidecar — it cannot be read, or it holds art under a card id the **whole** list no longer has — come back in a separate `artWarnings` array rather than failing the load. Unlike `warnings`, they never [block a save](#unreadable-lines-block-a-save). `artWarnings` is omitted when the sidecar is clean or absent. The orphan check ignores the filters, so a paged read never reports cards it did not ask for.

**Categories.** Every non-summary load carries the list's [categories](/list-format/#categories-namecategoriesjson) when it has any, as `categories` — `{ "order": ["Ramp", "Artifacts"], "cards": { "Sol Ring": ["Ramp", "Artifacts"] } }` — and every returned card carries its own resolved `categories`, primary first. **Absent means none at both levels**: never an empty array. `order` is the resolved order the next Ritual write persists. `categories` always describes the **whole list**, never just the returned page: a filtered read still reports every categorized name, while each card's own `categories` covers only the cards in the body.

Keys in `cards` are card names as the sidecar stores them, matched case- and whitespace-insensitively. Read each card's own `categories` field rather than joining `cards` by raw name, or you will miss entries the list still resolves.

Problems with the `.categories.json` sidecar — it cannot be read, or it records categories for names the list no longer holds — come back in a separate `categoryWarnings` array, like `artWarnings`. A read reports stale names and never removes them; the next save prunes them. The stale-name check is skipped when the list has unreadable lines, since those lines may still hold the named cards.

A `view=summary` body carries neither `categories` nor `categoryWarnings`: it returns before the sidecar is read.

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

`entryCount` is lines, `cardCount` is copies (summed quantity). Collections and wanted lists hold one card per line, so the two are equal there. A summary honours `section`/`nameContains` and ignores `limit`/`offset`: the counts describe the whole filtered set. A narrowed summary is `"partial": true` with no `contentHash`, like every other narrowed view.

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

A refusal keeps the shape — `success: false`, `printings: []` — plus the [message triple](#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry. A missing `name` is `admin.api.field.required` and a malformed `limit` `admin.api.field.notPositiveInteger` (see [Error responses](#error-responses)); so is a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](#error-responses)'s do.

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

A failure answers `success: false`, `printings: []` and the four printing fields (`representative`, `lowestPriceCard`, `lowestPriceCardEur`, `lowestPriceCardTix`) `null`, plus the [message triple](#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](#error-responses)'s do.

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

A name that matches nothing returns `404` with a message pointing at [`/api/autocomplete`](#card-autocomplete), keyed `admin.api.card.unknownName`: `name` is the name sent, and `route` (`/api/autocomplete`) and `tool` (`autocomplete_card`, the MCP tool) are identifiers that stay as they are in any language. A missing or blank `name` is a `400` (`admin.api.field.required`). Every error response keeps the success shape — `success: false` and `card: null` — plus the [message triple](#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](#error-responses)'s do.

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

Every error response keeps the success shape — `success: false`, the requested `page`, `hasMore: false`, an empty `cards` array — plus the [message triple](#the-message-triple): `message` (English), and `messageKey` and `messageParams` when the failure has a catalog entry — a lookup that failed inside the card cache, such as a failed [`--cache-server`](/commands/cache/) request (`domain.cache.serverRequestFailed`, …), whose params may nest as an [error response](#error-responses)'s do. The query's own refusals are keyed too: a missing `q` (`admin.api.field.required`), a `page` or `limit` that is not a positive integer (`admin.api.field.notPositiveInteger`), a `limit` past one Scryfall page (`admin.api.cardSearch.limitTooLarge`, with `max` and the `value` sent) and an invalid `warm` (`errors.enum.invalid`). A Scryfall refusal is Scryfall's own text and has no key.

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

Report the card cache's size, freshness, tag coverage, and source — the same payload [`ritual cache status --output json`](/commands/cache/) prints. Diagnostic only: it never refreshes or writes the cache. Tag presence is checked over a bounded sample of cached cards, not a full scan.

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

| Field             | Description                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `empty`           | Whether the cache holds no cards at all                                                                                                                      |
| `cardCount`       | Distinct card **names** cached (each holds an array of printings)                                                                                            |
| `lastCardRefresh` | ISO-8601 time of the last bulk refresh, or `null` until one has run                                                                                          |
| `priceAgeHours`   | Whole hours since that refresh (prices come with the bulk data), or `null`                                                                                   |
| `priceStale`      | `true` when prices are older than 24 hours, or their age is unknown                                                                                          |
| `tagsPresent`     | Whether any sampled card carries oracle/art tags                                                                                                             |
| `source`          | `local`, or `cache-server` when a [cache server](/commands/cache/) is configured                                                                             |
| `defaultLanguage` | The configured [`defaultLanguage`](/configuration/#default-language)                                                                                         |
| `cardBulkType`    | Which bulk built the cache (`default_cards`/`all_cards`), or `null` when no ingest has recorded provenance                                                   |
| `bulkTypeStale`   | `true` when the cache's bulk disagrees with `defaultLanguage`; a full refresh is needed (see [bulk selection](/commands/cache/#bulk-selection-and-language)) |

## Price Summary

```
GET /api/price/summary
```

Price every deck, collection, and wanted list from the local card cache and return per-list, per-type, and grand totals plus any list-parser warnings — the same payload as [`price --summary --output json`](/commands/price/). Prices are read strictly from the cache: an empty cache returns `503` without downloading anything (run [`ritual cache preload-all`](/commands/cache/) first), and a card the cache does not hold is reported as unpriced rather than fetched from Scryfall. `lastRefreshedAt` is the cache's last bulk-refresh time in Unix milliseconds, or `null` when unknown.

**Query Parameters:**

| Parameter | Description                                                                                                                                                                                                                                  | Required |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `type`    | Only price `deck`, `collection`, or `wanted` lists                                                                                                                                                                                           | No       |
| `source`  | The store, which sets the currency: `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), `cardhoarder` (Scryfall MTGO tix), or `cardkingdom` (Card Kingdom NM retail from the cached feed). Default: the configured `defaultPriceSource` | No       |

An unknown `type` or `source` returns `400`. There is no currency parameter: each store has one (`tcgplayer`/`cardkingdom` → `usd`, `cardmarket` → `eur`, `cardhoarder` → `tix`), and every response names both its `source` and its `currency`.

When the store resolves to `cardkingdom` (`source=cardkingdom`, or the configured default), the route reads the cached [buylist feed](/commands/sell/). With a feed cached, printings Card Kingdom does not sell are reported unpriced. With no feed downloaded it returns `503` with the refresh advice rather than falling back to Scryfall. The parameter is **not** gated on the [`priceSources`](/configuration/#price-stores-pricesources) config key; it needs only a cached feed.

`mode` discriminates the two price bodies: `"summary"` here, `"list"` on [Price List](#price-list).

`unpricedCount` counts copies whose price the data could not supply, and **only** those. `estimatedCount` counts deck and wanted-list copies whose price is an estimate: the line pins no printing (priced at a representative one) or has no price. Any at all makes `total` an estimate, which the CLI and sites render with a `~` prefix (`~$12.34`). Collections never estimate. Cards that carry no price [by rule](/custom-art/#custom-art-carries-no-price) — a `proxy` label, custom art, or both — are priced at `0` and counted in `cardCount`, but are left out of `unpricedCount`: they are not a gap in the price data.

**Response:**

```json
{
  "success": true,
  "mode": "summary",
  "source": "tcgplayer",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "lists": [
    {
      "type": "deck",
      "name": "my-deck",
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2,
      "estimatedCount": 12
    }
  ],
  "typeTotals": [
    {
      "type": "deck",
      "listCount": 1,
      "cardCount": 100,
      "total": 245.1,
      "lowestTotal": 199.9,
      "unpricedCount": 2,
      "estimatedCount": 12
    }
  ],
  "totals": {
    "listCount": 1,
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2,
    "estimatedCount": 12
  },
  "warnings": []
}
```

## Price List

```
GET /api/price/:type/:slug
```

Price a single list and return its summary plus every priced card entry in file order — the same payload as the CLI's single-list `price <name> --output json`. `:type` is `deck`, `collection`, or `wanted`; `:slug` is the list's file basename, as on the load routes. Takes the same `source` query parameter as [Price Summary](#price-summary), with the same `503` when the card cache is empty (or when `source=cardkingdom` finds no cached feed). An unknown slug returns `404`.

**Response:**

```json
{
  "success": true,
  "mode": "list",
  "source": "tcgplayer",
  "currency": "usd",
  "lastRefreshedAt": 1752600000000,
  "list": {
    "type": "deck",
    "name": "my-deck",
    "cardCount": 100,
    "total": 245.1,
    "lowestTotal": 199.9,
    "unpricedCount": 2,
    "estimatedCount": 12
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

An entry that could not be priced also carries **`unpricedReason`**, absent on every priced card:

- Data gaps, which `unpricedCount` counts: `no-printings`, `printing-not-found`, `currency-unavailable`, `finish-unpriced-in-currency`, `no-price-data`.
- By-rule reasons, which it does not count (see [Price Summary](#price-summary)): `proxy` and `custom-art`. `custom-art` wins when a card is both.

By-rule entries still carry their printing and their `set`/`collectorNumber`: a proxy is a proxy _of_ a card, and custom art replaced the picture, not the card.

## Sell Report

:::note[The five sell routes are gated on the buyer feed being wanted]
`GET /api/sell/report`, `GET /api/sell/cart`, `POST /api/sell/refresh`, `GET /api/buylist/status`, and `POST /api/buylist/quotes` answer **`404`** unless something wants the buyer feed: [sell mode](/public-site/sell/) — [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) (off by default) or a server started with [`ritual admin --sell-mode`](/commands/admin/#sell-mode) — **or** the `cardkingdom` entry of [`priceSources`](/configuration/#price-stores-pricesources), whose retail prices come from the same feed.

The check reads the config per request, so a `config set` or a [`PUT /api/config`](/admin/api/#update-config) (the Settings page's **Offer sell mode** and **Price Stores** checkboxes) takes effect on the next request without a restart. [`GET /api/status`](/admin/api/#server-status) reports the effective value so a client can hide its sell surfaces. The public site server (`serve --api`) gates its two buylist routes the same way.

A server running under `--sell-mode` opens these routes without anything on disk saying so; [`GET /api/config`](/admin/api/#get-config) reports it as `overrides: {"site.sellMode": true}` beside the stored `config`.

The refusal body is the standard [error envelope](#error-responses), `{"success": false, "message": "Not found", "messageKey": "admin.api.server.notFound"}`: the same body the admin server answers for a path it has no route for. The same gate applies to the MCP tools that reuse these handlers (`get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, `refresh_buylist`) — see [`mcp`](/commands/mcp/#sell-tools-need-sell-mode).
:::

```
GET /api/sell/report
```

Match listed cards against the locally cached [Card Kingdom buylist](/commands/sell/) and report what CK is buying, the cash quote per Near Mint copy, and their quantity caps — the same payload as [`sell --output json`](/commands/sell/). Strictly cache-backed: the card cache **and** a downloaded feed are prerequisites (`503` otherwise, each naming its remedy). This route never downloads anything; that is [Sell Refresh](#sell-refresh)'s job.

Copies that are [priceless by rule](/custom-art/#custom-art-carries-no-price) — labeled `proxy`, wearing custom art, or both — are dropped **before** matching, so they are never quoted and never counted as cards the buyer declined. They are dropped rather than merged, so an otherwise-identical real copy in the same list keeps its own quote and quantity.

### Parameters

| Parameter  | Description                                                                                                   | Required |
| ---------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `type`     | Match every `deck`, `collection`, or `wanted` list (default: every collection)                                | No       |
| `lists`    | Comma-separated `type:slug` refs to match exactly these lists (overrides `type`); unknown → 404               | No       |
| `tags`     | Comma-separated card tags (exact); scopes matching to lines carrying one, before CK's buy caps are shared out | No       |
| `sets`     | Comma-separated set codes to filter to                                                                        | No       |
| `min`      | Minimum per-copy offer (USD)                                                                                  | No       |
| `minOwned` | Minimum total owned copies (`ownedCopies.collection + ownedCopies.deck`, a whole number)                      | No       |
| `minRatio` | Minimum offer-to-market ratio (`offerRatio`, e.g. `0.8`); entries with no market price drop                   | No       |

A blank parameter (`?min=`) reads as absent. A malformed one is a `400` carrying the parser's message: a tag that breaks the [tag shape rule](/list-format/#card-tags), a `min`/`minRatio` that is not a plain non-negative decimal (`1.5`, not `1e1` or `-1`), or a `minOwned` that is not a whole number (`Invalid minOwned '2.5' (expected a whole number)`, key `errors.number.notWholeNumber`). A numeric refusal names the parameter as it is spelled in the query string.

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
      "cardIds": [14],
      "edhrecRank": 812,
      "ownedCopies": { "collection": 3, "deck": 1 },
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
      "tcgplayerPrice": 2.1,
      "offerRatio": 0.714,
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

Entry fields:

- `status` is `buying`, `not-buying` (the product exists but CK's buy quantity is 0), or `no-match` (with `noMatchReason`: `no-printings`, `printing-not-found`, or `not-on-buylist`).
- `matchVia` names the join key that located the product (`scryfall-id`, `sku`, or `name`). `ambiguous` is set when several products matched; the quote is the best-paying one.
- An entry with `pinned: false` (an unpinned deck/wanted line) is quoted at the best-paying printing, whose set/collector/`ckFinish` it reports.
- `sellableQuantity` draws from a per-product budget of CK's `qtyBuying`, so entries sharing a product never sum past the cap. `value` prices only those copies.
- `cardIds` are the `&N` ids of the list lines aggregated into the entry, in file order (one per line; lines with no id yet contribute none). `tags` are those lines' tags; identically tagged lines aggregate together. `edhrecRank` is the card's EDHREC rank from the card cache, absent when unranked or uncached. `language` is the lines' language token (absent for English); a non-English entry is never quoted. `ownedCopies` counts the card's copies by name, across every printing, in all collections and all decks regardless of the report's scope (proxies and deck extras sections excluded).
- `tcgplayerPrice` is the quoted printing's TCGplayer market price (USD, from the card cache's Scryfall prices) at the quoted finish, and `offerRatio` is `priceBuy ÷ tcgplayerPrice` to three places. Both are absent when the cache has no price for that printing or the product is not tied to a cached printing.

## Sell Cart

```
GET /api/sell/cart
```

The entries CK is buying, rendered in their [sell-cart CSV import format](/commands/sell/#sell-cart-csv-export): `card name, edition, foil, quantity`, no header row, CK's own listing titles with variant note, quantities capped at their buy limits. Takes the same `?type=`/`?lists=`/`?tags=`/`?sets=`/`?min=`/`?minRatio=`/`?minOwned=` parameters and `503` prerequisites as [Sell Report](#sell-report). Backs the CLI's `sell --output csv`.

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

`warnings` flags CK's upload caps (500 unique titles / 5,000 cards) and etched foils the format cannot express (exported as foil). Each is a [message](#the-message-triple): English `message` plus `messageKey` (`domain.buylist.cart.etchedAsFoil`, `domain.buylist.cart.tooManyTitles`, `domain.buylist.cart.tooManyCards`) and `messageParams`. The etched warning's `titles` is a `unit` list of CK's own titles; the cap warnings' `count` and `max` are numbers.

```json
{
  "message": "The CK CSV format cannot mark etched foils; exported as foil — adjust in the sell cart: Sol Ring",
  "messageKey": "domain.buylist.cart.etchedAsFoil",
  "messageParams": { "titles": { "list": ["Sol Ring"], "join": "unit" } }
}
```

## Sell Refresh

```
POST /api/sell/refresh
```

Download Card Kingdom's pricelist feed (~70 MB) when the cached copy is missing or stale (older than a day); `?force=true` redownloads regardless. The one sell route that reaches the network.

**Response:**

```json
{
  "success": true,
  "refreshed": true,
  "feedRetrievedAt": 1785850800000,
  "feedCreatedAt": "2026-08-04 06:06:09",
  "productCount": 149978,
  "skippedRows": [
    {
      "message": "Skipped Card Kingdom product data[3]: missing card name",
      "messageKey": "domain.cache.cardKingdom.feed.productSkipped",
      "messageParams": {
        "index": 3,
        "reason": { "messageKey": "domain.cache.cardKingdom.product.noName" }
      }
    }
  ]
}
```

`skippedRows` lists the downloaded feed's product rows that were malformed and left out, one [message triple](#the-message-triple) each (English whatever the server's UI language): the first ten are itemized (`domain.cache.cardKingdom.feed.productSkipped`, whose `index` is the row's position in the feed and whose `reason` nests a `domain.cache.cardKingdom.product.*` phrase), then one `domain.cache.cardKingdom.feed.moreSkipped` message counts the rest. It is empty when nothing was downloaded or every row parsed.

A failed download returns `502` only when no feed is cached at all. With a stale cache the call answers `200` with the stale feed's stamps, `refreshed: false`, and the failure as `staleFallback`. So `refreshed: false` without `staleFallback` means the cache was still fresh; with it, you are still on the stale feed.

The failure is a message triple, English whatever the server's UI language, both as the `502` body and as `staleFallback`:

```json
{
  "message": "Card Kingdom feed download failed: HTTP 503",
  "messageKey": "domain.cache.cardKingdom.downloadHttpFailed",
  "messageParams": { "status": 503 }
}
```

Its key is one of `domain.cache.cardKingdom.downloadFailed` (the request never got an answer; `error` is the underlying error), `downloadHttpFailed` (`status` is the HTTP status), `notJson` (`error` is the parser's message), or a `domain.cache.cardKingdom.feed.*` refusal of a feed that does not have the expected shape.

Every buylist route that needs a downloaded feed (the sell report and cart, [Buylist Status](#buylist-status), [Buylist Quotes](#buylist-quotes), and the [price report](#price-summary) under `?source=cardkingdom`) answers `503` without one, keyed `domain.cache.cardKingdom.missingApiAdvice`. Its `lead` param nests the `domain.cache.cardKingdom.noFeed` sentence, and `tool`, `route` and `command` are the identifiers it names: `refresh_buylist`, `POST /api/sell/refresh` and `ritual sell --refresh auto`.

## Buylist Quotes

```
POST /api/buylist/quotes
```

The buyer's current offer for specific printings, keyed by `set:collectorNumber:finish` (set lowercased). Use it to price an arbitrary set of cards without building a whole [Sell Report](#sell-report). Strictly cache-backed: `503` with the remedy when no feed has been downloaded.

**Request:**

```json
{
  "buyer": "cardkingdom",
  "printings": [{ "set": "dsk", "collectorNumber": "136", "finish": "nonfoil", "scryfallId": "…" }]
}
```

- `buyer` defaults to `cardkingdom` (the only buyer today).
- `scryfallId` is optional but is the primary join key when present. `set`/`collectorNumber` always form the response key and drive the sku fallback for the ~0.5% of Card Kingdom products with no Scryfall id.
- `language` (optional) is the entry's [language code](/configuration/#default-language); absent means English. The buyer feeds are English-only, so a non-`en` printing is never matched: its key is absent from `quotes`, never quoted at the English product's price.
- At most 500 printings per request.
- `buyer`, each `finish` and each `language` are matched case-insensitively (like the CLI's `--finish`), and `set` and `collectorNumber` are trimmed. The response's quote keys always use the canonical lowercase finish, so a request that sends `"finish": "FOIL"` finds its quote under `…:foil`.

A malformed body is refused with `400` in English plus its key: the [request-field family](#error-responses) (`admin.api.field.*`) with the offending entry's indexed path as `field` (`printings[3].set`), `errors.enum.*` for a `buyer` or `finish` outside its choices, and `domain.card.language.invalidField` for an unknown `language`.

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

- `quotes` is **sparse**: a requested printing the buyer has no product for is absent.
- `buying` is false when Card Kingdom publishes a price but has paused buying (`qtyBuying: 0`). Treat it as no offer. A present quote is not by itself an offer, since much of CK's catalog is paused at any time, so always check `buying`. Both cases read as "not on the buylist", which is the rule the sites' **On buylist** chip and grouping use.
- `variation` is CK's variant note for the matched product, present only when they publish one. A client rendering a [cart CSV](#sell-cart) row builds CK's listed title as `name (variation)`.
- `priceRetail`/`qtyRetail` are the buyer's own NM retail price and stock, which the sites' [Card Kingdom price view](/public-site/prices/) displays. A `qtyRetail` of `0` means out of stock with the listed price standing; a `priceRetail` of `0` means no published retail price.

The public site server (`ritual serve --api`) also mounts this route, unauthenticated, and answers `404` there too unless [sell mode](/public-site/sell/) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. The public site itself does not call it (sell mode reads buy prices built into each list's data); the admin editors are the one client that quotes live, as cards are added. The public server has no refresh route, so an unauthenticated caller can never trigger the ~70 MB download.

## Buylist Status

```
GET /api/buylist/status
```

Which buyers this server can quote against and how fresh the cached feed is, without quoting anything. Backs the admin **Refresh Cache** page's buylist card.

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

`503` with the remedy when no feed has been downloaded — a normal first-run state.

## Save a List

```
POST /api/deck/:slug/save
POST /api/collection/:slug/save
POST /api/wanted/:slug/save
```

Save an editing session: the request carries **only the changes**, never the list. The route reads the file, replays the changes over it with the same rules the editors apply, and writes the result plus a changelog entry. A save therefore scales with the edit rather than the list, and a client cannot write content its changes do not describe.

What the route takes from the file rather than the request:

- **Front matter** is never taken from the request (edit it with [List Metadata](#list-metadata)). A collection or wanted list keeps its block byte for byte. A deck's is re-written in canonical form: a known field of the wrong type, or a legacy `name:` / `created:` key, is dropped, and an inferred format is made explicit. A deck whose front matter is not readable YAML is a `400`, rather than a write that would drop it.
- **The title** (a deck's name, a flat list's `# Title`), or the file's name when it has none, as the load route reports it.
- **Section order**: the file's order with the session's `add-section` / `rename-section` / `remove-section` changes replayed over it, so a section the session added survives the write while still empty.

**Request Body:**

```json
{
  "changes": [{ "action": "add", "cardName": "Sol Ring", "set": "c21", "collectorNumber": "263" }],
  "contentHash": "…",
  "continueSession": false,
  "validateCardNames": false
}
```

- `changes` are [change events](/list-format/#the-changesmd-changelog) without the `id` / `timestamp` envelope; the route stamps its own, and ignores any a client sends. At most 50,000 per save.
- `contentHash` is required: the hash the [load](#load-deck) returned. A file that changed since is a `409` with `conflict: true`; reload and retry. A filtered or paged load has no hash, because only a full load shows the whole list.
- `continueSession` (optional boolean) merges this save into the previous save's changelog entry, bumping its timestamp, instead of opening a new one. The editor sets it on every save after the first within an editing session.
- [`validateCardNames`](#validatecardnames) (optional boolean) checks every named card against the card cache.

**Validation.** Each change is decoded with the same rules the changelog and [change bundles](#import-changes) use, before the file is read. Any failure is a `400` naming the change (`changes[2] has an invalid "set".`), and nothing is written. A decode refusal is keyed `domain.changes.problem.*`, with the change it names nested as the `subject` param (see [the message triple](#the-message-triple)). Two checks answer differently: a line break is refused first, keyed `admin.api.save.lineBreak` with the JSON path as `field` (see [Line breaks](#line-breaks)), and a collection change missing its printing names the card, keyed `domain.changes.collectionPrinting.add` or `.setPrinting` with a flat `name`:

- Actions, finishes, conditions, boards and [languages](/list-format/#card-language) must be known values. A `set-language` change requires its `language`.
- Labels are signed (`["trade", "no-sale"]`; see [Card labels](/list-format/#card-labels)) and must be ones the list type carries: `proxy`/`no-proxy` alone on a deck, none on a wanted list. The `keep`/`proxy` exclusivity rule applies, and no label may be both set and negated. A `move-from`/`move-to` is the exception: its `labels` describe the moving copy as its source states them, so only the vocabulary and the conflict rules are checked, and the destination lands them on arrival.
- Tags must be [tag-shaped](/list-format/#card-tags) and are canonicalized (trimmed, single-spaced, deduplicated, sorted). Category names must be [category-shaped](/list-format/#categories-namecategoriesjson); a `set-categories` list keeps its order (the first is the primary category), and an empty one clears.
- No string may contain a line break (see [Line breaks](#line-breaks)).
- A collection change that adds a line (`add`, `move-to`, `set-printing`) must carry a printing.

**All or nothing.** A change that does not apply to the list as it stands (its card is not there, or it needs a printing pinned first) refuses the whole batch with a `400`. The body names each change that missed in an `unmatched` array (each described in English, followed by its reason in parentheses: `no-target`, `not-applicable` or `needs-printing`), and nothing is written. Its `message` (`1 change matched no card in deck "burn": "Add Sol Ring &3" — card names match exactly (case-sensitive). Nothing was saved.`) is keyed `domain.changes.unmatched.summary`, and its params nest: each reason, and each change description inside it, is a message of its own, so the editor shows the whole refusal in the reader's language. A save never reports success while dropping changes.

**Cross-list moves** in `changes` write the other list too, each with its own changelog entry:

- A `move-from {to}` adds the copy to its destination. The copy keeps the event's `tags` and `note`, and its `labels` (the copy's labels as this list states them) land by the [move rule](/commands/move/): a proxy stays a proxy and a real card real wherever both types carry `proxy`, a stated label keeps its state, an unstated one takes the destination's default, as far as the destination type accepts (`proxy` into a deck, all of them into a collection, none into a wanted list), written as the smallest override that says so. On a deck, the copy merges onto a line whose effective labels, printing and tags match, only within the `section` the move names (any section when it names none). A copy that merges onto a deck line with a different note keeps the line's note, and the dropped one is reported in `droppedNotes`.
- A `move-to {from}` (an incoming move) takes the copy out of its source: by the `sourceCardId` line when it still holds the card, else by printing, else by name for a printing-less source line. Each fallback prefers a line whose effective labels equal the move's positive `labels`, so a `[proxy]` copy leaves from the proxy line. The copy lands here with its labels written against this list's default, and a merge onto a deck line with a different note is reported in `droppedNotes` too.
- A `move-to` carrying `replacesCardId` pins one of this list's own name-only lines rather than adding a copy. When it equals the move's `cardId`, the line is converted in place — on a deck only when the copy's labels, landed against the deck default, equal the line's effective labels (`proxy` is a fact a pin never changes); an in-place pin that fails this is refused. Otherwise one copy leaves that line and lands on `cardId` as a normal arrival, with its own labels, tags and note.
- A `move-to` that pins a line (`replacesCardId`) may also carry `replacement` (`{ set, collectorNumber, finish?, language? }`): that printing is added to the source list in place of the copy taken, logged there as an `Added` line. A `replacement` without `replacesCardId` is a `400`.

Every move is validated in memory before anything is written. A missing list, a source with no copy to take, or a printing-less card headed into a collection fails the save with nothing written.

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection",
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

See [`effects`](#effects) for what the array reports.

### Unreadable lines block a save

All three save routes parse the file on disk before applying anything, and refuse with `400` when that parse yields any [`warnings`](#load-deck). A line the parser cannot read, or a [fenced code block](/list-format/#fenced-code-blocks), is content the re-serializing write would delete, releasing any `&N` ids it held back into the reuse pool. The message names the file and each entry. Nothing is written. Fix the line, or remove the fenced block, and retry; `GET /api/{type}/:slug` reports the same list in its `warnings` field. A held deck line refuses the save the same way, with its own message (`messageKey: domain.list.rewriteHold`, `action: saving`): nothing would be deleted, but the write would change what the line means. When a file holds both, the refusal says both. MCP mutations surface the same refusal as a tool error.

### Line breaks

Card names, printings, sections, and list names are written into single-line card lines, headings, and changelog entries, so none of them may contain a line break (newline, carriage return, vertical tab, form feed, NEL, or U+2028/U+2029). The [save route](#save-a-list) checks every string in `changes`, and [Move Selected Cards](#move-selected-cards) and `POST /api/move/commit` check their `moves`. A line break anywhere in those is a `400` with `messageKey: admin.api.save.lineBreak` naming the JSON path, such as `changes[2].cardName` or `moves[0].cardName`. A save's notes are trimmed first, so a pasted trailing newline on a note is not refused. Nothing is written. [Import changes](#import-changes) refuses a bundle carrying one the same way. MCP mutations surface the refusal as a tool error.

### `validateCardNames`

The save routes and the [Move Selected Cards](#move-selected-cards) / [Remove Cards](#remove-cards) routes accept an optional boolean `validateCardNames`, default `false`. It is validated, never coerced: any non-boolean value is a `400`.

With it set, every card name the request mentions is checked against the local Scryfall card cache before anything is written:

- A name **already present in the affected list** is accepted with no lookup, so a custom, proxied, or unreleased card stays removable and editable.
- Any other name must be one the cache knows. An unknown one is a `400` naming up to three of the closest cached spellings.
- An **empty** cache is also a `400` (not a `503` as on [Price List](#price-list)), naming both remedies: the MCP `refresh_cache` tool, or `ritual cache preload-all`.

The admin UI leaves it off. The MCP write tools set it on every request, except the import tools, whose engines report per-row failures.

### `effects`

The [save route](#save-a-list) answers with an `effects` array describing what the save did to individual card lines, and a `contentHash` for the next save. Each entry is `{ action, cardId, name, section?, quantity, printing?, previousCardId? }`, where `action` is `added`, `removed`, or `updated`.

`previousCardId` appears only on an `updated` effect whose line was **renumbered**: another entry in the same save claimed its `&N` (a cross-list move carrying its source id, a replayed change bundle), so the serializer gave the older line a fresh number.

A card's `&N` id is allocated inside the save, so the response is the **only** place a client that added a card can learn the id its line got. Set codes inside `printing` are lowercase.

A save also re-files the list's [custom-art](/custom-art/) sidecar from the **changes**, not from the file it produced: a card the changes remove loses its art even when they re-add the same card and the new line takes the same `&N` back. To put art on a card you are adding, wait for the save to answer, then aim a [Card Art](#card-art) write at the id the effects report (following `previousCardId` where a line was renumbered). The admin editors' [add-card dialog](/admin/editors/#card-options) does this.

### `artWarnings`

When that re-filing could not happen, the save still succeeds and reports the problem in an **`artWarnings`** array, one message per sidecar it had to leave alone. Causes:

- The list's own `.art.json` cannot be read.
- The `.art.json` of a list this save's cross-list moves ([**Move to list…**](/admin/editors/#custom-art), [**Swap Printings…**](/admin/editors/#swap-printings)) send cards to or take them from cannot be read.
- A moved copy's art has no destination line to follow onto.

The field is omitted when everything re-filed cleanly, and shares its name with the load routes' [sidecar problems](#load-deck) channel.

The card lines were written correctly; the only casualty is that art may now sit under an `&N` the save freed or renumbered. Fix the sidecar by hand (the message names the file and the parse failure) and the art applies again, or comes off the list with the next art write.

### `categoryWarnings` and `prunedCategories`

A save also commits the list's [categories sidecar](/list-format/#categories-namecategoriesjson). The sidecar is keyed by card **name**, so the save is what tells it which entries no card backs any more:

| Field              | Type       | Meaning                                                                                                        |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `categoryWarnings` | `string[]` | The categories sidecar could not be read or written. A warning, never a failure — the card lines were written. |
| `prunedCategories` | `string[]` | Card names whose category assignments this save dropped, because the list no longer holds a line of that name. |

Both are omitted when there is nothing to report. A save that carries no category change and prunes nothing leaves the sidecar byte-identical, including a hand-edited one, whose stale `.sha256` survives so [`detect-changes`](/commands/detect-changes/) still records the edit.

## List Collections

```
GET /api/collections
```

Returns the available collections.

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

Load a collection with full card data, printings, and mana symbol map. Accepts the same [list load parameters](#list-load-parameters) as [Load Deck](#load-deck); the `cards` view returns `entries` + `sectionOrder` rather than a deck.

- Top-level `description` — the collection's front-matter blurb, absent when none is declared.
- Top-level `labels` — its [default card labels](/list-format/#default-labels-and-descriptions), absent when none are declared. An entry's own `labels` is its per-card override, signed (`["trade", "no-sale"]`); its effective labels are the default adjusted by it: the positives added, the negated labels taken away. Each entry also carries `effectiveLabels`, those labels resolved by the server (empty when it has none), so a client never re-implements the rule.
- Entry `tags` — the line's [tags](/list-format/#card-tags), canonical and without the `#`, absent when it has none.
- Entry `categories` — the card name's [categories](/list-format/#categories-namecategoriesjson) in this list, primary first, absent when it has none. The list's own vocabulary is the top-level `categories` — see [Load Deck](#load-deck).

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [
    {
      "name": "Sol Ring",
      "set": "2xm",
      "collectorNumber": "270",
      "labels": ["keep"],
      "effectiveLabels": ["keep"],
      "tags": ["Binder: Trade", "Ramp"],
      "cardId": 1
    }
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

## Create Collection

```
POST /api/collection/create
```

Create a new collection file, named after the collection — see [List file names](/commands/new/#list-file-names).

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

Delete a collection file and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses). `confirmName` must match the parsed `# Title` exactly.

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
  "message": "Deleted collection 'My Collection'; its files are in .trash/2026-10-05T14-03-22Z-collection-My Collection",
  "deletedFiles": [
    "/home/me/mtg/collections/My Collection.md",
    "/home/me/mtg/collections/My Collection.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-collection-My Collection"
}
```

## List Wanted Lists

```
GET /api/wanted
```

Returns the available wanted lists.

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

- Entry `tags` — the line's [tags](/list-format/#card-tags), canonical and without the `#`, absent when it has none. Wanted entries carry tags exactly as deck and collection cards do; they are the one list type without `labels`.
- Entry `categories` — the card name's [categories](/list-format/#categories-namecategoriesjson) in this list, primary first, absent when it has none. The list's own vocabulary is the top-level `categories` — see [Load Deck](#load-deck).

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [
    { "name": "Sol Ring", "set": "2xm", "collectorNumber": "270", "tags": ["Ramp"], "cardId": 1 }
  ],
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

## Create Wanted List

```
POST /api/wanted/create
```

Create a new wanted list file, named after the list — see [List file names](/commands/new/#list-file-names).

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

Delete a wanted list file and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses). `confirmName` must match the parsed `# Title` exactly.

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
  "message": "Deleted wanted list 'Holiday Wishlist'; its files are in .trash/2026-10-05T14-03-22Z-wanted-Holiday Wishlist",
  "deletedFiles": [
    "/home/me/mtg/wanted/Holiday Wishlist.md",
    "/home/me/mtg/wanted/Holiday Wishlist.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-wanted-Holiday Wishlist"
}
```

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

Move a batch of selected cards across lists atomically — backs the cross-list **Move all selected** action. Each item addresses its source card by list + identity (the same `cardId`/`copyIndex` scheme as [Remove Cards](#remove-cards)) and its destination by `toType` + `toSlug`. The optional printing fields, `language`, and `toSection` behave exactly as in [Commit Moves](#commit-moves). Cards or destinations that can no longer be resolved, or whose destination is the list they already live in, are skipped and reported. The optional [`validateCardNames`](#validatecardnames) flag applies here too.

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

Remove a batch of cards across lists atomically — backs the cross-list **Remove all selected** action. The state is rebuilt from disk, each requested card is resolved to its physical key, and the source files and their changelogs are written in a single pass. Deck copies are addressed by `copyIndex` (one item per copy); collection and wanted entries use their `cardId` at `copyIndex` 0. Cards that can no longer be resolved are skipped and reported. The optional [`validateCardNames`](#validatecardnames) flag applies here too. When git auto-commit is enabled, the written files are committed in a single commit (`Remove N cards`).

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

## List All Lists

```
GET /api/lists
```

Returns every list (deck, collection, wanted) as a slug-keyed summary. The single canonical enumeration route; it populates the [Change History](/admin/history/) page's list picker and the cross-list move targets.

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

Compare two lists (any mix of deck, collection, and wanted list) and return the matched identities with per-side quantities plus the entries only one side has. Exposed as the MCP `diff_lists` tool; shares its engine with the [`diff`](/commands/diff/) CLI command — see that page for the identity rules (nonfoil folding, the no-printing bucket, all sections included).

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

`matches` includes identities whose quantities are equal on both sides; clients decide what counts as interesting. `warnings` carries list parse warnings from either side, and names a list's [`.categories.json` sidecar](/list-format/#categories-namecategoriesjson) that could not be read (the diff still runs). Each entry is a [message triple](#the-message-triple): `domain.export.warning.inList`, whose `list` names the list and whose `warning` nests the parser's own message.

## Load Change History

```
GET /api/history/:type/:slug
```

Returns the parsed change sets of a list's change log (newest first) plus the typed change events a "rewrite with defaults" would produce. `:type` is `deck`, `collection`, or `wanted`.

- Each set carries its prose `lines` and its `events`: the typed events from the entry's [`ritual-changes` block](/list-format/#the-changesmd-changelog), one per line in the same order (empty for a legacy entry with no block).
- The list file and its [`.categories.json` sidecar](/list-format/#categories-namecategoriesjson) are read only to derive `defaultEvents`. A list with no change log yet returns an empty `sets` array.
- A sidecar that exists but cannot be read contributes no category events and is reported in a `categoryWarnings` array (absent otherwise).
- A set followed by hand-written non-change text carries it in a `trailing` array (absent otherwise). The text survives an edit-and-save round trip: each line is kept as written and re-emitted after the set's change lines; blank lines between them are not kept.

**Response:**

```json
{
  "success": true,
  "header": "# Changelog for My Deck",
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"],
      "events": [
        {
          "action": "add",
          "cardName": "Sol Ring",
          "cardId": 1,
          "set": "lea",
          "collectorNumber": "1"
        }
      ],
      "trailing": ["NOTE TO SELF: the FNM tuning session."]
    }
  ],
  "defaultEvents": [
    { "action": "add", "cardName": "Sol Ring", "cardId": 1, "set": "lea", "collectorNumber": "1" }
  ]
}
```

## Save Change History

```
POST /api/history/:type/:slug/save
```

Overwrite the list's change log with the supplied change sets. Each set needs:

- a valid ISO-8601 `timestamp`;
- a `lines` array of strings, each starting with `- `;
- an `events` array of typed change events, one per line in the same order, echoed back from `GET` (empty only for a legacy set that had none). An event that does not decode is a `400` naming it (`Set #1 event #2 is missing its "id".`), keyed `domain.changes.problem.*` with the event nested as its `subject`.
- optionally a `trailing` array of preserved hand-written lines. These must **not** start with `- ` or `## ` (they would be re-parsed as change lines or set headers on the next load) and are written back verbatim after the set's change lines.

Only the `.changes.md` file is written; the list's own `.md` is never touched, and the existing header is preserved. When git auto-commit is enabled, the change log is committed (`Rewrite change history for <slug>`).

**Request Body:**

```json
{
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"],
      "events": [
        {
          "action": "add",
          "cardName": "Sol Ring",
          "cardId": 1,
          "set": "lea",
          "collectorNumber": "1"
        }
      ]
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

Write a list's YAML front matter. Decks take the deck vocabulary below; decks and collections take `labels` (their [default card labels](/list-format/#card-labels)); **all three types** take `description` (the blurb the built site prints above the cards) and `image` (the list's [cover image](/list-images/)). Those two are the only fields a wanted list accepts; a `labels` key on a wanted body is a `400` naming the field. Shares its engine with the [`metadata`](/commands/metadata/) CLI command (which covers all three types and does not write `image`), [`set-list-image`](/commands/set-list-image/), and the MCP `set_list_metadata` tool.

Only the fields present in the body are written; every other front-matter key (including user-authored ones) round-trips untouched. A field sent as `null` is deleted, as is a `description` sent as an empty string. The markdown body below the front matter is left byte for byte as it was: card lines are never re-serialized and no card IDs are assigned. **No changelog entry is written**, since metadata is not a card change.

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

| Field         | Validation                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | All three types. String (trimmed) or `null`; an empty (or blank) string clears it                                                                                                                                                                              |
| `tags`        | Deck only. Array of non-empty strings (trimmed, deduplicated, order preserved); `null` or `[]` clears the key                                                                                                                                                  |
| `format`      | Deck only. A [deck format](/commands/new/#deck-format) name, canonicalized (`EDH` → `commander`); `null` clears it and the deck falls back to section inference                                                                                                |
| `sourceId`    | Deck only. Non-empty string or `null`                                                                                                                                                                                                                          |
| `sourceUrl`   | Deck only. An `http`/`https` URL or `null`                                                                                                                                                                                                                     |
| `labels`      | Deck and collection. Array of `sale`/`trade` (combinable) or `keep`/`proxy` (each alone), case-insensitive, normalized to canonical order; a **deck** accepts `proxy` alone. A default is positive only (`no-…` is refused). `null` or `[]` clears the default |
| `image`       | All three types. A single-key mapping — `{"card": N}`, `{"file": "rel/path"}` or `{"url": "https://…"}` — or `null` to clear it. Scalars are rejected. See below                                                                                               |
| `contentHash` | Optional concurrency token from the list's load route; a non-string value is a `400`                                                                                                                                                                           |

Rejected fields, each a `400`:

- `name` — the message points at [`POST /api/deck/:slug/rename`](#rename-deck), which also renames the file and its sidecars.
- `created` and `lastSynced` — stamped by Ritual (deck creation and [deck sync](/commands/deck-sync/)).
- Any unknown field. A deck-only field on a collection (and vice versa) is an unknown field.

A flat-list (collection or wanted) write refuses with `400` when the file's existing front matter cannot be read as a YAML mapping, since merging over keys it cannot see would clobber them.

`image` is validated as the front-matter grammar is (see [List cover images](/list-images/)), with one addition: a `{"card": N}` reference is checked against the file being written, so an `&N` the list does not carry is a `400` naming the raw id, and nothing is written. A `{"file": …}` path is checked for shape only (the image need not exist yet; a missing one is a build-time warning), and a `{"url": …}` is never fetched.

Setting `sourceId` together with an `archidekt.com` `sourceUrl` makes a deck sync-linked, so these fields change which decks [`POST /api/deck-sync`](#sync-decks) operates on. The two must name the **same** Archidekt deck once merged over what the file already carries: a sync addresses the deck by `sourceId` while every surface shows `sourceUrl`, so a mismatched pair would push one deck's cards into another. A request that produces one is a `400` (`sourceUrl names Archidekt deck 999 but sourceId is 123. …`) and writes nothing. A `sourceUrl` on another service is not constrained.

When `contentHash` is supplied and no longer matches the file, the response is `409` with `"conflict": true`, the same optimistic-concurrency contract as the editor save routes. Omit it for a plain read-modify-write. The write updates the file's hash, so an editor that had the deck open sees a conflict on its next save rather than silently clobbering the new metadata.

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

Set or clear one card's [custom art](/custom-art/) on any list type. Like the metadata route this is a **direct** write: no change event, no changelog entry, and **no `contentHash` round trip**. Card lines and the `<list>.art.json` sidecar are separate files, so the write is safe alongside an editor's pending card edits.

**Request Body:**

```json
{ "cardId": 5, "art": { "file": "proxies/sol-ring.jpg" } }
```

| Field    | Validation                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cardId` | Required. A card line's `&N` id (a positive integer) that the list actually holds                                                                                                                                                          |
| `art`    | Required. `{ "file": "<art-dir-relative path>" }` (ending in `.avif`/`.gif`/`.jpeg`/`.jpg`/`.png`/`.webp`), `{ "url": "<http(s) URL>" }`, or `null` to clear the card's art. Exactly one of `file`/`url`, and no other key, may be present |

Any other field is a `400` naming it.

The save, move, and remove routes re-file this sidecar themselves — see [Art follows the card](/custom-art/#art-follows-the-card):

- A save or removal that drops a card drops its art, even when the same save re-adds that card.
- A renumbered line takes its entry with it.
- A cross-list move carries the entry to the destination list's sidecar under the new line's `&N`. A copy that merges onto a line the destination already had keeps that line's own art.

The sidecars land in the same auto-commit as the list files they describe.

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

Refusals are `400` for:

- a malformed body;
- a `cardId` the list does not hold (for a card an editing session added but has not saved, save first and use the id the save's [`effects`](#effects) report);
- a reference that does not parse: a backslash, an absolute path, a `..` escape, a `file` whose extension is not one the art route serves, a non-`http(s)` URL;
- a `file` with no image behind it in the configured art directory (the message names the exact path checked);
- an existing `.art.json` that cannot be read. The route refuses rather than overwrite it, since that would erase art for cards the request never mentioned.

Each refusal is keyed (see [Error responses](#error-responses)). A reference the grammar refuses carries its own `domain.list.art.*` key; an unreadable `.art.json` answers `domain.list.sidecar.problem`, whose `file` is the sidecar's path and whose `reason` nests the parse problem (`domain.list.sidecar.invalidJson`, `domain.list.art.sidecarBadEntry` with the entry's own refusal nested again, …).

An unknown list is a `404`.

Clearing the last card's art removes the sidecar rather than writing `{}`. When git auto-commit is enabled the sidecar is committed with the message `Update custom art for <type> <slug>`, but only when a file was actually written or removed.

The images themselves are served read-only, behind the same login, at `GET /art/<relpath>` from the configured [`artDir`](/configuration/#directory-options), which lets the editor preview a local file. Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served (the same allowlist a `file` reference is validated against), and any path leaving the art directory is a `404`. That `404`'s body is `{"error": "Not found", "errorKey": "admin.api.server.notFound"}`: the English under `error`, its key beside it.

## Deck Sync Status

```
GET /api/deck-sync
```

Returns every Archidekt-linked deck that can be synced — those whose front matter has both an Archidekt `sourceUrl` and a `sourceId` — plus the stored Archidekt login. Backs the [Sync Decks](/admin/sync-decks/) page and the MCP `get_sync_status` tool.

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

Sync decks with Archidekt, using the same engine as the [`deck-sync`](/commands/deck-sync/) CLI command. Exposed as the MCP `sync_decks` tool. Requires a stored Archidekt login; without one the response is `401` with `loginRequired: true`.

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
| `decks`                 | Deck slugs or names, resolved like CLI list arguments. Omitted or empty syncs every linked deck; blank names are dropped, and a list of only blank names is a `400`.                                                          | No       |
| `dryRun`                | Report what would sync without writing files or pushing changes (default `false`).                                                                                                                                            | No       |
| `ignoreUnreadableLines` | Sync decks whose files hold content a rewrite cannot reproduce — unreadable lines or a fenced code block — deleting it (default `false`).                                                                                     | No       |
| `only`                  | `additions` or `removals` — apply just one side of each deck's diff, relative to the sync destination (see [Change Filter](/commands/deck-sync/#change-filter)). Omitted applies every change; any other value returns `400`. | No       |
| `force`                 | Push a deck whose remote copy changed since its recorded sync, overwriting those remote changes (default `false`). Must be a boolean or `400`. A pull ignores it.                                                             | No       |
| `syncPrintings`         | Also sync each card's exact printing — set, collector number, and foil/etched finish (default `false`). Must be a boolean or `400`. See [Printing Sync](/commands/deck-sync/#printing-sync---sync-printings).                 | No       |
| `syncCategories`        | Also sync each card's categories — its role in the deck (default `false`). Must be a boolean or `400`. See [Category Sync](/commands/deck-sync/#category-sync---sync-categories).                                             | No       |

**Divergence guard.** A `push` refuses any deck whose Archidekt `updatedAt` is newer than the `sourceUpdatedAt` its last sync recorded, so remote edits are never silently reverted. Such a deck is reported `failed` with `Remote deck changed since last sync (…) — pull first, or pass --force to overwrite remote changes.`, and the rest of the run continues. A `pull` of that deck records the new baseline (even when it finds no card changes), after which the push succeeds; `force: true` overrides the guard. See [Divergence Guard](/commands/deck-sync/#divergence-guard-push).

**Unreadable lines.** A sync rewrites each deck file, so a line the parser cannot read, or a [fenced code block](/list-format/#fenced-code-blocks), would be deleted by the save. Over HTTP there is nobody to prompt, so such decks **fail** (`N unreadable lines would be dropped by a sync`) unless the request sets `ignoreUnreadableLines` — the API equivalent of the CLI's [`--yes`](/commands/deck-sync/#unreadable-lines). The affected decks and their exact lines are reported in `report.unreadable` and, on the stream, as a `progress` frame with `kind: "unreadable-lines"` emitted before the decision is applied. A `dryRun` request is exempt: it writes nothing, so those decks are previewed rather than refused.

**Response:**

```json
{
  "success": true,
  "message": "Pushed 2 decks, 1 skipped.",
  "summary": {
    "clauses": [
      {
        "message": "Pushed 2 decks",
        "messageKey": "admin.api.deckSync.pushed",
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
    "direction": "push",
    "decks": [
      { "name": "Winota Stax", "status": "synced", "outcome": "changed" },
      {
        "name": "Oops All Soldiers",
        "status": "synced",
        "outcome": "unchanged",
        "reason": "no changes",
        "reasonKey": "domain.sync.reasonNoChanges"
      },
      {
        "name": "Borrowed Deck",
        "status": "skipped",
        "reason": "you do not own Archidekt deck 12345",
        "reasonKey": "domain.sync.notDeckOwner",
        "reasonParams": { "deckId": "12345" }
      }
    ],
    "failedCount": 0,
    "unreadable": [],
    "cancelled": false
  }
}
```

`summary` is **required** on a completed run: the same sentence as `message`, split into ordered keyed clauses so a client with a translator can render it in the reader's locale. Each clause is a [message triple](#the-message-triple) with no final punctuation. `message` is unchanged.

`success` reports whether the run could be performed, **not** whether every deck synced. A run with per-deck failures still returns `200` with `success: true` and a non-zero `report.failedCount`, so read each deck's `status` and `reason`. Other report fields:

- Each deck carries `outcome`, the code to branch on: `changed` (written or sent), `unchanged` (already matched, or a push that once planned had nothing to send), `dry-run` (a preview, which `reason` summarizes) or `cancelled` (never reached). Collection lists add `not-run` (see [Sync Collection](#sync-collection)). It is absent on a failed deck and on one skipped for another reason. Never match on `reason` text.
- `reason` is English whatever the operator's UI language — the [message triple](#the-message-triple)'s contract — with `reasonKey` and `reasonParams` beside it, as `messageKey` and `messageParams` are beside `message`. A sync's params may nest: a param is a string or number, another message (`{ messageKey, messageParams }`), a list (`{ list, join }`, where `join` is `and`, `unit`, `clauses` or `concat`), a duration (`{ elapsedMs }` for how long something took, `{ durationMs }` for an age or a time-out, such as the card cache's age in a push's CSV cache check) or a card language (`{ language }`), all rendered in the same locale as the message around them. A reason raised outside the catalog (a network error) has no key.
- Each deck carries `printingsChanged` (a count) when the request set `syncPrintings`, or `printingsUnaligned` (the card names whose printings the two sides disagree about) when it did not.
- Each deck carries `categoriesChanged` (a count of cards) when the request set `syncCategories`.
- Each deck carries `boardMoves` (a count) when its diff moved cards between boards. Moves bypass `only`: a move adds and removes no copies, so neither filter value drops it. See [Board moves](/commands/deck-sync/#board-moves).
- Each deck that had card changes carries `changes`: every change the run applied (or would apply on a dry run), narrowed by `only`. It lists what went through: a push leaves out what its plan could not send, or did not need to. When the push itself failed (nothing was sent), it lists what the push attempted, and `reason` says so. Entries are discriminated by `kind`: `added`/`removed` (`name`, `quantity`, `board`), `quantity` (`name`, `board`, `from`, `to`), `move` (`name`, `quantity`, `from`, `to` boards), `printing` (`name`, `board`, `from`, `to` printings) and `categories` (`name`, `categories`, primary first). The first four carry an optional `printing` (`set` lowercase, `collectorNumber`, `finish`) on a run syncing printings. These are the cards the CLI lists under `--verbose`. The SSE stream carries the same cards as `detail` log lines.
- `report.unreadable` lists any deck whose file holds lines the parser could not read (`{ name, file, warnings }`, each warning a [message triple](#the-message-triple)), so a caller that never sees the stream can still show what a retry with `ignoreUnreadableLines` would delete.
- `report.ownedDecksIncomplete`, on a push only, is present when Archidekt stopped serving the list of decks the account owns part way (a next-page link Ritual would not follow, a page served twice, the 100-page cap): a message triple saying why (`domain.sync.archidekt.nextLinkForeign`, `nextLinkUnreadable`, `pageRepeated` or `pageCapReached`). While it is present, a deck missing from that list is `skipped` with the reason `domain.sync.ownershipUnknown` (`deckId`, and the same message nested as `reason`), not `domain.sync.notDeckOwner`. The stream carries it as a run-level `warn` log line.
- A failed Archidekt request is keyed `domain.sync.archidekt.*`, its HTTP `status` a number param and Archidekt's own explanation, when it gave one, the `reason` of the key's `WithReason` twin; a reply Archidekt sent that Ritual could not read is a `…Unreadable` key nesting what was wrong.
- `report.cancelled` is `true` when an in-process caller cancelled the run (the MCP `sync_decks` tool, on a client's `notifications/cancelled`). Cancellation is honoured **between decks only**: the deck in flight finishes, every deck the run never reached is reported `skipped` with the `cancelled` outcome (its English `reason` reads `cancelled before it started`), and the summary ends on a `cancelled with N decks not started` clause. The response is still `200` with the report. HTTP callers cannot cancel a run: closing the stream leaves it running to completion.

When git auto-commit is enabled, deck files written by the run are committed (`Sync decks with Archidekt (<direction>)`).

## Deck Sync Stream

```
GET /api/deck-sync/stream?direction=pull&deck=<slug>&deck=<slug>&only=additions&dryRun=true
```

The same sync as `POST /api/deck-sync`, streamed as server-sent events. `EventSource` can only issue a bodyless `GET`, so the request arrives as query parameters:

- `direction` is required.
- `deck` repeats once per deck; omit it entirely to sync all.
- `only` takes `additions` or `removals`; omit it to apply every change.
- `dryRun` / `ignoreUnreadableLines` / `force` / `syncPrintings` / `syncCategories` take `true` or `false`. Any other value is rejected, so a flag that decides whether files are written can never be misread as "no".

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the deck being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message, messageKey?, messageParams? }` (`item` is `null` for run-level lines; `level` is `info`, `warn`, `error`, or `detail` — one line per card change under a deck's `Changes:` summary; `message` is English, and the key and params, which may nest as a deck's `reasonParams` do, let the page render the line in the reader's language), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items: [{ name, file, warnings }] }` (each warning a [message triple](#the-message-triple), as in `report.unreadable`). |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](#the-message-triple), keyed `summary`, and report the JSON route returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `error`    | `{ message, messageKey?, messageParams?, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure); a [message triple](#the-message-triple) whose params may nest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Failures are reported inside the stream rather than as an HTTP status, since `EventSource` exposes no response body for a non-2xx open.

## Collection Sync Status

```
GET /api/collection-sync
```

Returns every collection list a run can be scoped to, the stored Archidekt login, when the account last synced, and the list a pull adds new cards to.

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

- `lastSynced` is account-level rather than per-list (an Archidekt account has one collection while Ritual has many collection lists). It is `null` until a run applies something for real: a dry run records nothing, and neither does a run that stopped without writing (see [Sync Collection](#sync-collection)). The stamp means "the lists and the account agreed at this time".
- `pullTarget` is the [`collectionSync.pullTarget`](/configuration/#collection-sync) config key: the list a pull adds new cards to unless the request names another.
- `csvThreshold` is how many new printings a push adds one at a time before the [CSV import path](#csv-import-for-new-cards) takes over, so a caller can explain or decide the `csv` field.

## Sync Collection

```
POST /api/collection-sync
```

Sync the account's Archidekt collection with the local collection lists, using the same engine as the [`collection-sync`](/commands/collection-sync/) CLI command. Requires a stored Archidekt login; without one the response is `401` with `loginRequired: true`. A login that predates recording which account it belongs to is refused the same way (a collection is fetched by numeric user id), so sign in again.

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

| Field                   | Description                                                                                                                                                                                                                                                                                                                                                                                                           | Required |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `direction`             | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value returns `400`.                                                                                                                                                                                                                                                                                                                              | Yes      |
| `lists`                 | Collection list slugs or names, resolved like CLI list arguments. Omitted or empty compares the whole collection (a list of only blank names is a `400`); the remote side is always the entire Archidekt collection.                                                                                                                                                                                                  | No       |
| `into`                  | The list a pull adds new cards to, created if it does not exist. A name **two** lists answer to fails the run before anything is fetched or written. Omitted uses the `collectionSync.pullTarget` config key. A push ignores it.                                                                                                                                                                                      | No       |
| `only`                  | `additions` or `removals` — apply just one side of the diff, relative to the sync destination. Omitted applies every change; any other value returns `400`.                                                                                                                                                                                                                                                           | No       |
| `removalPriority`       | Collection list names **in priority order** — the only lists an ambiguous removal may take copies from (see below). Must be an array of non-blank names or `400`. A push ignores it.                                                                                                                                                                                                                                  | No       |
| `removalAssignments`    | An explicit decision per ambiguous removal: `[{ key, choices: [{ list, copies }] }]`, where `key` is the removal's key as `report.ambiguous` reports it and each choice names a list losing `copies` (a whole number ≥ 1). Shape-validated here (`400`); whether the lists hold those copies and the counts add up is reported through the run. Cannot be combined with `removalPriority` (`400`). A push ignores it. | No       |
| `csv`                   | Upload a push's **new cards** as one CSV import instead of adding them one at a time (see below). Must be a boolean or `400`. A pull ignores it.                                                                                                                                                                                                                                                                      | No       |
| `dryRun`                | Report what would sync without writing files or touching Archidekt (default `false`).                                                                                                                                                                                                                                                                                                                                 | No       |
| `ignoreUnreadableLines` | Sync lists whose files contain lines the parser cannot read, dropping those lines (default `false`).                                                                                                                                                                                                                                                                                                                  | No       |

A `csvFile` field is **rejected** with `400` rather than ignored: writing a CSV to a caller-named path is a CLI-only feature ([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)), and a caller mirroring the CLI's flags should be told instead of having its additions uploaded.

### CSV import for new cards

Adding a printing Archidekt does not have costs a [paced](/commands/collection-sync/#rate-limiting) search plus a create, so a first push of a real collection would take hundreds of requests. `csv: true` sends those additions through Archidekt's own collection importer instead — one upload, with every row built from the local Scryfall cache — exactly as the CLI's [`--csv`](/commands/collection-sync/#csv-import-for-new-cards) does, however few there are.

A push adding more new printings than `csvThreshold` without `csv: true` **fails before writing anything to Archidekt**: the guidance lands in `report.errors`, `report.csv` stays `null`, and no record is created, grown, or deleted. A `dryRun` never needs the flag: over the threshold it reports the upload it would make and resolves nothing. Quantity changes and removals never use the CSV (removals use Archidekt's bulk-delete endpoint). Additions whose printing the local cache does not hold cannot become rows; they are added one at a time and counted in `report.csv.uncached`.

The rows are keyed by the Scryfall ids the **local card cache** holds, so a run taking this path treats cache freshness as [`--refresh auto`](/commands/collection-sync/#cache-freshness): an empty or day-old cache is redownloaded before the file is built, reported as a `log` event on the stream and in the run's messages.

**Ambiguous removals.** A pull removal is ambiguous when only _some_ of a printing's copies are going and those copies live in several lists, so nothing says which list the card physically left. (Taking every copy, or copies held in a single list, is never ambiguous.) The decision is made up front, as either:

- `removalPriority` — copies come only from the lists it names, walking them in the order given. Names are matched exactly, never by the substring rule other list lookups use, and an unknown name fails the run.
- `removalAssignments` — an explicit per-removal decision.

Without either, or with one that does not cover a removal, the run **fails and writes nothing at all**: the reason lands in `report.errors`, `report.unresolvedAmbiguity` is `true`, `report.ambiguous` carries each removal with its per-list copy counts, no list file is touched, and the account's `lastSynced` is left alone. A `dryRun` request never fails on an ambiguity itself; it reports it instead. (An unknown `removalPriority` name still fails a `dryRun`: that is a bad argument, not an unresolved removal.)

**Unreadable lines.** A pull rewrites each list file and a push treats those files as the truth, so a line the parser cannot read would be lost either way. Such lists **fail** unless the request sets `ignoreUnreadableLines`, the API equivalent of the CLI's `--yes`. The affected lists and their exact lines are reported in `report.unreadable` (`{ name, file, warnings }`, each warning a [message triple](#the-message-triple)) and, on the stream, as a `progress` frame with `kind: "unreadable-lines"`. A `dryRun` request is exempt: it writes nothing, so those lists are previewed rather than refused.

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
    "lists": [
      {
        "name": "binder",
        "status": "synced",
        "outcome": "changed",
        "added": 1,
        "removed": 0,
        "pending": 0,
        "changes": [
          {
            "kind": "added",
            "name": "Lightning Bolt",
            "quantity": 1,
            "printing": {
              "set": "lea",
              "collectorNumber": "161",
              "finish": "nonfoil",
              "condition": "NM"
            }
          }
        ]
      }
    ],
    "failedCount": 0,
    "errors": [],
    "errorMessages": [],
    "unreadable": [],
    "ambiguous": [],
    "localIncomplete": false,
    "csv": null,
    "totals": { "added": 1, "removed": 0, "skipped": 0, "pending": 0 },
    "cancelled": false,
    "unresolvedAmbiguity": false
  }
}
```

`summary` is **required** and works exactly as it does for [Sync Decks](#sync-decks).

`success` reports whether the run could be performed, **not** whether every list synced: a run with per-list failures still returns `200` with `success: true` and a non-zero `report.failedCount`. Report fields:

- `report.lists[].outcome`, `reason`, `reasonKey` and `reasonParams` work as a deck's do in [Sync Decks](#sync-decks): branch on `outcome`; `reason` is English, the key and params render it in the reader's language. Several reasons for one list are joined into one. A run that refuses before reaching its lists (a bad `into` or `removalPriority`, an unresolved ambiguity, or a push's additions it will not send) reports them `skipped` with the outcome `not-run` and the reason `not synced: the run stopped before this list`. `changed` includes copies a CLI push wrote to its `--csv-file` for upload.
- `report.lists[].changes`, present when a list had any: every card behind its counts, which are its totals. Each entry has a `kind` (`added`, with `via: "csv"` when a push's CSV import created it, or `removed`), `name`, `quantity` in copies, and `printing` (`set` lowercase, `collectorNumber`, `finish`, `condition`, and `language` when not English). There is one entry per card, printing and kind, narrowed by `only`. The `pending` kind comes only from the CLI's `--csv-file` and never appears on this surface. It lists what went through, or would on a dry run: a card whose write failed is left out, and the list's `reason` says what failed. On a push a card held in several lists is one key, so its entry, with the key's whole quantity, is listed under each of them. A list a cancellation skipped may still carry changes an earlier list's turn made for it. The SSE stream carries the same cards as `detail` log lines.
- `report.unlisted` — a push's deletions of records for cards no in-scope list holds any more (the same shape as a `removed` change), present only when there is at least one; a failed one is in `errors` instead.
- `report.errors` — failures that belong to the run rather than to one list (the collection fetch, or deleting records for cards no list holds any more), in English.
- `report.errorMessages` — the same failures, in the same order, as `{ message, messageKey?, messageParams? }` messages for a client that renders them in its own language.
- `report.ambiguous` — every removal a pull could not place on its own, whether a strategy then placed them or the run failed on them. Counts are in copies, not lists.
- `report.unresolvedAmbiguity` — `true` when the run stopped _because_ of them: no `removalPriority` or `removalAssignments` was given, the priority could not cover a removal, or the assignments did not account for every copy. Nothing was written; rerun with a decision. Branch on this flag rather than the prose in `errors` (the MCP `sync_collection` tool asks the client for the decision when it can).
- `report.localIncomplete` — `true` when a list in scope did not make it into the comparison: an unresolvable name, a file that could not be read, or one held back for unreadable lines. The local side is then short of cards it really holds, so a pull adds nothing (those cards would be duplicated into the target list) and a push removes nothing (they would be deleted from Archidekt). Fix or accept the listed lists and run again.
- `report.cancelled` — works as for [Sync Decks](#sync-decks): an in-process caller (the MCP `sync_collection` tool) cancelled the run between lists, or before the remote collection was fetched (either direction). The list in flight finishes, the lists never reached are `skipped` with the `cancelled` outcome (English `reason` `cancelled before it started`), the summary ends on a `cancelled with N lists not started` clause, and **no `lastSynced` is recorded**. A cancelled push has still sent every change it made before stopping.

When git auto-commit is enabled, list files written by the run are committed (`Sync collection with Archidekt (<direction>)`).

`report.csv` describes what the [CSV import](#csv-import-for-new-cards) did with a push's new cards. It is `null` on any run that did not take that path: every pull, a push that added nothing new, a push with no more than `csvThreshold` new printings and no `csv: true` (which adds them one at a time), and one refused for lacking `csv: true`. Every shape carries `cards` (copies), `rows` (one per printing), and `uncached` (additions the cache could not resolve, added one at a time instead), plus:

| `status`   | Extra fields                                | Meaning                                                        |
| ---------- | ------------------------------------------- | -------------------------------------------------------------- |
| `uploaded` | `chunks`, `failures[]`, `unconfirmedChunks` | Imported; `failures` names the rows Archidekt refused          |
| `planned`  | `destination` (`upload`)                    | What a `dryRun` would have done — nothing was sent             |
| `failed`   | `message`, `messageKey`, `messageParams`    | The whole import failed; the rest of the run still applied     |
| `empty`    | —                                           | No row could be keyed at all: `uncached` covers every new card |

`unconfirmedChunks` counts chunk responses Ritual could not read. Their rows are counted as imported because nothing said otherwise, so a non-zero value means part of that outcome is assumed rather than confirmed (the run log carries what Archidekt replied).

Each entry of `failures` is `{ row, card, ambiguous, notFound, errors }`: the 0-based row of the uploaded CSV, the card it carried, and why it was dropped. A row Ritual cannot match to a card is named by an English label in `card` (`CSV row 3`), with `cardKey` and `cardParams` beside it. The lists holding those cards are reported as failed. (`exported`, the CLI's `--csv-file` outcome, cannot occur here since the request parser refuses `csvFile`, so `report.totals.pending` stays `0` on this surface.)

## Collection Sync Stream

```
GET /api/collection-sync/stream?direction=pull&list=<slug>&into=Inbox&only=additions&removalPriority=<slug>&csv=true&dryRun=true
```

The same sync as `POST /api/collection-sync`, streamed as server-sent events. `EventSource` can only issue a bodyless `GET`, so the request arrives as query parameters:

- `direction` is required.
- `list` repeats once per list; omit it entirely to sync the whole collection.
- `removalPriority` repeats once per list **in priority order** (parameter order is the priority; a blank one is rejected).
- `removalAssignments` is a single JSON-encoded parameter, validated by the same rules as the body's.
- `only` and `into` are omitted (or empty) to accept their defaults.
- `csv` / `dryRun` / `ignoreUnreadableLines` take `true` or `false`. Any other value is rejected, so a flag that decides whether files are written, or how a large batch of cards reaches Archidekt, can never be misread as "no".
- A `csvFile` parameter is rejected here too.

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the collection list being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message, messageKey?, messageParams? }` (`message` English, key and params as for Sync Decks; `item` is `null` for run-level lines; `level` is `info`, `warn`, `error`, or `detail`, one line per card under a list's `Changes:` count, while a run-level `detail` line is a card a push's CSV import created or a record it deleted for a card no list holds), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items }` (`items` as in `report.unreadable`). |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](#the-message-triple), keyed `summary`, and report the JSON route returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `error`    | `{ message, messageKey?, messageParams?, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure); a [message triple](#the-message-triple) whose params may nest.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Failures are reported inside the stream rather than as an HTTP status, since `EventSource` exposes no response body for a non-2xx open.

## Build Site

```
POST /api/build-site
```

Build and publish the public static site — the same build as [`ritual build-site`](/commands/build-site/), run as a child process so the server stays responsive. The build writes into a scratch directory beside `dist/` and swaps it into place only once the child exits cleanly, so `dist/` always holds either the previous site or the new one. Exposed as the MCP `build_site` tool.

**Request Body:** None.

**Response:**

```json
{
  "success": true,
  "message": "Site built successfully",
  "messageKey": "admin.api.buildSite.built",
  "outDir": "/home/user/ritual/dist",
  "durationMs": 42000
}
```

- One build runs at a time: a second request while one is in flight is refused with `503`.
- A failed build answers `500` with the tail of the child's stderr in `message`, and `dist/` is left as it was.
- An in-process caller can cancel the build through its request context (the MCP tool does, on a client's `notifications/cancelled`): the child is killed, the scratch directory removed, and the response is `499` with `dist/` untouched.

## Build Site Stream

```
GET /api/build-site/stream
```

The same build as `POST /api/build-site`, streamed as server-sent events. The admin **Build Site** page's progress bar and live log read it. It takes no parameters.

| Event      | Payload                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | `{ kind: "step", progress, total, message }` for one of the build's structural steps on a 0–3 scale (starting → building → publishing → done), or `{ kind: "output", line }` for one line of the child's stdout or stderr, forwarded as it is printed.                                                |
| `done`     | `{ message, messageKey?, messageParams?, outDir, durationMs }` — the same [message triple](#the-message-triple) and publish details the JSON route returns.                                                                                                                                           |
| `error`    | `{ message, messageKey?, messageParams? }` for a build that was refused (one is already running) or failed; `message` carries the same text the JSON route would, and it is a [message triple](#the-message-triple) whose params may nest (an error the build raised, such as a cache-lock time-out). |

Failures ride the stream rather than an HTTP status, since `EventSource` exposes no response body for a non-2xx open. Closing the stream does **not** cancel the build: it runs to completion and publishes on its own, as a dropped sync stream leaves its run in flight.

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

| Field       | Description                                                                                                                                                                                    | Required |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `listType`  | `deck`, `collection`, or `wanted`                                                                                                                                                              | Yes      |
| `name`      | New list name (`create`/`overwrite`) or an existing list to append to (`append`)                                                                                                               | Yes      |
| `mode`      | `create` (default — fails if the list exists), `overwrite`, or `append`                                                                                                                        | No       |
| `format`    | Deck format; required when creating or overwriting a deck                                                                                                                                      | No       |
| `content`   | Raw CSV text                                                                                                                                                                                   | Yes      |
| `columns`   | 1-based column mapping spec, e.g. `name=1,set=2,collector-number=3`. Fields: `name`, `set`, `collector-number`, `condition`, `finish`, `language`, `tags`, `categories`, `section`, `quantity` | Yes      |
| `hasHeader` | Whether the first row is a header row (default `true`)                                                                                                                                         | No       |

`format`, when given, must be a canonical deck format key — see [Deck Format](/commands/new/#deck-format). An unrecognized value returns `400`.

**Response:**

```json
{
  "success": true,
  "message": "Appended 2 cards to collection 'Red Binder'; 1 row failed validation",
  "messageKey": "admin.api.importCsv.partial",
  "messageParams": {
    "result": {
      "messageKey": "admin.api.importCsv.appended",
      "messageParams": {
        "listType": "collection",
        "cards": { "messageKey": "domain.count.cards", "messageParams": { "count": 2 } },
        "name": "Red Binder"
      }
    },
    "failed": { "messageKey": "admin.api.importCsv.rowsFailed", "messageParams": { "count": 1 } }
  },
  "cardCount": 2,
  "failures": [
    {
      "lineNumber": 3,
      "raw": "No Printing,,",
      "reason": "Missing set code (required for collections)",
      "reasonKey": "domain.import.csv.missingSet"
    }
  ],
  "failedCount": 1,
  "warnings": [
    {
      "message": "Skipped header row: Name,Set,Collector Number,Quantity",
      "messageKey": "admin.api.importCsv.headerSkipped",
      "messageParams": { "row": "Name,Set,Collector Number,Quantity" }
    }
  ]
}
```

`message`'s counts are nested messages (see [the message triple](#the-message-triple)), so a client renders them in its reader's language. A partial import names the failed rows in the same sentence.

**`failures`.** Each row's `reason` is English — several reasons joined with `; ` — with `reasonKey`/`reasonParams` beside it, the [message triple](#the-message-triple) under the field's own name. A row failing for several reasons carries `reasonKey: "domain.sync.reasonList"` and the reasons nested as `reasonParams.reasons` (`{ list: [{ messageKey, messageParams }, …], join: "clauses" }`), so a client joins them in its reader's language. A reason worded outside the catalog (a [tag](/list-format/#card-tags) refusal) carries no key.

**Merging.** In a **deck**, rows naming the same card **and** the same printing merge into one line with their quantities summed, in every mode. **Collections and wanted lists** keep one line per physical copy in every mode, so N rows of the same printing stay N lines.

**`warnings`** is a list of message triples — the English `message`, plus `messageKey`/`messageParams` (which may nest) when the notice has a catalog entry. It reports:

- the row that was skipped as a header, plus a second entry when that row does not look like one (`… — set hasHeader to false to import it as a card.`). A row looks like a header when a cell matches a known column name: the English ones, plus the spellings of every language this build ships — never just the server's own interface language, so the answer, and `warnings`, are the same bytes whoever runs the server;
- category values a row's `categories` cell refused (the row still imported), and, on a deck, values that named a board and set the row's section instead (`domain.import.csv.rowNotice`, whose `notice` param nests what happened to the value);
- anything that went wrong writing the list's [categories sidecar](/list-format/#categories-namecategoriesjson), including the card names whose entries an overwrite pruned.

It is empty when `hasHeader` is `false` and nothing else had news.

**Categories.** A mapped `categories` column (headers `category` or `categories`) writes the list's `<name>.categories.json` sidecar: comma-separated values, the first primary. On a **deck**, a cell value that names a board (`Sideboard`, `Commander`, `Tokens`, …) sets the row's section instead of becoming a category, and an explicit non-empty `section` cell wins. The sidecar and its `.sha256` join the auto-commit set.

**Status codes.** `cardCount`, `failures`, `failedCount`, and `warnings` are **always** present. Rows that fail validation are returned in `failures` while the valid rows still import, and `success` is a pure envelope flag: a request where _every_ row failed is still a `200` carrying `cardCount: 0` and the per-row report. The response is `400` only when the **request** is invalid: bad body shape, unknown `listType`/`format`, an unparseable column spec, a mapped column number the file has no column for (`Column 99 (mapped to 'name') does not exist: the file has 6 columns`), an unparseable CSV, no data rows, an append to a list that does not exist, a new list whose name has no usable file-name characters, a new list whose name matches an existing one, or an append to a file holding content its rewrite would delete. Each of those refusals is keyed; an unparseable CSV's (`admin.api.importCsv.parseFailed`) nests the CSV reader's own message as its `reason` param. An unknown `format` is `domain.list.deckFormat.invalid`, whose `formats` param is the valid keys as a `{ list, join: "unit" }`; an unusable name is `domain.list.name.unusable`; a name that collides is `domain.import.nameTaken`, whose `reason` param nests the list engine's own collision message (`domain.list.lifecycle.exists` or `domain.list.lifecycle.existsFolded`); and an append the rewrite gate refuses is `domain.list.unreadableContent`, whose `problems` param is a `{ list, join: "clauses" }`. Appends record each added card in the list's changelog. When git auto-commit is enabled, the list file (and changelog) are committed.

## Import Changes

```
POST /api/import-changes
```

Apply a change bundle exported from the site editor to the underlying lists. Used by the admin site's **Import Changes** page and exposed as the MCP `import_change_bundle` tool; shares its apply engine with the [`import-changes`](/commands/import-changes/) CLI command.

**Request Body:** the exported JSON, verbatim — a version-3 `ritual-change-bundle` covering one or more lists. Each list's own edits sit in `lists[].changes`. Cross-list moves are normalized into the top-level `moves` array and never appear as `move-from`/`move-to` inside a list's `changes`. Each move is one copy, naming its source and destination list by kind + name (the slug is a best-effort hint), and carries:

- the copy's printing fields (`set`, `collectorNumber`, `finish`, `condition`, `language`);
- optional `tags` (the card's [tags](/list-format/#card-tags), canonical and without the `#`), landing on the destination line;
- optional `labels` (the card's [labels](/list-format/#card-labels) as its source list states them, signed: its effective labels there plus a `no-` for each label its source stated that it lacks), landed by the [move rule](/commands/move/) — a proxy stays a proxy and a real card real, a stated label keeps its state, an unstated one takes the destination's default — as far as the destination type accepts, and optional `note`, landing on the destination line;
- optional `toCardId`, the destination line's `&N` as the exporting editor allocated it, which the import re-targets like an `add`'s id;
- for a copy pinning a name-only destination line, `pinsCardId` and `replacement`.

```json
{
  "format": "ritual-change-bundle",
  "version": 3,
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
  "messageKey": "admin.api.importChanges.applied",
  "messageParams": {
    "changes": { "messageKey": "domain.count.changes", "messageParams": { "count": 2 } },
    "lists": { "messageKey": "domain.count.lists", "messageParams": { "count": 2 } }
  },
  "failedCount": 0,
  "lists": [
    {
      "kind": "deck",
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "applied": 1,
      "conflicts": [],
      "droppedNotes": [{ "cardName": "Sol Ring", "cardId": 3, "note": "from trade" }]
    },
    {
      "kind": "collection",
      "slug": "binder",
      "name": "Binder",
      "applied": 1,
      "conflicts": [],
      "droppedNotes": []
    }
  ]
}
```

**How changes apply.** Every list's changes and every move are merged into one timestamp-ordered stream and applied in batches (consecutive events aimed at the same list); each batch loads its list fresh immediately before saving it. Changes are re-targeted to the list's current card IDs: by ID when it still exists, otherwise by card name (a copy the same import just added first).

**Conflicts.** Changes whose target card no longer exists, whose action cannot apply to that list (a commander change aimed at a collection), or which would set a foil/etched finish on a card that pins no printing are skipped and reported in that list's `conflicts` as `{ change, reason }`, where `reason` is `"target-not-found"`, `"not-applicable"`, or `"needs-printing"`.

**Moves.** Each entry of `moves` is applied on its **destination** list as a `move-to`: that save adds the copy there, takes it out of the source list (by the source line id the move names, else by the exact printing, else by name for a printing-less source line), and writes both changelogs. A destination named only by a move is resolved by its slug, then by its name, and reported as a list of its own (`slug` is the file basename it resolved to). `lists[].applied` counts moves arriving in the list; a replacement printing written back to a move's source list is not counted.

**Dropped notes.** Each list's `droppedNotes` gathers its saves' own `droppedNotes` (see [Save a List](#save-a-list)): a moved card that merged onto a deck line already holding a different note keeps the line's note. Each distinct note is listed once. Empty when none.

**Failures.** A list that fails to resolve, load, or save carries an `error` string (English) and is counted in `failedCount`. When the failure has a catalog entry — the load or save route's own keyed refusal, such as `admin.api.list.notFoundListRoute` — `errorKey` and `errorParams` ride beside it, as `messageKey` and `messageParams` do beside `message`. The failing batch applied nothing, that list's later batches are skipped, and batches already applied stay applied and counted; the other lists continue. `success` stays `true` on a partial import, so read `failedCount` (and each list's `error`), not the envelope. Every list that received changes gets a changelog entry, through the same save path as the editors. The response is `400` when the body is not a valid change bundle; its `message` says why (`Move #1 "from" is not an object.`, `List #2: Missing or invalid "slug".`), keyed `domain.changes.problem.*`, and when the problem is about one change or move that record is nested as the `subject` param.

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
    "labels": ["trade"],
    "tags": ["Signed"]
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

Selection:

- `lists` names resolve like CLI list arguments; the optional `type` pins an ambiguous name.
- Each `cards` entry is whitespace-separated name terms. Every entry across all lists whose name matches all terms is added, deduplicated against the selected lists.
- `filters.conditions` takes condition grades and/or `none` (cards with no condition marked), matching the CLI's `--condition`.
- `filters.labels` takes label values (`sale`, `trade`, `keep`, `proxy`) and/or `none` (unlabeled), matched against each deck and collection card's effective labels like the CLI's `--labels`. Wanted entries carry no labels and never match.
- `filters.tags` takes [card tags](/list-format/#card-tags) and keeps every card carrying any of them, matched exactly and case-sensitively on every list type, wanted lists included. A card with no tags never matches, and there is no `none` value (`none` is an ordinary tag). A malformed tag is a `400`.
- `preset` starts from a saved or built-in [export preset](/commands/export/#presets). The built-in `archidekt` preset needs no config, and a saved preset of that name shadows it. Explicit fields override the preset's values.

Output:

- `format` is `csv` (default), `json`, `text` (a plain-text decklist, quantities aggregated), or `md` (canonical list markdown without `&N` ids) — see [export formats](/commands/export/#formats).
- `columns`, `header`, and `quoteAll` shape `csv`/`json` output only and are ignored for `text`/`md` (unlike the CLI, the route does not reject the combination).
- `dialect` is the output vocabulary, ignored for `md` — see [dialects](/commands/export/#dialects). For `csv`/`json` it spells finish and condition: `ritual` (the default; `nonfoil`/`foil`/`etched`, `NM`…`DMG`) or `archidekt` (`Normal`/`Foil`/`Etched` under a `Variant` header, and `NM|LP|MP|HP|D`). For `text` it picks the decklist form: `arena` and `moxfield` write bare board markers over `1 Name (SET) CN` lines (moxfield splices `*F*`/`*E*` between the set and the collector number, and closes each line with the card's categories as `#tag` tokens) and omit maybeboard/token cards, naming them in the response's `warnings`.
- An unknown `dialect` or `preset` is a `400`.
- Selected `scryfallId` and `edhrecRank` columns are resolved from the local Scryfall cache.
- The `categories` column exports the card name's [categories](/commands/categories/) in that list, comma-joined primary first, and `primaryCategory` just the first of them. Both are empty for an uncategorized card. The `md` format and every `text` dialect but `moxfield` drop them; `moxfield` text writes them as `#tag` tokens.

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

The file lands under an `exports/` directory in the base dir, which [`init-site`](/commands/init-site/) adds to `.gitignore`. The server picks the name, `<scope>-<YYYYMMDD>.<ext>`: scope is the single selected list's sanitized name, `cards` for a card-pick-only export, or `all-lists` otherwise, and the date is UTC. A name already taken gains the lowest free `-2`, `-3`, … suffix, so a write never overwrites an earlier export. `path` is **base-dir-relative**, so a caller that trusts it cannot be walked outside the workspace. The written file is newline-terminated and byte-identical to what the CLI's `export --out` writes.

`warnings` carries [message triples](#the-message-triple) (`domain.export.warning.*`), never bare strings:

- list parse warnings (`domain.export.warning.inList`, the parser's own message nested as `warning`);
- `cards` terms that matched nothing;
- one entry naming the maybeboard/token sections a `text` export in the `arena` or `moxfield` dialect left out (`domain.export.warning.extrasOmitted`, whose `sections` is a `{ list, join: "unit" }` of `domain.export.warning.sectionCount` messages with per-section counts, each `section` a `domain.board.*` message when it is a standard board such as `Maybeboard`, else the heading as written);
- one entry naming the categories a `text` export in the `moxfield` dialect could not write as tags (a space, a leading `!`, or a character a Ritual tag cannot hold);
- one entry per list whose [categories sidecar](/list-format/#categories-namecategoriesjson) could not be read (that list exports with empty category cells);
- when the `scryfallId` column is selected, one entry per printing the local Scryfall cache does not hold (`domain.export.warning.scryfallIdUncached`), and one per card name whose line pins no printing (`domain.export.warning.scryfallIdUnpinned`); either cell renders empty;
- when the `edhrecRank` column is selected, one entry per card name the local Scryfall cache does not hold (an unranked card is not warned about — its cell is simply empty).

The response is `400` for an unknown list, preset, column, dialect, or filter value. A refused column or condition/label filter value is keyed `domain.export.problem.*`. An unknown value, or an empty list, offers the values accepted as a `{ list, join: "unit" }` (`columns`, or `values`); a duplicate column names only the duplicate. A write that cannot settle on a free file name answers `500` with `domain.export.problem.fileNameExhausted`.

## List Decks

```
GET /api/decks
```

List all deck files in the decks directory.

**Response:**

```json
{
  "decks": ["burn", "elves", "mono-red-aggro"]
}
```

## Import Deck

```
POST /api/import-deck
```

Import a deck from a supported URL, or from decklist text supplied directly (pasted in the UI or read from an uploaded file). The request is one of two shapes, distinguished by `mode`.

**Request body (URL):**

```json
{
  "mode": "url",
  "url": "https://archidekt.com/decks/123456",
  "overwrite": false,
  "syncPrintings": true
}
```

**Request body (text):**

```json
{
  "mode": "text",
  "content": "4 Lightning Bolt\n1 Sol Ring\n\n## Sideboard\n2 Pyroblast",
  "name": "My Burn Deck",
  "overwrite": false
}
```

| Field           | Type    | Required         | Default | Description                                                                                                                                                                                                       |
| --------------- | ------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`          | string  | Yes              | —       | `"url"` or `"text"`                                                                                                                                                                                               |
| `url`           | string  | When `url` mode  | —       | Archidekt, Moxfield, or MTGGoldfish URL                                                                                                                                                                           |
| `content`       | string  | When `text` mode | —       | Decklist text (`QTY Name` per line; `## Heading` lines start sections)                                                                                                                                            |
| `name`          | string  | No               | —       | Deck name for `text` mode; ignored if the text defines its own `# Title`                                                                                                                                          |
| `overwrite`     | boolean | No               | `false` | Overwrite existing deck on conflict                                                                                                                                                                               |
| `syncPrintings` | boolean | When `url` mode  | —       | `true` keeps the exact printings (set, collector number, finish) the source lists; `false` imports bare card names. Rejected in `text` mode. See [Printing choice](/commands/import/#printings-from-a-url-import) |

`syncPrintings` is required in `url` mode because the CLI asks interactively and over HTTP the caller must decide. In `text` mode the printings come from the pasted lines.

**Response:**

```json
{
  "success": true,
  "message": "Successfully imported 'My Deck'",
  "messageKey": "admin.api.importDeck.imported",
  "messageParams": { "name": "My Deck", "notes": { "list": [], "join": "concat" } },
  "deckName": "My Deck",
  "syncPrintings": true,
  "warnings": [],
  "advisories": []
}
```

- `warnings` lists text lines the parser skipped — content that was **not** imported (always empty for URL imports). Like `advisories`, it is a list of message triples: the English `message`, plus `messageKey`/`messageParams`. A line the card-line grammar refused is keyed `domain.card.line.atLine` (`{ line, text }`), its diagnostic nested as `text` (`domain.card.line.*`). A warning whose card **was** imported, only without the labels it carried, has `"labelsDropped": true`; the others are lines that were skipped.
- `advisories` lists content that **was** read but is worth a word: a card name still carrying a printing token, a skipped MTG Arena `About` line, or an empty `## Maybeboard`/`## Tokens` header the write drops. On a URL import it carries notes about the source's [categories](/commands/import/#categories-from-a-url-import): names Ritual refused, or a categories file that could not be written.
- When either array is non-empty, `message` notes the count, as a nested message per kind of note (see [the message triple](#the-message-triple)).

A URL import from Archidekt or Moxfield also writes the deck's `<deck>.categories.json` (and its `.sha256`), replacing the file a replaced deck had; with git auto-commit enabled, the categories and primer files are committed with the deck.

Pasted/uploaded text is read with the same dialects as [`ritual import`](/commands/import/#mtg-arena--mtgo-exports): Ritual's own format plus MTG Arena/MTGO/Moxfield exports (`4 Lightning Bolt (M10) 146`, bare `Deck`/`Sideboard` markers, and a `*F*`/`*E*` finish marker either trailing or between the set and the collector number).

A name/ID conflict without `overwrite`, or a deck name with no characters usable in a file name, fails with a `400` (the same usage classification the CLI turns into exit code `2`), not a `500`.

An Archidekt URL whose deck Archidekt does not show (it does not exist, or is private) fails with a `404`; Archidekt failing any other way (any other 4xx such as a `403`, a 5xx, a rate limit that outlived its retries, or a `200` whose reply cannot be read) answers `502`. Both bodies are the [error response](#error-responses), English plus its key whatever the server's UI language:

```json
{
  "success": false,
  "message": "Failed to fetch Archidekt deck 123456 (HTTP 404): Not found.",
  "messageKey": "domain.sync.archidekt.deckFailedWithReason",
  "messageParams": { "deckId": "123456", "status": 404, "reason": "Not found." }
}
```

`status` is Archidekt's HTTP status, a number. `reason` is Archidekt's own explanation, quoted as it sent it and cut to a few hundred characters (several are a `clauses` list); a reply that explains nothing, such as an HTML error page, gives `domain.sync.archidekt.deckFailed`, without `reason`. A reply Archidekt answered but Ritual could not read (not JSON, or its `cards` not a list of entries) is `domain.sync.archidekt.deckUnreadable` (`deckId`, and what was wrong nested as `reason`).

## Refresh Cache

```
POST /api/cache/refresh
```

Download and cache all Scryfall card data — the Scryfall half of `ritual cache preload-all`, without the [buylist](/commands/sell/) refresh that command also runs under sell mode (that is [`POST /api/sell/refresh`](/admin/api/#sell-refresh)). Returns a JSON response when complete. A refresh that fails answers a non-2xx with the failure's message. A refresh cancelled by its caller (only an in-process caller such as the MCP `refresh_cache` tool can cancel one) answers `499`: the download stops, nothing is written, the previous cache is left as it was, and the cache lock is released.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "Cache refreshed successfully",
  "messageKey": "admin.api.cache.refreshed"
}
```

## Refresh Cache Stream

```
GET /api/cache/refresh/stream
```

Stream cache refresh progress as Server-Sent Events (SSE). The UI uses it for its real-time progress bar.

**Response:** `text/event-stream` with the following event types:

| Event      | Data Fields                                                       | Description                    |
| ---------- | ----------------------------------------------------------------- | ------------------------------ |
| `progress` | `stage`, `percentage?`, `message`, `messageKey`, `messageParams?` | Progress update during refresh |
| `done`     | `message`, `messageKey`                                           | Refresh completed successfully |
| `error`    | `message`, `messageKey?`, `messageParams?`                        | Refresh failed                 |

All three are [message triples](#the-message-triple): `message` is English whatever the server's UI language, and `messageKey` and `messageParams` let a client render the line in its reader's language — the admin Cache Refresh page does, and relabels a line already on screen when the reader switches language. A `progress` line's key is a `domain.cache.refresh.*` message, and its params nest: a download size or the amount received so far is a size, `{ sizeBytes }`, rendered as a two-decimal mebibyte figure in the reader's locale (the line spells the `MiB` unit itself). An `error` with a catalog entry carries its key and params as an [error response](#error-responses) does: a cache-lock time-out (`domain.cache.lockTimedOut`), or a refresh failure (`domain.cache.refresh.*`) — Scryfall refusing the bulk manifest or the bulk download (`manifestFailed`, `bulkFetchFailed`, whose params are the HTTP `status` and `statusText`), a manifest with no bulk of the kind needed (`noBulkUri`, whose `bulk` is the Scryfall bulk name), an empty download (`bulkNoBody`) or a malformed bulk line (`invalidJsonLine`, whose `line` is its number).

**Stage values:** `metadata`, `tags`, `download`, `save`, `done`, `info`. Parsing and processing happen inline while the gzipped-JSONL bulk streams, so `download` covers them. The stages come from the refresh engine itself, and `percentage` is present on a `download` event whenever the compressed download size is known.

**Example event stream:**

```
event: progress
data: {"stage":"download","percentage":45,"message":"Processing: 45% (32.50/72.50 MiB)","messageKey":"domain.cache.refresh.processing","messageParams":{"percentage":45,"received":{"sizeBytes":34078720},"total":{"sizeBytes":76021760}}}

event: progress
data: {"stage":"save","message":"Saving to cache…","messageKey":"domain.cache.refresh.saving"}

event: done
data: {"message":"Cache refreshed successfully","messageKey":"admin.api.cache.refreshed"}
```

## Archidekt Login

```
POST /api/login/archidekt
```

Log in to Archidekt. The server authenticates with the Archidekt API and stores the session token locally.

**Request body:**

```json
{
  "username": "myuser",
  "password": "mypassword"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Logged in as myuser",
  "username": "myuser"
}
```

A missing `username` or `password` is a `400` (`admin.api.field.credentialsRequired`) that never reaches Archidekt. A login that fails is an [error response](#error-responses) whose status says whose failure it was:

| Status | When                                                                      | `messageKey`                                                                        |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `401`  | Archidekt refused the credentials (a 4xx other than `429`)                | `domain.sync.auth.loginFailedWithReason`, or `domain.sync.auth.loginFailed`         |
| `502`  | Archidekt failed: a 5xx, a `429`, or a reply that holds no usable session | `domain.sync.auth.loginFailed(WithReason)`, or `domain.sync.auth.loginReplyInvalid` |
| `500`  | This server failed, such as a token file it could not write               | the error's own, as for any route                                                   |

`status` is the HTTP status Archidekt answered with. `reason` is Archidekt's own explanation, read from its reply's `non_field_errors` and `detail` and quoted on one line (control characters stripped, each cut to 300 characters); several are a `clauses` list. A reply without one, such as an error page, gives the `loginFailed` form with no `reason`:

```json
{
  "success": false,
  "message": "Archidekt answered the login with HTTP 400: Unable to log in with provided credentials.",
  "messageKey": "domain.sync.auth.loginFailedWithReason",
  "messageParams": {
    "status": 400,
    "reason": "Unable to log in with provided credentials."
  }
}
```

## Archidekt Login Status

```
GET /api/login/archidekt
```

Report the stored Archidekt login, including how long the access and refresh tokens remain valid. Expirations come from the tokens' JWT `exp` claims. When neither token is valid, `loginRequired` is `true` and the user must sign in again.

**Response:**

```json
{
  "loggedIn": true,
  "username": "myuser",
  "accessTokenExpiration": "2026-05-24T19:53:49.000Z",
  "accessTokenValid": true,
  "refreshTokenExpiration": "2026-07-02T18:53:49.000Z",
  "refreshTokenValid": true,
  "loginRequired": false
}
```

## TOTP Setup

```
POST /api/totp/setup
```

Generate a new TOTP secret for two-factor authentication. The secret stays pending until verified.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "secret": "JBSWY3DPEHPK3PXP",
  "uri": "otpauth://totp/Ritual:admin?secret=JBSWY3DPEHPK3PXP&issuer=Ritual&algorithm=SHA1&digits=6&period=30"
}
```

## TOTP Verify

```
POST /api/totp/verify-setup
```

Verify a TOTP code to activate the pending secret. Call it after `/api/totp/setup` to confirm the authenticator app is configured.

**Request body:**

```json
{
  "code": "123456"
}
```

**Response:**

```json
{
  "success": true,
  "message": "TOTP enabled successfully"
}
```

## TOTP Disable

```
POST /api/totp/disable
```

Disable TOTP two-factor authentication.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "TOTP disabled"
}
```

## TOTP Status

```
GET /api/totp/status
```

Check whether TOTP is enabled for the admin account.

**Response:**

```json
{
  "enabled": true
}
```

## Get Config

```
GET /api/config
```

Returns the current application configuration.

**Response:**

```json
{
  "success": true,
  "config": {
    "decksDir": "./decks",
    "collectionsDir": "./collections",
    "wantedDir": "./wanted",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
    "updateCheck": true,
    "admin": {
      "gitEnabled": false,
      "gitAutoCommit": false,
      "gitAutoPush": false,
      "trustProxy": false,
      "secureCookies": false,
      "ipAllowList": [],
      "ipDenyList": [],
      "userAgentAllowList": [],
      "userAgentDenyList": [],
      "rateLimitEnabled": true,
      "rateLimitMaxAttempts": 5,
      "rateLimitWindowMinutes": 5,
      "failedAuthDelayMs": 3000
    },
    "collectionSync": {
      "pullTarget": "Inbox"
    }
  }
}
```

`config` is the **stored** configuration. When this server was started with a session flag that displaces one of those values — today that means [`--sell-mode`](/commands/admin/#sell-mode) — the response also carries an `overrides` object saying what the running process is actually operating with, keyed by the config path each override displaces:

```json
{
  "success": true,
  "config": { "site": {} },
  "overrides": { "site.sellMode": true }
}
```

The flag writes nothing, so `config.site.sellMode` keeps reporting the stored value (usually unset) while the server's sell routes answer anyway. `overrides` is **absent entirely** when no override is in force. It is a process-local fact, so `ritual config get` has no equivalent and `PUT /api/config` never returns it: a write echoes back what it persisted.

## Update Config

```
PUT /api/config
```

Update the application configuration. Partial updates are supported: only the fields you include change. The nested `admin` object is merged field by field, so you can send just the admin settings you want to change.

Every key in the request body is validated **before** the merge is persisted; a malformed update is rejected with a `400` and never written to disk:

- Unknown top-level keys are rejected (`Unknown config key "x"`).
- Unknown keys inside `admin` are rejected (`Unknown admin config key "x"`), matching `config set admin.<field>`.
- When `admin` or `site` is present, its fields are validated field by field with the config loader's rules, and any malformed field rejects the whole update.
- `collectionSync` replaces wholesale like `site` rather than merging like `admin`. Its fields are validated (`pullTarget` must be a non-empty list name) and any absent field takes its default, so a partial object round-trips to a complete one. A malformed value rejects the whole update.
- `defaultPriceSource` (an empty string clears it), `priceSources` (store names only — lowercased and deduped, unknown stores rejected), `defaultLanguage` (canonical Scryfall codes only, no aliases), `uiLocale` (a BCP-47 tag naming the interface language, not the card language; see [Localization](/localization/)), `cacheLockTimeoutSeconds`, `cacheSource`, `cacheFeedUrl`, `searchDebounceMs`, and `updateCheck` (a boolean) are validated as [`config set`](/commands/config/) validates them.
- `cacheFeedUrl` has one extra rule: sending it as an **empty string** clears a previously-set override (falling back to the built-in default). Omitting the field leaves the current value untouched.
- `managed` is accepted so a client can send back the whole config it read, but it is **ignored**: the stored [`managed` block](/configuration/#ritual-bookkeeping-managed-key) belongs to `init-site` and `migrate` and is never taken from a request.

A rejected value answers in the shared [error envelope](#error-responses), in English plus its key. The config validator's keys are `domain.config.*`: a top-level field's refusal names it as `field` (`domain.config.mustBeBoolean`, `mustBeOneOf` — whose `values` is a `{ list, join: "unit" }` — and so on), and a field inside a block is refused by `domain.config.inSection`, whose `section` is the block (`site`, `admin`, `collectionSync`) and whose `reason` nests the field's own refusal:

```json
{
  "success": false,
  "message": "site config: \"ciSystem\" must be \"github-actions\" or \"manual\"",
  "messageKey": "domain.config.inSection",
  "messageParams": {
    "section": "site",
    "reason": {
      "messageKey": "domain.config.mustBeEither",
      "messageParams": { "field": "ciSystem", "first": "github-actions", "second": "manual" }
    }
  }
}
```

A `priceSources` or `defaultPriceSource` refusal is keyed `domain.config.mustBeOneOf`, `domain.config.mustBeStringArray`, or `domain.config.unknownStore` (`{ field, value, values }`, with the accepted stores a `{ list, join }`). An `exportPresets` refusal is keyed `domain.export.problem.*` (a preset's column list's own refusal nested as `reason` inside `domain.export.problem.presetColumnsInvalid`). A `defaultCategories` refusal is keyed: `domain.config.defaultCategoriesNotArray` / `domain.config.defaultCategoriesNotText`, or the category rule's own `domain.card.category.invalid`, whose `rule` nests `domain.card.category.shapeRule`.

A `uiLocale` refusal is keyed `domain.config.uiLocaleMalformed` for a value that is not a language tag at all, whose `reason` nests the tag parser's own refusal — `errors.i18n.localeTag.invalid` (`{ value }`, the value as given), `errors.i18n.localeTag.empty` or `errors.i18n.localeTag.notAString` — or `domain.config.uiLocaleUnknown` (`{ tag }`) for a well-formed tag naming no language the server knows.

**Request body:**

```json
{
  "admin": {
    "gitEnabled": true,
    "gitAutoCommit": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "config": {
    "decksDir": "./decks",
    "collectionsDir": "./collections",
    "wantedDir": "./wanted",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
    "updateCheck": true,
    "admin": {
      "gitEnabled": true,
      "gitAutoCommit": true,
      "gitAutoPush": false,
      "trustProxy": false,
      "secureCookies": false,
      "ipAllowList": [],
      "ipDenyList": [],
      "userAgentAllowList": [],
      "userAgentDenyList": [],
      "rateLimitEnabled": true,
      "rateLimitMaxAttempts": 5,
      "rateLimitWindowMinutes": 5,
      "failedAuthDelayMs": 3000
    },
    "collectionSync": {
      "pullTarget": "Inbox"
    }
  }
}
```
