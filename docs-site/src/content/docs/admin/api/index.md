---
title: 'Admin API'
description: The HTTP API the admin server exposes, shared by the admin site, the MCP server, and any other client.
sidebar:
  label: 'Overview'
  order: 0
# Links to a route on the old single-page API reference (/admin/api/#save-a-list)
# land here; this sends them on to the page that now holds the route.
head:
  - tag: script
    content: >-
      (()=>{const m={"server-status":"auth","create-admin-account":"auth","log-in":"auth","log-out":"auth","audit-log":"auth","create-deck":"lists","list-lifecycle-responses":"lists","rename-deck":"lists","delete-deck":"lists","card-autocomplete":"cards","load-deck":"lists","list-load-parameters":"lists","card-printings":"cards","card-price":"cards","card-details":"cards","card-search":"cards","plain-read-vs-warmtrue":"cards","cache-status":"site","setup-diagnostics":"site","price-summary":"prices","price-list":"prices","sell-report":"prices","parameters":"prices","sell-cart":"prices","sell-refresh":"prices","buylist-quotes":"prices","buylist-status":"prices","save-a-list":"lists","unreadable-lines-block-a-save":"lists","line-breaks":"lists","validatecardnames":"lists","effects":"lists","artwarnings":"lists","categorywarnings-and-prunedcategories":"lists","list-collections":"lists","load-collection":"lists","create-collection":"lists","rename-collection":"lists","delete-collection":"lists","list-wanted-lists":"lists","load-wanted-list":"lists","create-wanted-list":"lists","rename-wanted-list":"lists","delete-wanted-list":"lists","card-index":"cards","commit-moves":"cards","move-selected-cards":"cards","remove-cards":"cards","list-all-lists":"lists","diff-lists":"lists","load-change-history":"lists","save-change-history":"lists","list-metadata":"lists","card-art":"lists","deck-sync-status":"sync","sync-decks":"sync","deck-sync-stream":"sync","collection-sync-status":"sync","sync-collection":"sync","csv-import-for-new-cards":"sync","collection-sync-stream":"sync","build-site":"site","build-site-stream":"site","import-csv":"imports","import-changes":"imports","export-cards":"imports","list-decks":"lists","import-deck":"imports","refresh-cache":"site","refresh-cache-stream":"site","archidekt-login":"sync","archidekt-login-status":"sync","totp-setup":"auth","totp-verify":"auth","totp-disable":"auth","totp-status":"auth","get-config":"site","update-config":"site"};const h=decodeURIComponent(location.hash.slice(1));if(m[h])location.replace('/admin/api/'+m[h]+'/#'+h)})()
---

The admin server exposes an HTTP API under `/api/`. The admin site, the [MCP server](/commands/mcp/), and any client you write use the same routes. Unless a route says otherwise, every request needs a signed-in session.

This page covers what every route shares: the response messages, the error bodies, and authentication. The routes themselves are grouped by area:

- [Status and sign-in](/admin/api/auth/): server status, the first account, signing in and out, the audit log, and TOTP.
- [Lists](/admin/api/lists/): create, load, save, rename and delete decks, collections and wanted lists; their metadata, art, diffs and history.
- [Cards and moves](/admin/api/cards/): look up cards, printings and prices, search the card cache, and move or remove cards across lists.
- [Prices and selling](/admin/api/prices/): list prices, the sell report and cart, and Card Kingdom buylist quotes.
- [Import and export](/admin/api/imports/): import decks, CSV files and change bundles; export cards.
- [Archidekt sync](/admin/api/sync/): log in to Archidekt and sync decks and the collection with it.
- [Site, cache and settings](/admin/api/site/): build the site, check and refresh the card cache, run setup diagnostics, and read or change settings.

## The message triple

Every response body, success or refusal, carries its user-facing prose as up to three fields:

| Field           | Presence | Meaning                                                                                                                 |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `message`       | always   | The sentence, in **English**; what `curl`, scripts, and the MCP server read. It never follows the operator's UI locale. |
| `messageKey`    | optional | The message-catalog key `message` was rendered from. Locale-invariant. Absent when the sentence has no catalog entry.   |
| `messageParams` | optional | The parameters `messageKey` interpolates. Absent for a message that takes none.                                         |

