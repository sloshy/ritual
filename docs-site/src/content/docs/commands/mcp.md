---
title: 'mcp'
---

Start an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI agents (Claude Desktop, Claude Code, and other MCP clients) manage your decks, collections, and wanted lists.

The MCP server runs the **same operations as the [admin site](/commands/admin/)**, in-process. It reuses the admin route handlers directly, so editing through MCP behaves identically to editing in the browser: the same changelog, the same content-hash conflict detection, and the same optional git auto-commit. It does **not** open the admin HTTP server or require an admin login. It is a local, trusted process you launch yourself.

## Usage

```bash
ritual mcp [options]
```

## Options

| Option                    | Description                                                                                   | Default     |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `--transport <type>`      | Transport to use: `stdio` or `http`                                                           | `stdio`     |
| `-p, --port <number>`     | Port for the HTTP transport                                                                   | `8765`      |
| `--host <address>`        | Host to bind for the HTTP transport                                                           | `127.0.0.1` |
| `--token <secret>`        | Require this bearer token on the HTTP transport                                               |             |
| `--allow-unauthenticated` | Serve the HTTP transport without a bearer token on a non-loopback host                        |             |
| `--sell-mode`             | Answer the sell/buylist tools for this run even when `site.sellMode` is off (both transports) |             |

`--token` may also be supplied via the `RITUAL_MCP_TOKEN` environment variable (the flag takes precedence), which keeps the secret out of the process list. The global `--base-dir <path>` option selects which Ritual workspace (decks/collections/wanted dirs) the server operates on. The `RITUAL_BASE_DIR` environment variable does the same, which is handy in an MCP client's `env` block. The directory must already exist or the server exits `2` before starting. Likewise, a [malformed `ritual.config.json`](/configuration/#malformed-files-are-a-hard-error) aborts the server with exit `1` before the transport opens. `--cache-server <host:port>` is also honoured.

## Transports

### stdio (default)

The standard transport for local MCP clients. The client launches `ritual mcp` and exchanges JSON-RPC over stdin/stdout. There is no network exposure and no authentication, since the client already controls the process.

:::note
On the stdio transport, **stdout is the JSON-RPC channel**, so Ritual diverts all of its own logging to stderr. Do not pipe other commands' output into `ritual mcp`.
:::

Over stdio the protocol era is chosen by the connection's opening exchange (a 2025-era `initialize` is served on a compatibility path; a 2026-07-28 client is served statelessly), and one server instance is pinned for the life of the connection. The per-request stateless model described below applies to HTTP only.

### HTTP (Streamable HTTP)

```bash
ritual mcp --transport http --port 8765 --token "$MCP_TOKEN"
```

