---
sidebar_position: 27
---

# mcp

Start an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes Ritual's
deck, collection, and wanted-list management to AI agents (Claude Desktop, Claude Code, and other MCP
clients).

The MCP server runs the **same operations as the [web admin interface](./admin.md)** in-process — it
reuses the admin route handlers directly, so editing through MCP behaves identically to editing in the
browser (the same changelog, content-hash conflict detection, and optional git auto-commit). It does
**not** open the admin HTTP server or require an admin login; it is a local, trusted process you launch
yourself.

## Usage

```bash
ritual mcp [options]
```

## Options

| Option                | Description                                     | Default     |
| --------------------- | ----------------------------------------------- | ----------- |
| `--transport <type>`  | Transport to use: `stdio` or `http`             | `stdio`     |
| `-p, --port <number>` | Port for the HTTP transport                     | `8765`      |
| `--host <address>`    | Host to bind for the HTTP transport             | `127.0.0.1` |
| `--token <secret>`    | Require this bearer token on the HTTP transport |             |

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
for remote/networked clients. It binds to `127.0.0.1` by default. **If you expose it beyond localhost,
set a token (`--token` or `RITUAL_MCP_TOKEN`) so every request must send `Authorization: Bearer <token>`**
— there is no other authentication layer. Each client session is tracked by the `Mcp-Session-Id` header
negotiated during initialization.

### Embedding in a running admin server

Instead of a standalone process, you can serve the same MCP endpoint **inside a running web admin** with
[`ritual admin --mcp`](./admin.md#embedded-mcp-server). That runs one process exposing both the web admin
and an MCP endpoint (on `--mcp-port`, default `8765`), sharing the same config, cache, and data. It uses
the **same bearer-token auth** as this command: a token (`--mcp-token` or `RITUAL_MCP_TOKEN`) is required
there (since the admin binds `0.0.0.0` by default) and is independent of the browser admin login.

## Tools

### Read (read-only)

| Tool                                            | Description                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `list_decks`, `list_collections`, `list_wanted` | List lists of one type.                                      |
| `list_all_lists`                                | Every deck/collection/wanted list as `{ type, slug, name }`. |
| `load_deck`, `load_collection`, `load_wanted`   | Load a list's cards/entries and sections.                    |
| `search_cards`, `autocomplete_card`             | Find card names on Scryfall.                                 |
| `card_printings`, `card_price`                  | A card's printings and per-currency prices.                  |
| `load_history`                                  | A list's change history.                                     |
| `move_candidates`                               | Every movable card across lists, with keys for `move_cards`. |
| `get_config`, `get_audit_log`                   | Configuration and admin activity.                            |

### Write

| Tool                                                               | Description                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `create_deck`, `create_collection`, `create_wanted`                | Create a new, empty list.                                                                         |
| `import_deck`                                                      | Import a deck from a URL or pasted decklist text.                                                 |
| `import_csv`                                                       | Import CSV text into a new or existing list (create/overwrite/append) with a column-mapping spec. |
| `add_card_to_deck`, `add_card_to_collection`, `add_card_to_wanted` | Add a card.                                                                                       |
| `remove_card_from_deck`                                            | Remove one copy of a card from a deck.                                                            |
| `set_card_note`, `set_card_printing`, `set_commander`              | Edit a card in place.                                                                             |
| `move_cards`                                                       | Move cards between lists (using keys from `move_candidates`).                                     |

Card edits load the list, apply the change, and save in a single call, so **you never supply a content
hash** — conflict detection is handled internally (a concurrent web-UI edit surfaces as an error you can
retry).

### Destructive

These are flagged with the MCP `destructiveHint` so clients can gate or confirm them:

| Tool                                                | Description                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `rename_deck`, `rename_collection`, `rename_wanted` | Rename a list (changes its slug).                                         |
| `delete_deck`, `delete_collection`, `delete_wanted` | Delete a list. Requires a `confirmName` matching the list's display name. |
| `rewrite_history`                                   | Replace a list's entire change log.                                       |
| `update_config`                                     | Merge a partial configuration.                                            |
| `build_site`                                        | Rebuild the public static site.                                           |
| `refresh_cache`                                     | Refresh the Scryfall card cache (bulk download).                          |

`import_deck` and `import_csv` (listed under [Write](#write)) also carry `destructiveHint`, because
both can overwrite an existing list of the same name. Their default, non-overwrite modes are safe.

The authentication endpoints (`setup`, `login`, TOTP, Archidekt) are intentionally **not** exposed.

## Resources

Every list is also a readable resource at `ritual://{type}/{slug}` (e.g. `ritual://deck/my-deck`),
listed via the MCP resources API and returning the list's JSON contents.

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

- [`skills`](./skills.md) — teach a coding agent to drive Ritual via the CLI instead of MCP tool calls.
- [`admin`](./admin.md) — the browser-based equivalent, and the HTTP API the MCP tools mirror.
- [Admin API Endpoints](/admin/api) — the underlying request/response shapes.
