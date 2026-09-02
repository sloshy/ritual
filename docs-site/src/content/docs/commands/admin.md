---
title: 'admin'
---

Start the web admin interface for managing Ritual from a browser.

## Usage

```bash
ritual admin [options]
ritual admin setup --username <username> [--password-stdin]
ritual admin reset-password [--username <username>] [--password-stdin]
ritual admin disable-totp
```

Run bare, `ritual admin` starts the web admin server. The `setup`, `reset-password`, and `disable-totp` subcommands manage the admin account headlessly, without starting a server — see [Account Recovery](#account-recovery).

## Options

| Option                 | Description                                                                                                                                                                                    | Default   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>`  | Port to serve on                                                                                                                                                                               | `8080`    |
| `--host <address>`     | Host address to bind to                                                                                                                                                                        | `0.0.0.0` |
| `--theme <name>`       | Initial theme served by the admin. Append `-inverted` (e.g. `boros-inverted`) for the inverted variant. See [`build-site` themes](/commands/build-site/#themes) for the full list of palettes. | `default` |
| `--refresh <mode>`     | Card cache **and buylist** refresh policy on startup: `ask` (prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never`                                                         | `ask`     |
| `--mcp`                | Also serve an [MCP](/commands/mcp/) endpoint in this same process (requires `--mcp-token`)                                                                                                     |           |
| `--mcp-port <number>`  | Port for the embedded MCP server (only with `--mcp`)                                                                                                                                           | `8765`    |
| `--mcp-token <secret>` | Bearer token required on the embedded MCP endpoint (with `--mcp`)                                                                                                                              |           |
| `--sell-mode`          | Offer [sell mode](/public-site/sell/) for this run even when `site.sellMode` is off (enable-only). See [Sell mode](#sell-mode).                                                                |           |

On startup, `admin` runs the standard [card-ID backfill](/#the-card-id-backfill), persisting any missing `&N` card IDs into the list files (the editors rely on them). It then checks whether the Scryfall card cache is missing or stale and prompts to refresh it, and — **when [sell mode](#sell-mode) is on** — redownloads the [Card Kingdom buylist](/commands/sell/) if it is more than a day old (Card Kingdom regenerates it daily, and the quote routes themselves never download). Startup only _updates_ a buylist — a workspace that has never downloaded one is left alone, with no prompt — and `--refresh no-bulk`/`never` skip it entirely; a failed download leaves the older feed in place with a warning rather than failing startup. Pass `--refresh auto` (or `no-bulk` / `never`) to answer that prompt non-interactively — an explicit mode is required when running under `bun run dev admin` (see [Development → Dev Workflow](/development/#dev-workflow)). Under the default `--refresh ask`, a run where prompts are unavailable (stdin is not a TTY, or the global `--no-input` flag is in force) skips the refresh instead of prompting.

## Sell mode

[Sell mode](/public-site/sell/) — Card Kingdom buy prices in the editors, the buylist filters and
groupings, and the sell-cart export — is **off unless you ask for it**, on the admin site exactly as
on a published one. Turn it on for the workspace with
[`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), or for one
run:

```bash
ritual admin --sell-mode
```

With sell mode **off** — and [`priceSources`](/configuration/#price-stores-pricesources) not naming `cardkingdom`, which wants the same feed — the admin server:

- skips the startup buylist refresh entirely (no ~70 MB download for a capability this workspace has
  not asked for);
- answers `404` on `/api/sell/report`, `/api/sell/cart`, `/api/sell/refresh`, `/api/buylist/status`,
  and `/api/buylist/quotes` — read per request, so a `config set` takes effect without a restart;
- hides the surfaces that call them: the editors' **Sell mode** toggle and buyer selector (see
  [Editors](/admin/editors/)), the **Refresh buylist** card on the [Refresh Cache](#refresh-cache)
  page, and the sell controls on all three panes of [Move Cards](/admin/move-cards/).

The admin UI learns this from [`GET /api/status`](#get-apistatus), which reports the **effective**
value — so `--sell-mode` shows the surfaces even with nothing in the config file.

The [Settings](#settings) page carries an **Offer sell mode** checkbox for `site.sellMode` and **Price Stores** checkboxes for [`priceSources`](/configuration/#price-stores-pricesources), so the
key can be set from the browser as well as from the CLI. Checking it stores `site.sellMode: true`;
unchecking removes the key entirely (so `config get site.sellMode` reports it unset again, rather
than an explicit `false` that means the same as the default). Both sides pick the change up
**immediately, without a reload or a restart**: the routes re-read the config per request, and the
save re-reads `GET /api/status`, so the editors' sell toggle, the [Move Cards](/admin/move-cards/)
sell controls and the [Refresh Cache](#refresh-cache) page's buylist card appear or disappear on
the spot. If that status read fails — the server went away between the save and the re-read — the
surfaces keep their previous state rather than guessing; the save itself still landed, so reload to
resynchronize. A server started with `--sell-mode` keeps offering sell mode whatever the checkbox says —
the flag is a session override that wins over the stored key — so unchecking it there stores the
change without hiding anything until the next run.

Do bear in mind what the checkbox commits to: every later site build and cache refresh downloads
and indexes Card Kingdom's ~70 MB buylist.

[`ritual sell`](/commands/sell/) is unaffected: running it is itself the request for Card Kingdom
prices, so it works whatever sell mode says.

## Embedded MCP Server

Passing `--mcp` starts an [MCP](/commands/mcp/) (Model Context Protocol) endpoint in the **same process** as the web admin, on a separate port (`--mcp-port`, default `8765`). Both `--port` and `--mcp-port` are validated at parse time (1–65535), and `--mcp-port` must differ from `--port`; violating either exits with code 2 before the server starts:

```bash
ritual admin --mcp --mcp-token "$MCP_TOKEN"
#   http://<host>:8080/        web admin
#   http://<host>:8765/mcp     MCP (Streamable HTTP)
```

This is one process — not a second `ritual mcp` instance — so it shares the same config, card cache, and data directory. Authentication uses the **same bearer-token model as the standalone server**: a token is **required** — pass `--mcp-token <secret>` or set the `RITUAL_MCP_TOKEN` environment variable (the admin binds `0.0.0.0` by default, so an unauthenticated MCP endpoint would be exposed). Every MCP request must then send `Authorization: Bearer <token>`; requests without it get `401`. The token is independent of the browser admin login.

The endpoint is stateless and serves both the 2026-07-28 and the 2025-era protocol — see [`ritual mcp` → HTTP](/commands/mcp/#http-streamable-http) for what that means for sessions, `GET`/`DELETE`, and error responses.

Both listeners stop cleanly on `Ctrl-C` (`SIGINT`) or `SIGTERM`: the admin server and the embedded MCP endpoint are shut down together, so neither port is left bound.

The standalone [`ritual mcp`](/commands/mcp/) command is still the way to run MCP without the web admin (over stdio, or HTTP with a bearer token).

## First-Time Setup

When you first start the admin interface, navigate to the displayed URL in your browser. You will be prompted to create an admin account:

- **Username**: any username of your choice
- **Password**: must be 8–128 characters

Credentials are hashed with bcrypt and stored in `.logins/admin-auth.json`. Subsequent visits require signing in with these credentials via HTTP Basic Auth.

The account can also be created ahead of time from the terminal with `ritual admin setup` — see [Account Recovery](#account-recovery).

## Account Recovery

Three subcommands manage the admin account **headlessly** — they read and write `.logins/admin-auth.json` directly, without starting (or requiring) a running admin server. They exist for scripted provisioning and for recovering access when you are locked out. All three support the standard scripting options (`--output text|json|ndjson`, `--quiet`) and append an entry to the audit log (`.logins/admin-audit.log`).

### `ritual admin setup`

Create the admin account before ever opening the browser:

```bash
# Interactive password prompt
ritual admin setup --username ops

# Scripted: password piped on stdin (exactly one trailing newline is stripped)
printf '%s\n' "$ADMIN_PASSWORD" | ritual admin setup --username ops --password-stdin --output json
# → { "username": "ops", "created": true }
```

| Option                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `--username <username>` | Username for the new admin account (required) |
| `--password-stdin`      | Read the password from stdin (for scripting)  |

Fails with exit code `1` if an admin user already exists, and exit code `2` for validation problems (missing username, password too short/too long) or when a password prompt would be needed but stdin is not a terminal.

### `ritual admin reset-password`

Replace the stored password hash (and optionally the username) for the existing account:

```bash
printf '%s\n' "$NEW_PASSWORD" | ritual admin reset-password --password-stdin
# Also replace the username:
printf '%s\n' "$NEW_PASSWORD" | ritual admin reset-password --username root --password-stdin
```

| Option                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `--username <username>` | Also replace the admin username (optional) |
| `--password-stdin`      | Read the new password from stdin           |

Everything else in the credentials file — most importantly a TOTP secret, including a pending enrollment — is preserved verbatim. Fails with exit code `3` when no admin user exists yet (run `ritual admin setup` instead).

### `ritual admin disable-totp`

Remove the TOTP secret from the account so login only needs the password again:

```bash
ritual admin disable-totp --output json
# → { "totpDisabled": true }
```

This clears **both** an active TOTP secret and a stuck `pending:` enrollment — an enrollment you started in the browser but never verified is exactly the kind of lockout this command recovers from. Fails with exit code `1` when no TOTP secret is stored, and `3` when no admin user exists.

### Recovery runbook

**Lost password** (with or without TOTP still working):

1. On the machine hosting Ritual, run `ritual admin reset-password` (interactive) or pipe the new password with `--password-stdin`.
2. Restart the admin server (see the caveat below).
3. Sign in with the new password.

**Lost TOTP device** (or a broken half-finished TOTP enrollment):

1. Run `ritual admin disable-totp`.
2. Restart the admin server.
3. Sign in with username + password only, then re-enroll TOTP from Settings → Two-Factor Authentication if desired.

**Lost everything / no account state worth keeping**: delete `.logins/admin-auth.json` and run `ritual admin setup` (or open the browser for first-time setup) to start fresh.

:::caution
Live browser sessions are held **in memory inside the running admin server process** — recovering credentials on disk does not invalidate or refresh them. After any credential recovery, **restart the admin server** so stale sessions are dropped and logins are checked against the new credentials.
:::

## Available Actions

The admin dashboard provides a web interface for the following operations:

### Import Deck

Import a deck three ways, selected with a segmented control:

- **URL** — fetch from Archidekt, Moxfield, or MTGGoldfish.
- **Upload File** — choose a decklist or exported deck file (markdown or plain text); it is read in the browser and parsed server-side.
- **Paste Text** — paste a decklist directly (`QTY Name` per line, `## Heading` lines start new sections). MTG Arena/MTGO exports are understood too, printings included.

For upload and paste, an optional **Deck Name** is used unless the text defines its own name (a `# Title` heading, or an Arena `About` block's `Name` line). Optionally overwrite an existing deck on conflict. URL imports also carry an **Import the exact printings…** checkbox (ticked by default, URL mode only) — unticking it imports bare card names; see [Printings from a URL import](/commands/import/#printings-from-a-url-import).

### Import CSV

Import cards from a CSV export (Moxfield, Deckbox, ManaBox, ...) into a deck, collection, or wanted list — either **creating a new list** or **appending to an existing one**. Upload a file or paste CSV text; the page parses it in the browser, guesses whether the first row is a header, and pre-selects which column holds each card field (name, set, collector number, condition, finish, section, quantity) for you to confirm. Values are normalized on import (e.g. `Near Mint` → `NM`, `F` → foil, `side` → `Sideboard`) exactly like the [`import`](/commands/import/#csv-imports) CLI command's CSV mode, which shares the same engine.

When creating, an **Overwrite if a list with this name exists** checkbox replaces an existing list of the same name; in **Append to Existing** mode the target is picked from a dropdown of the existing lists of the selected type. Appends record every added card in the list's changelog. Rows that fail validation are listed with their line numbers; the valid rows still import.

### Import Changes

The **Import Changes** page applies a change bundle exported from the public site's [in-browser editor](/commands/build-site/#editing-on-the-public-site) — a version-2 `ritual-change-bundle` JSON covering one or more lists plus the cross-list moves touching them (the export panel's **This list** and **All lists** scopes both produce it; see the [format](/commands/import-changes/#format)). Upload the file or paste its contents; the page parses it in the browser and shows a full **preview of every pending change grouped by target list**, the bundle's **moves** (each copy with its source and destination), and per-list and total counts. Nothing is written until you press **Apply N changes to K lists**.

Applying replays every list's changes and every move in one timestamp-ordered stream, re-targets each list's changes to its current card IDs (by ID when it still exists, otherwise by card name), applies each move on its destination list — whose save also takes the copy out of the source list and writes both changelogs — writes the list files and their changelogs, and reports a per-list outcome: applied count (moves included), every skipped change with the reason it was skipped (card not found, not applicable to this list, or the card has no printing for that finish), and any list that failed (which stops that list's remaining batches, not the others). This is the same engine as the [`import-changes`](/commands/import-changes/) CLI command and the MCP `import_change_bundle` tool.

#### Loading changes into an editor

Alternatively, the deck, collection, and wanted-list editors each have an **Import…** button that loads a change bundle as **pending edits** rather than applying it immediately — useful when you want to adjust the changes before committing them. The dialog loads the bundle entry for the list being edited plus every move leaving or arriving at it (matched by slug or display name; other entries are ignored), and rejects a bundle that names no list of this kind and no move touching it:

- Each change is **re-targeted** to the current list's card IDs — added cards get fresh IDs, and other changes match by ID when it still exists, otherwise by card name.
- Changes that cannot be applied are skipped and listed after the import, each with its reason: the card is not in the list, the action does not apply to this kind of list, or it would set a foil/etched finish on a card that pins no printing.
- The loaded changes appear in the editor for you to review and then **Save Changes** as a normal edit (recorded in the changelog).

### Moving Cards While Editing

While editing a deck, collection, or wanted list you can move a card into another list without leaving the editor (this is separate from the dedicated **Move Cards** batch tool). A single **Move to list…** item appears in three places:

- the per-card **⋯** context menu (moves that card),
- the per-list **Selected** menu (moves the current multi-selection), and
- the cross-list **All Selected** navbar menu (moves every selected card from its own list).

Choosing **Move to list…** opens a small picker listing your other decks, collections, and wanted lists; pick one to set the destination. (The picker replaces the older layout that listed every destination as its own menu entry.)

For the per-card and per-list **Selected** moves, choosing a destination removes the card from the list you're editing and **stages** a move. **When you Save, both lists are written**: the card is removed from the source (with a "Move … to …" changelog entry) and added to the destination (with a matching "Move … from …" entry). Moving a printing-less card into a collection — which requires a specific printing — opens a printing picker first.

The editor's pending changes can also carry **incoming** moves — a `move-to` recording a copy that arrives in the list you're editing from another list (a printing swap that pulls a copy you own elsewhere, or a bundle loaded through **Import…**). Save handles these symmetrically: the copy is added here, **taken out of the source list** — by the source line id the change names when that line still holds the card, otherwise by the exact printing, otherwise (for a source line that pinned no printing, such as a wanted entry) by name — and both changelogs are written ("Move … from …" here, "Move … to …" on the source). A move from the **Swap Printings** wizard that gives one of this list's name-only lines a printing carries `replacesCardId` instead: the line is converted in place (keeping its `&N`) or, when only some of its copies are filled, split — no copy is added. Such a move may also carry a `replacement`, a printing added back to the source list in the section the departed line left and logged there as an `Added` line (see [Save Deck](/admin/api/#save-deck)). Every move, in either direction, is validated in memory before anything is written: a missing list, a source with no copy left to take, or a printing-less card headed into a collection fails the save with nothing written. A swap that leaves and enters the same other list stages both halves against one copy of its file. Custom art follows the moved copy both ways.

The cross-list **All Selected** move does not go through the editor's Save button: it is applied **immediately** and atomically across every affected file via `POST /api/move/selected` (each card moves from its own list to the chosen destination).

### Build Site

Trigger a full static site build from the browser. This runs the same build as `ritual build-site`, as a background child process — the admin server stays responsive for its duration, and the build publishes atomically. The page streams the build as it runs: a progress bar over the build's four structural steps (starting, building, publishing, done) and a live log box showing the build's own output lines, so a multi-minute build never looks stuck. If the event stream cannot be opened the page falls back to the plain request; if it drops mid-build the build keeps running on the server and the page says so rather than starting a second one. See [`POST /api/build-site`](#post-apibuild-site) and [`GET /api/build-site/stream`](#get-apibuild-sitestream) for the details.

### Refresh Cache

Download and cache all Scryfall card data — the Scryfall half of `ritual cache preload-all`. (Unlike the CLI command, it never touches the [Card Kingdom buylist](/commands/sell/): this page has its own button for that, below.)

The Refresh Cache page shows real-time progress during the operation:

- **Progress bar** with download percentage and MiB counter
- **Stage indicators** tracking each phase: Downloading & processing → Saving
  (cards are parsed and processed as the stream downloads, so they are one phase)
- Falls back gracefully if streaming is unavailable

When [sell mode](#sell-mode) is on, the page also carries a **Card Kingdom buylist** card, backing
sell mode and the [`sell`](/commands/sell/) command (with sell mode off and no `cardkingdom` price source the card is not shown at
all — its routes answer `404`). It shows when the feed was last downloaded, Card Kingdom's
own generation stamp, and the product count, with a **Refresh buylist** button. Once the server is
up, that ~70 MB download only ever happens on an explicit click — no page load triggers it — and the
button forces a redownload even when the cached copy is still fresh. (Server _startup_ refreshes a
day-old feed on its own, as described above, so the button is for forcing one mid-session.) A workspace that has never downloaded it
shows an empty state offering the button rather than an error; if a download fails but a stale copy
exists, the card reports "The buylist was not updated." instead of claiming success.

When the refresh actually brings down a new feed, the admin also discards the quotes it has already
resolved in this browser session, so an editor opened afterwards prices every card against the feed
you just downloaded. (A refresh that changed nothing — a copy that was still fresh, or a failed
download that fell back to the stale one — leaves them alone: they already quote that feed.)

### Archidekt Login

Sign in to your Archidekt account through the web interface. Credentials are sent to the Ritual server, which handles authentication server-side.

The page also shows the status of the stored login:

- **Current login (access token)**: how long the active session token remains valid. When it expires it is refreshed automatically.
- **Refresh token**: how long the longer-lived refresh token remains valid. Once it expires too, a fresh login is required.

When both the access token and refresh token have expired, the page reports that a login is required to use Archidekt account features.

### Sync Decks

Pull or push Archidekt-linked decks, with per-deck progress streaming into the page as the run proceeds. Toggle which decks to sync (all by default), pick a direction, and optionally preview without writing. Each deck shows when it last synced, and the page signs in to Archidekt inline when the stored token has expired.

Same engine as [`deck-sync`](/commands/deck-sync/). See [Sync Decks](/admin/sync-decks/) for the full page.

### Sync Collection

Pull or push the signed-in Archidekt account's collection, with per-list progress streaming into the page as the run proceeds. Choose a direction, a scope (the whole collection or selected lists), a change filter (all changes, additions only, removals only), the list a pull adds new cards to, an ordered removal priority (which binders may give copies up when a removal is ambiguous — without it such a run stops without writing anything), whether a push uploads its new cards as one CSV import (on by default — with it off a push adding more than 25 of them stops without pushing anything), and optionally preview without writing. A finished push reports what that import did, including any row Archidekt refused. An account has one collection, so the page shows a single account-level "last synced".

Same engine as [`collection-sync`](/commands/collection-sync/). See [Sync Collection](/admin/sync-collection/) for the full page.

### Settings

Configure admin settings including:

- **Decks Directory**: path to the decks folder (default: `./decks`)
- **Collections Directory**: path to the collections folder (default: `./collections`)
- **Wanted List Directory**: path to the wanted-lists folder (default: `./wanted`)
- **Custom Art Directory**: path to the folder holding [custom card art](/custom-art/) images — the directory a card's `file` reference is relative to. Never created by Ritual; a missing directory just means the workspace has no local art (default: `./art`; see [Configuration](/configuration/#directory-options))
- **Default Price Currency**: the currency price-touching surfaces default to (default: `usd`; see [Configuration](/configuration/#default-currency))
- **Default Language**: the Scryfall language code stamped on newly added cards; a non-English value switches cache downloads to the much larger `all_cards` bulk (default: `en`; see [Configuration](/configuration/#default-language))
- **Interface Language**: the language the admin and CLI **speak** — a BCP-47 tag, listing every locale this build ships, each named in its own language (default: `en`; see [Configuration](/configuration/#interface-language)). Deliberately placed below Default Language and worded against it: **this is not the card language**. Saving it relabels the admin immediately, with no rebuild; the public site picks it up on its next [build-site](/commands/build-site/#localized-builds). The header also carries a language switcher that changes the language for this browser only, without touching the config — see [Localization](/localization/#admin-site)
- **Cache Lock Timeout**: seconds a cache refresh waits for another process's cache-write lock before failing (default: `300`; see [Configuration](/configuration/#cache-lock-timeout))
- **Cache Source**: where cache refreshes download from — Scryfall directly or a peer-to-peer cache feed (default: `scryfall`; see [Configuration](/configuration/#cache-source))
- **Cache Feed URL**: the feed URL used when the cache source is the feed (empty = the built-in default)
- **Card Search Debounce**: milliseconds the editors' add-card search waits after a keystroke before querying autocomplete; `0` disables the debounce (default: `500`; see [Configuration](/configuration/#search-debounce))
- **Offer sell mode**: whether the sites — the published one and this admin — offer [sell mode](#sell-mode) (default: off; `site.sellMode`). Unchecking removes the key rather than storing `false`. Saving applies at once, with no reload: the sell surfaces appear or disappear as soon as the save returns. See [Sell mode](#sell-mode) for what it costs and how `--sell-mode` overrides it
- **Git Integration**: enable/disable git auto-commit
- **Two-Factor Authentication (TOTP)**: set up or disable TOTP 2FA
- **Rate Limiting**: configure failed login attempt limits and lockout duration
- **IP Filtering**: allow/deny lists for IP addresses
- **User-Agent Filtering**: allow/deny lists for browser user agents

### Audit Log

View a chronological log of all login attempts, including timestamp, IP address, username, success/failure status, and user agent. Useful for monitoring unauthorized access attempts.

## Configuration File

Settings are stored in `ritual.config.json` in the base directory. The file is shared by the entire app — see [Configuration](/configuration/) for the full reference and how it interacts with `--base-dir`. It is created the first time something writes a setting (a **Settings** page save, `config set`, `init-site`); until then the defaults below apply with no file on disk.

```json
{
  "decksDir": "./decks",
  "collectionsDir": "./collections",
  "wantedDir": "./wanted",
  "defaultCurrency": "usd",
  "priceSources": ["tcgplayer"],
  "defaultLanguage": "en",
  "uiLocale": "en",
  "cacheLockTimeoutSeconds": 300,
  "cacheSource": "scryfall",
  "searchDebounceMs": 500,
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
```

All admin-server settings live under the nested `admin` key. Set them from the **Settings** page, with [`config set admin.<field>`](/commands/config/), or by hand.

## Git Integration

When git integration is enabled in settings:

1. The admin checks if the target directory (decks, collections, or config) is inside a git repository
2. After file-modifying operations (editing decks or collections, importing decks, updating config), changed files are automatically staged and committed
3. Commit messages describe the action performed (e.g., "Save 3 changes to burn.md")

Enable this feature in the Settings page by checking both **Enable Git integration** and **Auto-commit changes**.

Auto-commit covers writes made through the admin web UI and the [MCP server](/commands/mcp/), which reuses the same handlers in-process. CLI commands never auto-commit — including [`ritual import-changes`](/commands/import-changes/), which replays bundles through the same save handlers with auto-commit suppressed.

## Security

### Failed Login Delay

Every failed authentication attempt incurs a configurable delay (default: 3 seconds) before the server responds. This is implemented using `Bun.sleep()` so it does not block other requests — the server remains fully responsive during the delay.

### Rate Limiting

After a configurable number of consecutive failed login attempts (default: 5) from a single IP address, that IP is locked out for a configurable duration (default: 5 minutes). Rate limiting can be disabled entirely in settings.

| Config Field                   | Default | Description                    |
| ------------------------------ | ------- | ------------------------------ |
| `admin.rateLimitEnabled`       | `true`  | Enable/disable rate limiting   |
| `admin.rateLimitMaxAttempts`   | `5`     | Failed attempts before lockout |
| `admin.rateLimitWindowMinutes` | `5`     | Lockout duration in minutes    |
| `admin.failedAuthDelayMs`      | `3000`  | Delay (ms) on failed auth      |

Rate limit state is stored in memory and resets when the server restarts.

### Two-Factor Authentication (TOTP)

TOTP (Time-based One-Time Password) adds a second factor to authentication. When enabled, login requires both your password and a 6-digit code from an authenticator app (e.g., Google Authenticator, Authy, 1Password).

**Setup:**

1. Go to Settings → Two-Factor Authentication
2. Click "Set Up TOTP" — the server generates a secret key
3. Add the secret to your authenticator app (manual entry or use the `otpauth://` URI with a QR code generator)
4. Enter the current 6-digit code to verify and activate TOTP

**Login with TOTP:**
When TOTP is enabled, the login form shows an additional code field. For API access, include the `totpCode` field in the `POST /api/login` request body.

The TOTP secret is stored in `.logins/admin-auth.json` alongside the password hash.

### IP Allow/Deny Lists

Control which IP addresses can access the admin interface:

- **Allow list**: If non-empty, only IPs matching a pattern can connect. All others are blocked with `403 Forbidden`.
- **Deny list**: IPs matching any pattern are blocked. Deny is checked before allow.

Patterns support simple wildcards: `192.168.1.*`, `10.0.*`, `*` (match all).

### User-Agent Allow/Deny Lists

Control which browsers/clients can access the admin interface:

- **Allow list**: If non-empty, only matching User-Agent strings can connect.
- **Deny list**: Matching User-Agent strings are blocked.

Patterns support wildcards: `*bot*` (blocks common bots), `Mozilla*` (allows browsers).

## HTTP API Reference

All API endpoints are served under `/api/`. Except where noted, endpoints require an active session.

### Authentication

The admin uses **session-based authentication**. To start a session, send a `POST /api/login` request with your credentials. If TOTP is enabled, include the TOTP code. The server responds with a `Set-Cookie` header containing the session token. All subsequent requests are authenticated automatically via the session cookie.

Sessions expire after 24 hours. To end a session, call `POST /api/logout`.

Unauthenticated requests to protected endpoints receive a `401 Unauthorized` JSON response.

Rate-limited requests receive a `429 Too Many Requests` response with a `Retry-After` header indicating the remaining lockout seconds.

### Audit Log

Every login attempt (successful or failed) is logged to `.logins/admin-audit.log` with timestamp, IP address, username, result, reason, and user agent. The log can be viewed in the admin UI under "Audit Log" or via the `GET /api/audit-log` endpoint.

### `GET /api/status`

**Auth required:** No

Returns server health, whether first-time setup is needed, and which optional capabilities this server offers.

**Response:**

```json
{
  "ok": true,
  "setupRequired": false,
  "totpEnabled": true,
  "sellMode": false
}
```

`sellMode` is the **effective** value — `site.sellMode`, or `true` when the server was started with [`--sell-mode`](#sell-mode). With it false a client hides its sell surfaces — though the `/api/sell/*` and `/api/buylist/*` routes themselves stay open when the `cardkingdom` [price store](/configuration/#price-stores-pricesources) is enabled, since Card Kingdom retail prices ride the same feed.

### `POST /api/setup`

**Auth required:** No (only works when no admin user exists)

Create the initial admin account. Returns `409 Conflict` if an admin already exists.

**Request body:**

```json
{
  "username": "admin",
  "password": "mypassword"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Admin account created successfully"
}
```

### `POST /api/login`

**Auth required:** No

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
  "totpRequired": true
}
```

### `POST /api/logout`

**Auth required:** Yes

Destroys the current session.

**Request body:** None

**Response:**

```json
{
  "success": true
}
```

### `GET /api/audit-log`

**Auth required:** Yes

Returns recent login attempt records.

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

Entries are returned most recent first.

### `GET /api/decks`

**Auth required:** Yes

List all deck files in the decks directory.

**Response:**

```json
{
  "decks": ["burn", "elves", "mono-red-aggro"]
}
```

### `GET /api/lists`

**Auth required:** Yes

List every deck, collection, and wanted list as lightweight summaries. Backs the editor's "Move to list" destination picker.

**Response:**

```json
{
  "success": true,
  "lists": [
    { "type": "deck", "slug": "burn", "name": "Burn" },
    { "type": "collection", "slug": "binder", "name": "Binder" }
  ]
}
```

### `POST /api/move/selected`

**Auth required:** Yes

Move a batch of selected cards across lists atomically — the server side of the cross-list **All Selected → Move all to list…** action. Each item identifies a card by its source list and identity and names a destination list (by `toType` + `toSlug`); optional `set`/`collectorNumber`/`finish`/`condition` pin a resolved printing (required when moving a printing-less card into a collection), and `toSection` (deck destinations only) places the card in that section. See the [admin API reference](/admin/api/#move-selected-cards) for the full request/response specification.

**Request body:**

```json
{
  "moves": [
    {
      "listType": "deck",
      "listSlug": "burn",
      "name": "Lightning Bolt",
      "cardId": 3,
      "copyIndex": 0,
      "toType": "collection",
      "toSlug": "binder",
      "set": "lea",
      "collectorNumber": "161"
    }
  ]
}
```

**Response:** `{ "success": true, "moved": 1, "requested": 1, "skipped": 0, "droppedNotes": [], "warnings": [], "message": "Moved 1 card." }`. Cards whose source or destination can no longer be resolved (or whose destination is their own list) are skipped and counted. `warnings` is always present (possibly empty) and names each list file that could not be fully read while the card index was rebuilt, so a skipped move is never silently unexplained.

### `GET /api/card-search`

**Auth required:** Yes

Search Scryfall with its raw query syntax, one page per request. With `warm=true` the results are also written into the local card cache (under names it does not already hold), whole-name matches are promoted, and the page is capped at 20 — the behavior the removed `POST /api/search-cards` route provided. See [Card Search](/admin/api/#card-search) for the full parameter list, the response shape, and the error contract that applies to both modes.

### `POST /api/import-deck`

**Auth required:** Yes

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

| Field           | Type    | Required         | Default | Description                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`          | string  | Yes              | —       | `"url"` or `"text"`                                                                                                                                                                                                                                                                                                                        |
| `url`           | string  | When `url` mode  | —       | Archidekt, Moxfield, or MTGGoldfish URL                                                                                                                                                                                                                                                                                                    |
| `content`       | string  | When `text` mode | —       | Decklist text (`QTY Name` per line; `## Heading` lines start sections)                                                                                                                                                                                                                                                                     |
| `name`          | string  | No               | —       | Deck name for `text` mode; ignored if the text defines its own `# Title`                                                                                                                                                                                                                                                                   |
| `overwrite`     | boolean | No               | `false` | Overwrite existing deck on conflict                                                                                                                                                                                                                                                                                                        |
| `syncPrintings` | boolean | When `url` mode  | —       | `true` keeps the exact printings (set, collector number, finish) the source lists; `false` imports bare card names. Required — the CLI asks interactively, and over HTTP the caller must decide. Rejected in `text` mode, whose printings come from the pasted lines. See [Printing choice](/commands/import/#printings-from-a-url-import) |

**Response:**

```json
{
  "success": true,
  "message": "Successfully imported 'My Deck'",
  "deckName": "My Deck",
  "syncPrintings": true,
  "warnings": [],
  "advisories": []
}
```

`warnings` lists any text lines the parser skipped — content that was **not** imported (always empty for URL imports). `advisories` lists content that **was** read but is worth a word — a card name still carrying a printing token, a skipped MTG Arena `About` line, or an empty `## Maybeboard`/`## Tokens` header the write drops. When either array is non-empty, `message` notes the count, so the admin UI's status alert shows it.

Pasted/uploaded text is read with the same dialects as [`ritual import`](/commands/import/#mtg-arena--mtgo-exports): Ritual's own format plus MTG Arena/MTGO/Moxfield exports (`4 Lightning Bolt (M10) 146`, bare `Deck`/`Sideboard` markers, and a `*F*`/`*E*` finish marker either trailing or between the set and the collector number).

A name/ID conflict without `overwrite` and a deck name with no characters usable in a file name are both the client's to fix: they fail with a `400` (the same usage classification the CLI turns into exit code `2`), not a `500`.

### `POST /api/import-csv`

**Auth required:** Yes

Import cards from CSV text into a deck, collection, or wanted list — creating, overwriting, or appending. See the [admin API reference](/admin/api/#import-csv) for the full request/response specification.

### `POST /api/import-changes`

**Auth required:** Yes

Apply an exported change bundle to the underlying lists. See the [admin API reference](/admin/api/#import-changes) for the full request/response specification.

### `POST /api/build-site`

**Auth required:** Yes

Trigger a full static site build. This is equivalent to running `ritual build-site`. May take several minutes.

The build runs as a child process and is awaited asynchronously, so it does not block the admin server for its duration. It builds into a scratch directory and swaps that into `dist/` only once it finishes, so an interrupted or failed build never leaves a broken published site — `dist/` holds either the previous build or the new one. (Every build takes this care now, including [`ritual build-site`](/commands/build-site/#the-output-directory-is-replaced-never-half-written) on the command line; the two share one implementation.) A second concurrent build is refused with `503`, a failed build answers `500` with the child's stderr tail, and a build cancelled by its caller (only an in-process caller such as the [MCP `build_site` tool](/commands/mcp/) can cancel one) answers `499` with `dist/` untouched. A cancelled or killed build can leave a [`.dist-build-*` scratch directory](/commands/build-site/#scratch-directories-beside-the-output) beside `dist/`; it is inert, and a later build sweeps it.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "Site built successfully",
  "outDir": "/home/user/ritual/dist",
  "durationMs": 42000
}
```

### `GET /api/build-site/stream`

**Auth required:** Yes

The same build as `POST /api/build-site`, streamed via Server-Sent Events: one `progress` frame per structural step (`{ kind: "step", progress, total, message }`, on a 0–3 scale) and per line of the child's output (`{ kind: "output", line }`), then a single `done` (`{ message, outDir, durationMs }`) or `error` (`{ message }`). Closing the stream does not cancel the build. See the [admin API reference](/admin/api/#build-site-stream) for the full specification.

### `POST /api/cache/refresh`

**Auth required:** Yes

Download and cache all Scryfall card data — the Scryfall half of `ritual cache preload-all`, without the [buylist](/commands/sell/) refresh that command also runs under sell mode (that is [`POST /api/sell/refresh`](/admin/api/#sell-refresh)). Returns a JSON response when complete. A refresh that fails answers a non-2xx with the failure's message rather than reporting success. A refresh cancelled by its caller (only an in-process caller such as the MCP `refresh_cache` tool can cancel one) answers `499`: the download stops, nothing is written, the previous cache is left exactly as it was, and the cache lock is released.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "Cache refreshed successfully"
}
```

### `GET /api/cache/refresh/stream`

**Auth required:** Yes

Stream cache refresh progress via Server-Sent Events (SSE). The UI uses this endpoint to show a real-time progress bar.

**Response:** `text/event-stream` with the following event types:

| Event      | Data Fields                       | Description                    |
| ---------- | --------------------------------- | ------------------------------ |
| `progress` | `stage`, `percentage?`, `message` | Progress update during refresh |
| `done`     | `message`                         | Refresh completed successfully |
| `error`    | `message`                         | Refresh failed                 |

**Stage values:** `metadata`, `tags`, `download`, `save`, `done`, `info` (parsing/processing happen inline while the gzipped-JSONL bulk streams, so `download` covers them). The stages come from the refresh engine itself rather than being scraped from log lines, so the `percentage` on a `download` event is present whenever the compressed download size is known.

**Example event stream:**

```
event: progress
data: {"stage":"download","percentage":45,"message":"Downloading: 45% (32.50/72.50 MiB)"}

event: progress
data: {"stage":"save","message":"Saving to cache..."}

event: done
data: {"message":"Cache refreshed successfully"}
```

### `GET /api/cache/status`

**Auth required:** Yes

Report the local card cache's state — size, last bulk refresh, price age and staleness, tag coverage, and whether reads come from the on-disk cache or a configured cache server. The payload is the same one `ritual cache status --output json` prints, wrapped in the success envelope. Read-only: asking never refreshes or writes. See the [admin API reference](/admin/api/#cache-status) for the full response specification.

### `POST /api/login/archidekt`

**Auth required:** Yes

Login to Archidekt. Credentials are sent to the server which authenticates with the Archidekt API and stores the session token locally.

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

### `GET /api/login/archidekt`

**Auth required:** Yes

Report the status of the stored Archidekt login, including how long the access and refresh tokens remain valid. Expirations are derived from the tokens' JWT `exp` claims. When neither token is valid, `loginRequired` is `true` and the user must sign in again.

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

### `POST /api/totp/setup`

**Auth required:** Yes

Generate a new TOTP secret for two-factor authentication. The secret is stored in a pending state until verified.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "secret": "JBSWY3DPEHPK3PXP",
  "uri": "otpauth://totp/Ritual:admin?secret=JBSWY3DPEHPK3PXP&issuer=Ritual&algorithm=SHA1&digits=6&period=30"
}
```

### `POST /api/totp/verify-setup`

**Auth required:** Yes

Verify a TOTP code to activate the pending secret. This must be called after `/api/totp/setup` to confirm the user has successfully configured their authenticator app.

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

### `POST /api/totp/disable`

**Auth required:** Yes

Disable TOTP two-factor authentication.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "TOTP disabled"
}
```

### `GET /api/totp/status`

**Auth required:** Yes

Check whether TOTP is enabled for the admin account.

**Response:**

```json
{
  "enabled": true
}
```

### `GET /api/config`

**Auth required:** Yes

Returns the current application configuration.

**Response:**

```json
{
  "success": true,
  "config": {
    "decksDir": "./decks",
    "collectionsDir": "./collections",
    "wantedDir": "./wanted",
    "defaultCurrency": "usd",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
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

`config` is the **stored** configuration. When this server was started with a session flag that
displaces one of those values — today that means [`--sell-mode`](#sell-mode) — the response also
carries an `overrides` object saying what the running process is actually operating with, keyed by
the config path each override displaces:

```json
{
  "success": true,
  "config": { "site": {} },
  "overrides": { "site.sellMode": true }
}
```

The flag writes nothing, so `config.site.sellMode` keeps reporting the stored value (usually unset)
while the server's sell routes answer anyway. The key is **absent entirely** when no override is in
force — no `overrides` means the stored config is what this server runs with. It is a
process-local fact, which is why `ritual config get` has no equivalent, and why `PUT /api/config`
never returns it: a write echoes back what it persisted.

### `PUT /api/config`

**Auth required:** Yes

Update the application configuration. Partial updates are supported — only the fields you include will be changed. The nested `admin` object is merged field-by-field, so you can send just the admin settings you want to change.

Every key in the request body is validated **before** the merge is persisted — a malformed update is rejected with a `400`, never written to disk and silently dropped on the next config load. Specifically:

- Unknown top-level keys are rejected with a `400` (`Unknown config key "x"`).
- Unknown keys inside `admin` are rejected with a `400` (`Unknown admin config key "x"`), matching `config set admin.<field>`.
- When `admin` or `site` is present, its fields are validated field-by-field (the same rules the config loader applies), and any malformed field rejects the whole update with a `400`.

`collectionSync` replaces wholesale like `site` rather than merging like `admin`: its fields are validated (`pullTarget` must be a non-empty list name) and any absent field takes its default, so a partial object round-trips to a complete one and a malformed value rejects the whole update with a `400`.

`defaultCurrency`, `priceSources` (store names only — lowercased and deduped, unknown stores rejected), `defaultLanguage` (canonical Scryfall codes only — no aliases on the API), `uiLocale` (a BCP-47 tag naming the interface language — not the card language; see [Localization](/localization/)), `cacheLockTimeoutSeconds`, `cacheSource`, `cacheFeedUrl`, and `searchDebounceMs` are validated the same way as [`config set`](/commands/config/) and rejected with a `400` when malformed. `cacheFeedUrl` has one extra rule: sending it as an **empty string** explicitly clears a previously-set override (falling back to the built-in default) — omitting the field entirely, by contrast, leaves the current value untouched.

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
    "defaultCurrency": "usd",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
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

## Examples

Start the admin on the default port:

```bash
ritual admin
```

Start on a custom port:

```bash
ritual admin --port 9090
```

Bind to localhost only:

```bash
ritual admin --host 127.0.0.1
```
