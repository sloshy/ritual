---
title: 'mcp'
---

Start an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI agents (Claude Desktop, Claude Code, and other MCP clients) manage your decks, collections, and wanted lists.

The server runs the **same operations as the [admin site](/commands/admin/)**, in-process, through the same route handlers. Editing through MCP behaves exactly like editing in the browser: same changelog, same content-hash conflict detection, same optional git auto-commit. It does not open the admin HTTP server or need an admin login. It is a local, trusted process you launch yourself.

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

Notes:

- `--token` can also come from the `RITUAL_MCP_TOKEN` environment variable (the flag wins). That keeps the secret out of the process list.
- The global `--base-dir <path>` option, or the `RITUAL_BASE_DIR` environment variable (handy in a client's `env` block), selects the Ritual workspace. The directory must exist, or the server exits `2` before starting.
- A [malformed `ritual.config.json`](/configuration/#malformed-files-are-a-hard-error) aborts the server with exit `1` before the transport opens.
- The global `--cache-server <host:port>` option also applies.

## Transports

### stdio (default)

The standard transport for local MCP clients. The client launches `ritual mcp` and exchanges JSON-RPC over stdin/stdout. There is no network exposure and no authentication, because the client already controls the process.

:::note
On stdio, **stdout is the JSON-RPC channel**, so Ritual sends all of its own logging to stderr. Do not pipe other commands' output into `ritual mcp`.
:::

Over stdio the protocol era is chosen by the connection's opening exchange. A 2025-era `initialize` is served on a compatibility path; a 2026-07-28 client is served statelessly. One server instance is kept for the life of the connection. The per-request stateless model below applies to HTTP only.

### HTTP (Streamable HTTP)

```bash
ritual mcp --transport http --port 8765 --token "$MCP_TOKEN"
```

Serves the MCP [Streamable HTTP](https://modelcontextprotocol.io) transport at `http://<host>:<port>/mcp` for remote clients. It binds to `127.0.0.1` by default. `--port` must be 1–65535; an invalid value exits with code 2. **If you expose it beyond localhost, set a token (`--token` or `RITUAL_MCP_TOKEN`).** Every request must then send `Authorization: Bearer <token>`. There is no other authentication layer.

Ritual implements MCP revision **2026-07-28**, whose Streamable HTTP transport is **stateless**: no `initialize` handshake and no `Mcp-Session-Id` header. Every POST to `/mcp` is served on its own, carrying the protocol version and client capabilities in the request. Clients speaking the older 2025-era protocol (including current Claude Desktop / Claude Code releases) are still served: Ritual answers their `initialize` handshake on a compatibility path. On that path the standalone `GET /mcp` SSE stream and `DELETE /mcp` session teardown answer `405`. Ritual uses neither feature.

Without a token, the command **refuses to bind a non-loopback `--host`** (exit code `2`) unless you pass `--allow-unauthenticated`. An unauthenticated endpoint exposed beyond the local machine lets anyone on the network edit your lists. Tokenless binds to a loopback host (`127.0.0.1`, `localhost`, `::1`) are allowed and print a one-line notice on stderr.

The HTTP-only flags (`--port`, `--host`, `--token`, `--allow-unauthenticated`) do nothing under stdio. Passing them there prints a warning on stderr.

`Ctrl+C` (`SIGINT`) or `SIGTERM` stops the listener and drops active connections, so the port is released and the process exits on its own. A failed teardown is reported on stderr. `ritual admin --mcp` does the same for both of its listeners.

#### Errors

| Response | When                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`    | Missing or wrong bearer token. The JSON-RPC body carries implementation-defined code `-32010`.                                                                                           |
| `403`    | On a **loopback bind only**: a request whose `Host` or `Origin` header is not local (DNS-rebinding protection, checked before auth). An exposed host skips this and relies on the token. |
| `404`    | A path other than `/mcp`. The body carries implementation-defined code `-32011`.                                                                                                         |
| `405`    | `GET`/`DELETE` on `/mcp` — the 2025-era session operations, which stateless serving does not have.                                                                                       |
| `415`    | A POST whose `Content-Type` is not `application/json`.                                                                                                                                   |

On 2026-07-28 responses, the catalog surfaces (`tools/list`, `resources/templates/list`, `server/discover`) advertise a one-hour private cache hint. `resources/list` and `resources/read` are marked never-cacheable, since their contents change with every edit. Ritual declares no tool-list-changed notifications and no resource subscriptions; see [Resources](#resources) for the transport-dependent `resources.listChanged`.

### Embedding in a running admin server

[`ritual admin --mcp`](/commands/admin/#embedded-mcp-server) serves the same MCP endpoint **inside a running web admin** instead of a standalone process. One process exposes both the web admin and an MCP endpoint (on `--mcp-port`, default `8765`), sharing config, cache, and data. It uses the same bearer-token auth as this command. A token (`--mcp-token` or `RITUAL_MCP_TOKEN`) is required there, since the admin binds `0.0.0.0` by default. The token is independent of the browser admin login.

## Results and errors

The tool-result contract is transport-independent. It holds over stdio, over Streamable HTTP, and on either protocol era.

### Structured results

Every tool declares an `outputSchema` and answers with `structuredContent`. **Read `structuredContent`, not `content[0].text`.** A successful result carries an empty `content` array, so the same JSON is never sent twice. Only a failure carries a text block, holding the `message` described below. The one other shape a call can answer with is an `input_required` result: `sync_collection` returns one when it needs an [ambiguous-removal decision](#sync_collection) and the client can be asked.

A tool's `outputSchema`, as returned by `tools/list`, **is the authoritative field-level documentation of its response**: every field, its type, whether it is always present, and what it means. This page describes the tools; the schemas describe their replies. The one exception is the failure payload: `isError` results are exempt from output-schema validation, so no schema carries it and it is documented below instead.

### Tool errors

A failed tool call is **not** a JSON-RPC error. It comes back as a normal result with `isError: true`, a one-line text block (the message), **and** a structured payload:

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

Ritual's internal conflict code `-32012` is **never visible to a client**. Every error thrown inside a tool call is converted into the `isError` result above; the numeric code only drives the one automatic retry. The `-32010` / `-32011` codes in the HTTP [Errors](#errors) table are different: the HTTP wrapper emits them before the request reaches the protocol layer, so they are wire-visible and never appear inside a tool result.

One error is re-raised rather than structured: a URL-elicitation request is a protocol handshake the client must answer, not a tool failure.

### Language: English by contract

Ritual's CLI output and its two web UIs follow the configured [UI locale](/localization/) (`--locale`, `RITUAL_LOCALE`, or the `uiLocale` config key). **This surface does not.** Tool names, titles, descriptions, parameter documentation, output-schema descriptions, the server `instructions`, and the `message` of every result stay English. They are model-facing prose mixed with flags, file paths, and `snake_case` tool names; translating them would break the identifiers a client matches on.

A client that renders for a human gets the sentence unrendered instead of translated. Results produced by the shared admin handlers carry two optional fields beside `message`:

| Field           | Meaning                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messageKey`    | The catalog key `message` was rendered from — stable across locales _and_ across rewordings of the English text. Absent when a handler has no key for that sentence. |
| `messageParams` | The values that key interpolates. Absent when the message takes none.                                                                                                |

Match on `messageKey` (or, for a failure, on `code`) rather than on the prose; `message` is the field most likely to be reworded. The two sync tools carry the same triple per clause in `summary.clauses`, so a run's one-line outcome can be re-joined and re-pluralized in another language. The `isError` payload carries no key, since `code` is already its discriminator.

Data payloads are never localized either. See [what never gets translated](/localization/#what-never-gets-translated).

### Progress notifications

The four long-running tools (`refresh_cache`, `sync_decks`, `sync_collection`, and `build_site`) emit `notifications/progress` **during** the call, but only when the client supplied a `progressToken` (the SDK client does this when you pass `onprogress` to `callTool`). Without a token nothing is emitted.

Each notification carries `progress`, `total`, and a human-readable `message`. `progress` strictly increases across a run. Scales differ by tool: the cache refresh reports 0–100, the two syncs report one notification per deck/list plus a terminal `n/n`, and `build_site` reports `total: 3` (0 start, 1 building, 2 publishing, 3 done).

The result itself is unchanged and still blocking: the tool returns its ordinary structured result when the work finishes. Over Streamable HTTP the response upgrades to an SSE stream automatically once a notification precedes the result.

One client-side setting matters. The SDK's default request timeout is 60 seconds and does **not** reset on progress. A client driving a long call should pass `resetTimeoutOnProgress: true` (or a larger `timeout`) alongside `onprogress`. Ritual cannot set this; it is a client option.

All four also honour cancellation (a client's `notifications/cancelled`, which the SDK client sends when the `signal` passed to `callTool` aborts), each at the point its partial state is recoverable:

- `build_site` kills the child build. The build publishes atomically, so the live site is untouched: `dist/` still holds the previous site, and the next `build_site` is accepted immediately. The cancelled call answers with a tool error saying the site build was cancelled.
- `refresh_cache` stops the download and writes nothing. The previous card cache stands, the cache lock is released, and the call answers with a tool error saying the refresh was cancelled.
- `sync_decks` and `sync_collection` stop **between items**. The deck or list in flight finishes (nothing is half-pushed or half-written), and every item the run never reached is reported `skipped` with the reason `cancelled before it started`. The result is the ordinary report with `report.cancelled: true` (and, for the collection, no `lastSynced` recorded), because the items already synced are real. A client that cancels should still read it. A cancelled push has already sent whatever it pushed before stopping.

## Tools

Every tool that addresses a list takes the same two fields: `listType` (`deck` | `collection` | `wanted`) and `slug` (the markdown file basename without `.md`).

### Read (read-only)

| Tool                                   | Description                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_lists`                           | Every list as `{ listType, slug, name }`, optionally filtered by `listType`.                                                                                                                       |
| `get_sync_status`                      | What an Archidekt sync can cover: `target: "decks"`, `target: "collection"`, or omit `target` for both.                                                                                            |
| `get_list`                             | Read one list, whole or narrowed by `section` / `nameContains` / `limit` / `offset`. See [the result shape](#the-get_list-result).                                                                 |
| `search_scryfall`                      | Run a live [Scryfall query](https://scryfall.com/docs/syntax) and return card summaries (name, printing, mana cost, type line, oracle text, prices). `warm: true` also caches the results locally. |
| `autocomplete_card`                    | Match every whitespace-separated term against the local cache's card names (`in tre` → "In the Trenches").                                                                                         |
| `find_cards`                           | Find where a card physically lives across your lists, one result per copy. `includeLists` adds the full roster.                                                                                    |
| `get_card_details`                     | Everything the local cache knows about one card: oracle text, type line, colors, keywords, legalities, Scryfall Tagger tags, faces, printing count.                                                |
| `get_card_printings`, `get_card_price` | A card's printings and per-currency prices (an unknown card name is an error).                                                                                                                     |
| `get_price_report`                     | [Price](/commands/price/) one list, one list type, or every list; optional `source` picks the store.                                                                                               |
| `get_sell_report`                      | Match cards against the locally cached [Card Kingdom buylist](/commands/sell/): what CK is buying, the cash quote per Near Mint copy, and their quantity caps.                                     |
| `get_sell_cart`                        | The cards CK is buying, rendered as their sell-cart CSV import format, over the same scope and filters as `get_sell_report`.                                                                       |
| `get_buylist_quotes`                   | The buyer's current offer for specific printings, keyed by `set:collectorNumber:finish`.                                                                                                           |
| `get_history`                          | A list's change history: each set's prose `lines`, typed `events`, preserved `trailing` text, and the `defaultEvents` a rewrite-with-defaults would write.                                         |
| `get_config`, `get_cache_status`       | Configuration (as `config`, plus session [`overrides`](#stored-config-vs-what-this-server-runs-with)) and the state of the local Scryfall card cache.                                              |
| `diff_lists`                           | Compare two lists by card name or exact printing — the [`diff`](/commands/diff/) command as a tool.                                                                                                |
| `export_cards`                         | Render a CSV, JSON, plain-text, or Markdown [export](/commands/export/) of lists and/or card picks; `write: true` writes a file instead.                                                           |

Details the table leaves out:

- `get_sync_status`: `target: "decks"` returns the linked decks with each deck's `lastSynced` (what `deck-sync status` prints). `target: "collection"` returns the coverable lists, the default pull target, the CSV threshold, and when the account last synced. Both carry the login snapshot, whose `loginRequired` is what `ritual login status` reports.
- `get_sell_report`: scope with `listType` (default: collections) or `lists`; filter with `sets` / `minPrice`. Errors when the card cache is empty (`refresh_cache`), no feed is downloaded (`refresh_buylist`), or [sell mode is off](#sell-tools-need-sell-mode).
- `get_sell_cart`: no header row; CK's own listing titles with variant note; quantities capped at their buy limits. `warnings` flags their 500-title/5,000-card upload caps and etched foils the format cannot express. Needs [sell mode](#sell-tools-need-sell-mode).
- `get_buylist_quotes`: prices an arbitrary set of cards without building a whole sell report; printings with no product are absent from the result. Cache-backed, so run `refresh_buylist` first. Needs [sell mode](#sell-tools-need-sell-mode).
- `get_history`: `events` come from the entry's `ritual-changes` block (empty for a legacy entry). Hand-written text preserved after a set is in its `trailing` array; echo it back on `rewrite_history` or it is deleted. When the categories sidecar could not be read, `defaultEvents` names no categories and `categoryWarnings` says why (absent otherwise).
- `get_config`: the config includes `defaultLanguage` (the card language) and `uiLocale` (the [interface language](/configuration/#interface-language)), two different settings.
- `export_cards`: takes filters (name, set, finish, conditions, labels, tags), saved or built-in `preset`s, and column selection for `csv`/`json`. The columns include `categories` (comma-joined, primary first) and `primaryCategory`; both are dropped by the `text` and `md` formats. A `dialect` (`ritual`, `archidekt`, `arena`, `moxfield`) spells `csv`/`json` values and picks the `text` decklist form; `arena`/`moxfield` omit maybeboard and token cards and name them in `warnings`.

#### The `get_list` result

The result is discriminated by `view` (`"cards"` | `"summary"`) and `listType`:

- A deck's cards view carries `deck` + `frontMatter`. A flat list's carries `entries` + `sectionOrder` plus the list's front-matter `description` (a deck's is inside `deck`). `view: "summary"` carries `counts` only.
- Every arm carries `warnings`: lines the file's parser could not read. It is always present and empty for a clean file, so a list holding an unreadable line is never mistaken for a shorter list.
- A cards view on a label-carrying list reports the list-level `labels` default and each card's own `labels` override.
- Each card carries its own `tags` (canonical, without the `#`) when it has any; absent when none.
- The list's [cover image](/list-images/) override is reported as `image`, absent when the built-in cover rule applies.
- When any returned card has [custom art](/custom-art/), a `customArt` record of raw references keyed by `&N` id is present.
- The list's [categories](#card-categories) are reported as `categories` when the list has any, and each returned card carries its own resolved `categories`.

#### Network vs local

Three tools find cards, and their names say where the data comes from:

- **`search_scryfall`** always queries the live Scryfall API with Scryfall's own query syntax. One page per call: walk a large result set with `page` while `hasMore` is true. `limit` caps the cards returned (max 175; default 20 with `warm: true`, otherwise the whole page). With `warm: true` it also writes results into the local card cache under names the cache does not already hold (never overwriting one), and moves a card whose whole name the query spells out ahead of Scryfall's popularity order. It writes to the cache only, never to your lists, so it still carries `readOnlyHint`.
- **`find_cards`** searches **your own lists** and never touches the network. Each result is one physical copy (a deck line with quantity 3 yields three), carrying `listType`, `listSlug`, `name`, printing, `cardId`, and `copyIndex` — exactly the fields `move_selected_cards` and `remove_selected_cards` address entries by. Filters intersect: `name` matches every whitespace-separated term in any order; `listType`/`slug`/`set` match exactly. `includeLists: true` adds the full list roster (the move destinations). It is off by default, and the roster is unaffected by the filters. `warnings` names any list file that could not be fully read, so an empty result is never silently wrong.
- **`autocomplete_card`** reads the local card cache, also with no network.

#### Reading part of a list

`get_list` defaults to the whole list. To read less:

- `view: "summary"` returns `{ slug, listType, counts, warnings }`: total lines, total copies, a per-section breakdown, and the parser warnings. No card data, which makes it the cheapest call and the right first one on a large collection.
- `section` matches a markdown `## Section` heading exactly (case-sensitive). A section that does not exist yields no entries rather than an error.
- `nameContains` matches every whitespace-separated term, in any order, like `autocomplete_card`.
- `limit` and `offset` page through the matches in the `cards` view. `view: "summary"` ignores them; its counts always describe the whole filtered set.
- `totalCount` is always present: the number of entries that matched **before** `limit`/`offset`, or the list's whole line count when nothing was filtered. It tells a full page from the end of the list.

These are route parameters, not a client-side trim. A `summary` or filtered read returns before the server loads any Scryfall card data, printings, prices, or the mana-symbol map.

#### Cards and prices

`get_card_printings` returns the newest 20 printings by default, as identity only: set, collector number, rarity, release date, finishes, and (when not English) the object's `lang`. Pass `limit` for more or fewer. `limit` and `totalPrintings` count **distinct printings**; with a non-English cache every language object of an included printing is returned with it, so a client never sees a printing with half its languages missing. Pass `includePrices: true` when you want each printing's price block; `get_card_price` is usually the better answer for a price question. The result's `languages` array lists every language the card exists in (`en` first; `["en"]` for an English-only cache).

Both `get_card_printings` and `get_card_details` report whether the printing list is complete (`complete` / `printingsComplete`). It is `false` when the local cache holds no printing list for the name; the one printing shown then came from a single Scryfall lookup, so a `printingCount` of 1 says nothing about the card. Run `refresh_cache` (or [`ritual cache preload-all`](/commands/cache/)) before concluding a card has only one printing.

`get_cache_status` reports whether the local card cache is `empty`, how many cards it holds, when it was last refreshed, its price age and whether prices are `priceStale`, whether Scryfall Tagger tags are present, where the cache is served from, and its language provenance: `defaultLanguage` (the configured code), `cardBulkType` (`default_cards` English-only or `all_cards` every-language; `null` before any recorded ingest), and `bulkTypeStale` (`true` when the cache's bulk disagrees with what `defaultLanguage` demands, so a full `refresh_cache` is needed — see [bulk selection](/commands/cache/#bulk-selection-and-language)). Check `empty` and `priceStale` before pricing: a stale or empty cache is what `get_price_report` errors on, and `refresh_cache` is the fix.

`diff_lists` takes two sides (`a` and `b`, each `{ listType?, name }`; names resolve like CLI list arguments, with `listType` disambiguating a name) plus an optional `by` (`name`, the default, or `printing`). It returns `{ a, b, by, matches, onlyInA, onlyInB, warnings }` with quantities summed across all sections. Each side comes back as `{ listType, slug, name }`, the same vocabulary `list_lists` and `find_cards`' roster use, so a diff side can be handed to any tool that names a list. See [`diff`](/commands/diff/) for the identity rules (nonfoil folding, the no-printing bucket).

`get_price_report` takes both `listType` and `slug` (one list's summary plus its priced card entries), `listType` alone (per-list totals across every list of that type, like the CLI's `price --deck --summary`), or neither (per-list totals across every list). A `slug` without a `listType` is a validation error. The optional `currency` (`usd` | `eur` | `tix`) defaults to the configured `defaultCurrency`. The optional `source` picks the store instead: `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), `cardhoarder` (Scryfall MTGO tix), or `cardkingdom` (Card Kingdom NM retail from the cached [buylist feed](/commands/sell/); errors with the refresh advice when no feed is downloaded). A source implies its currency, so a `currency` that disagrees is a validation error, and a `cardkingdom` result carries `source: "cardkingdom"` beside `currency: "usd"`. The result is discriminated by `mode`: `"list"` carries `list` + `cards`, `"summary"` carries `lists` + `typeTotals` + `totals`. Prices come strictly from the local card cache; an empty cache is an error (check `get_cache_status`, then run `refresh_cache`).

`export_cards` returns `{ mode: "content", format, entryCount, warnings, content }` by default: the rendered export inline, with nothing written to disk. With `write: true` it writes a server-named file under `exports/` in the base dir and returns `{ mode: "file", format, entryCount, warnings, path, bytes }`; an existing file is never overwritten. Because of that write mode it carries no `readOnlyHint`, though it is not flagged destructive either, since the writer never replaces a file.

#### Stored config vs what this server runs with

`get_config` answers two questions, because they can disagree. `config` is the stored configuration: `ritual.config.json` merged over the built-in defaults, the same payload [`config list --output json`](/commands/config/#config-list) prints. `overrides` is what **this running server** is operating with instead, keyed by the config path each override displaces:

```json
{
  "config": { "site": {} },
  "overrides": { "site.sellMode": true }
}
```

That is a server started with [`--sell-mode`](#sell-tools-need-sell-mode). The flag is a session setting that writes nothing, so `config.site.sellMode` stays as stored while the sell tools answer anyway. Without such a flag the key is **absent entirely**: no `overrides` means the two answers agree, and reading `config` alone is enough.

`update_config` never carries the field. It echoes back what it persisted, and an override is neither persisted nor changed by a write.

### Write

| Tool                    | Description                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_list`           | Create a new, empty list. `format` (from the fixed set of deck formats) applies to decks only.                                                                                                |
| `import_deck`           | Import a deck from a URL or pasted decklist text (Ritual's own format and MTG Arena/MTGO exports).                                                                                            |
| `import_csv`            | Import CSV text into a new or existing list (create/overwrite/append) with a column-mapping spec.                                                                                             |
| `import_change_bundle`  | Apply a change bundle exported from the site editor to the underlying lists.                                                                                                                  |
| `set_list_metadata`     | Write a list's front matter. Only the fields you send are touched; `null` clears one. See [`set_list_metadata`](#set_list_metadata).                                                          |
| `add_card`              | Add a card to any list; `quantity` adds that many copies in one save. The list must already exist (use `create_list`).                                                                        |
| `set_card_art`          | Set or clear one card's [custom art](/custom-art/), addressed by `cardId`. See [Custom art](#custom-art).                                                                                     |
| `remove_card`           | Remove a card from any list; `quantity` (decks only) removes that many copies. Flat lists remove one entry at a time.                                                                         |
| `set_card_printing`     | Set a card's printing (and optionally `condition` / `language`) in place.                                                                                                                     |
| `apply_changes`         | Apply an ordered batch of changes to one list atomically (one save, one changelog block). The only route to language, note, label, section, commander and [category](#card-categories) edits. |
| `move_selected_cards`   | Move a batch of identity-addressed cards between lists atomically.                                                                                                                            |
| `remove_selected_cards` | Remove a batch of identity-addressed cards across lists atomically.                                                                                                                           |

Details the table leaves out:

- `create_list` is refused (`409`) when a list of that type already [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) under that name. Folding ignores case, accents, hyphens/underscores, apostrophes, and filename-illegal punctuation.
- `import_deck`: a URL import must state `syncPrintings` (`true` keeps the [exact printings the source lists](/commands/import/#printings-from-a-url-import), `false` imports bare card names). The CLI asks the user this interactively, so ask the user when their intent is unclear. Text lines the parser cannot read are skipped and reported in `warnings` (empty for URL imports); a non-empty array means part of the pasted text was not imported. `advisories` reports lines that were imported but looked off (e.g. a card name still holding a printing token). A name/ID conflict without `overwrite`, or a deck name with no characters usable in a file name, fails with `code: "invalid-request"`.
- `import_csv`: a `categories` cell (header `category` or `categories`) holds comma-separated categories (`Ramp, Artifacts`, first is primary) written to the list's categories sidecar. On a deck, a value that names a board (`Sideboard`, `Commander`, `Tokens`, …) sets the row's section instead, and a value the category grammar refuses goes to `warnings` rather than failing the row. In a deck, rows of the same card and printing merge into one line in every mode; collections and wanted lists keep one line per copy. `hasHeader` defaults to true, and `warnings` names the skipped row (and whether it looked like a header). `format` applies to decks only. Rows that fail validation do not fail the call: the result always carries `cardCount`, `failures`, and `failedCount`. A refusal (bad column spec, unknown list type, append to a missing list) is a tool error as usual.
- `import_change_bundle`: a version-2 bundle carries per-list `lists[].changes` plus a top-level normalized `moves` array. Each move is applied on its destination list, whose save also takes the copy out of the source and writes both changelogs. A move carrying `pinsCardId` pins a name-only line there instead of adding a copy; one carrying `replacement` adds that printing back to the source; one carrying `tags` lands them on the destination line. Answers `{ message, lists, failedCount }`. A list that could not be resolved, loaded, or saved is reported in its own `lists[].error` rather than failing the call: the failing batch applied nothing and that list's later batches are skipped, while earlier batches stay applied and are counted.
- `add_card`: `condition` is rejected for wanted lists; collections require `set` + `collectorNumber` together. `labels` (a label override for the new card) is accepted for whatever the list type [carries](#card-labels-are-per-list-type); `tags` gives the new card its [tags](#card-tags) on any list type. `language` records a non-English copy; omitted, the configured `defaultLanguage` applies. Unlike `ritual add-card`, this never creates a missing list.
- `remove_card`: `finish`, `condition`, and `language` narrow the match to entries with that value (`language: "en"` matches bare lines).
- `set_card_printing`: omitting `set`/`collectorNumber` clears a deck or wanted-list card's printing; on a collection that is rejected. `condition` takes a grade or `NONE` to clear a recorded grade (also accepted on `apply_changes`' `set-printing` action); `NM` is the unrecorded default, so setting it leaves the line ungraded. `language` sets the card's language alongside the printing; omitted, it is left alone.

Card edits load the list, apply the change, and save in one call, so **you never supply a content hash**; conflict detection is internal. A concurrent web-UI edit is retried once automatically (the retry re-reads the list, so your changes land on the content that won). A second conflict in a row surfaces as a structured `conflict` error (see [Tool errors](#tool-errors)), since two losses mean a live concurrent editor.

The four single-list edit tools (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`) answer with `{ applied, message, listType, slug, effects, unmatched }`:

- **`effects` removes the post-write `get_list` round trip.** It lists every entry the save created, dropped, or changed as `{ action, cardId, name, section?, quantity, printing?, previousCardId? }`, with the `&N` `cardId` the save allocated. Ids are assigned at write time, so the caller cannot know them beforehand.
- `previousCardId` appears only on an `updated` effect whose line was **renumbered** because another entry claimed the same `&N` (a cross-list move carrying its source id, a replayed change bundle). Without it, a card you have had all along would read as newly added.
- `unmatched` is always empty on a returning call. A miss fails the whole batch and surfaces as a structured error carrying the same list.

The cross-list tools `move_selected_cards` and `remove_selected_cards` keep their own `{ moved | removed, requested, skipped, warnings }` vocabulary and do **not** carry `effects`.

Card targeting is **exact and case-sensitive** on `cardName`, with `cardId` (the `&N` id shown by `get_list`) taking priority. This differs from the CLI, where a `--card-id` paired with a card name that names a different entry is a usage error. An MCP client is expected to read `cardId` and `name` from the same `get_list` snapshot. If you cannot be sure your snapshot is current, send `cardName` alone.

For the single-list edit tools (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`), a change that does not apply (its target does not exist, or one of the refusals below) **fails the whole call**: nothing is saved, no changelog entry is written, and the error names each change that did not apply. In an `apply_changes` batch one miss rejects the batch, while a later change may still target a card an earlier change in the same batch added. The cross-list batch tools (`move_selected_cards`, `remove_selected_cards`) and `import_change_bundle` use the same exact targeting but **skip and report** unresolvable items instead of failing.

A write to a list whose **file** holds a line the parser cannot read (a malformed card line, prose, comments, or any other text the list grammar does not model) is refused outright, because the save would drop that line and recycle its `&N`. The error names the file and each unreadable line, and nothing is written; these are the same lines `get_list` reports in `warnings`. Fix the file, then retry. The line-preserving CLI one-shots `set-card`/`remove-card`/`note` can edit such a file without touching those lines.

#### Card-name validation

Every write that carries a free-text card name (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`, `move_selected_cards`, `remove_selected_cards`) has its names checked against the local Scryfall card cache before anything is written:

- A name **already present in the list being edited** is accepted with no lookup. That keeps a custom, proxied, or unreleased card that already lives in a file removable and editable.
- Any other name must be one the cache knows. An unknown one is rejected with up to three of the closest cached spellings (`'Lightning Bolz' is not a card name the local cache knows. Did you mean: Lightning Bolt, ...?`).
- If the cache is **empty**, the write is refused with a message naming both remedies (`refresh_cache` here, `ritual cache preload-all` on the CLI). Check `get_cache_status` first if unsure.

`import_deck`, `import_csv`, and `import_change_bundle` are **excluded**: they carry bulk content whose per-row failures their own engines already report.

Collections track a specific physical printing per entry. `add_card`, `apply_changes`'s `add` and `set-printing` actions, and `set_card_printing` all require `set` + `collectorNumber` together when the target list is a collection; omitting either is rejected. Decks and wanted lists accept a name-only card.

A finish belongs to a printing on **every** list type. `apply_changes`' `set-finish` action rejects `foil` or `etched` against an entry that has no printing, reporting it as an unmatched change (`needs-printing`) so the whole batch is refused. Set the printing first; a `set-printing` earlier in the same batch satisfies it. `nonfoil` always applies, since it clears a finish token rather than asserting one.

The same check covers `set_card_printing` and `apply_changes`' `set-printing`, which write a printing and a finish together: clearing the printing (omitting `set`/`collectorNumber` on a deck or wanted list) while passing `finish: "foil"` is rejected. Clearing both the printing and the finish together is fine.

`add` is exempt: a name-only entry created with a finish records "any printing, in foil", a wanted-list specificity rather than an edit to an existing card.

`move_selected_cards` and `remove_selected_cards` address each card by identity: source `listType` + `slug` + `cardName`, plus `cardId` (the persistent `&N` id, required to match whenever the entry has one; `get_list` shows it) and `copyIndex` (0-based, for deck lines with quantity above 1). Each `move_selected_cards` item names its destination with `toListType` + `toSlug`, may override the printing on arrival (`set`, `collectorNumber`, `finish`, `condition`, `language`), and may pick a destination deck section with `toSection` (deck destinations only). Unresolvable items are skipped and counted in the response; notes a destination cannot keep are reported as `droppedNotes`.

#### Card language

Entries carry a `language` field only when the copy is not English; an absent value always means `en`, mirroring the card lines, where the `[ja]`-style token is omitted on English lines (see [Card Language](/list-format/#card-language)). The vocabulary is the 17 Scryfall codes (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`), canonical codes only, no aliases.

- `add_card` takes an optional `language`; omitted, the configured [`defaultLanguage`](/configuration/#default-language) applies (adds never prompt).
- `set_card_printing` takes one to set it alongside the printing; omitted leaves it alone.
- `apply_changes`' `set-language` action changes it on its own; `en` clears the line's token.
- `remove_card` (and `apply_changes`' `remove` action) takes an optional `language` to match only entries in that language; `"en"` matches bare lines.

Non-English copies are never quoted by the [sell tools](#read-read-only): Card Kingdom's feed is English-only, so they report `noMatchReason: "non-english"`. `get_buylist_quotes` printings take an optional `language` for the same reason (a non-English copy gets no quote).

#### Card labels are per list type

The [label](/list-format/#card-labels) vocabulary is shared, but each list type carries a different part of it: a **collection** takes all of it (`sale`/`trade` combine; `keep` and `proxy` each stand alone), a **deck** takes `proxy` alone, and a **wanted list** carries none. Every tool that pairs a `listType` with `labels` (`add_card`, `set_list_metadata`, and `apply_changes`' `add` / `set-label` actions) enforces this in its **input schema**, so a `sale` on a deck is refused before anything is loaded, with a message naming the offending labels and the ones that type supports. An empty array is a _clear_: it passes on a deck and a collection and is refused on a wanted list, which has no override to clear. The CLI flags, the admin save routes, and change-bundle imports make the same decision.

A card labeled `proxy` is not a real copy, and every reporting tool agrees: `get_price_report` prices it at `0` with `unpricedReason: "proxy"` and leaves it out of `unpricedCount` (it still counts as a card), `export_cards`' `filters.labels` selects it on a deck as readily as on a collection, and `get_sell_report`, `get_sell_cart`, and `get_buylist_quotes` never see it. Its absence there is the rule, not a failed lookup. A card with [custom art](#custom-art) is treated the same way (no price, no quotes, no sale), reported as `unpricedReason: "custom-art"`, which wins when a card is both.

#### Card tags

[Tags](/list-format/#card-tags) are the owner's own free-form vocabulary, carried by **every** list type and never resolved against a list default: a card's tags are exactly the ones on its line. Over MCP a tag is always its canonical value: plain text in the owner's own casing, trimmed and single-spaced (`Ramp`, `Card Draw`), **without** the `#` the card line writes, and never containing `#`, `,`, `&`, `*`, double quotes, brackets, braces or parentheses. Anything not canonical (`#Ramp`, ` Ramp`, `a,b`) is refused by the **input schema** before anything is loaded.

- `get_list` reports each card's `tags` in canonical (sorted) order.
- `add_card` and `apply_changes`' `add` take `tags` for a new card.
- `apply_changes`' `add-tag` / `remove-tag` put one tag on or take one off an existing card, **one event per tag**, so tagging then untagging the same card in one batch cancels out.
- A cross-list move carries a card's tags to the destination line: `move_selected_cards` takes them from the source line, and a bundle move carries them in its own `tags` field. Nothing is filtered out, since every list type carries tags.
- `export_cards`' `filters.tags` selects cards carrying any of the given tags on every list type (wanted lists included), matched exactly. A card with no tags never matches, and `none` is an ordinary tag rather than a sentinel.

Tags are not labels: `keep` as a tag carries none of the `keep` label's meaning, and a deck's front-matter `tags` (written by `set_list_metadata`) describe the deck, not a card.

#### Card categories

[Categories](/commands/categories/) are the card's **role in this one list**, what Archidekt calls a category and Moxfield a tag. They are the third kind of thing you can say about a card: a **label** is an instruction to the app (`proxy`, `keep`), a [**tag**](#card-tags) is a property of the physical copy and travels with a cross-list move, and a **category** belongs to the card _name in this list_ and never follows a move.

- **Keyed by card name, never `&N`.** One assignment covers every line of that name in the list, whatever its printing, section or quantity; matching folds case and whitespace.
- **Ordered, first is primary**, the one the site groups by.
- A name is plain text in the owner's own casing (`Ramp`, `Card Draw`) and can never contain `#`, `,`, `&`, `*`, double quotes, brackets, braces or parentheses. Anything else (`#Ramp`, ` Ramp`, `a,b`) is refused by the **input schema** before anything is loaded.

`get_list`'s cards view reports them twice: the list's own `categories` (`{ "order": [...], "cards": { "Sol Ring": ["Ramp", "Artifacts"] } }`) beside the entries, and each returned card's own resolved `categories`, primary first. **Absent means none at both levels**, never an empty array. Read the per-card field rather than joining `cards` yourself, since the name fold is Ritual's. `categories` always describes the whole list, never just the returned page; each card's own `categories` covers only the cards in the body.

`apply_changes` writes them, with three actions:

| Action               | Fields                    | What it does                                                                                                                                                                                      |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set-categories`     | `cardName`, `categories`  | Replaces that name's whole ordered list (first = primary). `[]` clears. No `cardId` — the sidecar does not address lines.                                                                         |
| `rename-category`    | `category`, `newCategory` | Rewrites every card using the name, and the vocabulary's order.                                                                                                                                   |
| `set-category-order` | `order`                   | Sets the vocabulary's display order. An empty array clears the declared order; the next write re-derives one from the categories the cards use, listing the configured `defaultCategories` first. |

There is no "remove a category" action. Removing one is two list-level actions: clear it off its cards with `set-categories`, then send a `set-category-order` without it.

A `set-categories` naming a card **this list does not hold** is applied and counted, then pruned when the save writes the sidecar (categories go with the last copy of a name), so it reads as a successful no-op. Check the list first. A save that pruned anything reports the dropped names in `prunedCategories`, as do `move_selected_cards` and `remove_selected_cards`.

A cards view also carries `categoryWarnings` when the categories sidecar cannot be read or records categories for names the list no longer holds. Like `artWarnings` it is not part of `warnings`, and it blocks nothing. See the [sidecar's format](/list-format/#categories-namecategoriesjson).

#### Custom art

`get_list`'s cards view reports a list's [custom art](/custom-art/) as `customArt`, a record of **raw** references (`{ "file": … }` / `{ "url": … }`) keyed by the card's `&N` id, present only when some card in the body has any. `set_card_art` takes those same references back as `art` (`null` clears). Art is list metadata: it lives in `<list>.art.json`, records no changelog entry, and neither needs nor disturbs a pending batch of card changes. Ritual only ever _references_ images. A `file` must already exist under the configured `artDir` and carry an image extension (`.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp`, the ones the art route serves). A `url` is used verbatim, never downloaded and never extension-checked.

Custom art carries the same pricing rule as the `proxy` label: `get_price_report` prices the card at `0` with `unpricedReason: "custom-art"` (not counted in `unpricedCount`), and `get_sell_report`, `get_sell_cart`, and `get_buylist_quotes` never see it.

**Art at add time is a two-step.** No tool takes an art reference as part of an add, because a line's `&N` is allocated inside the write. Add the card first, read the id off the mutation's `effects` (following `previousCardId` where a line was renumbered), then aim `set_card_art` at it:

1. `add_card` / `apply_changes` → `effects: [{ action: "added", cardId: 7, name: "Sol Ring", … }]`
2. `set_card_art` with `cardId: 7` and the reference.

The admin editors' add-card dialog does the same internally, and the CLI is the same shape: [`add-card`](/commands/add-card/) then [`set-card --art`](/commands/set-card/#custom-art).

Art follows the card, so no follow-up `set_card_art` is needed to keep it in place:

- A mutation that removes a card (`remove_card`, a `remove` in `apply_changes`, `remove_selected_cards`) drops its art.
- A cross-list move (`move_selected_cards`, or a move applied by `import_change_bundle`) re-files the entry under the destination line's new `&N`.
- A sync that pulls removals in (`sync_decks`, `sync_collection`) drops the entries of the cards it removed.
- A `remove` followed by an `add` of the same card in one `apply_changes` batch still drops the art, even when the new line reuses the old `&N`. Call `set_card_art` afterwards if the new copy should have it.
- Two things keep their art: a deck line that still has copies left after a removal, and a moved copy that merges onto a line the destination already had (that line's art is left alone, whichever direction the copy travels).

See [Art follows the card](/custom-art/#art-follows-the-card). A list's [cover image](/list-images/) is filed under an `&N` the same way and reconciled by the same mutations, so a `set_list_metadata` cover never needs re-setting after a card change.

A cards view also carries `artWarnings` when something is wrong with that sidecar: it cannot be read, or it holds art for cards the list no longer has. It is **not** part of `warnings`, which means unreadable card lines and causes a mutation to refuse the list. Bad custom art blocks nothing.

A mutation result (`add_card`, `remove_card`, `set_card_printing`, `apply_changes`) reports the same sidecar channels for the save it just did: `artWarnings` for art sidecars it could not re-file, `categoryWarnings` for a categories sidecar it could not read or write, and `prunedCategories` for card names whose [category](#card-categories) assignments it dropped. `move_selected_cards` and `remove_selected_cards` report `prunedCategories` too. All are absent when there is nothing to say.

#### `apply_changes`

`apply_changes` accepts fifteen change actions: `add`, `remove`, `set-finish`, `set-printing`, `set-language`, `set-note`, `set-label`, `add-tag`, `remove-tag`, `set-commander`, `unset-commander`, `set-section`, `set-categories`, `rename-category`, and `set-category-order`. It is the **only** way to reach every action after `set-printing`:

- `set-language` requires `language`; `en` clears the token.
- `set-note` sets or clears a card note.
- `set-label` takes the new labels; an empty array clears the override so the list default applies. Labels the list type [cannot carry](#card-labels-are-per-list-type) are refused by the input schema; a `set-label` that otherwise cannot apply fails at apply time.
- `add-tag` / `remove-tag` each take one canonical `tag`, on any list type.
- `set-section` moves a card to a section.
- `set-commander` / `unset-commander` apply to **decks only**.
- `set-categories` targets a card by **name** (no `cardId`); `rename-category` and `set-category-order` target the **list** and are the only changes here that name no card.

An `add` may also carry `labels` and `tags` for the fresh card; `add` and `set-printing` may carry `language`; `remove` may match on `language`. Change `id` and `timestamp` are stamped by the server and are not part of the input. Cross-list moves are rejected; use `move_selected_cards`. Section-structural events are not agent-facing.

`apply_changes` carries `destructiveHint: true` because a batch **can** remove cards in bulk. The hint reflects the tool's worst-case capability, not what any particular batch does.

#### `set_list_metadata`

`set_list_metadata` writes deck front matter (tags, format, source link) and, on a deck or a collection, `labels`, the [default card labels](/list-format/#card-labels) every entry without its own override inherits (`null` clears them). All three list types take:

- `description`, the blurb the built site prints above the cards (`null` or `""` clears it).
- `image`, the list's [cover image](/list-images/): a single-key mapping — `{"card": N}` (the `&N` of a line in that same list), `{"file": "rel/path"}` (relative to the art directory) or `{"url": "https://…"}` — with `null` restoring the built-in cover rule. There is no scalar spelling. The three modes fail differently: a `card` id the list does not carry is rejected outright, a `file` with nothing behind it is accepted and only warned about at build time, and a `url` is never validated.

`description` and `image` are the **only** fields a wanted list accepts (use `rename_list` to change its display name); a `labels` key on a wanted body is refused by name.

Setting `sourceId` together with an `archidekt.com` `sourceUrl` makes a deck sync-linked, so `sync_decks` operates on it. Once merged over what the file already carries, the two must name the **same** Archidekt deck, or the call is rejected (a sync addresses the deck by `sourceId` while every surface shows `sourceUrl`).

The call answers `{ slug, frontMatter }`; the route's `contentHash` is dropped, since an agent never supplies one. No changelog entry is recorded, because the changelog is card-level. This is the same write the CLI's [`deck-sync link`](/commands/deck-sync/#linking-a-deck-deck-sync-link) performs, so the deck's card lines and prose survive byte for byte.

### Destructive

These are flagged with the MCP `destructiveHint` so clients can gate or confirm them:

| Tool              | Description                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rename_list`     | Rename a list (changes its slug); the result carries `newFilePath` and `oldFilePath`.                                                                                                                                  |
| `delete_list`     | Delete a list and every sidecar it has. Requires a `confirmName` matching the list's display name; the result carries `deletedFiles`.                                                                                  |
| `rewrite_history` | Replace a list's entire change log.                                                                                                                                                                                    |
| `update_config`   | Merge a partial configuration.                                                                                                                                                                                         |
| `build_site`      | Rebuild the public static site. Runs in a child process and publishes atomically, so an interrupted build never leaves a broken site. Returns `{ message, outDir, durationMs }`.                                       |
| `sync_decks`      | [Sync decks](/commands/deck-sync/) with Archidekt in either direction. See [`sync_decks`](#sync_decks).                                                                                                                |
| `sync_collection` | [Sync collection lists](/commands/collection-sync/) with Archidekt in either direction. See [`sync_collection`](#sync_collection).                                                                                     |
| `refresh_cache`   | Refresh the Scryfall card cache (bulk download + oracle/art tags). A failed download or ingest is a tool error. Does **not** touch the buylist; that is `refresh_buylist`.                                             |
| `refresh_buylist` | Download the [Card Kingdom pricelist feed](/commands/sell/) (~70 MB) when the cached copy is stale (older than a day) or missing; `force: true` redownloads regardless. Needs [sell mode](#sell-tools-need-sell-mode). |

Details the table leaves out:

- `rename_list` is refused when the new name resolves to another list of the same type; re-spelling the list's own name (capitalization, punctuation) is allowed.
- `rewrite_history`: echo back sets you did not author exactly as `get_history` returned them, including each set's `events` array (one typed event per change line, in the same order; empty only for a legacy set that had none) and its `trailing` array of preserved hand-written lines, or that text is deleted. A set with no `events`, or with a count that does not match its `lines`, is refused. Trailing lines must not start with `- ` or `## `.
- `update_config`: `defaultLanguage` takes canonical Scryfall codes only; a non-`en` value switches cache downloads to the much larger `all_cards` bulk (see [Default language](/configuration/#default-language)). `uiLocale` is the unrelated [interface language](/configuration/#interface-language) (a BCP-47 tag); setting it never changes this surface's English prose. `priceSources` takes store names (`tcgplayer`, `cardmarket`, `cardkingdom`, `cardhoarder`; the sites offer only these stores' currencies; `[]` hides all site prices). Enabling `cardkingdom` makes builds and servers download the ~70 MB Card Kingdom feed, as sell mode does. `defaultCategories` is the global category vocabulary new lists suggest and order by (see [Card categories](#card-categories)).
- `build_site`, `sync_decks`, `sync_collection`, and `refresh_cache` report [progress and honour cancellation](#progress-notifications). The syncs cancel between items and report `report.cancelled`; a cancelled `refresh_cache` writes nothing and the previous cache stands.
- `sync_collection` asks the client (elicitation) which list loses an ambiguous removal when it can, and takes `removalAssignments` otherwise.
- `refresh_buylist`: the sell tools read strictly from this cache. A failed download with a stale cache degrades: `refreshed: false` plus the failure in `warnings`.

#### `sync_decks`

`sync_decks` takes:

- `direction` (`pull` | `push`).
- An optional `decks` array (slugs or names; omit to sync every Archidekt-linked deck).
- An optional [`only`](/commands/deck-sync/#change-filter) (`additions` | `removals`), applying just one side of each deck's diff relative to the sync destination.
- Optional `dryRun` / `ignoreUnreadableLines` / `force` / [`syncPrintings`](/commands/deck-sync/#printing-sync---sync-printings) flags.

Under `syncPrintings`, a card held at several printings at once is reconciled printing by printing (copies added, removed, or re-pinned), a local line naming no printing pushes nothing, and a stated finish the printing does not offer on Archidekt fails that deck. Each deck's report entry carries `printingsChanged`. Without the flag, printings are left alone and a deck whose two sides disagree about them carries `printingsUnaligned`.

It needs an Archidekt login stored by `ritual login archidekt` or the admin site; check `get_sync_status`'s `decks.archidekt.loginRequired` first. A run that completes reports `success` even when individual decks failed; read `report.failedCount` and each deck's `status`/`reason`.

A **push** whose remote deck changed since that deck's recorded `sourceUpdatedAt` fails with `Remote deck changed since last sync (…) — pull first, or pass --force to overwrite remote changes.` rather than reverting those remote edits. `force: true` overwrites them deliberately, and a `dryRun` reports the same refusal without needing it. Pulling that deck first also clears it, since a pull records the baseline even when it finds no card changes. See [Divergence Guard](/commands/deck-sync/#divergence-guard-push). Only decks that pushed cleanly get fresh stamps, so `get_sync_status` never reports a sync that failed.

A deck whose file holds lines the parser cannot read fails with `N unreadable lines would be dropped by a sync`, because syncing rewrites the file and would delete them. `ignoreUnreadableLines: true` accepts that loss. Confirm with the user before setting it; it stands in for the CLI's [`--yes`](/commands/deck-sync/#unreadable-lines) prompt.

#### `sync_collection`

`sync_collection` is the [collection counterpart](/commands/collection-sync/). An Archidekt account has **one** collection while Ritual has **many** collection lists, so a run compares the union of the lists in scope against the whole remote collection. There is no per-file link; the connection is the signed-in account. It takes:

- `direction` (`pull` | `push`).
- An optional `lists` array (slugs or names scoping the **local** side; omit to compare every collection list).
- The same [`only`](/commands/collection-sync/#change-filter) filter.
- An optional `into`: the list a pull adds new cards to, created if missing. Defaults to the [`collectionSync.pullTarget`](/configuration/#collection-sync) config key.
- An optional `removalPriority` array or `removalAssignments` array (one or the other; see below).
- An optional `csv` flag.
- The same `dryRun` / `ignoreUnreadableLines` flags.

Naming a subset of lists declares that those lists are what the remote collection mirrors, so cards living only in unnamed lists read as absent. Pair a subset run with `only: "additions"` when they are not the whole story.

`csv` is the tool's form of the CLI's [`--csv`](/commands/collection-sync/#csv-import-for-new-cards): send a push's **new cards** to Archidekt as one CSV import, with rows built from the local Scryfall cache, instead of creating them one at a time. Creating a printing costs a search plus a create, both [paced](/commands/collection-sync/#rate-limiting), so a push adding more than 25 new printings without `csv: true` **fails before writing anything remote**; there is nobody to prompt over MCP. Set it for any large push. A `dryRun` never needs it (it reports the upload it would make). `report.csv` then says what the import did: its `status`, `rows`, `chunks`, the rows Archidekt refused (`failures`), and `uncached` additions whose printing the cache does not hold and which were added one at a time. Because the rows are keyed by Scryfall ids from the local cache, an empty or day-old cache is refreshed automatically before the upload is built (the CLI's [`--refresh auto`](/commands/collection-sync/#cache-freshness)). Quantity changes and removals never go through the CSV, and a pull ignores the field. Writing the CSV to a file instead of pushing it is CLI-only: the tool has no `csvFile` field (an unknown field is stripped before dispatch, never honored).

`removalPriority` is the tool's form of the CLI's [`--removal-priority`](/commands/collection-sync/#ambiguous-removals): collection list names **in priority order**, the only lists an [ambiguous removal](/commands/collection-sync/#ambiguous-removals) may take copies from. A removal is ambiguous when only _some_ of a printing's copies are going and they live in several lists; taking every copy, or copies held in a single list, never is. `removalAssignments` is the other way to decide: an explicit `[{ key, choices: [{ list, copies }] }]` per ambiguous removal, naming the lists that lose copies and how many each gives up (`key` is the removal's key as `report.ambiguous` reports it). The two cannot be combined. Either one is validated against the ambiguity the run actually finds (a list holding no copies, or counts that do not add up), and a decision that does not cover a removal **fails the run and writes nothing at all**, naming the cards in `report.errors` and setting `report.unresolvedAmbiguity`.

A run that meets an ambiguous removal with **neither** field set **asks the user** when it can. If the client declared the `elicitation` capability, the call returns an `input_required` result carrying one form per ambiguous removal (a bounded integer per list holding copies: "how many copies should each list give up?"), and the client's answers rerun the sync with them as `removalAssignments`. The SDK client fulfils the round trip on its own; a 2025-era client is served through the SDK's legacy shim as an `elicitation/create` request. A declined form leaves the ambiguity unresolved: the run reports `unresolvedAmbiguity: true`, and nothing is written. A client that declared no `elicitation` capability is never asked; it gets the same unresolved report, and the agent should ask the user which lists may lose cards and rerun with one of the two fields rather than guess.

It needs the same Archidekt login (`get_sync_status`'s `collection.archidekt.loginRequired` reports it; a login stored before the account id was recorded must be renewed). It refuses a collection list with unreadable lines for the same reason as `sync_decks`: a pull rewrites the file, and a push treats the file as the truth, so those cards would be deleted from Archidekt. Its report adds:

- `ambiguous`: every ambiguous removal, with the lists holding copies and how many each holds, reported whether a strategy placed them or the run failed on them.
- `unresolvedAmbiguity`: true when the run stopped on them, having written nothing.
- `totals.skipped`: what `only` left out.
- `localIncomplete`: true when a list in scope did not make it into the comparison (an unresolvable name, an unreadable file, or one refused for unreadable lines). The local side is then short of cards it really holds, so the run withholds the changes that shortfall would have produced: a pull adds nothing and a push removes nothing.

`report.failedCount` and each list's `status`/`reason` carry per-list failures.

#### Other destructive hints

`import_deck`, `import_csv`, `import_change_bundle`, and `apply_changes` also carry `destructiveHint`, even though they are registered with the [write](#write) tools: the imports can overwrite an existing list of the same name, and an imported or applied change batch can remove cards. Their default, non-overwrite modes are otherwise safe.

The authentication endpoints (`setup`, `login`, TOTP, Archidekt) and the login audit log (`GET /api/audit-log`) are intentionally **not** exposed. They describe who used the admin server, which is not an agent's concern.

## Resources

Every list is also a readable resource at `ritual://{type}/{slug}` (e.g. `ritual://deck/my-deck`), listed via the MCP resources API. A read returns the same projected JSON as the `get_list` tool: the list's contents without the heavy editor payload (card data, printings, prices), with the same `view` and `listType` discriminants and the same `warnings`. The URI template offers completions for both `{type}` and `{slug}`, and a `{type}` already chosen narrows the slugs offered.

**`resources.listChanged` is advertised on stdio only.** Stdio keeps one server instance for the life of a connection, so a `notifications/resources/list_changed` sent after `create_list`, `import_deck`, `import_csv`, `rename_list`, or `delete_list` has a client to reach. The HTTP transport builds one server per request and tears it down with the response, so a notification there would have nowhere to go. HTTP clients should re-list resources after a list-lifecycle call.

## Card cache

Like `ritual admin`, server startup runs the standard [card-ID backfill](/cli-conventions/#the-card-id-backfill), persisting any missing `&N` card IDs into the list files before the first request is served.

Unlike `ritual admin`, the MCP server does **not** prompt to refresh the Scryfall cache on startup, because stdin is reserved for the protocol. It uses whatever cache exists; on a cache miss, card lookups fall back to live Scryfall requests. Call `get_cache_status` to see its state and `refresh_cache` to warm it. A cold cache also makes card-name validation on writes and `get_price_report` fail, so check it first.

The same applies to the [Card Kingdom buylist](/commands/sell/). `admin` and `serve --api` redownload a day-old feed when they start; the MCP server does not. `get_sell_report`, `get_sell_cart`, and `get_buylist_quotes` read whatever feed is cached, and `refresh_buylist` is the only thing in an MCP session that downloads one (its result reports the feed's age and product count). `refresh_cache` does **not** include the buylist, even though the CLI's [`cache preload-all`](/commands/cache/#the-buylist-rides-along-under-sell-mode) does.

### Sell tools need sell mode

The four buylist tools (`get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, and `refresh_buylist`) reuse the admin's sell routes. Those are enabled by [sell mode](/public-site/sell/) **or** the `cardkingdom` entry of [`priceSources`](/configuration/#price-stores-pricesources) (whose retail prices come from the same feed). Both are **off by default**. With neither on, all four fail with a `Not found` tool error. That is a configuration decision rather than a missing feed, so `refresh_buylist` will not fix it. Enable it with [`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), by ticking **Offer sell mode** on the admin's [Settings](/admin/dashboard/#settings) page (same key), or by starting the server with `--sell-mode`:

```bash
ritual mcp --sell-mode
```

`ritual admin --mcp --sell-mode` does the same for the [embedded endpoint](#embedding-in-a-running-admin-server). Only these four tools are gated.

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
