---
title: 'Admin API: Archidekt Sync'
description: 'Admin API routes to log in to Archidekt and sync decks and the collection with it.'
sidebar:
  label: 'Archidekt sync'
  order: 6
---

Routes that log in to Archidekt and sync decks and your collection with it. Each sync has a status route, a one-shot route, and a stream that reports progress as it runs. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

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

A missing `username` or `password` is a `400` (`admin.api.field.credentialsRequired`) that never reaches Archidekt. A login that fails is an [error response](/admin/api/#error-responses) whose status says whose failure it was:

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
| `allowRemoveAll`        | Sync a deck even when its source holds no cards and every card would be removed from the destination (default `false`). Must be a boolean or `400`. See [Empty-deck guard](/commands/deck-sync/#empty-deck-guard).            | No       |
| `syncPrintings`         | Also sync each card's exact printing — set, collector number, and foil/etched finish (default `false`). Must be a boolean or `400`. See [Printing Sync](/commands/deck-sync/#printing-sync---sync-printings).                 | No       |
| `syncCategories`        | Also sync each card's categories — its role in the deck (default `false`). Must be a boolean or `400`. See [Category Sync](/commands/deck-sync/#category-sync---sync-categories).                                             | No       |

**Divergence guard.** A `push` refuses any deck whose Archidekt `updatedAt` is newer than the `sourceUpdatedAt` its last sync recorded, so remote edits are never silently reverted. Such a deck is reported `failed` with `Remote deck changed since last sync (…) — pull first, or pass --force to overwrite remote changes.`, and the rest of the run continues. A `pull` of that deck records the new baseline (even when it finds no card changes), after which the push succeeds; `force: true` overrides the guard. See [Divergence Guard](/commands/deck-sync/#divergence-guard-push).

**Empty-deck guard.** A deck whose source holds no cards while its destination holds some (an empty Archidekt deck on a `pull`, an empty local deck on a `push`) is reported `failed` with `reasonKey` `domain.sync.emptyRemoteDeck` or `domain.sync.emptyLocalDeck`, nothing is written for it, and the rest of the run continues. A `dryRun` reports the same refusal, `only: "additions"` is never refused, and `allowRemoveAll: true` overrides it (`force` does not).

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

`summary` is **required** on a completed run: the same sentence as `message`, split into ordered keyed clauses so a client with a translator can render it in the reader's locale. Each clause is a [message triple](/admin/api/#the-message-triple) with no final punctuation. `message` is unchanged.

`success` reports whether the run could be performed, **not** whether every deck synced. A run with per-deck failures still returns `200` with `success: true` and a non-zero `report.failedCount`, so read each deck's `status` and `reason`. Other report fields:

- Each deck carries `outcome`, the code to branch on: `changed` (written or sent), `unchanged` (already matched, or a push that once planned had nothing to send), `dry-run` (a preview, which `reason` summarizes) or `cancelled` (never reached). Collection lists add `not-run` (see [Sync Collection](#sync-collection)). It is absent on a failed deck and on one skipped for another reason. Never match on `reason` text.
- `reason` is English whatever the operator's UI language — the [message triple](/admin/api/#the-message-triple)'s contract — with `reasonKey` and `reasonParams` beside it, as `messageKey` and `messageParams` are beside `message`. A sync's params may nest: a param is a string or number, another message (`{ messageKey, messageParams }`), a list (`{ list, join }`, where `join` is `and`, `unit`, `clauses` or `concat`), a duration (`{ elapsedMs }` for how long something took, `{ durationMs }` for an age or a time-out, such as the card cache's age in a push's CSV cache check) or a card language (`{ language }`), all rendered in the same locale as the message around them. A reason raised outside the catalog (a network error) has no key.
- Each deck carries `printingsChanged` (a count) when the request set `syncPrintings`, or `printingsUnaligned` (the card names whose printings the two sides disagree about) when it did not.
- Each deck carries `categoriesChanged` (a count of cards) when the request set `syncCategories`.
- Each deck carries `boardMoves` (a count) when its diff moved cards between boards. Moves bypass `only`: a move adds and removes no copies, so neither filter value drops it. See [Board moves](/commands/deck-sync/#board-moves).
- Each deck that had card changes carries `changes`: every change the run applied (or would apply on a dry run), narrowed by `only`. It lists what went through: a push leaves out what its plan could not send, or did not need to. When the push itself failed (nothing was sent), it lists what the push attempted, and `reason` says so. Entries are discriminated by `kind`: `added`/`removed` (`name`, `quantity`, `board`), `quantity` (`name`, `board`, `from`, `to`), `move` (`name`, `quantity`, `from`, `to` boards), `printing` (`name`, `board`, `from`, `to` printings) and `categories` (`name`, `categories`, primary first). The first four carry an optional `printing` (`set` lowercase, `collectorNumber`, `finish`) on a run syncing printings. These are the cards the CLI lists under `--verbose`. The SSE stream carries the same cards as `detail` log lines.
- `report.unreadable` lists any deck whose file holds lines the parser could not read (`{ name, file, warnings }`, each warning a [message triple](/admin/api/#the-message-triple)), so a caller that never sees the stream can still show what a retry with `ignoreUnreadableLines` would delete.
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
- `dryRun` / `ignoreUnreadableLines` / `allowRemoveAll` / `force` / `syncPrintings` / `syncCategories` take `true` or `false`. Any other value is rejected, so a flag that decides whether files are written can never be misread as "no".

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the deck being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message, messageKey?, messageParams? }` (`item` is `null` for run-level lines; `level` is `info`, `warn`, `error`, or `detail` — one line per card change under a deck's `Changes:` summary; `message` is English, and the key and params, which may nest as a deck's `reasonParams` do, let the page render the line in the reader's language), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items: [{ name, file, warnings }] }` (each warning a [message triple](/admin/api/#the-message-triple), as in `report.unreadable`). |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](/admin/api/#the-message-triple), keyed `summary`, and report the JSON route returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `error`    | `{ message, messageKey?, messageParams?, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure); a [message triple](/admin/api/#the-message-triple) whose params may nest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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
| `allowRemoveAll`        | Run even when the source holds no cards and every card would be removed from the destination (default `false`). Must be a boolean or `400`. See below.                                                                                                                                                                                                                                                                | No       |

A `csvFile` field is **rejected** with `400` rather than ignored: writing a CSV to a caller-named path is a CLI-only feature ([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)), and a caller mirroring the CLI's flags should be told instead of having its additions uploaded.

### CSV import for new cards

Adding a printing Archidekt does not have costs a [paced](/commands/collection-sync/#rate-limiting) search plus a create, so a first push of a real collection would take hundreds of requests. `csv: true` sends those additions through Archidekt's own collection importer instead — one upload, with every row built from the local Scryfall cache — exactly as the CLI's [`--csv`](/commands/collection-sync/#csv-import-for-new-cards) does, however few there are.

A push adding more new printings than `csvThreshold` without `csv: true` **fails before writing anything to Archidekt**: the guidance lands in `report.errors`, `report.csv` stays `null`, and no record is created, grown, or deleted. A `dryRun` never needs the flag: over the threshold it reports the upload it would make and resolves nothing. Quantity changes and removals never use the CSV (removals use Archidekt's bulk-delete endpoint). Additions whose printing the local cache does not hold cannot become rows; they are added one at a time and counted in `report.csv.uncached`.

The rows are keyed by the Scryfall ids the **local card cache** holds, so a run taking this path treats cache freshness as [`--refresh auto`](/commands/collection-sync/#cache-freshness): an empty or day-old cache is redownloaded before the file is built, reported as a `log` event on the stream and in the run's messages.

**Ambiguous removals.** A pull removal is ambiguous when only _some_ of a printing's copies are going and those copies live in several lists, so nothing says which list the card physically left. (Taking every copy, or copies held in a single list, is never ambiguous.) The decision is made up front, as either:

- `removalPriority` — copies come only from the lists it names, walking them in the order given. Names are matched exactly, never by the substring rule other list lookups use, and an unknown name fails the run.
- `removalAssignments` — an explicit per-removal decision.

Without either, or with one that does not cover a removal, the run **fails and writes nothing at all**: the reason lands in `report.errors`, `report.unresolvedAmbiguity` is `true`, `report.ambiguous` carries each removal with its per-list copy counts, no list file is touched, and the account's `lastSynced` is left alone. A `dryRun` request never fails on an ambiguity itself; it reports it instead. (An unknown `removalPriority` name still fails a `dryRun`: that is a bad argument, not an unresolved removal.)

**Empty side.** A pull against an Archidekt collection with no readable cards while the lists in scope hold some, or a push from lists holding no cards while the account's collection has some, would remove every card from the destination. The run is refused before anything is written: the reason lands in `report.errors` (`report.errorMessages` key `domain.sync.emptyRemoteCollection` or `domain.sync.emptyLocalCollection`), every list in scope is reported with the `outcome` `not-run`, and `lastSynced` is left alone. A `dryRun` reports the same refusal, `only: "additions"` is never refused, and `allowRemoveAll: true` lets the run go ahead. See [Empty-side guard](/commands/collection-sync/#empty-side-guard).

**Unreadable lines.** A pull rewrites each list file and a push treats those files as the truth, so a line the parser cannot read would be lost either way. Such lists **fail** unless the request sets `ignoreUnreadableLines`, the API equivalent of the CLI's `--yes`. The affected lists and their exact lines are reported in `report.unreadable` (`{ name, file, warnings }`, each warning a [message triple](/admin/api/#the-message-triple)) and, on the stream, as a `progress` frame with `kind: "unreadable-lines"`. A `dryRun` request is exempt: it writes nothing, so those lists are previewed rather than refused.

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

- `report.lists[].outcome`, `reason`, `reasonKey` and `reasonParams` work as a deck's do in [Sync Decks](#sync-decks): branch on `outcome`; `reason` is English, the key and params render it in the reader's language. Several reasons for one list are joined into one. A run that refuses before reaching its lists (a bad `into` or `removalPriority`, an unresolved ambiguity, the empty-side refusal, or a push's additions it will not send) reports them `skipped` with the outcome `not-run` and the reason `not synced: the run stopped before this list`. `changed` includes copies a CLI push wrote to its `--csv-file` for upload.
- `report.lists[].changes`, present when a list had any: every card behind its counts, which are its totals. Each entry has a `kind` (`added`, with `via: "csv"` when a push's CSV import created it, or `removed`), `name`, `quantity` in copies, and `printing` (`set` lowercase, `collectorNumber`, `finish`, `condition`, and `language` when not English). There is one entry per card, printing and kind, narrowed by `only`. The `pending` kind comes only from the CLI's `--csv-file` and never appears on this surface. It lists what went through, or would on a dry run: a card whose write failed is left out, and the list's `reason` says what failed. On a push a card held in several lists is one key, so its entry, with the key's whole quantity, is listed under each of them. A list a cancellation skipped may still carry changes an earlier list's turn made for it. The SSE stream carries the same cards as `detail` log lines.
- `report.unlisted` — a push's deletions of records for cards no in-scope list holds any more (the same shape as a `removed` change), present only when there is at least one; a failed one is in `errors` instead.
- `report.errors` — failures that belong to the run rather than to one list (the collection fetch, deleting records for cards no list holds any more, or the empty-side refusal), in English.
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
- `csv` / `dryRun` / `ignoreUnreadableLines` / `allowRemoveAll` take `true` or `false`. Any other value is rejected, so a flag that decides whether files are written, or how a large batch of cards reaches Archidekt, can never be misread as "no".
- A `csvFile` parameter is rejected here too.

Three event types are emitted:

| Event      | Payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | One step of the run, in the vocabulary both syncs share — `item` is the collection list being worked on: `{ kind: "item-start", item, index, total }`, `{ kind: "log", level, item, message, messageKey?, messageParams? }` (`message` English, key and params as for Sync Decks; `item` is `null` for run-level lines; `level` is `info`, `warn`, `error`, or `detail`, one line per card under a list's `Changes:` count, while a run-level `detail` line is a card a push's CSV import created or a record it deleted for a card no list holds), `{ kind: "item-result", result }`, or `{ kind: "unreadable-lines", items }` (`items` as in `report.unreadable`). |
| `done`     | `{ message, messageKey?, messageParams?, summary, report }` — the same [message triple](/admin/api/#the-message-triple), keyed `summary`, and report the JSON route returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `error`    | `{ message, messageKey?, messageParams?, loginRequired }` for a run that produced no report (bad parameters, no Archidekt login, or an unexpected failure); a [message triple](/admin/api/#the-message-triple) whose params may nest.                                                                                                                                                                                                                                                                                                                                                                                                                                |

Failures are reported inside the stream rather than as an HTTP status, since `EventSource` exposes no response body for a non-2xx open.
