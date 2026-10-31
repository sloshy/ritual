---
title: 'Use Ritual with AI Agents'
description: 'Connect an AI assistant to your workspace through the MCP server, or install skills that teach a coding agent the ritual CLI.'
sidebar:
  order: 4
---

An AI assistant can read and edit your decks, collections and wanted lists in two ways:

- **The MCP server** (`ritual mcp`). An MCP client such as Claude Code or Claude Desktop starts Ritual and calls its tools: read a list, add a card, price a collection. Edits go through the same checks as the [admin site](/admin/) and are written to each list's change history.
- **Skills** (`ritual skills install`). Instruction files that teach a coding agent to run the `ritual` command itself in your workspace. No server runs; the agent uses the CLI the way you would.

Use the MCP server when you talk to an assistant about your lists from a chat client. Use skills when a coding agent already works in the git repository that holds your lists. You can set up both.

## Before You Start

Have a workspace with at least one list, and a warm card cache:

```bash
cd ~/my-cards
ritual lists
ritual cache status
```

The MCP server never prompts to refresh the cache (its input is the protocol), and adding a card checks the name against the cache. If `cache status` shows no bulk data, run `ritual cache preload-all` first, or ask the assistant to call the `refresh_cache` tool. See [`cache`](/commands/cache/).

## Route 1: The MCP Server

### Connect Claude Code

Register the server once, pointing it at your workspace with the global `--base-dir` option:

```bash
claude mcp add --scope user ritual -- ritual mcp --base-dir /path/to/my-cards
```

`--scope user` makes the server available in every project. Without it, Claude Code registers the server for the current directory only.

Start Claude Code and run `/mcp` to check that `ritual` is connected. Claude Code launches `ritual mcp` itself and talks to it over stdin and stdout, so nothing listens on the network.

### Connect Claude Desktop

Add a server entry to Claude Desktop's `claude_desktop_config.json` (**Settings → Developer → Edit Config** opens it), then restart the app. The file is at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "ritual": {
      "command": "ritual",
      "args": ["mcp", "--base-dir", "/path/to/my-cards"]
    }
  }
}
```

A desktop app may not see the `PATH` your shell sets up (on Windows, Claude Desktop does not read shell profiles). If the server fails to start, give `command` the full path to the binary; the install script puts it in `~/.local/bin/ritual` by default.

You can name the workspace with the `RITUAL_BASE_DIR` environment variable instead of `--base-dir`:

```json
{
  "mcpServers": {
    "ritual": {
      "command": "ritual",
      "args": ["mcp"],
      "env": { "RITUAL_BASE_DIR": "/path/to/my-cards" }
    }
  }
}
```

A server defined here also loads in the Desktop app's Code tab, and wins over an entry of the same name there.

Other MCP clients take a similar `command` / `args` entry. The workspace folder must exist, or the server exits before starting.

### Serve over HTTP Instead

The default transport, stdio, suits a client on the same machine. For a client that connects to a URL, serve the Streamable HTTP transport:

```bash
export RITUAL_MCP_TOKEN="$(openssl rand -hex 32)"
ritual mcp --transport http --base-dir /path/to/my-cards
```

The endpoint is `http://127.0.0.1:8765/mcp` (change it with `--host` and `--port`). With a token set, every request must send `Authorization: Bearer <token>`. Reading the token from `RITUAL_MCP_TOKEN` keeps it out of the process list; `--token` works too. For example, Claude Code can connect to it with:

```bash
claude mcp add --transport http ritual http://127.0.0.1:8765/mcp \
  --header "Authorization: Bearer $RITUAL_MCP_TOKEN"
```

Your shell expands the token before Claude Code sees it, so the token is written in plain text into Claude Code's config (`~/.claude.json`).

Keep the default `127.0.0.1` bind unless you need to reach it from another machine. Without a token, Ritual refuses to bind any other host unless you pass `--allow-unauthenticated`, because anyone who can reach the port could then edit your lists. The bearer token is the only authentication.

