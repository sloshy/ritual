---
title: 'mcp'
---

Start an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes Ritual's
deck, collection, and wanted-list management to AI agents (Claude Desktop, Claude Code, and other MCP
clients).

The MCP server runs the **same operations as the [web admin interface](/commands/admin/)** in-process — it
reuses the admin route handlers directly, so editing through MCP behaves identically to editing in the
browser (the same changelog, content-hash conflict detection, and optional git auto-commit). It does
**not** open the admin HTTP server or require an admin login; it is a local, trusted process you launch
yourself.

## Usage

```bash
ritual mcp [options]
```

## Options

| Option                    | Description                                                            | Default     |
| ------------------------- | ---------------------------------------------------------------------- | ----------- |
| `--transport <type>`      | Transport to use: `stdio` or `http`                                    | `stdio`     |
| `-p, --port <number>`     | Port for the HTTP transport                                            | `8765`      |
| `--host <address>`        | Host to bind for the HTTP transport                                    | `127.0.0.1` |
| `--token <secret>`        | Require this bearer token on the HTTP transport                        |             |
| `--allow-unauthenticated` | Serve the HTTP transport without a bearer token on a non-loopback host |             |

`--token` may also be supplied via the `RITUAL_MCP_TOKEN` environment variable (the flag takes
precedence); this keeps the secret out of the process list. The global `--base-dir <path>` option
selects which Ritual workspace (decks/collections/wanted dirs) the server operates on;
`--cache-server <host:port>` is also honoured.

## Transports

### stdio (default)

The standard transport for local MCP clients: the client launches `ritual mcp` and exchanges JSON-RPC
over stdin/stdout. There is no network exposure and no authentication — the client already controls the
process.

:::note
On the stdio transport, **stdout is the JSON-RPC channel**, so Ritual diverts all of its own logging to
stderr. Do not pipe other commands' output into `ritual mcp`.
:::

Over stdio the protocol era is chosen by the connection's opening exchange (a 2025-era `initialize`
is served on a compatibility path; a 2026-07-28 client is served statelessly), and one server
instance is pinned for the life of the connection — the per-request stateless model described below
applies to HTTP only.

### HTTP (Streamable HTTP)

```bash
ritual mcp --transport http --port 8765 --token "$MCP_TOKEN"
```