Match on `messageKey`, never on the English text.

A few responses build their sentence from counted nouns — an import's "Applied 3 changes across 2 lists" — and there a param may itself be a message (`{ messageKey, messageParams }`) or a list (`{ list, join }`, where `join` is `and`, `unit`, `clauses` or `concat`), rendered in the same locale as the sentence around it, so the counts pluralize in the reader's language. [Import CSV](/admin/api/imports/#import-csv), [Import Changes](/admin/api/imports/#import-changes) and [Import Deck](/admin/api/imports/#import-deck) say so where they do, and so do the refusals of change JSON — a [change bundle](/admin/api/imports/#import-changes), a [save](/admin/api/lists/#save-a-list)'s changes and a [history rewrite](/admin/api/lists/#save-change-history)'s events — whose `domain.changes.problem.*` sentence nests the record it is about (`Move #1 "from"`, `changes[2]`) as its `subject`, an [error a route did not expect](#error-responses), such as a cache-lock time-out, the [list-file engines' refusals](#error-responses) (a list's unknown keys or valid formats as a `unit` list, an unreadable `.art.json`'s reason, a rewrite gate's problems), the [config validator's refusals](/admin/api/site/#update-config) (a block's refusal nesting its field's, the accepted values as a `unit` list, a malformed `uiLocale`'s nested tag-parser reason), a list load's [`warnings`](/admin/api/lists/#load-deck) (a card-line diagnostic nested as `text` inside its `domain.card.line.atLine` location, its hint inside `domain.card.line.withHint`), the [card vocabulary's refusals](#error-responses) (a tag or category refusal nesting its shape `rule`, a card language's valid codes as a `unit` list), [Export Cards](/admin/api/imports/#export-cards)' and [Diff Lists](/admin/api/lists/#diff-lists)' `warnings` (a list's parse warning nested as `warning`, a decklist's omitted sections as a `unit` list, each `section` a `domain.board.*` message for a standard board and the heading as written otherwise) and export refusals (the accepted columns or values as a `unit` list), and the [cache refresh stream](/admin/api/site/#refresh-cache-stream)'s progress lines, whose download sizes are a size (`{ sizeBytes }`, rendered as a two-decimal mebibyte figure in the reader's locale), the buylist routes' `503` when no feed is downloaded (`domain.cache.cardKingdom.missingApiAdvice`, whose `lead` nests the `domain.cache.cardKingdom.noFeed` sentence), [Sell Refresh](/admin/api/prices/#sell-refresh)'s `staleFallback` and `skippedRows` (a failed download's underlying `error`, a skipped feed row's `reason`), and [Sell Cart](/admin/api/prices/#sell-cart)'s `warnings` (the etched titles as a `unit` list). The [Archidekt sync routes](/admin/api/sync/#sync-decks) nest too: a deck's per-card change lines and the stream's `log` lines (and each item's `reasonParams`) name a standard board (`Main`, `Sideboard`, …) as a `domain.board.*` message, so it is worded in the reader's language. [Setup Diagnostics](/admin/api/site/#setup-diagnostics)' check summaries nest as well: the build and install kind as `domain.doctor.*` messages, a workspace's list counts as a `unit` list of `domain.count.*` messages, the cache's card count as a message, and an age as a duration (`{ durationMs }`, rendered as days and hours in the reader's locale). Every other response's params are plain strings and numbers.

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

`messageKey` and `messageParams` follow [the message triple](#the-message-triple): present on a keyed refusal, absent when the prose has no catalog entry. A refusal naming a list that does not resolve ([Diff Lists](/admin/api/lists/#diff-lists), [Export Cards](/admin/api/imports/#export-cards)) carries the list resolver's `errors.resolveList.*` key, and its params may nest (the ambiguous matches are a list of messages). A not-found with existing names close to the one requested is `errors.resolveList.didYouMean`, nesting the not-found message as `message` beside the suggested `names`.

A request whose shape is wrong is refused with a shared family of keys wherever a route's check is a generic one (a route with a field of its own, such as `columns` on [Export Cards](/admin/api/imports/#export-cards), words its refusal for that field). The body itself: `admin.api.body.notJson` (not valid JSON), `admin.api.body.notObject` (JSON, but not an object) and `admin.api.body.tooLarge` (a `413`, see [Request size limits](#request-size-limits)). A field or query parameter: `admin.api.field.*`, whose `field` param names it exactly as the request spelled it, an indexed path included (`printings[3].set`). The family is `required`, `notBoolean`, `notString`, `blank` (missing, or empty once trimmed), `notObject`, `notArray`, `notStringArray`, `tooMany` (more entries than one request may carry, the maximum as `count`), `notPositiveInteger` and `notNonNegativeInteger` (the value sent, trimmed, as `value`: an invalid `limit`, `page` or `offset`), plus `credentialsRequired` for a sign-in form missing its `username` or `password`. The English quotes the field: `"printings[3].set" must be a non-empty string.`, `Invalid "limit" 'abc'. Use a positive integer.` A value outside a fixed set of choices is `errors.enum.invalid` (or `errors.enum.type` for one that is not a string), with `field`, `value` and the comma-joined `choices`.

The list-file engines' refusals are keyed the same way: a [create, rename or delete](/admin/api/lists/#list-lifecycle-responses) refused (`domain.list.lifecycle.*`, or `domain.list.name.unusable` for a name with no usable file-name characters), an unknown deck format (`domain.list.deckFormat.invalid`, whose `formats` is a `{ list, join: "unit" }`), a cover image, custom-art reference or description the grammar refuses (`domain.list.image.*`, `domain.list.art.*`, `domain.list.description.*`; the keys it does not accept nest as a `{ list, join: "unit" }`), a metadata or cover write over front matter that is not a readable mapping, a cover naming no card of the list, an unreadable `.art.json`, and a [save](/admin/api/lists/#save-a-list) refused because a rewrite would delete content the parser cannot re-emit (`domain.list.unreadableContent`, whose `problems` param is a `{ list, join: "clauses" }` of nested messages: the parser's own warnings, keyed like the load's [`warnings`](/admin/api/lists/#load-deck), and, for a fenced code block, `domain.list.fencedContent`), and a save whose cross-list moves cannot reach their other list (`domain.list.move.*`: the list is gone, holds no copy to take, or cannot be staged — the last nests the staging refusal as its `reason`, and each names the list as a nested `domain.change.listRef` message).

The card vocabulary's refusals are keyed too (`domain.card.*`): a label set a request names (`domain.card.label.*`, or `errors.label.exclusive` / `errors.label.contradictory` for a combination the rule forbids), a tag or category (`domain.card.tag.*`, `domain.card.category.*`, whose `rule` param nests the shape rule as its own message), a note (`domain.card.note.invalid`), a set code (`domain.card.setCode.invalid`) and a card language (`domain.card.language.invalidField`). A change payload one of them refused nests it as the `detail` of `domain.changes.problem.fieldRejected`.

An error a route did not expect — one raised deep in an engine — is answered the same way, in English plus its key whenever it has one. A card-cache error is one: a cache-lock time-out (`domain.cache.lockTimedOut`, whose `timeout` param is a duration `{ durationMs }` and whose `holder` is a message of its own), a failed request to a [`--cache-server`](/commands/cache/) (`domain.cache.serverRequestFailed`, …), a card-cache refresh that failed or was cancelled (`domain.cache.refresh.*`), or a failed Scryfall request a route made (`domain.cache.scryfall.timedOut`, whose `timeout` is a duration `{ elapsedMs }`, and `domain.cache.scryfall.symbologyFailed`, whose params are the HTTP `status` and `statusText`). A remote cache server's own reply arrives nested: its message — a failed Scryfall price batch (`domain.cache.scryfall.pricesFailed`), the server's refusal of the request (`domain.cache.serverReply.*`, such as `invalidRoute` or `keyMalformed`), or a `--deny-http` server's refusal to download a price (`domain.cache.serverReply.httpDenied`) — is the `body` of `domain.cache.serverRequestFailedWithBody`, or the `error` of `domain.cache.serverStreamEntryError` (which names the entry's `key`) or `domain.cache.serverStreamError`. A reply this server cannot render whole (a newer cache server's key or param) is nested as its English text instead, and a reply that is not a message at all (an older cache server's keyless body, a proxy's error page) as its text, cut to about 1,000 characters and stripped of control characters (as is every text param of a nested reply). These params nest the way a [sync's](/admin/api/sync/#sync-decks) do.

A `ritual.config.json` edited by hand into something that is not a JSON object while the server runs fails **every** request with a `500` (the server re-reads the file per request), keyed `domain.config.fileNotJson`: `file` is the config file's name (`ritual.config.json`), `path` the file's location and `reason` the JSON parser's own complaint (plain text) or, for valid JSON that is not an object, a nested `domain.config.fileNotObject` message.

`499` is the status a route answers when an **in-process** caller cancels the request part way (the MCP tools do this on a client's `notifications/cancelled`). HTTP requests are never cancelled this way: closing the connection leaves the handler running to completion.

A few routes carry extra fields on failure where they are part of the wire contract:

- [Card Details](/admin/api/cards/#card-details) adds `card: null`.
- [Card Search](/admin/api/cards/#card-search) keeps its paging fields and an empty `cards` array.
- [Card Autocomplete](/admin/api/cards/#card-autocomplete) uses one shape for success and failure. [Card Printings](/admin/api/cards/#card-printings) fails with `printings: []`, [Card Price](/admin/api/cards/#card-price) with `printings: []` and its printing fields `null`, and Cards with `cards: []`, each beside the message triple.
- A save that loses an optimistic-concurrency race carries `conflict: true` with its `409`.
- A [save](/admin/api/lists/#save-a-list) refused because a change missed its card carries `unmatched`, one entry per change.

### Request size limits

Every route caps its request body and answers `413` past the cap, keyed `admin.api.body.tooLarge` with the route's limit in exact bytes as `messageParams.count` (`"Request body too large (limit 10240 bytes)"`). The bytes are counted as they arrive, so the cap holds for a chunked body or one that declares no `Content-Length`.

| Routes                                                                                                                                                                        | Cap           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Credentials, settings, list names, and other small bodies                                                                                                                     | 10 KiB        |
| [List metadata](/admin/api/lists/#list-metadata) (a description can be long)                                                                                                  | 1 MiB         |
| [Saves](/admin/api/lists/#save-a-list) (at most 50,000 changes), moves, removals, [sync](/admin/api/sync/#sync-decks) and [export](/admin/api/imports/#export-cards) requests | about 9.5 MiB |
| [Buylist quotes](/admin/api/prices/#buylist-quotes) (at most 500 printings)                                                                                                   | about 117 KiB |
| Uploads: [CSV](/admin/api/imports/#import-csv) and decklist imports, [change bundles](/admin/api/imports/#import-changes), history rewrites                                   | 16 MiB        |

Beneath the per-route caps, the server refuses any body larger than 16 MiB plus a small allowance; that refusal comes from the runtime and has no JSON body.

## Authentication

The admin uses **session-based authentication**. Send `POST /api/login` with your credentials (and a TOTP code if TOTP is enabled). The response sets a session cookie in a `Set-Cookie` header, and later requests authenticate with that cookie.

- Sessions expire after 24 hours. `POST /api/logout` ends one early.
- Unauthenticated requests to protected routes receive `401` with the shared [error envelope](#error-responses) (`messageKey: admin.api.server.unauthorized`). Before the first admin account exists they receive `403` (`admin.api.server.setupRequired`).
- Rate-limited sign-ins receive `429 Too Many Requests`: the shared error envelope (`messageKey: admin.api.login.rateLimited`) plus `retryAfterSeconds`, the remaining lockout, which the `Retry-After` header also carries.
