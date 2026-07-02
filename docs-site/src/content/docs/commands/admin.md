---
title: 'admin'
---

Start the web admin interface for managing Ritual from a browser.

## Usage

```bash
ritual admin [options]
```

## Options

| Option                 | Description                                                                                                                                                                                    | Default   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>`  | Port to serve on                                                                                                                                                                               | `8080`    |
| `--host <address>`     | Host address to bind to                                                                                                                                                                        | `0.0.0.0` |
| `--theme <name>`       | Initial theme served by the admin. Append `-inverted` (e.g. `boros-inverted`) for the inverted variant. See [`build-site` themes](/commands/build-site/#themes) for the full list of palettes. | `default` |
| `--allow-refresh`      | Refresh the card cache on startup without asking (bulk download)                                                                                                                               |           |
| `--no-refresh`         | Skip the card cache refresh on startup; use cached data as-is                                                                                                                                  |           |
| `--mcp`                | Also serve an [MCP](/commands/mcp/) endpoint in this same process (requires `--mcp-token`)                                                                                                     |           |
| `--mcp-port <number>`  | Port for the embedded MCP server (only with `--mcp`)                                                                                                                                           | `8765`    |
| `--mcp-token <secret>` | Bearer token required on the embedded MCP endpoint (with `--mcp`)                                                                                                                              |           |

On startup, `admin` checks whether the Scryfall card cache is missing or stale and prompts to refresh it. Pass `--allow-refresh` or `--no-refresh` to answer that prompt non-interactively — this is required when running under `bun run dev admin` (see [Development → Dev Workflow](/development/#dev-workflow)). (`--allow-refresh-no-bulk` is also accepted for parity with `serve-site`; since the admin cache is only populated by bulk download, it behaves the same as `--no-refresh` here.)

## Embedded MCP Server

Passing `--mcp` starts an [MCP](/commands/mcp/) (Model Context Protocol) endpoint in the **same process** as the web admin, on a separate port (`--mcp-port`, default `8765`):

```bash
ritual admin --mcp --mcp-token "$MCP_TOKEN"
#   http://<host>:8080/        web admin
#   http://<host>:8765/mcp     MCP (Streamable HTTP)
```

This is one process — not a second `ritual mcp` instance — so it shares the same config, card cache, and data directory. Authentication uses the **same bearer-token model as the standalone server**: a token is **required** — pass `--mcp-token <secret>` or set the `RITUAL_MCP_TOKEN` environment variable (the admin binds `0.0.0.0` by default, so an unauthenticated MCP endpoint would be exposed). Every MCP request must then send `Authorization: Bearer <token>`; requests without it get `401`. The token is independent of the browser admin login.

The standalone [`ritual mcp`](/commands/mcp/) command is still the way to run MCP without the web admin (over stdio, or HTTP with a bearer token).

## First-Time Setup

When you first start the admin interface, navigate to the displayed URL in your browser. You will be prompted to create an admin account:

- **Username**: any username of your choice
- **Password**: must be at least 4 characters (no other restrictions)

Credentials are hashed with bcrypt and stored in `.logins/admin-auth.json`. Subsequent visits require signing in with these credentials via HTTP Basic Auth.

## Available Actions

The admin dashboard provides a web interface for the following operations:

### Import Deck

Import a deck three ways, selected with a segmented control:

- **URL** — fetch from Archidekt, Moxfield, or MTGGoldfish.
- **Upload File** — choose a decklist or exported deck file (markdown or plain text); it is read in the browser and parsed server-side.
- **Paste Text** — paste a decklist directly (`QTY Name` per line, `## Heading` lines start new sections).

For upload and paste, an optional **Deck Name** is used unless the text defines its own `name:` in frontmatter. Optionally overwrite an existing deck on conflict.

### Import CSV

Import cards from a CSV export (Moxfield, Deckbox, ManaBox, ...) into a deck, collection, or wanted list — either **creating a new list** or **appending to an existing one**. Upload a file or paste CSV text; the page parses it in the browser, guesses whether the first row is a header, and pre-selects which column holds each card field (name, set, collector number, condition, finish, section, quantity) for you to confirm. Values are normalized on import (e.g. `Near Mint` → `NM`, `F` → foil, `side` → `Sideboard`) exactly like the [`import-csv`](/commands/import-csv/) CLI command, which shares the same engine.

When creating, an **Overwrite if a list with this name exists** checkbox replaces an existing list of the same name; in **Append to Existing** mode the target is picked from a dropdown of the existing lists of the selected type. Appends record every added card in the list's changelog. Rows that fail validation are listed with their line numbers; the valid rows still import.

