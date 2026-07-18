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

### HTTP (Streamable HTTP)

```bash
ritual mcp --transport http --port 8765 --token "$MCP_TOKEN"
```

Serves the MCP [Streamable HTTP](https://modelcontextprotocol.io) transport at `http://<host>:<port>/mcp`
for remote/networked clients. It binds to `127.0.0.1` by default. `--port` is validated at parse
time (1–65535); an invalid value exits with code 2. **If you expose it beyond localhost,
set a token (`--token` or `RITUAL_MCP_TOKEN`) so every request must send `Authorization: Bearer <token>`**
— there is no other authentication layer. Each client session is tracked by the `Mcp-Session-Id` header
negotiated during initialization.

Without a token, the command **refuses to bind a non-loopback `--host`** (exit code `2`) unless you
explicitly pass `--allow-unauthenticated` — an unauthenticated MCP endpoint exposed beyond the local
machine would let anyone on the network edit your lists. Tokenless binds to a loopback host
(`127.0.0.1`, `localhost`, `::1`) are allowed and print a one-line notice on stderr.

The HTTP-only flags (`--port`, `--host`, `--token`, `--allow-unauthenticated`) have no effect under the
default stdio transport; passing them there prints a warning on stderr and they are ignored.

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

| Tool                                | Description                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_lists`                        | Every list as `{ listType, slug, name }`, optionally filtered by `listType`.                                                                                |
| `load_list`                         | Load one list: decks return `{ slug, deck, frontMatter }`; collections and wanted lists return `{ slug, entries, sectionOrder }`.                           |
| `search_cards`, `autocomplete_card` | Find card names on Scryfall.                                                                                                                                |
| `card_printings`, `card_price`      | A card's printings and per-currency prices (an unknown card name is an error).                                                                              |
| `price_report`                      | [Price](/commands/price/) one list (`listType` + `slug`), one list type (`listType` alone), or every list (no arguments).                                   |
| `load_history`                      | A list's change history.                                                                                                                                    |
| `get_config`, `get_audit_log`       | Configuration and admin activity.                                                                                                                           |
| `export_cards`                      | Render a CSV, JSON, plain-text, or Markdown [export](/commands/export/) of lists and/or card picks, with filters (and, for `csv`/`json`, column selection). |
| `diff_lists`                        | Compare two lists by card name or exact printing — the [`diff`](/commands/diff/) command as a tool.                                                         |

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

| Tool                                 | Description                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `create_list`                        | Create a new, empty list. `format` (from the fixed set of deck formats) applies to decks only.                                    |
| `import_deck`                        | Import a deck from a URL or pasted decklist text.                                                                                 |
| `import_csv`                         | Import CSV text into a new or existing list (create/overwrite/append) with a column-mapping spec. `format` applies to decks only. |
| `import_changes`                     | Apply a change bundle exported from the site editor to the underlying lists.                                                      |
| `add_card`                           | Add a card to any list; `quantity` adds that many copies in one save. `condition` is rejected for wanted lists.                   |
| `remove_card`                        | Remove a card from any list; `quantity` (decks only) removes that many copies. Flat lists remove one entry a time.                |
| `set_card_note`, `set_card_printing` | Edit a card in place.                                                                                                             |
| `set_card_section`                   | Move a card to a section of its list (created when missing).                                                                      |
| `set_commander`, `unset_commander`   | Move a card into / out of a deck's Commander section.                                                                             |
| `apply_changes`                      | Apply an ordered batch of card-level changes to one list atomically (one save, one changelog block).                              |
| `move_cards`                         | Move a batch of identity-addressed cards between lists atomically.                                                                |
| `remove_cards`                       | Remove a batch of identity-addressed cards across lists atomically.                                                               |

Card edits load the list, apply the change, and save in a single call, so **you never supply a content
hash** — conflict detection is handled internally (a concurrent web-UI edit surfaces as an error you can
retry).

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

| Tool              | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `rename_list`     | Rename a list (changes its slug).                                         |
| `delete_list`     | Delete a list. Requires a `confirmName` matching the list's display name. |
| `rewrite_history` | Replace a list's entire change log.                                       |
| `update_config`   | Merge a partial configuration.                                            |
| `build_site`      | Rebuild the public static site.                                           |
| `refresh_cache`   | Refresh the Scryfall card cache (bulk download + oracle/art tags).        |

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