If you already run the web admin, `ritual admin --mcp` serves the same endpoint inside it (on `--mcp-port`, default `8765`) and requires a token. See [Embedding in a running admin server](/commands/mcp/#embedding-in-a-running-admin-server).

### What the Tools Do

Every tool that addresses a list takes a `listType` (`deck`, `collection` or `wanted`) and a `slug` (the file name without `.md`). The tools fall into three groups:

- **Read**: list your lists, read one, search Scryfall, find where a card lives across your lists, look up printings and prices, price a list, show a list's history, diff two lists, and export cards.
- **Write**: create a list, import a deck or CSV, add, remove and move cards, change a printing, condition or language, set labels, tags and categories, and apply a [change bundle](/commands/import-changes/).
- **Destructive**: rename or delete a list, rewrite a change log, change configuration, rebuild the site, sync with Archidekt, and refresh the card cache.

Destructive tools, and the imports that can overwrite a list, carry the MCP `destructiveHint` flag, so a client can ask you before running them. Claude Code and Claude Desktop ask for permission before a tool call unless you have allowed it. `delete_list` also needs the list's exact display name as `confirmName`, and moves the files into the workspace's `.trash/` folder rather than erasing them.

The sync tools take `dryRun`, so you can ask for a preview first. The [Archidekt sync rules](/commands/collection-sync/) apply unchanged: a collection push makes your whole Archidekt collection match your local collection lists.

The four Card Kingdom buylist tools (`get_sell_report`, `get_sell_cart`, `get_buylist_quotes`, `refresh_buylist`) are off by default. Turn them on with `site.sellMode`, a `cardkingdom` entry in `priceSources`, or `ritual mcp --sell-mode` for one run. Site sell mode and `--sell-mode` are beta. See [Sell tools need sell mode](/commands/mcp/#sell-tools-need-sell-mode).

The full tool list, with every argument and result field, is on the [`mcp` reference page](/commands/mcp/#tools).

### What Happens to Your Files

The MCP server runs the same code as the admin site's editors, in the same process. An edit through MCP:

- writes the list file and adds an entry to its `.changes.md` log,
- applies as changes to the current file, never as a wholesale overwrite, so edits made since the assistant read the list are kept; if another save lands at the same moment, the edit is retried once and then reported as a conflict,
- is committed to git only if you turned on `admin.gitEnabled` and `admin.gitAutoCommit` (and pushed with `admin.gitAutoPush`). See [Git integration](/configuration/#git-integration).

Without auto-commit, review what the assistant changed with `git diff` before you commit, the same as any other edit.

### Example Prompts

Once connected, ask in plain language. The assistant picks the tools.

- "What's in my Atraxa deck? Summarize it by card type."
- "Which of my collections hold a Sol Ring, and which printings?"
- "Add 4 Lightning Bolt to my Burn deck."
- "Price my trade binder and list the ten most valuable cards."
- "Compare my two Commander decks and tell me which cards they share."
- "Do a dry run of pulling my decks from Archidekt and tell me what would change."
- "Tag every card in my binder worth more than $20 with 'Sell Soon'."

The tool names, descriptions and results are in English whatever your [interface language](/localization/), since they are written for the model.

## Route 2: Skills for a Coding Agent

Skills are `SKILL.md` files that a coding agent such as Claude Code loads when a task matches their description. Ritual's skills teach the agent the `ritual` commands, their flags, and the list file format.

### Install Them

From your workspace:

```bash
ritual skills install
```

This writes every skill into `.claude/skills/` in the workspace, so Claude Code picks them up when it runs there. To make them available in every project instead:

```bash
ritual skills install --global
```

`ritual skills list` shows what is available, and you can install single skills by name (`ritual skills install ritual-decks`).

### What They Teach

| Skill                | Covers                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `ritual`             | Workspace layout, the file format, global options, setup, and updating Ritual.            |
| `ritual-decks`       | Creating, importing, syncing and pricing decks.                                           |
| `ritual-collections` | Collections, Archidekt collection sync, pricing, and the Card Kingdom buylist.            |
| `ritual-wanted`      | Wanted lists and their prices.                                                            |
| `ritual-edit`        | One-shot card edits across any list, change bundles, exports, and the interactive editor. |
| `ritual-cards`       | Card lookup and Scryfall searches.                                                        |
| `ritual-site`        | Building, serving and publishing the site, the MCP server, and `ritual migrate`.          |

### Keep Them Current

Skills describe the CLI of the Ritual version that wrote them. After you upgrade Ritual, refresh them:

```bash
ritual skills update            # or: ritual skills update --global
```

If you set up publishing with [`init-site`](/commands/init-site/), [`ritual migrate`](/commands/migrate/) refreshes the installed skills as well.

### Example Prompts

In Claude Code, inside the workspace:

- "Import https://archidekt.com/decks/12345 and price it."
- "Move my two foil Sol Rings from my binder to my Trade collection."
- "Export my collections to CSV with set, collector number and condition."
- "Build the site and serve it so I can look at it."

The agent runs the commands in your terminal, so you see each one and can stop it. Commands that change lists write the same change logs as when you run them yourself.

## Where Next

- [`mcp`](/commands/mcp/): every option, transport detail, tool and result shape.
- [`skills`](/commands/skills/): install, update and list, and how edited skill files are handled.
- [Admin API](/admin/api/): the HTTP routes the MCP tools reuse.
