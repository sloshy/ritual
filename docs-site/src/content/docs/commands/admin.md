---
title: 'admin'
---

Start the web [admin site](/admin/) for managing Ritual from a browser.

This page covers the server itself: starting it, creating and recovering the admin account, its security options, and how it relates to the config file. What you can do once signed in is documented in the [Admin Site](/admin/) section.

## Usage

```bash
ritual admin [options]
ritual admin setup --username <username> [--password-stdin]
ritual admin reset-password [--username <username>] [--password-stdin]
ritual admin disable-totp
```

Run bare, `ritual admin` starts the web admin server. The `setup`, `reset-password`, and `disable-totp` subcommands manage the admin account headlessly, without starting a server. See [Account Recovery](#account-recovery).

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

On startup, `admin` runs the standard [card-ID backfill](/cli-conventions/#the-card-id-backfill), persisting any missing `&N` card IDs into the list files, since the editors rely on them. It then checks whether the Scryfall card cache is missing or stale and prompts to refresh it. **When [sell mode](#sell-mode) is on**, it also redownloads the [Card Kingdom buylist](/commands/sell/) if it is more than a day old (Card Kingdom regenerates it daily, and the quote routes themselves never download). Startup only _updates_ a buylist: a workspace that has never downloaded one is left alone, with no prompt, and `--refresh no-bulk`/`never` skip it entirely. A failed download leaves the older feed in place with a warning rather than failing startup.

Pass `--refresh auto` (or `no-bulk` / `never`) to answer the cache prompt non-interactively. An explicit mode is required when running under `bun run dev admin` (see [Development → Dev Workflow](/development/#dev-workflow)). Under the default `--refresh ask`, a run where prompts are unavailable (stdin is not a TTY, or the global `--no-input` flag is in force) skips the refresh instead of prompting.

## Sell mode

[Sell mode](/public-site/sell/) (Card Kingdom buy prices in the editors, the buylist filters and groupings, and the sell-cart export) is **off unless you ask for it**, on the admin site exactly as on a published one. Turn it on for the workspace with [`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), or for one run:

```bash
ritual admin --sell-mode
```

With sell mode **off**, and [`priceSources`](/configuration/#price-stores-pricesources) not naming `cardkingdom` (which wants the same feed), the admin server:

- skips the startup buylist refresh entirely (no ~70 MB download for a capability this workspace has not asked for);
- answers `404` on `/api/sell/report`, `/api/sell/cart`, `/api/sell/refresh`, `/api/buylist/status`, and `/api/buylist/quotes`. These are read per request, so a `config set` takes effect without a restart;
- hides the surfaces that call them: the editors' **Sell mode** toggle and buyer selector (see [Editors](/admin/editors/)), the **Refresh buylist** card on the [Refresh Cache](/admin/dashboard/#refresh-cache) page, and the sell controls on all three panes of [Move Cards](/admin/move-cards/).

The admin UI learns this from [`GET /api/status`](/admin/api/#server-status), which reports the **effective** value, so `--sell-mode` shows the surfaces even with nothing in the config file.

The [Settings](/admin/dashboard/#settings) page carries an **Offer sell mode** checkbox for `site.sellMode` and **Price Stores** checkboxes for [`priceSources`](/configuration/#price-stores-pricesources), so the key can be set from the browser as well as from the CLI. Checking it stores `site.sellMode: true`. Unchecking removes the key entirely, so `config get site.sellMode` reports it unset again, rather than an explicit `false` that means the same as the default.

Both sides pick the change up **immediately, without a reload or a restart**. The routes re-read the config per request, and the save re-reads `GET /api/status`, so the editors' sell toggle, the [Move Cards](/admin/move-cards/) sell controls and the [Refresh Cache](/admin/dashboard/#refresh-cache) page's buylist card appear or disappear on the spot. If that status read fails (the server went away between the save and the re-read), the surfaces keep their previous state rather than guessing. The save itself still landed, so reload to resynchronize. A server started with `--sell-mode` keeps offering sell mode whatever the checkbox says, since the flag is a session override that wins over the stored key, so unchecking it there stores the change without hiding anything until the next run.

Bear in mind what the checkbox commits to: every later site build and cache refresh downloads and indexes Card Kingdom's ~70 MB buylist.

[`ritual sell`](/commands/sell/) is unaffected. Running it is itself the request for Card Kingdom prices, so it works whatever sell mode says.

## Embedded MCP Server

Passing `--mcp` starts an [MCP](/commands/mcp/) (Model Context Protocol) endpoint in the **same process** as the web admin, on a separate port (`--mcp-port`, default `8765`). Both `--port` and `--mcp-port` are validated at parse time (1–65535), and `--mcp-port` must differ from `--port`. Violating either exits with code 2 before the server starts:

```bash
ritual admin --mcp --mcp-token "$MCP_TOKEN"
#   http://<host>:8080/        web admin
#   http://<host>:8765/mcp     MCP (Streamable HTTP)
```

This is one process, not a second `ritual mcp` instance, so it shares the same config, card cache, and data directory. Authentication uses the **same bearer-token model as the standalone server**. A token is **required**: pass `--mcp-token <secret>` or set the `RITUAL_MCP_TOKEN` environment variable. The admin binds `0.0.0.0` by default, so an unauthenticated MCP endpoint would be exposed. Every MCP request must then send `Authorization: Bearer <token>`, and requests without it get `401`. The token is independent of the browser admin login.

The endpoint is stateless and serves both the 2026-07-28 and the 2025-era protocol. See [`ritual mcp` → HTTP](/commands/mcp/#http-streamable-http) for what that means for sessions, `GET`/`DELETE`, and error responses.

Both listeners stop cleanly on `Ctrl-C` (`SIGINT`) or `SIGTERM`. The admin server and the embedded MCP endpoint are shut down together, so neither port is left bound.

The standalone [`ritual mcp`](/commands/mcp/) command is still the way to run MCP without the web admin (over stdio, or HTTP with a bearer token).

## First-Time Setup

When you first start the admin interface, open the displayed URL in your browser. You will be prompted to create an admin account:

- **Username**: any username of your choice
- **Password**: must be 8–128 characters

Credentials are hashed with bcrypt and stored in `.logins/admin-auth.json`. Later visits require signing in with these credentials via HTTP Basic Auth.

The account can also be created ahead of time from the terminal with `ritual admin setup`. See [Account Recovery](#account-recovery).

## Account Recovery

Three subcommands manage the admin account **headlessly**. They read and write `.logins/admin-auth.json` directly, without starting (or requiring) a running admin server. They exist for scripted provisioning and for recovering access when you are locked out. All three support the standard scripting options (`--output text|json|ndjson`, `--quiet`) and append an entry to the audit log (`.logins/admin-audit.log`).

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

Everything else in the credentials file, most importantly a TOTP secret (including a pending enrollment), is preserved verbatim. Fails with exit code `3` when no admin user exists yet (run `ritual admin setup` instead).

### `ritual admin disable-totp`

Remove the TOTP secret from the account so login only needs the password again:

```bash
ritual admin disable-totp --output json
# → { "totpDisabled": true }
```

This clears **both** an active TOTP secret and a stuck `pending:` enrollment. An enrollment you started in the browser but never verified is exactly the kind of lockout this command recovers from. Fails with exit code `1` when no TOTP secret is stored, and `3` when no admin user exists.

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
Live browser sessions are held **in memory inside the running admin server process**. Recovering credentials on disk does not invalidate or refresh them. After any credential recovery, **restart the admin server** so stale sessions are dropped and logins are checked against the new credentials.
:::

## Configuration File

Settings are stored in `ritual.config.json` in the base directory. The file is shared by the entire app; see [Configuration](/configuration/) for the full reference and how it interacts with `--base-dir`. It is created the first time something writes a setting (a **Settings** page save, `config set`, `init-site`). Until then the [defaults](/configuration/#default-settings) apply with no file on disk.

All admin-server settings live under the nested `admin` key. Set them from the **Settings** page, with [`config set admin.<field>`](/commands/config/), or by hand.

## Git Integration

When git integration is enabled in settings:

1. The admin checks if the target directory (decks, collections, or config) is inside a git repository
2. After file-modifying operations (editing decks or collections, importing decks, updating config), changed files are automatically staged and committed
3. Commit messages describe the action performed (for example, "Save 3 changes to burn.md")

Enable this feature in the Settings page by checking both **Enable Git integration** and **Auto-commit changes**.

Auto-commit covers the admin web UI and the [MCP server](/commands/mcp/) only. CLI commands never auto-commit. See [Git integration](/configuration/#git-integration) for the keys and the `import-changes` exception.

## Security

### Network options

`admin.trustProxy` makes the server take the client address from the last `X-Forwarded-For` entry, the one a reverse proxy appends, instead of the connection's own address. Turn it on only behind a proxy you control. `admin.secureCookies` marks the session cookie `Secure`, so browsers send it over HTTPS only.

### Failed Login Delay

Every failed authentication attempt incurs a configurable delay (default: 3 seconds) before the server responds. The delay does not slow other requests.

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

TOTP (Time-based One-Time Password) adds a second factor to authentication. When enabled, login requires both your password and a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, and the like).

**Setup:**

1. Go to Settings → Two-Factor Authentication
2. Click "Set Up TOTP". The server generates a secret key
3. Add the secret to your authenticator app (manual entry or use the `otpauth://` URI with a QR code generator)
4. Enter the current 6-digit code to verify and activate TOTP

**Login with TOTP:**
When TOTP is enabled, the login form shows an additional code field. For API access, include the `totpCode` field in the `POST /api/login` request body.

The TOTP secret is stored in `.logins/admin-auth.json` alongside the password hash.

### IP Allow/Deny Lists

Control which IP addresses can access the admin interface:

- **Allow list**: if non-empty, only IPs matching a pattern can connect. All others are blocked with `403 Forbidden`.
- **Deny list**: IPs matching any pattern are blocked. Deny is checked before allow.

Patterns support simple wildcards: `192.168.1.*`, `10.0.*`, `*` (match all).

### User-Agent Allow/Deny Lists

Control which browsers/clients can access the admin interface:

- **Allow list**: if non-empty, only matching User-Agent strings can connect.
- **Deny list**: matching User-Agent strings are blocked.

Patterns support wildcards: `*bot*` (blocks common bots), `Mozilla*` (allows browsers).

## HTTP API

Every admin page is backed by an HTTP route under `/api/`, and the same routes serve the [MCP server](/commands/mcp/) and any client you write. They are documented on the [Admin API](/admin/api/) page.

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