Serves the MCP [Streamable HTTP](https://modelcontextprotocol.io) transport at `http://<host>:<port>/mcp` for remote/networked clients. It binds to `127.0.0.1` by default. `--port` is validated at parse time (1–65535); an invalid value exits with code 2. **If you expose it beyond localhost, set a token (`--token` or `RITUAL_MCP_TOKEN`) so every request must send `Authorization: Bearer <token>`.** There is no other authentication layer.

Ritual implements MCP revision **2026-07-28**, whose Streamable HTTP transport is **stateless**. There is no `initialize` handshake and no `Mcp-Session-Id` header. Every POST to `/mcp` is served on its own, carrying the protocol version and client capabilities in the request itself. Clients speaking the older 2025-era protocol (including current Claude Desktop / Claude Code releases) are still served: Ritual answers their `initialize` handshake on a compatibility path. On that path the standalone `GET /mcp` SSE stream and `DELETE /mcp` session teardown are not available and answer `405`. Ritual uses neither feature.

Without a token, the command **refuses to bind a non-loopback `--host`** (exit code `2`) unless you explicitly pass `--allow-unauthenticated`. An unauthenticated MCP endpoint exposed beyond the local machine would let anyone on the network edit your lists. Tokenless binds to a loopback host (`127.0.0.1`, `localhost`, `::1`) are allowed and print a one-line notice on stderr.

The HTTP-only flags (`--port`, `--host`, `--token`, `--allow-unauthenticated`) have no effect under the default stdio transport. Passing them there prints a warning on stderr and they are ignored.

`Ctrl+C` (`SIGINT`) or `SIGTERM` stops the listener and drops active connections, so the port is released and the process exits on its own rather than being killed with a bound socket behind it. A teardown that fails is reported on stderr instead of being swallowed. `ritual admin --mcp` does the same for both of its listeners.

#### Errors

| Response | When                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`    | Missing or wrong bearer token. The JSON-RPC body carries implementation-defined code `-32010`.                                                                                                                                |
| `403`    | On a **loopback bind only**: a request whose `Host` or `Origin` header is not local (DNS-rebinding protection, checked before auth). A deliberately exposed host skips this check and is guarded by the bearer token instead. |
| `404`    | A path other than `/mcp`. The body carries implementation-defined code `-32011`.                                                                                                                                              |
| `405`    | `GET`/`DELETE` on `/mcp` — the 2025-era session operations, which stateless serving does not have.                                                                                                                            |
| `415`    | A POST whose `Content-Type` is not `application/json`.                                                                                                                                                                        |

On 2026-07-28 responses, the catalog surfaces (`tools/list`, `resources/templates/list`, `server/discover`) advertise a one-hour private cache hint. List enumerations and reads (`resources/list`, `resources/read`) are marked never-cacheable, since their contents change with every edit. Ritual declares no tool-list-changed notifications and no resource subscriptions; see [Resources](#resources) for the transport-dependent `resources.listChanged`.

### Embedding in a running admin server

Instead of a standalone process, you can serve the same MCP endpoint **inside a running web admin** with [`ritual admin --mcp`](/commands/admin/#embedded-mcp-server). That runs one process exposing both the web admin and an MCP endpoint (on `--mcp-port`, default `8765`), sharing the same config, cache, and data. It uses the **same bearer-token auth** as this command. A token (`--mcp-token` or `RITUAL_MCP_TOKEN`) is required there, since the admin binds `0.0.0.0` by default, and is independent of the browser admin login.

## Results and errors

Both halves of the tool-result contract are transport-independent. They hold identically over stdio, over Streamable HTTP, and on either protocol era.

### Structured results

Every tool declares an `outputSchema` and answers with `structuredContent`. **Read `structuredContent`, not `content[0].text`.** A successful result carries an empty `content` array on purpose, so the same JSON is never put on the wire twice. Only a failure carries a text block, and it holds the `message` below. The one other shape a call can answer with is an `input_required` result: `sync_collection` returns one instead of a result when it needs an [ambiguous-removal decision](#destructive) and the client can be asked.

A tool's `outputSchema`, as returned by `tools/list`, **is the authoritative field-level documentation of its response**: every field, its type, whether it is always present, and a description of what it means. This page describes the tools; the schemas describe their replies, and they are what the client validates against. The one exception is the failure payload. `isError` results are exempt from output-schema validation, so no schema carries it and it is documented in prose below instead.

### Tool errors

A failed tool call is **not** a JSON-RPC error. It comes back as a normal result with `isError: true`, carrying a one-line text block (the message) **and** a structured payload:

```json
{
  "error": true,
  "code": "conflict",
  "message": "Deck has been modified since you loaded it. Please reload.",
  "conflict": true,
  "recovery": "Re-read the list with get_list, then re-apply your change."
}
```

| Field       | Meaning                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `code`      | `conflict` \| `cancelled` \| `invalid-request` \| `internal`. `cancelled` is the caller's own cancellation reaching back up. |
| `conflict`  | Present (and `true`) only on `code: "conflict"` — a lost optimistic-concurrency race.                                        |
| `recovery`  | The next concrete action, when there is one.                                                                                 |
| `unmatched` | Changes that did not apply, when an all-or-nothing batch was rejected whole.                                                 |

Ritual's internal conflict code `-32012` is **never visible to a client**. Ritual itself catches every error thrown inside a tool call and converts it into the `isError` result above, so the numeric code is spent before the SDK, let alone a client, ever sees it. It survives only as the internal signal that drives the one automatic retry. The `-32010` / `-32011` codes in the HTTP [Errors](#errors) table are different. They are emitted by the HTTP wrapper before the request reaches the protocol layer, so they _are_ wire-visible, and correspondingly never appear inside a tool result.

One error is re-raised rather than structured: a URL-elicitation request is a protocol handshake the client must answer, not a tool failure.

### Language: English by contract

Ritual's CLI output and its two web UIs follow the configured [UI locale](/localization/) (`--locale`, `RITUAL_LOCALE`, or the `uiLocale` config key). **This surface does not.** Tool names, titles, descriptions, parameter documentation, output-schema descriptions, the server `instructions`, and the `message` of every result, success or failure, stay English no matter what that setting says. They are model-facing prose densely interleaved with flags, file paths, and `snake_case` tool names, so a translated copy would help no one and would break the very identifiers a client matches on.

A client that _does_ render for a human gets the sentence unrendered instead of translated. Results produced by the shared admin handlers carry two optional fields beside `message`:

| Field           | Meaning                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messageKey`    | The catalog key `message` was rendered from — stable across locales _and_ across rewordings of the English text. Absent when a handler has no key for that sentence. |
| `messageParams` | The values that key interpolates. Absent when the message takes none.                                                                                                |

Match on `messageKey` (or, for a failure, on `code`) rather than on the prose. Both are locale-invariant, and `message` is the field most likely to be reworded. The two sync tools carry the same triple per clause in `summary.clauses`, so a run's one-line outcome can be re-joined and re-pluralized in another language instead of being re-parsed out of English. The `isError` payload carries no key, since `code` is already its discriminator.

Data payloads are never localized either. See [what never gets translated](/localization/#what-never-gets-translated) for the full contract.

### Progress notifications

The four long-running tools (`refresh_cache`, `sync_decks`, `sync_collection`, and `build_site`) emit `notifications/progress` **during** the call, but only when the client asked for them by supplying a `progressToken` (which the SDK client does automatically when you pass `onprogress` to `callTool`). Without a token nothing is emitted.

Each notification carries `progress`, `total`, and a human-readable `message`. `progress` strictly increases across a run. The scales differ by tool: the cache refresh reports 0–100, and the two syncs report one notification per deck/list plus a terminal `n/n`. `build_site` reports three structural steps (start → building → publishing → done).

The result itself is **unchanged and still blocking**. The tool returns its ordinary structured result when the work finishes. Over Streamable HTTP the response upgrades to an SSE stream automatically as soon as a notification precedes the result, so no client configuration is needed for the frames to arrive.

One client-side setting does matter. The SDK's default request timeout is 60 seconds and does **not** reset on progress. A client driving a long call should pass `resetTimeoutOnProgress: true` (or a larger `timeout`) alongside `onprogress`. Ritual cannot set it; it is a client option.

All four also honour cancellation (a client's `notifications/cancelled`, which the SDK client sends when the `signal` passed to `callTool` aborts), each at the point its partial state is recoverable:

- `build_site` kills the child build. Because the build publishes atomically the live site is left untouched. The cancelled call answers with a tool error saying the site build was cancelled; `dist/` still holds the previous site, byte for byte, and the next `build_site` is accepted immediately.
- `refresh_cache` stops the download and writes nothing. The previous card cache is left exactly as it was, the cache lock is released, and the call answers with a tool error saying the refresh was cancelled.
- `sync_decks` and `sync_collection` stop **between items**. The deck or list in flight finishes (nothing is ever half-pushed or half-written), and every item the run never reached is reported `skipped` with the reason `cancelled before it started`. The result is the ordinary report with `report.cancelled: true` (and, for the collection, no `lastSynced` recorded), because the items already synced are real. A client that cancels should still read it. Note that a cancelled push has already sent whatever it pushed before stopping.

## Tools

Every tool that addresses a list takes the same two fields: `listType` (`deck` | `collection` |
`wanted`) and `slug` (the markdown file basename without `.md`).

### Read (read-only)

| Tool                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_lists`                           | Every list as `{ listType, slug, name }`, optionally filtered by `listType`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `get_sync_status`                      | What an Archidekt sync can cover. `target: "decks"` returns the linked decks (with each deck's `lastSynced` — the same view the CLI's `deck-sync status` prints); `target: "collection"` returns the coverable lists, the default pull target, the CSV threshold, and when the account last synced. Omit `target` for both halves. Both carry the login snapshot, whose `loginRequired` is what `ritual login status` reports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `get_list`                             | Read one list. The result is discriminated by `view` (`"cards"` \| `"summary"`) and `listType`: a deck's cards view carries `deck` + `frontMatter`, a flat list's carries `entries` + `sectionOrder` plus the list's front-matter `description` (a deck's rides inside `deck`), and `view: "summary"` carries `counts` only. A cards view on a label-carrying list also reports the list-level `labels` default with each card's own `labels` override; every card on every list type carries its own `tags` (its line's tags, canonical and without the `#`) when it has any; and the view reports the list's [cover image](/list-images/) override as `image` (absent when the built-in cover rule applies), and — when any returned card has [custom art](/custom-art/) — a `customArt` record of raw references keyed by `&N` id. A cards view also carries the list's [categories](#card-categories) as `categories` when the list has any, and each returned card's own resolved `categories`. Every arm also carries `warnings` — lines the file's parser could not read, always present and empty for a clean file, so a list holding an unreadable line is never mistaken for a shorter list. `section` / `nameContains` / `limit` / `offset` narrow the result. |
| `search_scryfall`                      | Run a live [Scryfall query](https://scryfall.com/docs/syntax) and return card summaries (name, printing, mana cost, type line, oracle text, prices). `warm: true` also caches the results locally and promotes a whole-name match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `autocomplete_card`                    | Match every whitespace-separated term against the local cache's card names (`in tre` → "In the Trenches").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `find_cards`                           | Find where a card physically lives across your lists — one result per copy, carrying the fields the move/remove tools address entries by. `includeLists` adds the full roster as `{ listType, slug, name }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `get_card_details`                     | Everything the local cache knows about one card: oracle text, type line, colors, keywords, legalities, Scryfall Tagger tags, faces, printing count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `get_card_printings`, `get_card_price` | A card's printings and per-currency prices (an unknown card name is an error).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `get_price_report`                     | [Price](/commands/price/) one list (`listType` + `slug`), one list type (`listType` alone), or every list (no arguments). Optional `source` picks the store (`tcgplayer` / `cardmarket` / `cardkingdom` — Card Kingdom NM retail from the cached feed). The result is discriminated by `mode`: `"list"` carries `list` + `cards`, `"summary"` carries `lists` + `typeTotals` + `totals`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `get_sell_report`                      | Match cards against the locally cached [Card Kingdom buylist](/commands/sell/): what CK is buying, the cash quote per Near Mint copy, and their quantity caps. Scope with `listType` (default: collections) or `lists`; filter with `sets` / `minPrice`. Errors when the card cache is empty (`refresh_cache`), no feed has been downloaded (`refresh_buylist`), or [sell mode is off](#sell-tools-need-sell-mode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `get_sell_cart`                        | The cards CK is buying, rendered as their sell-cart CSV import format (no header row; CK's own listing titles, variant note included; quantities capped at their buy limits) over the same scope and filters as `get_sell_report`. `warnings` flags their 500-title/5,000-card upload caps and etched foils the format cannot express. Needs [sell mode](#sell-tools-need-sell-mode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `get_buylist_quotes`                   | The buyer's current offer for specific printings, keyed by `set:collectorNumber:finish`. Prices an arbitrary set of cards (a trade, a selection) without building a whole sell report; printings with no product are absent from the result. Cache-backed — run `refresh_buylist` first. Needs [sell mode](#sell-tools-need-sell-mode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `get_history`                          | A list's change history: each set's prose `lines` plus its typed `events` (from the entry's `ritual-changes` block; empty for a legacy entry), and the `defaultEvents` a rewrite-with-defaults would write. A set followed by preserved hand-written text carries it in a `trailing` array — echo it back on `rewrite_history` or that text is deleted. When the list's categories sidecar could not be read, `defaultEvents` names no categories and `categoryWarnings` says why (absent otherwise).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `get_config`, `get_cache_status`       | Configuration (including `defaultLanguage`, the card language, and `uiLocale`, the [interface language](/configuration/#interface-language) — two different settings), and the state of the local Scryfall card cache. `get_config` reports the stored config as `config` and, when this server was started with a session flag such as `--sell-mode`, what it is actually running with as [`overrides`](#stored-config-vs-what-this-server-runs-with).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `diff_lists`                           | Compare two lists by card name or exact printing — the [`diff`](/commands/diff/) command as a tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `export_cards`                         | Render a CSV, JSON, plain-text, or Markdown [export](/commands/export/) of lists and/or card picks, with filters (name, set, finish, conditions, labels, tags), saved or built-in `preset`s, column selection for `csv`/`json` (including `categories` — the card name's categories in that list, comma-joined primary first — and `primaryCategory`, both dropped by the `text` and `md` formats), and a `dialect` (`ritual`, `archidekt`, `arena`, `moxfield`) that spells `csv`/`json` values and picks the `text` decklist form (`arena`/`moxfield` omit maybeboard and token cards and name them in `warnings`). `write: true` writes a file instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

#### Network vs local

Three tools find cards, and their names say where the data comes from:

- **`search_scryfall`** always queries the live Scryfall API, using Scryfall's own query syntax. One
  page per call — walk a large result set with `page` while `hasMore` is true; `limit` caps the cards
  returned (max 175, defaulting to 20 when `warm: true` and to the whole page otherwise). With
  `warm: true` it additionally writes results into the local card cache under names the cache does
  not already hold (never overwriting one), and moves a card whose whole name the query spells out
  ahead of Scryfall's popularity order. It writes to the _cache_ only, never to your lists, which is
  why it still carries `readOnlyHint`.
- **`find_cards`** searches **your own lists** — the cross-list physical-card index — and never
  touches the network. Each result is one physical copy (a deck line with quantity 3 yields three),
  carrying `listType`, `listSlug`, `name`, printing, `cardId`, and `copyIndex`: exactly the fields
  `move_selected_cards` and `remove_selected_cards` address entries by. Filters intersect (`name`
  matches every whitespace-separated term in any order; `listType`/`slug`/`set` match exactly), and
  `includeLists: true` adds the full list roster (the move destinations) — off by default, since it
  does not depend on the filters. `warnings` names any list file that could not be fully read, so an
  empty result is never silently wrong.
- **`autocomplete_card`** reads the local card cache, also with no network.

#### Reading part of a list

`get_list` defaults to the whole list. To read less:

- `view: "summary"` returns `{ slug, listType, counts, warnings }` — total lines, total copies, a
  per-section breakdown, and the parser warnings every arm carries. No card data at all, which makes
  it the cheapest call on a list you have not seen, and the right first one on a large collection.
- `section` matches a markdown `## Section` heading exactly (case-sensitively); a section that does
  not exist yields no entries rather than an error.
- `nameContains` matches every whitespace-separated term, in any order, the way `autocomplete_card`
  matches.
- `limit` and `offset` page through the matches in the default (`cards`) view. `view: "summary"`
  ignores them: its counts always describe the whole filtered set, which is what you page against.
- `totalCount` is always present — the number of entries that matched **before** `limit`/`offset`
  applied, or the list's whole line count when nothing was filtered — so you can tell a full page
  from the end of the list.

These are route parameters, not a client-side trim: a `summary` or filtered read returns before the
server loads any Scryfall card data, printings, prices, or the mana-symbol map.

#### Cards and prices

`get_card_printings` returns the newest 20 printings by default, as identity only — set, collector
number, rarity, release date, finishes, and (when not English) the object's `lang`. Pass `limit`
for more or fewer (`limit` and `totalPrintings` count **distinct printings** — with a non-English
cache every language object of an included printing rides along, so a client never sees a printing
with half its languages missing), and `includePrices: true` when you actually want each printing's
price block; `get_card_price` is usually the better answer for a price question. The result's
`languages` array summarizes every language the card exists in (`en` first; `["en"]` for an
English-only cache).

Both `get_card_printings` and `get_card_details` report whether the printing list can be trusted as
complete (`complete` / `printingsComplete`). It is `false` when the local card cache holds no
printing list for the name — the one printing shown then came from a single Scryfall lookup, so a
`printingCount` of 1 says nothing about the card. Run `refresh_cache` (or
[`ritual cache preload-all`](/commands/cache/)) before concluding a card has only one printing.

`get_cache_status` reports whether the local card cache is `empty`, how many cards it holds, when it
was last refreshed, its price age and whether prices are `priceStale`, whether Scryfall Tagger tags
are present, where the cache is served from, and its language provenance: `defaultLanguage` (the
configured code), `cardBulkType` (`default_cards` English-only or `all_cards` every-language —
`null` before any recorded ingest), and `bulkTypeStale` (`true` when the cache's bulk disagrees
with what `defaultLanguage` demands, meaning a full `refresh_cache` is needed — see
[bulk selection](/commands/cache/#bulk-selection-and-language)). Check `empty` and `priceStale`
before pricing: a stale or empty cache is exactly what `get_price_report` errors on, and
`refresh_cache` is the fix.

`diff_lists` takes two sides (`a` and `b`, each `{ listType?, name }` — names resolve like CLI list
arguments, with `listType` pinning an ambiguous name) plus an optional `by` (`name`, the default, or
`printing`) and returns `{ a, b, by, matches, onlyInA, onlyInB, warnings }` with quantities summed
across all sections. Each side comes back as `{ listType, slug, name }` — the same vocabulary
`list_lists` and `find_cards`' roster use, so a diff side can be handed straight to any tool that
names a list. See [`diff`](/commands/diff/) for the identity rules (nonfoil folding, the
no-printing bucket).

`get_price_report` takes both `listType` and `slug` (one list's summary plus its priced card entries),
`listType` alone (per-list totals across every list of that type, like the CLI's `price --deck
--summary`), or neither (per-list totals across every list) — a `slug` without a `listType` is a
validation error. The optional `currency` (`usd` | `eur` | `tix`) defaults to the configured
`defaultCurrency`; the optional `source` picks the store instead — `tcgplayer` (Scryfall USD),
`cardmarket` (Scryfall EUR), or `cardkingdom` (Card Kingdom NM retail from the cached
[buylist feed](/commands/sell/); errors with the refresh advice when no feed is downloaded).
A source implies its currency, so passing a `currency` that disagrees is a validation error,
and a `cardkingdom` result carries `source: "cardkingdom"` beside `currency: "usd"`. The
result is discriminated by `mode`: `"list"` carries `list` + `cards`,
`"summary"` carries `lists` + `typeTotals` + `totals`. Prices come strictly from the local card
cache; an empty cache is an error (check `get_cache_status` first, then run `refresh_cache`).

`export_cards` returns `{ mode: "content", format, entryCount, warnings, content }` by default —
the rendered export inline, with nothing written to disk. With `write: true` it instead writes a
server-named file under `exports/` in the base dir and returns
`{ mode: "file", format, entryCount, warnings, path, bytes }`; an existing file is never
overwritten. Because of that write mode it carries no `readOnlyHint` (it is not flagged destructive
either — the writer never replaces a file), even though it is registered with the read tools.

#### Stored config vs what this server runs with

`get_config` answers two questions, because they can disagree. `config` is the stored configuration
— `ritual.config.json` merged over the built-in defaults, the same payload
[`config list --output json`](/commands/config/#config-list) prints. `overrides` is what **this running
server** is operating with in place of it, keyed by the config path each override displaces:

```json
{
  "config": { "site": {} },
  "overrides": { "site.sellMode": true }
}
```

That is a server started with [`--sell-mode`](#sell-tools-need-sell-mode): the flag is a session
setting that writes nothing, so `config.site.sellMode` stays as stored (usually unset) while the
sell tools answer anyway. Without it, the key is **absent entirely** — no `overrides` means the two
answers agree, and reading `config` alone is enough.

`update_config` never carries the field: it echoes back what it persisted, and an override is
neither persisted nor changed by a write.

### Write

| Tool                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_list`           | Create a new, empty list. `format` (from the fixed set of deck formats) applies to decks only. Refused (`409`) when a list of that type already [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) under that name — folding ignores case, accents, hyphens/underscores, apostrophes, and filename-illegal punctuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `import_deck`           | Import a deck from a URL or pasted decklist text (Ritual's own format and MTG Arena/MTGO exports). A URL import must state `syncPrintings` (`true` keeps the [exact printings the source lists](/commands/import/#printings-from-a-url-import), `false` imports bare card names) — the CLI asks the user interactively, and this field is that decision, so ask the user when their intent is unclear. Text lines the parser cannot read are skipped and reported in the result's `warnings` array (empty for URL imports) — a non-empty array means part of the pasted text was not imported. `advisories` reports lines that were imported but looked off (e.g. a card name still holding a printing token). A name/ID conflict without `overwrite`, or a deck name with no characters usable in a file name, fails with `code: "invalid-request"`.                                                                                                                                                                                                                                                                                                                              |
| `import_csv`            | Import CSV text into a new or existing list (create/overwrite/append) with a column-mapping spec. A `categories` cell (header `category` or `categories`) holds the card's categories comma-separated (`Ramp, Artifacts`, first is primary) and is written to the list's categories sidecar; on a deck a value that names a board (`Sideboard`, `Commander`, `Tokens`, …) sets the row's section instead, and a value the category grammar refuses is dropped into `warnings` rather than failing the row. In a deck, rows of the same card and printing merge into one line in every mode; collections and wanted lists keep one line per copy. `hasHeader` defaults to true and the result's `warnings` name the row that skipped (and whether it looked like a header), so a headerless export does not silently lose its first card. `format` applies to decks only. Rows that fail validation do not fail the call: the result always carries `cardCount`, `failures`, and `failedCount`, so a partially-failed import still succeeds and reports which rows were dropped. A refusal (bad column spec, unknown list type, append to a missing list) is a tool error as usual. |
| `import_change_bundle`  | Apply a change bundle exported from the site editor to the underlying lists. A version-2 bundle carries per-list `lists[].changes` plus a top-level normalized `moves` array; each move is applied on its destination list, whose save also takes the copy out of the source and writes both changelogs (a move carrying `pinsCardId` pins a name-only line there instead of adding a copy; one carrying `replacement` adds that printing back to the source; one carrying `tags` lands them on the destination line). Answers with `{ message, lists, failedCount }`; a list that could not be resolved, loaded, or saved is reported in its own `lists[].error` rather than failing the call (the failing batch applied nothing and that list's later batches are skipped; earlier batches stay applied and are counted).                                                                                                                                                                                                                                                                                                                                                        |
| `set_list_metadata`     | Write a list's front matter — any list's `description`, a deck's `tags`, `format`, `sourceId`, `sourceUrl`, or a deck's or collection's default `labels` (a deck's being `proxy` alone). Only the fields you send are touched; `null` clears one. Answers with `{ slug, frontMatter }` — the route's `contentHash` is dropped, since an agent never supplies one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `add_card`              | Add a card to any list; `quantity` adds that many copies in one save. `condition` is rejected for wanted lists; collections require `set` + `collectorNumber` together, and `labels` (a label override for the new card) is accepted for whatever the list type [carries](#card-labels-are-per-list-type); `tags` gives the new card its [tags](#card-tags) on any list type. `language` records a non-English copy — omitted, the configured `defaultLanguage` applies. The list must already exist — unlike `ritual add-card`, which creates a missing collection or wanted list, list creation here is its own tool (`create_list`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `set_card_art`          | Set or clear one card's [custom art](/custom-art/) — the image the site and editors show instead of the printing's scan. Addressed by `cardId` (`get_list` reports it); `art` is `{ file }` under the configured `artDir`, `{ url }`, or `null` to clear. A file must already exist there — Ritual references images, it never uploads them. The write goes straight to `<list>.art.json`: no card-line change, no changelog entry, and no interaction with a pending batch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `remove_card`           | Remove a card from any list; `quantity` (decks only) removes that many copies. Flat lists remove one entry a time. `finish`, `condition`, and `language` narrow the match to entries with that value (`language: "en"` matches bare lines).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `set_card_printing`     | Set a card's printing in place. It can omit `set`/`collectorNumber` to clear a deck or wanted-list card's printing, but not a collection's — that's rejected. `condition` takes a grade or `NONE` to clear a recorded grade (also accepted on `apply_changes`' `set-printing` action); `NM` is the unrecorded default, so setting it leaves the line ungraded. `language` sets the card's language alongside the printing; omitted, it is left alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apply_changes`         | Apply an ordered batch of changes to one list atomically (one save, one changelog block). The only route to language, note, label, section, commander and [category](#card-categories) edits (`set-categories`, `rename-category`, `set-category-order`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `move_selected_cards`   | Move a batch of identity-addressed cards between lists atomically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `remove_selected_cards` | Remove a batch of identity-addressed cards across lists atomically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Card edits load the list, apply the change, and save in a single call, so **you never supply a content
hash** — conflict detection is handled internally. A concurrent web-UI edit is retried once
automatically (the retry re-reads the list, so your changes land on the content that won); a second
conflict in a row surfaces as a structured `conflict` error result (see
[Tool errors](#tool-errors)), since two losses mean a live concurrent editor and retrying further
would overwrite work you never saw.

The four single-list edit tools (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`)
answer with `{ applied, message, listType, slug, effects, unmatched }`. **`effects` removes the
post-write `get_list` round trip**: it lists every entry the save created, dropped, or changed as
`{ action, cardId, name, section?, quantity, printing?, previousCardId? }`, with the `&N` `cardId`
the save allocated — which the caller could not know beforehand, since ids are assigned at write
time. `previousCardId` appears only on an `updated` effect whose line was **renumbered**, because
another entry arrived claiming the same `&N` (a cross-list move carrying its source id, a replayed
change bundle): without it, a card you have had all along would read as newly added. `unmatched` is
always empty on a returning call (a miss fails the whole batch and surfaces as a structured error
carrying the same list). The cross-list tools `move_selected_cards` and `remove_selected_cards` keep
their own `{ moved | removed, requested, skipped, warnings }` vocabulary and do **not** carry
`effects`.

Card targeting is **exact and case-sensitive** on `cardName`, with `cardId` (the `&N` id shown by
`get_list`) taking priority. That id priority is deliberate and differs from the CLI, where a
`--card-id` paired with a card name that names a different entry is a usage error: the CLI guards a
human (or script) holding an `&N` that was recycled after a removal, while an MCP client is expected
to read `cardId` and `name` from the same `get_list` snapshot. If you cannot be sure your snapshot is
current, send `cardName` alone. For the single-list edit tools (`add_card`, `remove_card`,
`set_card_printing`, `apply_changes`), a change that does not apply — its target does not exist, or one
of the refusals described below — **fails the whole call**:
nothing is saved, no changelog entry is written, and the error names each change that did not apply.
In an `apply_changes` batch this is atomic — one miss rejects the batch — while a later change may
still target a card an earlier change in the same batch added. The cross-list batch tools
(`move_selected_cards`, `remove_selected_cards`) and `import_change_bundle` use the same exact
targeting but **skip and report** unresolvable items instead of failing, as documented below.

A write to a list whose **file** holds a line the parser cannot read — a malformed card line, but
also prose, comments, or any other text the list grammar does not model — is refused outright: the
save would re-serialize the list without that line and recycle its `&N`. The error names the file
and each unreadable line, and nothing is written — the same lines `get_list` reports in `warnings`.
Fix the file, then retry (the line-preserving CLI one-shots `set-card`/`remove-card`/`note` can
edit such a file without touching those lines).

#### Card-name validation

Every write that carries a free-text card name — `add_card`, `remove_card`, `set_card_printing`,
`apply_changes`, `move_selected_cards`, `remove_selected_cards` — has its names checked against the
local Scryfall card cache before anything is written:

- A name **already present in the list being edited** is accepted with no lookup at all. That is what
  keeps a custom, proxied, or unreleased card that already lives in a file removable and editable.
- Any other name must be one the cache knows. An unknown one is rejected with up to three of the
  closest cached spellings (`'Lightning Bolz' is not a card name the local cache knows. Did you mean:
Lightning Bolt, ...?`), which is far more actionable than the "nothing matched" the edit would
  otherwise have produced.
- If the cache is **empty**, the write is refused with a message naming both remedies (the
  `refresh_cache` tool here, `ritual cache preload-all` on the CLI). Check `get_cache_status` first
  if you are unsure.

`import_deck`, `import_csv`, and `import_change_bundle` are **excluded**: they carry bulk content
whose per-row failures their own engines already report, and rejecting a whole import over one bad
row would be worse than reporting it.

Collections track a specific physical printing per entry: `add_card`, `apply_changes`'s `add` and
`set-printing` actions, and `set_card_printing` all require `set` + `collectorNumber` together when
the target list is a collection — omitting either one is rejected rather than written as a
printing-less (or cleared) entry. Decks and wanted lists accept a name-only card.

A finish, though, belongs to a printing on **every** list type. `apply_changes`' `set-finish` action
rejects `foil` or `etched` against an entry that pins no printing, reporting it as an unmatched
change (`needs-printing`) so the whole batch is refused and nothing is saved. Pin the printing first
— a `set-printing` earlier in the same batch satisfies it, since a later change sees what the
earlier ones did. `nonfoil` always applies: it clears a finish token rather than asserting one.

The same check covers `set_card_printing` and `apply_changes`' `set-printing` action, which write a
printing and a finish together: clearing the printing (omitting `set`/`collectorNumber` on a deck or
wanted list) while passing `finish: "foil"` is rejected rather than written, since it would produce
the very line `set-finish` refuses. Clearing the printing _and_ the finish together is fine.

`add` is deliberately exempt: a name-only entry created with a finish records "any printing, in
foil", which is a wanted-list specificity rather than an edit to a card already on the list.

`move_selected_cards` and `remove_selected_cards` address each card by identity: source `listType` + `slug` +
`cardName`, plus `cardId` (the persistent `&N` id — required to match whenever the entry has one;
`get_list` shows it) and `copyIndex` (0-based, for deck lines with quantity above 1). Each
`move_selected_cards` item names its destination with `toListType` + `toSlug`, may override the printing on
arrival (`set`, `collectorNumber`, `finish`, `condition`, `language`), and may pick a destination deck section
with `toSection` (deck destinations only). Unresolvable items are skipped and counted in the
response; notes a destination cannot keep are reported as `droppedNotes`.

#### Card language

Entries carry a `language` field only when the copy is not English: an absent value always means
`en`, mirroring the card lines themselves, where the `[ja]`-style token is omitted on English
lines (see [Card Language](/list-format/#card-language)). The vocabulary everywhere is the 17
Scryfall codes (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`) — canonical codes only,
no aliases. `add_card` takes an optional `language` (omitted, the configured
[`defaultLanguage`](/configuration/#default-language) stamps the new card — adds never prompt);
`set_card_printing` takes one to set it alongside the printing (omitted leaves it alone); and
`apply_changes`' `set-language` action changes it on its own, where `en` clears the line's token.
`remove_card` (and `apply_changes`' `remove` action) takes an optional `language` to match only
entries in that language — `"en"` matches bare lines.
Non-English copies are never quoted by the [sell tools](#read-read-only) — Card Kingdom's feed is
English-only, so they report `noMatchReason: "non-english"`, and `get_buylist_quotes` printings
take an optional `language` for the same reason (a non-English copy gets no quote).

#### Card labels are per list type

The [label](/list-format/#card-labels) vocabulary is shared, but which of it a list carries is
not: a **collection** takes all of it (`sale`/`trade` combine; `keep` and `proxy` each stand
alone), a **deck** takes `proxy` alone, and a **wanted list** carries none. Every tool that pairs
a `listType` with `labels` — `add_card`, `set_list_metadata`, and `apply_changes`' `add` /
`set-label` actions — enforces this in its **input schema**, so a `sale` on a deck is refused
before anything is loaded, with a message naming the offending labels and the ones that type
supports. An empty array is a _clear_, so it passes on a deck and a collection and is refused on
a wanted list, which has no override to clear — the same decision the CLI flags, the admin save
routes, and change-bundle imports make, from the same shared rule.

A card labeled `proxy` is not a real copy, and every reporting tool says so consistently:
`get_price_report` prices it at `0` with `unpricedReason: "proxy"` and leaves it out of
`unpricedCount` (it still counts as a card), `export_cards`' `filters.labels` selects it on a deck
as readily as on a collection, and `get_sell_report`, `get_sell_cart`, and `get_buylist_quotes`
never see it at all. Its absence there is the rule, not a failed lookup. A card given
[custom art](#custom-art) is treated identically — one rule, custom art or proxy ⇒ no price, no
quotes, no sale — reported as `unpricedReason: "custom-art"`, which wins when a card is both.

#### Card tags

[Tags](/list-format/#card-tags) are the owner's own free-form vocabulary, carried by **every**
list type and never resolved against a list default — a card's tags are exactly the ones on its
line. Over MCP a tag is always its canonical value: plain text in the owner's own casing, trimmed
and single-spaced (`Ramp`, `Card Draw`), **without** the `#` the card line writes, and never
containing `#`, `,`, `&`, brackets, braces or parentheses. `get_list` reports each
card's `tags` in canonical (sorted) order; `add_card` and `apply_changes`' `add` take `tags` for a
new card; and `apply_changes`' `add-tag` / `remove-tag` put one tag on or take one off an existing
card — **one event per tag**, so tagging then untagging the same card in one batch cancels out.
Anything that is not canonical (`#Ramp`, ` Ramp`, `a,b`) is refused by the **input schema**
before anything is loaded. Tags are not labels: `keep` as a tag carries none of the `keep`
label's meaning, and a deck's front-matter `tags` (written by `set_list_metadata`) describe the
deck, not a card. A cross-list move carries a card's tags to the destination line — every list
type carries them, so unlike a label override nothing is filtered out: `move_selected_cards`
takes them from the source line, and a bundle move carries them in its own `tags` field.
`export_cards`' `filters.tags` selects cards carrying any of the given tags on every list type
(wanted lists included), matched exactly; a card with no tags never matches, and `none` is an
ordinary tag rather than a sentinel.

#### Card categories

[Categories](/commands/categories/) are the card's **role in this one list** — what Archidekt calls
a category and Moxfield a tag. They are the third kind of thing you can say about a card, and the
contrast is the point: a **label** is an instruction to the app (`proxy`, `keep`), a
[**tag**](#card-tags) is a property of the physical copy and travels with a cross-list move, and a
**category** belongs to the card _name in this list_ and never follows a move.

- **Keyed by card name, never `&N`.** One assignment covers every line of that name in the list,
  whatever its printing, section or quantity; matching folds case and whitespace.
- **Ordered, first is primary** — the one the site groups by.
- A name is plain text in the owner's own casing (`Ramp`, `Card Draw`) and can never contain `#`,
  `,`, `&`, `*`, double quotes, brackets, braces or parentheses. Anything else — `#Ramp`, ` Ramp`, `a,b` —
  is refused by the **input schema**, before anything is loaded.

`get_list`'s cards view reports them twice: the list's own `categories` — `{ "order": [...],
"cards": { "Sol Ring": ["Ramp", "Artifacts"] } }` — beside the entries, and each returned card's
own resolved `categories`, primary first. **Absent means none at both levels**, never an empty
array. Read the per-card field rather than joining `cards` yourself: the name fold is Ritual's.
`categories` always describes the whole list, never just the returned page — a filtered read still
reports every categorized name, while each card's own `categories` covers only the cards in the body.

`apply_changes` writes them, with three actions:

| Action               | Fields                    | What it does                                                                                                                                                                                      |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set-categories`     | `cardName`, `categories`  | Replaces that name's whole ordered list (first = primary). `[]` clears. No `cardId` — the sidecar does not address lines.                                                                         |
| `rename-category`    | `category`, `newCategory` | Rewrites every card using the name, and the vocabulary's order.                                                                                                                                   |
| `set-category-order` | `order`                   | Sets the vocabulary's display order. An empty array clears the declared order; the next write re-derives one from the categories the cards use, listing the configured `defaultCategories` first. |

There is no "remove a category" action: removing one is those two list-level actions together —
clear it off its cards with `set-categories`, then send a `set-category-order` without it.

A `set-categories` naming a card **this list does not hold** is applied and counted, and then
pruned when the save writes the sidecar (categories go with the last copy of a name), so it reads
as a successful no-op. Check the list first. A save that pruned anything reports the dropped names
in `prunedCategories`, as do `move_selected_cards` and `remove_selected_cards`.

A cards view also carries `categoryWarnings` when the categories sidecar cannot be read or records
categories for names the list no longer holds. Like `artWarnings` it is deliberately not part of
`warnings`, and it blocks nothing. See the [sidecar's format](/list-format/#categories-namecategoriesjson).

#### Custom art

`get_list`'s cards view reports a list's [custom art](/custom-art/) as `customArt` — a record of
**raw** references (`{ "file": … }` / `{ "url": … }`) keyed by the card's `&N` id, present only
when some card in the body has any. `set_card_art` takes those same references back. Art is list
metadata: it lives in `<list>.art.json`, records no changelog entry, and neither needs nor
disturbs a pending batch of card changes. Ritual only ever _references_ images — a `file` must
already exist under the configured `artDir` and carry an image extension (`.avif`, `.gif`,
`.jpeg`, `.jpg`, `.png`, `.webp` — the ones the art route serves), and a `url` is used verbatim,
never downloaded and never extension-checked.

Custom art carries the same pricing rule as the `proxy` label: a card with art of its own is not
the printing a price is quoted for, so `get_price_report` prices it at `0` with
`unpricedReason: "custom-art"` (not counted in `unpricedCount`), and `get_sell_report`,
`get_sell_cart`, and `get_buylist_quotes` never see it.

**Art at add time is a two-step.** No tool takes an art reference as part of an add — `add_card`
and an `add` in `apply_changes` write card lines, and a line's `&N` is allocated inside that write.
So add the card first, read the id off the mutation's `effects` (following `previousCardId` where a
line was renumbered), then aim `set_card_art` at it:

1. `add_card` / `apply_changes` → `effects: [{ action: "added", cardId: 7, name: "Sol Ring", … }]`
2. `set_card_art` with `cardId: 7` and the reference.

This is deliberate rather than a gap: art is list metadata written to a different file, and folding
it into the add would make one call write two files with two failure modes. The admin editors'
add-card dialog does exactly this internally, holding the reference until the save answers. The CLI
is the same shape — [`add-card`](/commands/add-card/) then
[`set-card --art`](/commands/set-card/#custom-art).

Art follows the card, so no tool needs a follow-up `set_card_art` to keep it in place: a mutation
that removes a card (`remove_card`, a `remove` in `apply_changes`, `remove_selected_cards`) drops
its art, a cross-list move (`move_selected_cards`, or a move applied by `import_change_bundle`) re-files
the entry under the destination line's new `&N` (a copy that merges onto a line the destination already
had leaves that line's art alone, whichever direction it travels), and a sync that pulls removals in (`sync_decks`,
`sync_collection`) drops the entries of the cards it removed. Two things keep their art instead: a
deck line that still has copies left after a removal, and a moved copy that merges onto a line the
destination already had. See [Art follows the card](/custom-art/#art-follows-the-card). A list's
[cover image](/list-images/) is filed under an `&N` the same way and is reconciled by the same
mutations, so a `set_list_metadata` cover never needs re-setting after a card change.

A cards view also carries `artWarnings` when something is wrong with that sidecar — it cannot be
read, or it holds art for cards the list no longer has. It is deliberately **not** part of
`warnings`: that channel means unreadable card lines, and a mutation refuses a list that has any.
Bad custom art blocks nothing.

A mutation result (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`) reports the same
sidecar channels for the save it just did: `artWarnings` for art sidecars it could not re-file,
`categoryWarnings` for a categories sidecar it could not read or write, and `prunedCategories` for
card names whose [category](#card-categories) assignments it dropped. `move_selected_cards` and
`remove_selected_cards` report `prunedCategories` too. All are absent when there is nothing to say.

#### `apply_changes`

`apply_changes` accepts fifteen change actions: `add`, `remove`, `set-finish`,
`set-printing`, `set-language`, `set-note`, `set-label`, `add-tag`, `remove-tag`, `set-commander`,
`unset-commander`, `set-section`, `set-categories`, `rename-category`, and `set-category-order`. It is
the **only** way to reach every action after `set-printing` — changing a card's language on its own (`set-language`
requires `language`; `en` clears the token), setting or clearing a card note, setting or clearing a
card's label override (`set-label` takes the new labels; an empty array clears the
override so the list default applies), putting a [tag](#card-tags) on or taking one off a card
(`add-tag` / `remove-tag` each take one canonical `tag`, on any list type), moving a card to a
section, and setting or clearing a deck commander have no tool of their own. The commander actions apply to **decks only**, and `set-label`
only where the list type [carries the labels you send](#card-labels-are-per-list-type) — a schema
refusal for a label the type cannot express, and a not-applicable failure at apply time elsewhere. An `add`
may also carry `labels` to label a fresh card and `tags` to tag one, `add` and `set-printing` may
carry `language`, and `remove` may match on one.
The three [category](#card-categories) actions are here too: `set-categories` targets a card by
**name** (no `cardId`), while `rename-category` and `set-category-order` target the **list** and
are the only changes here that name no card at all.
Change `id` and `timestamp` are stamped by the server and are not part of the input. Cross-list moves
are rejected — use `move_selected_cards`. Section-structural events are not agent-facing; the three
category actions are.

`apply_changes` carries `destructiveHint: true` because a batch **can** remove cards in bulk. The
note, label, tag, category, section, and commander actions are themselves additive; the hint reflects the tool's worst-case
capability, not what any particular batch does.

`set_list_metadata` writes deck front matter (tags, format, source link) and — on a
deck or a collection — `labels`, the [default card labels](/list-format/#card-labels) every
entry without its own override inherits (`null` clears them). All three list types take
`description`, the blurb the built site prints above the cards (`null` or `""` clears it), and
`image`, the list's [cover image](/list-images/): a single-key mapping — `{"card": N}` (the `&N`
of a line in that same list), `{"file": "rel/path"}` (relative to the art directory) or
`{"url": "https://…"}` — with `null` restoring the built-in cover rule. There is no scalar
spelling, and the three modes fail differently on purpose: a `card` id the list does not carry is
rejected outright, a `file` with nothing behind it is accepted and only warned about at build time,
and a `url` is never validated at all. `description` and `image` are the **only** fields a wanted
list accepts (use `rename_list` to change its display name); a `labels` key on a wanted body is refused by name. Setting `sourceId` together with an `archidekt.com`
`sourceUrl` is what makes a deck sync-linked, and therefore what `sync_decks` then operates on — the
two must name the **same** Archidekt deck once merged over what the file already carries, or the call
is rejected (a sync addresses the deck by `sourceId` while every surface shows `sourceUrl`). No
changelog entry is recorded: the changelog is card-level, and metadata is not a card change. This is
the same write the CLI's [`deck-sync link`](/commands/deck-sync/#linking-a-deck-deck-sync-link)
performs — both go through one front-matter writer, so the deck's card lines and prose survive
byte for byte either way.

### Destructive

These are flagged with the MCP `destructiveHint` so clients can gate or confirm them:

| Tool              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rename_list`     | Rename a list (changes its slug); the result carries `newFilePath` and `oldFilePath`. Refused when the new name resolves to another list of the same type; re-spelling the list's own name (capitalization, punctuation) is allowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `delete_list`     | Delete a list and every sidecar it has. Requires a `confirmName` matching the list's display name; the result carries `deletedFiles`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `rewrite_history` | Replace a list's entire change log. Echo back sets you did not author exactly as `get_history` returned them — including each set's `events` array (one typed event per change line, in the same order; empty only for a legacy set that had none) and its `trailing` array of preserved hand-written lines, or that text is deleted. A set with no `events`, or with a count that does not match its `lines`, is refused. Trailing lines must not start with `- ` or `## `.                                                                                                                                                                                                                                                                             |
| `update_config`   | Merge a partial configuration. `defaultLanguage` takes canonical Scryfall codes only, and a non-`en` value switches cache downloads to the much larger `all_cards` bulk — see [Default language](/configuration/#default-language). `uiLocale` is the unrelated [interface language](/configuration/#interface-language) (a BCP-47 tag); setting it never changes this surface's own English prose. `priceSources` takes store names (`tcgplayer`, `cardmarket`, `cardkingdom`; `[]` hides all site prices) — enabling `cardkingdom` makes builds and servers download the ~70 MB Card Kingdom feed like sell mode does. `defaultCategories` is the global category vocabulary new lists suggest and order by — see [Card categories](#card-categories). |
| `build_site`      | Rebuild the public static site. Runs asynchronously in a child process and publishes atomically, so an interrupted build never leaves a broken site. Reports progress and honours cancellation. Returns `{ message, outDir, durationMs }` — where it published and how long the build took.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sync_decks`      | [Sync decks](/commands/deck-sync/) with Archidekt in either direction. Reports progress and honours cancellation between decks (`report.cancelled`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `sync_collection` | [Sync collection lists](/commands/collection-sync/) with Archidekt in either direction. Reports progress and honours cancellation between lists (`report.cancelled`); asks the client (elicitation) which list loses an ambiguous removal when it can, and takes `removalAssignments` otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `refresh_cache`   | Refresh the Scryfall card cache (bulk download + oracle/art tags). A failed download or ingest is now reported as a tool error rather than a silent success. Reports progress and honours cancellation (nothing is written; the previous cache stands). Does **not** touch the buylist — that is `refresh_buylist`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `refresh_buylist` | Download the [Card Kingdom pricelist feed](/commands/sell/) (~70 MB) when the cached copy is stale (older than a day) or missing; `force: true` redownloads regardless. The sell tools read strictly from this cache. A failed download with a stale cache degrades: `refreshed: false` plus the failure in `warnings`. Needs [sell mode](#sell-tools-need-sell-mode).                                                                                                                                                                                                                                                                                                                                                                                   |

`sync_decks` takes a `direction` (`pull` | `push`), an optional `decks` array (slugs or names; omit
to sync every Archidekt-linked deck), an optional
[`only`](/commands/deck-sync/#change-filter) (`additions` | `removals`, applying just one side of
each deck's diff relative to the sync destination), and optional `dryRun` /
`ignoreUnreadableLines` / `force` /
[`syncPrintings`](/commands/deck-sync/#printing-sync---sync-printings) flags. Under
`syncPrintings`, a card held at several printings at once is reconciled printing by printing
(copies added, removed, or re-pinned), a local line naming no printing pushes nothing, and a stated
finish the printing does not offer on Archidekt fails that deck; each deck's report entry carries
`printingsChanged`. Without the flag, printings are left alone and a deck whose two sides disagree
about them carries `printingsUnaligned`. It needs
an Archidekt login stored by `ritual login archidekt` or the admin site — check
`get_sync_status`'s `decks.archidekt.loginRequired` first. A run that completes reports `success` even when individual decks
failed; read `report.failedCount` and each deck's `status`/`reason`.

A **push** whose remote deck changed since that deck's recorded `sourceUpdatedAt` fails with
`Remote deck changed since last sync (…) — pull first, or pass --force to overwrite remote changes.`
rather than reverting those remote edits; `force: true` overwrites them deliberately, and a `dryRun`
reports the same refusal without needing it. Pulling that deck first also clears it — a pull records
the baseline even when it finds no card changes. See
[Divergence Guard](/commands/deck-sync/#divergence-guard-push). Only decks that pushed cleanly get
fresh stamps, so `get_sync_status` never reports a sync that failed.

A deck whose file holds lines the parser cannot read fails with
`N unreadable lines would be dropped by a sync`, because syncing rewrites the file and would delete
them. `ignoreUnreadableLines: true` accepts that loss — confirm with the user before setting it,
since it is the tool's stand-in for the CLI's [`--yes`](/commands/deck-sync/#unreadable-lines) prompt.

`sync_collection` is the [collection counterpart](/commands/collection-sync/), and the shape of the
problem differs: an Archidekt account has **one** collection while Ritual has **many** collection
lists, so a run compares the union of the lists in scope against the whole remote collection (there
is no per-file link — the connection is the signed-in account). It takes a `direction`
(`pull` | `push`), an optional `lists` array (slugs or names scoping the **local** side; omit to
compare every collection list), the same
[`only`](/commands/collection-sync/#change-filter) filter, an optional `into`
(the list a pull adds new cards to, created if missing — defaults to the
[`collectionSync.pullTarget`](/configuration/#collection-sync) config key), an optional
`removalPriority` array or `removalAssignments` array (one or the other — see below), an optional
`csv` flag, and the same `dryRun` / `ignoreUnreadableLines` flags. Naming a subset of lists declares that those lists are what the
remote collection mirrors, so cards living only in unnamed lists read as absent — pair a subset run
with `only: "additions"` when they are not the whole story.

`csv` is the tool's form of the CLI's
[`--csv`](/commands/collection-sync/#csv-import-for-new-cards), and means the same thing: send a
push's **new cards** to Archidekt as one CSV import, with the rows built from the local Scryfall
cache, instead of resolving and creating them one at a time. Creating a printing costs a search plus
a create, both [paced](/commands/collection-sync/#rate-limiting), so a push adding more than 25 new
printings without `csv: true` **fails before writing anything remote** rather than spending that
many requests — there is nobody to prompt over MCP. Set it for any large push; a `dryRun` never
needs it (it reports the upload it would make). `report.csv` then says what the import did — its
`status`, `rows`, `chunks`, the rows Archidekt refused (`failures`), and `uncached` additions whose
printing the cache does not hold and which were added one at a time. Because those rows are keyed by
the Scryfall ids the local cache holds, an empty or day-old cache is refreshed automatically before
the upload is built — the CLI's [`--refresh auto`](/commands/collection-sync/#cache-freshness), since
there is nobody to ask here either. Quantity changes and removals never ride the CSV, and a pull
ignores the field. Writing the CSV to a file instead of pushing it is CLI-only: the tool has no
`csvFile` field (an unknown field is stripped before dispatch, never honored), since a server does
not write files a caller names.

`removalPriority` is the tool's form of the CLI's
[`--removal-priority`](/commands/collection-sync/#ambiguous-removals): collection list names **in
priority order**, the only lists an [ambiguous removal](/commands/collection-sync/#ambiguous-removals)
may take copies from. A removal is ambiguous when only _some_ of a printing's copies are going and
they live in several lists — taking every copy, or copies held in a single list, never is.
`removalAssignments` is the other way to decide: an explicit
`[{ key, choices: [{ list, copies }] }]` per ambiguous removal, naming the lists that lose copies
and how many each gives up (`key` is the removal's key as `report.ambiguous` reports it). The two
cannot be combined. Either one is validated against the ambiguity the run actually finds — a list
holding no copies, or counts that do not add up — and a decision that does not cover a removal
**fails the run and writes nothing at all**, naming the cards in `report.errors` and setting
`report.unresolvedAmbiguity`.

A run that meets an ambiguous removal with **neither** field set **asks the user** when it can. If
the client declared the `elicitation` capability, the call returns an `input_required` result
carrying one form per ambiguous removal — a bounded integer per list holding copies, "how many
copies should each list give up?" — and the client's answers rerun the sync with them as
`removalAssignments` (the SDK client fulfils the round trip on its own; a 2025-era client is served
through the SDK's legacy shim as an `elicitation/create` request). A declined form leaves the
ambiguity unresolved: the run reports it with `unresolvedAmbiguity: true`, and nothing is written.
A client that declared no `elicitation` capability is never asked; it gets the same unresolved
report, and the agent should ask the user which binders may lose cards and rerun with one of the
two fields rather than guessing.

It needs the same Archidekt login (`get_sync_status`'s `collection.archidekt.loginRequired` reports it;
a login stored before the account id was recorded must be renewed), and it refuses a
collection list with unreadable lines for the same reason — a pull rewrites the file, and a push
treats the file as the truth, so those cards would be deleted from Archidekt. Its report adds
`ambiguous` (every ambiguous removal, with the lists holding copies and how many each holds —
reported whether a strategy placed them or the run failed on them), `unresolvedAmbiguity` (true
when the run stopped on them, having written nothing), `totals.skipped` (what `only` left out), and
`localIncomplete` — true when a list in scope
did not make it into the comparison (an unresolvable name, an unreadable file, or one refused for
unreadable lines). The local side is then short of cards it really holds, so the run withholds the
changes that shortfall would have manufactured: a pull adds nothing (it would duplicate the missing
list's cards into the target) and a push removes nothing (it would delete them from Archidekt).
`report.failedCount` and each list's `status`/`reason` carry per-list failures.

`import_deck`, `import_csv`, `import_change_bundle`, and `apply_changes` also carry
`destructiveHint`, even though they are registered with the [write](#write) tools: the imports can
overwrite an existing list of the same name, and an imported or applied change batch can remove
cards. Their default, non-overwrite modes are otherwise safe.

The authentication endpoints (`setup`, `login`, TOTP, Archidekt) and the login audit log
(`GET /api/audit-log`) are intentionally **not** exposed: they describe who used the admin server,
which is not an agent's concern.

## Resources

Every list is also a readable resource at `ritual://{type}/{slug}` (e.g. `ritual://deck/my-deck`),
listed via the MCP resources API. A read returns the same projected JSON as the `get_list` tool —
the list's contents without the heavy editor payload (card data, printings, prices), carrying the
same `view` and `listType` discriminants — including `warnings`, the lines the parser could not
read. The URI template offers completions for both `{type}` and
`{slug}`, and a `{type}` already chosen narrows the slugs offered.

**`resources.listChanged` is advertised on stdio only.** Stdio pins one server instance for the life
of a connection, so a `notifications/resources/list_changed` sent after `create_list`, `import_deck`,
`import_csv`, `rename_list`, or `delete_list` has a client to reach. The HTTP transport is stateless —
it builds one server per request and tears it down with the response — so a notification there would
have nowhere to go, and claiming the capability would be a promise Ritual cannot keep. HTTP clients
should re-list resources after a list-lifecycle call.

## Card cache

Like `ritual admin`, server startup runs the standard [card-ID backfill](/cli-conventions/#the-card-id-backfill), persisting
any missing `&N` card IDs into the list files before the first request is served.

Unlike `ritual admin`, the MCP server does **not** prompt to refresh the Scryfall cache on startup
(stdin is reserved for the protocol). It uses whatever cache exists; on a cache miss, card lookups fall
back to live Scryfall requests. Call `get_cache_status` to see what state it is in, and the
`refresh_cache` tool to warm it explicitly. A cold cache is also what makes card-name validation on
writes and `get_price_report` fail, so it is worth checking first.

The same applies to the [Card Kingdom buylist](/commands/sell/): `admin` and `serve --api` redownload
a day-old feed when they start, and the MCP server deliberately does not — `get_sell_report`,
`get_sell_cart`, and `get_buylist_quotes` read whatever feed is cached, and `refresh_buylist` is the
only thing in an MCP session that downloads one (its result reports the feed's age and product
count). Note that `refresh_cache` does **not** include the buylist, even though the CLI's
[`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) does.

### Sell tools need sell mode

The four buylist tools — `get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, and
`refresh_buylist` — reuse the admin's sell routes, which are gated on
[sell mode](/public-site/sell/) **or** the `cardkingdom` entry of
[`priceSources`](/configuration/#price-stores-pricesources) (whose retail prices ride on the
same feed). Both are **off by default**, and with neither on all four fail with a
`Not found` tool error. That is a configuration decision rather than a missing feed, so
`refresh_buylist` will not fix it. Enable it with
[`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), by ticking
**Offer sell mode** on the admin's [Settings](/admin/dashboard/#settings) page (it writes the same
key), or by starting the server with `--sell-mode`:

```bash
ritual mcp --sell-mode
```

`ritual admin --mcp --sell-mode` does the same for the [embedded endpoint](#embedding-in-a-running-admin-server).
The rest of the tool surface is unaffected — only these four are gated.

## Client configuration

Most MCP clients accept a server entry like the following (stdio):

```json
{
  "mcpServers": {
    "ritual": {
      "command": "ritual",
      "args": ["mcp", "--base-dir", "/path/to/your/ritual/workspace"]
    }
  }
}
```

For Claude Code, register it with:

```bash
claude mcp add ritual -- ritual mcp --base-dir /path/to/your/ritual/workspace
```

## See also

- [`skills`](/commands/skills/) — teach a coding agent to drive Ritual via the CLI instead of MCP tool calls.
- [`admin`](/commands/admin/) — the browser-based equivalent, and the HTTP API the MCP tools mirror.
- [Admin API Endpoints](/admin/api/) — the underlying request/response shapes.
- [Localization](/localization/) — what follows the UI locale, and what (this surface included) never does.
