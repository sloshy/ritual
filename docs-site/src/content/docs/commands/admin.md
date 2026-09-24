---
title: 'admin'
---

Start the web [admin site](/admin/) for managing Ritual from a browser.

This page covers the server: starting it, creating and recovering the admin account, its security options, and its config keys. What you can do once signed in is documented in the [Admin Site](/admin/) section.

## Usage

```bash
ritual admin [options]
ritual admin setup --username <username> [--password-stdin]
ritual admin reset-password [--username <username>] [--password-stdin]
ritual admin disable-totp
```

`ritual admin` starts the web admin server. The `setup`, `reset-password`, and `disable-totp` subcommands manage the admin account without starting a server. See [Account Recovery](#account-recovery).

## Options

| Option                 | Description                                                                                                                                                   | Default   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>`  | Port to serve on                                                                                                                                              | `8080`    |
| `--host <address>`     | Host address to bind to                                                                                                                                       | `0.0.0.0` |
| `--theme <name>`       | Initial theme. Append `-inverted` (e.g. `boros-inverted`) for the inverted variant. See [`build-site` themes](/commands/build-site/#themes) for the palettes. | `default` |
| `--refresh <mode>`     | Card cache **and buylist** refresh policy on startup: `ask` (prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never`                        | `ask`     |
| `--mcp`                | Also serve an [MCP](/commands/mcp/) endpoint in this process (requires `--mcp-token`)                                                                         |           |
| `--mcp-port <number>`  | Port for the embedded MCP server (only with `--mcp`)                                                                                                          | `8765`    |
| `--mcp-token <secret>` | Bearer token required on the embedded MCP endpoint (with `--mcp`)                                                                                             |           |
| `--sell-mode`          | Offer [sell mode](/public-site/sell/) for this run even when `site.sellMode` is off (enable-only). See [Sell mode](#sell-mode).                               |           |

On startup, `admin`:

1. Runs the [card-ID backfill](/cli-conventions/#the-card-id-backfill), writing any missing `&N` card IDs into the list files, since the editors rely on them.
2. Checks whether the Scryfall card cache is missing or stale and offers to refresh it.
3. When [sell mode](#sell-mode) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`, redownloads the [Card Kingdom buylist](/commands/sell/) if it is more than a day old. Startup only _updates_ a buylist: a workspace that has never downloaded one is left alone, with no prompt. A failed download keeps the older feed and warns instead of failing startup.

`--refresh auto`, `no-bulk`, or `never` answers the cache prompt non-interactively; `no-bulk`/`never` also skip the buylist refresh. Under the default `ask`, a run where prompts are unavailable (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)) skips the refresh. `bun run dev admin` requires an explicit mode (see [Development → Dev Workflow](/development/#dev-workflow)).

## Sell mode

[Sell mode](/public-site/sell/) adds Card Kingdom buy prices in the editors, buylist filters and groupings, and the sell-cart export. It is **off unless you ask for it**. Turn it on for the workspace with [`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), or for one run:

```bash
ritual admin --sell-mode
```

With sell mode **off**, and [`priceSources`](/configuration/#price-stores-pricesources) not naming `cardkingdom` (which uses the same feed), the admin server:

- skips the startup buylist refresh (no ~70 MB download);
- answers `404` on `/api/sell/report`, `/api/sell/cart`, `/api/sell/refresh`, `/api/buylist/status`, and `/api/buylist/quotes`. The setting is read per request, so a `config set` takes effect without a restart;
- hides the surfaces that call them: the editors' **Sell mode** toggle and buyer selector (see [Editors](/admin/editors/)), the **Refresh buylist** card on the [Refresh Cache](/admin/dashboard/#refresh-cache) page, and the sell controls on all three panes of [Move Cards](/admin/move-cards/).

The admin UI learns the **effective** value from [`GET /api/status`](/admin/api/#server-status), so `--sell-mode` shows the surfaces even with nothing in the config file.

The [Settings](/admin/dashboard/#settings) page has an **Offer sell mode** checkbox for `site.sellMode` and **Price Stores** checkboxes for [`priceSources`](/configuration/#price-stores-pricesources). Checking the box stores `site.sellMode: true`. Unchecking removes the key, so `config get site.sellMode` reports it unset rather than an explicit `false`.

The change applies **immediately, without a reload or restart**: the routes re-read the config per request, and the save re-reads `GET /api/status`, so the sell surfaces appear or disappear on the spot. If that status read fails (the server went away between the save and the re-read), the surfaces keep their previous state; the save still landed, so reload to resynchronize. A server started with `--sell-mode` keeps offering sell mode whatever the checkbox says, since the flag overrides the stored key for that run.

Checking the box commits every later site build and cache refresh to downloading and indexing Card Kingdom's ~70 MB buylist.

[`ritual sell`](/commands/sell/) is unaffected by sell mode. Running it is itself the request for Card Kingdom prices.

## Embedded MCP Server

`--mcp` starts an [MCP](/commands/mcp/) (Model Context Protocol) endpoint in the **same process** as the web admin, on a separate port (`--mcp-port`, default `8765`). Both `--port` and `--mcp-port` must be 1–65535, and `--mcp-port` must differ from `--port`; otherwise the command exits with code 2 before starting:

```bash
ritual admin --mcp --mcp-token "$MCP_TOKEN"
#   http://<host>:8080/        web admin
#   http://<host>:8765/mcp     MCP (Streamable HTTP)
```

This is one process, not a second `ritual mcp` instance, so it shares the same config, card cache, and data directory. Authentication uses the **same bearer-token model as the standalone server**. A token is **required** because the admin binds `0.0.0.0` by default: pass `--mcp-token <secret>` or set `RITUAL_MCP_TOKEN`. Every MCP request must send `Authorization: Bearer <token>`; requests without it get `401`. The token is independent of the browser admin login.

The endpoint is stateless and serves both the 2026-07-28 and the 2025-era protocol. See [`ritual mcp` → HTTP](/commands/mcp/#http-streamable-http) for what that means for sessions, `GET`/`DELETE`, and error responses.

Both listeners stop together on `Ctrl-C` (`SIGINT`) or `SIGTERM`, so neither port is left bound.

The standalone [`ritual mcp`](/commands/mcp/) command is still the way to run MCP without the web admin (over stdio, or HTTP with a bearer token).

## First-Time Setup

Open the displayed URL in your browser. You are prompted to create an admin account:

- **Username**: any username
- **Password**: 8–128 characters

Credentials are hashed with bcrypt and stored in `.logins/admin-auth.json`. Later visits sign in with these credentials via HTTP Basic Auth.

You can also create the account ahead of time from the terminal with `ritual admin setup`. See [Account Recovery](#account-recovery).

## Account Recovery

Three subcommands manage the admin account without a running server. They read and write `.logins/admin-auth.json` directly, for scripted provisioning and for recovering access when you are locked out. All three support the standard [scripting options](/cli-conventions/#scripting) (`--output text|json|ndjson`, `--quiet`) and append an entry to the audit log (`.logins/admin-audit.log`).

### `ritual admin setup`

Create the admin account before opening the browser:

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

Exit code `1` if an admin user already exists. Exit code `2` for validation problems (missing username, password too short or too long) or when a password prompt is needed but stdin is not a terminal.

### `ritual admin reset-password`

Replace the stored password (and optionally the username) of the existing account:

```bash
printf '%s\n' "$NEW_PASSWORD" | ritual admin reset-password --password-stdin
# Also replace the username:
printf '%s\n' "$NEW_PASSWORD" | ritual admin reset-password --username root --password-stdin
```

| Option                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `--username <username>` | Also replace the admin username (optional) |
| `--password-stdin`      | Read the new password from stdin           |

Everything else in the credentials file is kept, including a TOTP secret and any pending TOTP enrollment. Exit code `3` when no admin user exists yet (run `ritual admin setup` instead).

### `ritual admin disable-totp`

Remove the TOTP secret so login needs only the password again:

```bash
ritual admin disable-totp --output json
# → { "totpDisabled": true }
```

This clears **both** an active TOTP secret and a stuck `pending:` enrollment, such as one you started in the browser but never verified. Exit code `1` when no TOTP secret is stored, and `3` when no admin user exists.

### Recovery runbook

**Lost password** (with or without TOTP still working):

1. On the machine hosting Ritual, run `ritual admin reset-password` (interactive) or pipe the new password with `--password-stdin`.
2. Restart the admin server (see the caution below).
3. Sign in with the new password.

**Lost TOTP device** (or a broken half-finished TOTP enrollment):

1. Run `ritual admin disable-totp`.
2. Restart the admin server.
3. Sign in with username + password, then re-enroll TOTP from Settings → Two-Factor Authentication if desired.

**Lost everything**: delete `.logins/admin-auth.json` and run `ritual admin setup` (or open the browser for first-time setup) to start fresh.

:::caution
Browser sessions are held **in memory inside the running admin server**. Changing credentials on disk does not invalidate them. After any credential recovery, **restart the admin server** so stale sessions are dropped and logins are checked against the new credentials.
:::

## Configuration File

Settings are stored in `ritual.config.json` in the base directory. The file is shared by the whole app; see [Configuration](/configuration/) for the full reference and how it interacts with `--base-dir`. It is created the first time something writes a setting (a **Settings** page save, `config set`, `init-site`). Until then the [defaults](/configuration/#default-settings) apply.

Admin-server settings live under the `admin` key. Set them from the **Settings** page, with [`config set admin.<field>`](/commands/config/), or by hand.

## Git Integration

When git integration is enabled:

1. The admin checks whether the target directory (decks, collections, or config) is inside a git repository
2. After a file-modifying operation (editing decks or collections, importing decks, updating config), the changed files are staged and committed
3. Commit messages describe the action (for example, "Save 3 changes to burn.md")

Enable it on the Settings page by checking both **Enable Git integration** and **Auto-commit changes**.

Auto-commit covers the admin web UI and the [MCP server](/commands/mcp/) only. CLI commands never auto-commit. See [Git integration](/configuration/#git-integration) for the keys and the `import-changes` exception.

## Security

### Network options

`admin.trustProxy` makes the server take the client address from the last `X-Forwarded-For` entry, the one a reverse proxy appends, instead of the connection's own address. Turn it on only behind a proxy you control. `admin.secureCookies` marks the session cookie `Secure`, so browsers send it over HTTPS only.

### Failed Login Delay

Every failed authentication attempt is delayed (default: 3 seconds) before the server responds. The delay does not slow other requests.

### Rate Limiting

After a number of consecutive failed login attempts (default: 5) from one IP address, that IP is locked out for a set duration (default: 5 minutes). Rate limiting can be disabled in settings.

| Config Field                   | Default | Description                    |
| ------------------------------ | ------- | ------------------------------ |
| `admin.rateLimitEnabled`       | `true`  | Enable/disable rate limiting   |
| `admin.rateLimitMaxAttempts`   | `5`     | Failed attempts before lockout |
| `admin.rateLimitWindowMinutes` | `5`     | Lockout duration in minutes    |
| `admin.failedAuthDelayMs`      | `3000`  | Delay (ms) on failed auth      |

Rate limit state is kept in memory and resets when the server restarts.

### Two-Factor Authentication (TOTP)

TOTP (Time-based One-Time Password) adds a second factor. When enabled, login requires your password and a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, and the like).

**Setup:**

1. Go to Settings → Two-Factor Authentication
2. Click "Set Up TOTP". The server generates a secret key
3. Add the secret to your authenticator app (manual entry, or the `otpauth://` URI with a QR code generator)
4. Enter the current 6-digit code to verify and activate TOTP

**Login with TOTP:**
The login form shows an additional code field. For API access, include the `totpCode` field in the `POST /api/login` request body.

The TOTP secret is stored in `.logins/admin-auth.json` alongside the password hash.

### IP Allow/Deny Lists

Control which IP addresses can access the admin interface:

- **Allow list**: if non-empty, only IPs matching a pattern can connect. All others get `403 Forbidden`.
- **Deny list**: IPs matching any pattern are blocked. Deny is checked before allow.

Patterns support simple wildcards: `192.168.1.*`, `10.0.*`, `*` (match all).

### User-Agent Allow/Deny Lists

Control which browsers and clients can access the admin interface:

- **Allow list**: if non-empty, only matching User-Agent strings can connect.
- **Deny list**: matching User-Agent strings are blocked.

Patterns support wildcards: `*bot*` (blocks common bots), `Mozilla*` (allows browsers).

## HTTP API

Every admin page is backed by an HTTP route under `/api/`. The same routes serve the [MCP server](/commands/mcp/) and any client you write. See the [Admin API](/admin/api/) page.

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
