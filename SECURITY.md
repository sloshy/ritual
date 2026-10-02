# Security

## Reporting a vulnerability

Report security problems privately, not in a public issue. Use GitHub's **Report a
vulnerability** button on the repository's Security tab (private vulnerability
reporting). If that is unavailable, contact the maintainer at the address on the
project's commits. You should hear back within a week.

In scope: the `ritual` binary and Docker image, every server it starts (`serve`,
`admin`, `mcp`, `cache server`, `cache feed host`), the sites it builds, the install
scripts, and the workflows it generates. Out of scope: the third-party services Ritual
talks to (Scryfall, Card Kingdom, Archidekt, Moxfield, MTGGoldfish, GitHub).

Only the latest release is supported with fixes.

## Deployment assumptions

Ritual is a single-user tool that works on files in a directory you own. These are the
properties to know before you expose any of it to a network. The
[documentation](https://ritual.rpeters.dev) covers each in detail.

### Servers and where they listen

| Command                    | Default bind            | Authentication                                                                                           |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `serve`                    | `0.0.0.0:3000`          | None. Serves the built site's static files only.                                                         |
| `serve --api`              | `0.0.0.0:3000`          | None. Read-only API with CORS `*`; see below.                                                            |
| `admin`                    | `0.0.0.0:8080`          | Account login with a session cookie; see below.                                                          |
| `admin --mcp`              | admin's host, port 8765 | Bearer token, required.                                                                                  |
| `mcp --transport http`     | `127.0.0.1:8765`        | Bearer token. Without one, a non-loopback `--host` is refused unless you pass `--allow-unauthenticated`. |
| `mcp` (stdio, the default) | no socket               | Whoever launches the process.                                                                            |
| `cache server`             | `127.0.0.1:4000`        | **None, including its write routes.** Trusted networks only.                                             |
| `cache feed host`          | `127.0.0.1:4010`        | None. Read-only (GET/HEAD); seeding opens a BitTorrent listener.                                         |

- **`serve --api` has no write routes and no authentication.** It answers list data,
  card search, prices and buylist quotes to anyone who can reach it. Some routes read
  through to Scryfall when the cache lacks a card or a price is stale, so an anonymous
  caller can cause outbound Scryfall requests and cache writes. Request bodies are capped,
  and batch routes are capped (500 names or printings, 200 card IDs). There is no rate limiting; put a reverse proxy
  in front of a public deployment if you need it.
- **Never expose `cache server` to an untrusted network.** It can clear and replace cache
  sections without authentication. Bind it to loopback (its default) or a private
  network, and point `serve --api` or clients at it from there.
- **Every server that accepts a request body caps it** (Bun's `maxRequestBodySize` plus a streaming byte
  count) except `cache server`, whose bulk-upload routes are meant for trusted peers.

### The admin site

- **The first account needs a one-time setup token.** `ritual admin` prints a setup URL
  carrying a random 144-bit token to its own console; without it, `POST /api/setup`
  refuses. `RITUAL_ADMIN_SETUP_TOKEN` pins the token, and `ritual admin setup` creates the
  account from the terminal instead.
- **Passwords are hashed with bcrypt** (cost 10). Optional TOTP second factor, with replay
  protection.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Strict` cookie,
  held in memory for 24 hours (a restart logs everyone out). Set `admin.secureCookies`
  when the admin is served over HTTPS so the cookie is also `Secure`.
- **Cross-site requests** are refused by the `SameSite=Strict` cookie; there is no
  separate CSRF token. Responses carry a `default-src 'self'` Content Security Policy and
  `X-Frame-Options: DENY`.
- **Failed logins** are delayed, rate-limited per IP (5 failures within 5 minutes locks
  the address for 5 minutes by default), and recorded in `.logins/admin-audit.log`.
  Behind a reverse proxy, set `admin.trustProxy` so the limit applies to the client
  rather than the proxy, and only then.
- **IP and User-Agent allow and deny lists** (`admin.ipAllowList` and the like) apply
  before any route.
- **Bind the admin to loopback** (`--host 127.0.0.1`) unless you need it on the network,
  and put HTTPS in front of it when you do.
- **Git integration is off by default.** With `admin.gitAutoCommit`, saves commit only the
  files they touched, through `git` called with an argument list, never a shell.

### The MCP server

- The token comes from `--token` / `--mcp-token` or `RITUAL_MCP_TOKEN` (the environment
  variable keeps it out of the process list), and is compared in constant time.
- On a loopback bind, the HTTP transport also checks the `Host` and `Origin` headers
  against DNS rebinding. On any other bind, the token is the only check.
- **A connected client can do anything the admin site can,** including deleting lists,
  rewriting history and changing `ritual.config.json` (the admin's allow lists among
  it). Treat the token like the admin password.

### Credentials on disk

`.logins/` in the workspace holds plaintext JSON files, each written with mode `0600` in
a directory created `0700`:

- `admin-auth.json`: the admin username, bcrypt password hash, and TOTP secret.
- `admin-audit.log`: login attempts with IP and User-Agent.
- `archidekt.json`: your Archidekt access and refresh tokens. Your Archidekt password is
  sent to Archidekt to log in and never stored.
- `collection-sync.json`: the last collection sync's time and Archidekt user.

Anyone who can read the workspace can read these, so keep `.logins/` out of version
control. `ritual init-site` writes a `.gitignore` that excludes it; if you version a
workspace without running it, add `.logins/` yourself.

### What Ritual sends where

Ritual has **no telemetry or analytics**. It contacts other services only to do what you
asked, identifying itself as `Ritual/<version>`:

- **Scryfall**: bulk card data, symbols, and lookups for cards the cache lacks, paced
  between requests. A site Ritual builds also calls Scryfall from the visitor's browser
  for card search and images.
- **Card Kingdom**: its public price list, when Card Kingdom prices or sell mode are on.
- **Archidekt, Moxfield, MTGGoldfish**: when you import from or sync with them.
- **GitHub**: the releases API for `self-update` and, at most once a day, the update
  notice. Turn the notice off with the `updateCheck: false` config key or
  `RITUAL_NO_UPDATE_CHECK`; it never runs in CI, in Docker, or in a non-release build.
- **The cache feed** (opt-in, `cacheSource: feed`): BitTorrent peers and the feed host,
  with every file checked against the feed's SHA-256.

### Releases and the Docker image

- Every release binary is published with a SHA-256 checksum and a build provenance
  attestation (`gh attestation verify <file> --repo sloshy/ritual`). The install scripts,
  `ritual self-update` and the generated deploy workflow verify the checksum before
  using a download. The binaries are not code-signed.
- The Docker image runs as the non-root user `ritual`, and is built by the release
  workflow from the tagged commit.