Serves the MCP [Streamable HTTP](https://modelcontextprotocol.io) transport at `http://<host>:<port>/mcp`
for remote/networked clients. It binds to `127.0.0.1` by default. `--port` is validated at parse
time (1–65535); an invalid value exits with code 2. **If you expose it beyond localhost,
set a token (`--token` or `RITUAL_MCP_TOKEN`) so every request must send `Authorization: Bearer <token>`**
— there is no other authentication layer.

Ritual implements MCP revision **2026-07-28**, whose Streamable HTTP transport is **stateless**: there is
no `initialize` handshake and no `Mcp-Session-Id` header. Every POST to `/mcp` is served on its own,
carrying the protocol version and client capabilities in the request itself. Clients speaking the older
2025-era protocol (including current Claude Desktop / Claude Code releases) are still served — Ritual
answers their `initialize` handshake on a compatibility path. On that path the standalone `GET /mcp` SSE
stream and `DELETE /mcp` session teardown are not available and answer `405`; Ritual uses neither feature.

Without a token, the command **refuses to bind a non-loopback `--host`** (exit code `2`) unless you
explicitly pass `--allow-unauthenticated` — an unauthenticated MCP endpoint exposed beyond the local
machine would let anyone on the network edit your lists. Tokenless binds to a loopback host
(`127.0.0.1`, `localhost`, `::1`) are allowed and print a one-line notice on stderr.

The HTTP-only flags (`--port`, `--host`, `--token`, `--allow-unauthenticated`) have no effect under the
default stdio transport; passing them there prints a warning on stderr and they are ignored.

#### Errors

| Response | When                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`    | Missing or wrong bearer token. The JSON-RPC body carries implementation-defined code `-32010`.                                                                                                                                |
| `403`    | On a **loopback bind only**: a request whose `Host` or `Origin` header is not local (DNS-rebinding protection, checked before auth). A deliberately exposed host skips this check and is guarded by the bearer token instead. |
| `404`    | A path other than `/mcp`. The body carries implementation-defined code `-32011`.                                                                                                                                              |
| `405`    | `GET`/`DELETE` on `/mcp` — the 2025-era session operations, which stateless serving does not have.                                                                                                                            |
| `415`    | A POST whose `Content-Type` is not `application/json`.                                                                                                                                                                        |

On 2026-07-28 responses, the catalog surfaces (`tools/list`, `resources/templates/list`,
`server/discover`) advertise a one-hour private cache hint; list enumerations and reads
(`resources/list`, `resources/read`) are marked never-cacheable, since their contents change with
every edit. Ritual declares no list-changed notifications and no resource subscriptions.

### Embedding in a running admin server

Instead of a standalone process, you can serve the same MCP endpoint **inside a running web admin** with
[`ritual admin --mcp`](/commands/admin/#embedded-mcp-server). That runs one process exposing both the web admin
and an MCP endpoint (on `--mcp-port`, default `8765`), sharing the same config, cache, and data. It uses
the **same bearer-token auth** as this command: a token (`--mcp-token` or `RITUAL_MCP_TOKEN`) is required
there (since the admin binds `0.0.0.0` by default) and is independent of the browser admin login.

## Tools

Every tool that addresses a list takes the same two fields: `listType` (`deck` | `collection` |
`wanted`) and `slug` (the markdown file basename without `.md`).

### Read (read-only)

| Tool                                | Description                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_lists`                        | Every list as `{ listType, slug, name }`, optionally filtered by `listType`.                                                                                                                                               |
| `load_list`                         | Load one list: decks return `{ slug, deck, frontMatter }`; collections and wanted lists return `{ slug, entries, sectionOrder }`.                                                                                          |
| `search_cards`, `autocomplete_card` | Find card names — `search_cards` runs a [Scryfall query](https://scryfall.com/docs/syntax); `autocomplete_card` matches every whitespace-separated term against the local cache's names (`in tre` → "In the Trenches").    |
| `card_printings`, `card_price`      | A card's printings and per-currency prices (an unknown card name is an error).                                                                                                                                             |
| `price_report`                      | [Price](/commands/price/) one list (`listType` + `slug`), one list type (`listType` alone), or every list (no arguments).                                                                                                  |
| `load_history`                      | A list's change history.                                                                                                                                                                                                   |
| `deck_sync_status`                  | The Archidekt-linked decks (with each deck's `lastSynced`) plus the stored Archidekt login — what `sync_decks` can act on.                                                                                                 |
| `collection_sync_status`            | The collection lists a sync can cover, the list a pull adds new cards to by default, the CSV threshold (`csvThreshold`), when the account last synced, and the stored Archidekt login — what `sync_collection` can act on. |
| `get_config`, `get_audit_log`       | Configuration and admin activity.                                                                                                                                                                                          |
| `export_cards`                      | Render a CSV, JSON, plain-text, or Markdown [export](/commands/export/) of lists and/or card picks, with filters (and, for `csv`/`json`, column selection, a value `dialect`, and saved or built-in `preset`s).            |
| `diff_lists`                        | Compare two lists by card name or exact printing — the [`diff`](/commands/diff/) command as a tool.                                                                                                                        |

`diff_lists` takes two sides (`a` and `b`, each `{ listType?, name }` — names resolve like CLI list
arguments, with `listType` pinning an ambiguous name) plus an optional `by` (`name`, the default, or
`printing`) and returns `{ a, b, by, matches, onlyInA, onlyInB, warnings }` with quantities summed
across all sections. See [`diff`](/commands/diff/) for the identity rules (nonfoil folding, the
no-printing bucket).

`price_report` takes both `listType` and `slug` (one list's summary plus its priced card entries),
`listType` alone (per-list totals across every list of that type, like the CLI's `price --deck
--summary`), or neither (per-list totals across every list) — a `slug` without a `listType` is a
validation error. The optional `currency` (`usd` | `eur` | `tix`) defaults to the configured
`defaultCurrency`. Prices come strictly from the local card cache; an empty cache is an error (run
`refresh_cache` first).

### Write

| Tool                                 | Description                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_list`                        | Create a new, empty list. `format` (from the fixed set of deck formats) applies to decks only.                                                                          |
| `import_deck`                        | Import a deck from a URL or pasted decklist text.                                                                                                                       |
| `import_csv`                         | Import CSV text into a new or existing list (create/overwrite/append) with a column-mapping spec. `format` applies to decks only.                                       |
| `import_changes`                     | Apply a change bundle exported from the site editor to the underlying lists.                                                                                            |
| `add_card`                           | Add a card to any list; `quantity` adds that many copies in one save. `condition` is rejected for wanted lists; collections require `set` + `collectorNumber` together. |
| `remove_card`                        | Remove a card from any list; `quantity` (decks only) removes that many copies. Flat lists remove one entry a time.                                                      |
| `set_card_note`, `set_card_printing` | Edit a card in place. `set_card_printing` can omit `set`/`collectorNumber` to clear a deck or wanted-list card's printing, but not a collection's — that's rejected.    |
| `set_card_section`                   | Move a card to a section of its list (created when missing).                                                                                                            |
| `set_commander`, `unset_commander`   | Move a card into / out of a deck's Commander section.                                                                                                                   |
| `apply_changes`                      | Apply an ordered batch of card-level changes to one list atomically (one save, one changelog block).                                                                    |
| `move_cards`                         | Move a batch of identity-addressed cards between lists atomically.                                                                                                      |
| `remove_cards`                       | Remove a batch of identity-addressed cards across lists atomically.                                                                                                     |

Card edits load the list, apply the change, and save in a single call, so **you never supply a content
hash** — conflict detection is handled internally (a concurrent web-UI edit surfaces as an error you can
retry).

Collections track a specific physical printing per entry: `add_card`, `apply_changes`'s `add` and
`set-printing` actions, and `set_card_printing` all require `set` + `collectorNumber` together when
the target list is a collection — omitting either one is rejected rather than written as a
printing-less (or cleared) entry. Decks and wanted lists accept a name-only card.

`move_cards` and `remove_cards` address each card by identity: source `listType` + `slug` +
`cardName`, plus `cardId` (the persistent `&N` id — required to match whenever the entry has one;
`load_list` shows it) and `copyIndex` (0-based, for deck lines with quantity above 1). Each
`move_cards` item names its destination with `toListType` + `toSlug`, may override the printing on
arrival (`set`, `collectorNumber`, `finish`, `condition`), and may pick a destination deck section
with `toSection` (deck destinations only). Unresolvable items are skipped and counted in the
response; notes a destination cannot keep are reported as `droppedNotes`.

`apply_changes` accepts the card-level change actions (`add`, `remove`, `set-finish`,
`set-printing`, `set-note`, `set-commander`, `unset-commander`, `set-section`); missing change
`id`/`timestamp` fields are autofilled. Cross-list moves and section-structural events are rejected —
use `move_cards` and `set_card_section` instead.

### Destructive

These are flagged with the MCP `destructiveHint` so clients can gate or confirm them:

| Tool              | Description                                                                             |
| ----------------- | --------------------------------------------------------------------------------------- |
| `rename_list`     | Rename a list (changes its slug).                                                       |
| `delete_list`     | Delete a list. Requires a `confirmName` matching the list's display name.               |
| `rewrite_history` | Replace a list's entire change log.                                                     |
| `update_config`   | Merge a partial configuration.                                                          |
| `build_site`      | Rebuild the public static site.                                                         |
| `sync_decks`      | [Sync decks](/commands/deck-sync/) with Archidekt in either direction.                  |
| `sync_collection` | [Sync collection lists](/commands/collection-sync/) with Archidekt in either direction. |
| `refresh_cache`   | Refresh the Scryfall card cache (bulk download + oracle/art tags).                      |

`sync_decks` takes a `direction` (`pull` | `push`), an optional `decks` array (slugs or names; omit
to sync every Archidekt-linked deck), an optional
[`only`](/commands/deck-sync/#change-filter) (`additions` | `removals`, applying just one side of
each deck's diff relative to the sync destination), and optional `dryRun` /
`ignoreUnreadableLines` flags. It needs
an Archidekt login stored by `ritual login archidekt` or the admin site — check `deck_sync_status`'s
`archidekt.loginRequired` first. A run that completes reports `success` even when individual decks
failed; read `report.failedCount` and each deck's `status`/`reason`.

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
`removalPriority` array, an optional `csv` flag, and the same `dryRun` /
`ignoreUnreadableLines` flags. Naming a subset of lists declares that those lists are what the
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
they live in several lists — taking every copy, or copies held in a single list, never is. There is
nobody to prompt over MCP, so a run that meets an ambiguous removal without a priority — or with one
that cannot cover it — **fails and writes nothing at all**, naming the cards in `report.errors`. Ask
the user which binders may lose cards rather than guessing at a priority.

It needs the same Archidekt login (`collection_sync_status`'s `archidekt.loginRequired` reports it;
a login stored before the account id was recorded must be renewed), and it refuses a
collection list with unreadable lines for the same reason — a pull rewrites the file, and a push
treats the file as the truth, so those cards would be deleted from Archidekt. Its report adds
`ambiguous` (every ambiguous removal, with the lists holding copies and how many each holds —
reported whether a `removalPriority` placed them or the run failed on them),
`totals.skipped` (what `only` left out), and `localIncomplete` — true when a list in scope
did not make it into the comparison (an unresolvable name, an unreadable file, or one refused for
unreadable lines). The local side is then short of cards it really holds, so the run withholds the
changes that shortfall would have manufactured: a pull adds nothing (it would duplicate the missing
list's cards into the target) and a push removes nothing (it would delete them from Archidekt).
`report.failedCount` and each list's `status`/`reason` carry per-list failures.

`import_deck`, `import_csv`, `import_changes`, and `apply_changes` (listed under [Write](#write))
also carry `destructiveHint`: the imports can overwrite an existing list of the same name, and an
imported or applied change batch can remove cards. Their default, non-overwrite modes are otherwise
safe.

The authentication endpoints (`setup`, `login`, TOTP, Archidekt) are intentionally **not** exposed.

## Resources

Every list is also a readable resource at `ritual://{type}/{slug}` (e.g. `ritual://deck/my-deck`),
listed via the MCP resources API. A read returns the same projected JSON as the `load_list` tool —
the list's contents without the heavy editor payload (card data, printings, prices).

## Card cache

Unlike `ritual admin`, the MCP server does **not** prompt to refresh the Scryfall cache on startup
(stdin is reserved for the protocol). It uses whatever cache exists; on a cache miss, card lookups fall
back to live Scryfall requests. Use the `refresh_cache` tool to warm the cache explicitly.

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