### Import Changes

The deck, collection, and wanted-list editors each have an **Import…** button that accepts a change-list JSON exported from the public site's [in-browser editor](/commands/build-site/#editing-on-the-public-site). Upload the file or paste its contents; the editor validates it (rejecting a file whose list kind doesn't match), then loads its changes as **pending edits** rather than applying them immediately:

- Each change is **re-targeted** to the current list's card IDs — added cards get fresh IDs, and other changes match by ID when it still exists, otherwise by card name.
- Changes whose target can no longer be found are reported as conflicts and skipped, with a count shown after import.
- The loaded changes appear in the editor for you to review and then **Save Changes** as a normal edit (recorded in the changelog).

### Moving Cards While Editing

While editing a deck, collection, or wanted list you can move a card into another list without leaving the editor (this is separate from the dedicated **Move Cards** batch tool). A single **Move to list…** item appears in three places:

- the per-card **⋯** context menu (moves that card),
- the per-list **Selected** menu (moves the current multi-selection), and
- the cross-list **All Selected** navbar menu (moves every selected card from its own list).

Choosing **Move to list…** opens a small picker listing your other decks, collections, and wanted lists; pick one to set the destination. (The picker replaces the older layout that listed every destination as its own menu entry.)

For the per-card and per-list **Selected** moves, choosing a destination removes the card from the list you're editing and **stages** a move. **When you Save, both lists are written**: the card is removed from the source (with a "Move … to …" changelog entry) and added to the destination (with a matching "Move … from …" entry). Moving a printing-less card into a collection — which requires a specific printing — opens a printing picker first.

The cross-list **All Selected** move does not go through the editor's Save button: it is applied **immediately** and atomically across every affected file via `POST /api/move/selected` (each card moves from its own list to the chosen destination).

### Build Site

Trigger a full static site build from the browser. This runs the same process as `ritual build-site`.

### Refresh Cache

Download and cache all Scryfall card data. Equivalent to `ritual cache preload-all`.

The Refresh Cache page shows real-time progress during the operation:

- **Progress bar** with download percentage and MiB counter
- **Stage indicators** tracking each phase: Downloading → Parsing → Processing → Saving
- Falls back gracefully if streaming is unavailable

### Archidekt Login

Sign in to your Archidekt account through the web interface. Credentials are sent to the Ritual server, which handles authentication server-side.

The page also shows the status of the stored login:

- **Current login (access token)**: how long the active session token remains valid. When it expires it is refreshed automatically.
- **Refresh token**: how long the longer-lived refresh token remains valid. Once it expires too, a fresh login is required.

When both the access token and refresh token have expired, the page reports that a login is required to use Archidekt account features.

### Settings

Configure admin settings including:

- **Decks Directory**: path to the decks folder (default: `./decks`)
- **Collections Directory**: path to the collections folder (default: `./collections`)
- **Default Price Currency**: the currency price-touching surfaces default to (default: `usd`; see [Configuration](/configuration/#default-currency))
- **Git Integration**: enable/disable git auto-commit
- **Two-Factor Authentication (TOTP)**: set up or disable TOTP 2FA
- **Rate Limiting**: configure failed login attempt limits and lockout duration
- **IP Filtering**: allow/deny lists for IP addresses
- **User-Agent Filtering**: allow/deny lists for browser user agents

### Audit Log

View a chronological log of all login attempts, including timestamp, IP address, username, success/failure status, and user agent. Useful for monitoring unauthorized access attempts.

## Configuration File

Settings are stored in `ritual.config.json` in the base directory. The file is shared by the entire app — see [Configuration](/configuration/) for the full reference and how it interacts with `--base-dir`.

```json
{
  "decksDir": "./decks",
  "collectionsDir": "./collections",
  "wantedDir": "./wanted",
  "defaultCurrency": "usd",
  "admin": {
    "gitEnabled": false,
    "gitAutoCommit": false,
    "gitAutoPush": false,
    "ipAllowList": [],
    "ipDenyList": [],
    "userAgentAllowList": [],
    "userAgentDenyList": [],
    "rateLimitEnabled": true,
    "rateLimitMaxAttempts": 5,
    "rateLimitWindowMinutes": 5,
    "failedAuthDelayMs": 3000
  }
}
```

All admin-server settings live under the nested `admin` key. Set them from the **Settings** page, with [`config-set admin.<field>`](/commands/config-set/), or by hand.

## Git Integration

When git integration is enabled in settings:

1. The admin checks if the target directory (decks, collections, or config) is inside a git repository
2. After file-modifying operations (editing decks or collections, importing decks, updating config), changed files are automatically staged and committed
3. Commit messages describe the action performed (e.g., "Save 3 changes to burn.md")

Enable this feature in the Settings page by checking both **Enable Git integration** and **Auto-commit changes**.

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

Returns server health and whether first-time setup is needed.

**Response:**

```json
{
  "ok": true,
  "setupRequired": false,
  "totpEnabled": true
}
```

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

Move a batch of selected cards across lists atomically — the server side of the cross-list **All Selected → Move all to list…** action. Each item identifies a card by its source list and identity and names a destination list (by `toType` + `toName`); optional `set`/`collectorNumber`/`finish`/`condition` pin a resolved printing (required when moving a printing-less card into a collection).

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
      "toName": "Binder",
      "set": "lea",
      "collectorNumber": "161"
    }
  ]
}
```

**Response:** `{ "success": true, "moved": 1, "requested": 1, "skipped": 0, "message": "Moved 1 card." }`. Cards whose source or destination can no longer be resolved (or whose destination is their own list) are skipped and counted.

### `POST /api/search-cards`

**Auth required:** Yes

Search for cards by name using the Scryfall API. Returns up to 20 results.

**Request body:**

```json
{
  "query": "Lightning Bolt"
}
```

**Response:**

```json
{
  "success": true,
  "cards": [{ "name": "Lightning Bolt" }, { "name": "Lightning Bolt (Textless)" }]
}
```

### `POST /api/import-deck`

**Auth required:** Yes

Import a deck from a supported URL, or from decklist text supplied directly (pasted in the UI or read from an uploaded file). The request is one of two shapes, distinguished by `mode`.

**Request body (URL):**

```json
{
  "mode": "url",
  "url": "https://archidekt.com/decks/123456",
  "overwrite": false
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

| Field       | Type    | Required         | Default | Description                                                            |
| ----------- | ------- | ---------------- | ------- | ---------------------------------------------------------------------- |
| `mode`      | string  | Yes              | —       | `"url"` or `"text"`                                                    |
| `url`       | string  | When `url` mode  | —       | Archidekt, Moxfield, or MTGGoldfish URL                                |
| `content`   | string  | When `text` mode | —       | Decklist text (`QTY Name` per line; `## Heading` lines start sections) |
| `name`      | string  | No               | —       | Deck name for `text` mode; ignored if the text defines its own `name:` |
| `overwrite` | boolean | No               | `false` | Overwrite existing deck on conflict                                    |

**Response:**

```json
{
  "success": true,
  "message": "Successfully imported 'My Deck'",
  "deckName": "My Deck"
}
```

### `POST /api/import-csv`

**Auth required:** Yes

Import cards from CSV text into a deck, collection, or wanted list — creating, overwriting, or appending. See the [admin API reference](/admin/api/#import-csv) for the full request/response specification.

### `POST /api/build-site`

**Auth required:** Yes

Trigger a full static site build. This is equivalent to running `ritual build-site`. May take several minutes.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "Site built successfully"
}
```

### `POST /api/cache/refresh`

**Auth required:** Yes

Download and cache all Scryfall card data. Equivalent to `ritual cache preload-all`. Returns a JSON response when complete.

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

**Stage values:** `download`, `parse`, `process`, `save`, `done`, `info`

**Example event stream:**

```
event: progress
data: {"stage":"download","percentage":45,"message":"Downloading: 45% (112.50/250.45 MiB)"}

event: progress
data: {"stage":"parse","message":"Parsing JSON..."}

event: done
data: {"message":"Cache refreshed successfully"}
```

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
    "admin": {
      "gitEnabled": false,
      "gitAutoCommit": false,
      "gitAutoPush": false,
      "ipAllowList": [],
      "ipDenyList": [],
      "userAgentAllowList": [],
      "userAgentDenyList": [],
      "rateLimitEnabled": true,
      "rateLimitMaxAttempts": 5,
      "rateLimitWindowMinutes": 5,
      "failedAuthDelayMs": 3000
    }
  }
}
```

### `PUT /api/config`

**Auth required:** Yes

Update the application configuration. Partial updates are supported — only the fields you include will be changed. The nested `admin` object is merged field-by-field, so you can send just the admin settings you want to change.

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
    "admin": {
      "gitEnabled": true,
      "gitAutoCommit": true,
      "gitAutoPush": false,
      "ipAllowList": [],
      "ipDenyList": [],
      "userAgentAllowList": [],
      "userAgentDenyList": [],
      "rateLimitEnabled": true,
      "rateLimitMaxAttempts": 5,
      "rateLimitWindowMinutes": 5,
      "failedAuthDelayMs": 3000
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
