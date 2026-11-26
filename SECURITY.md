# Security

## Reporting a vulnerability

Report security problems privately, not in a public issue: email the maintainer at
the address on the project's commits. You should hear back within a week.

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

| Command                    | Default bind            | Authentication                                                                                                                                                 |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serve`                    | `0.0.0.0:3000`          | None. Serves the built site's static files only.                                                                                                               |
| `serve --api`              | `0.0.0.0:3000`          | None. Read-only API with CORS `*`; see below.                                                                                                                  |
| `admin`                    | `0.0.0.0:8080`          | Account login with a session cookie; see below.                                                                                                                |
| `admin --mcp`              | admin's host, port 8765 | Bearer token, or OAuth with `--mcp-oauth` (beta), or both; one of them is required.                                                                            |
| `mcp --transport http`     | `127.0.0.1:8765`        | Bearer token and/or OAuth (`--oauth`, beta). Without either, a non-loopback `--host` or a `--public-url` is refused unless you pass `--allow-unauthenticated`. |
| `mcp` (stdio, the default) | no socket               | Whoever launches the process.                                                                                                                                  |
| `cache server`             | `127.0.0.1:4000`        | **None, including its write routes.** Trusted networks only.                                                                                                   |
| `cache feed host`          | `127.0.0.1:4010`        | None. Read-only (GET/HEAD); seeding opens a BitTorrent listener.                                                                                               |

- **`serve --api` has no write routes and no authentication.** It answers list data,
  card search, prices and buylist quotes to anyone who can reach it. Some routes read
  through to Scryfall when the cache lacks a card or a price is stale, so an anonymous
  caller can cause outbound Scryfall requests and cache writes. Request bodies are capped,
  and batch routes are capped (500 names or printings, 200 card IDs). There is no rate limiting; put a reverse proxy
  in front of a public deployment if you need it. With no cookies and no write routes, it has
  nothing for another site to forge, so it has no cross-site check (its `POST` routes only
  look up prices and quotes).
- **Never expose `cache server` to an untrusted network.** It can clear and replace cache
  sections without authentication. Bind it to loopback (its default) or a private
  network, and point `serve --api` or clients at it from there.
- **Every server that accepts a request body caps it**: Bun's `maxRequestBodySize` plus a
  per-route budget counted as the body streams in. `cache server`'s bulk-upload route allows
  1 GiB, because a client's full card refresh sends the whole card cache in one request; its
  other routes allow 16 MiB or less.
- **`cache server` and `cache feed host` do not send unexpected errors to the client.**
  A `500` carries a generic message; the error itself goes to the server's console.

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
- **Cross-site requests** are refused in two ways. The `SameSite=Strict` cookie keeps a
  browser from sending the session with them, and every `/api/*` request a browser sends
  from another site (a sibling port or subdomain included) is refused with `403` before any
  route runs, including `/api/setup` and `/api/login`, which need no session, and the `GET`
  streams that sync, refresh or build. The check reads the browser's
  `Sec-Fetch-Site` header (only `same-origin` passes, or `none` for a request the user made
  directly), or, from a browser that does not send it, requires the `Origin` host to match
  the `Host` header (`X-Forwarded-Host` under `admin.trustProxy`). A request with neither
  header is not from a browser and is let through to the usual session check. There is no
  separate CSRF token. Responses carry a `default-src 'self'` Content Security Policy and
  `X-Frame-Options: DENY`.
- **Failed logins** are delayed, rate-limited per IP (5 failures within 5 minutes locks
  the address for 5 minutes by default), and recorded in `.logins/admin-audit.log`. Each
  attempt is counted before its password is checked, so a burst of parallel guesses gets
  no more checks than the limit. Wrong TOTP codes are also limited across all addresses:
  past 10 in 15 minutes, no code is checked for anyone until the window passes (shared
  with the MCP OAuth consent page).
  Behind a reverse proxy, set `admin.trustProxy` so the limit applies to the client
  rather than the proxy, and only then.
- **IP and User-Agent allow and deny lists** (`admin.ipAllowList` and the like) apply
  before any route.
- **Bind the admin to loopback** (`--host 127.0.0.1`) unless you need it on the network,
  and put HTTPS in front of it when you do.
- **Git integration is off by default.** With `admin.gitAutoCommit`, saves commit only the
  files they touched, through `git` called with an argument list, never a shell.

### The MCP server

- The static token comes from `--token` / `--mcp-token` or `RITUAL_MCP_TOKEN` (the
  environment variable keeps it out of the process list), and is compared in constant
  time. With OAuth on (below), access tokens Ritual issued are accepted as well.
- On a loopback bind, the HTTP transport also checks the `Host` and `Origin` headers
  against DNS rebinding: only local names and the host name of `--public-url` /
  `--mcp-public-url` pass (the OAuth metadata, registration and token endpoints check
  `Host` only). On any other bind, the token or OAuth is the only check.
- **A connected client can do anything the admin site can,** including deleting lists,
  rewriting history and changing `ritual.config.json` (the admin's allow lists among
  it). Treat the token, and an OAuth approval, like the admin password.

### The MCP OAuth server (beta)

`ritual mcp --oauth` and `ritual admin --mcp --mcp-oauth` mount a single-user OAuth 2.1
authorization server on the MCP listener, so hosted clients (Claude's custom connectors)
can sign in. It adds unauthenticated, internet-facing routes: `/.well-known/*` metadata,
`POST /oauth/register` (dynamic client registration), `/oauth/authorize` (a login and
consent page) and `POST /oauth/token`.

- **The resource owner is the admin account.** Approving a client means signing in on the
  consent page with the admin username and password (and TOTP when enabled). Failed
  attempts are delayed, audited and rate-limited per address under the same `admin.*`
  settings as the admin login, but per address on a limiter of their own, so wrong passwords from the internet cannot
  lock the owner's address out of the local admin (only the global TOTP budget below is shared). Each attempt is counted before the password is
  checked and checks run one at a time per address and four at a time overall, so
  parallel guesses gain nothing; the failed-attempt delay is waited out outside that
  queue, and past 16 waiting sign-ins a new one is refused at once (`429`), so a flood of
  failures cannot starve the owner's sign-in. A wrong code reads exactly like a wrong
  password; a sign-in page is spent after three failures. IPv6 addresses are limited per /64. The admin IP and User-Agent allow and deny
  lists apply to the consent page.
- **Wrong TOTP codes are limited globally.** At most 10 wrong codes after a right password
  are checked per 15 minutes across all addresses, shared with the admin login in the same
  process; past that no code is checked until the window passes (`429` with
  `Retry-After` for a right password; a wrong password is answered as before). A code is
  accepted in three 30-second steps, so that is about 960 guesses a day at odds of 3 in a
  million each: roughly 0.3% a day. Missing and malformed codes are not counted. The budget
  stays on when `admin.rateLimitEnabled` is off: it does not depend on client addresses.
- **Behind a tunnel, `admin.trustProxy` is required.** A loopback bind with a
  non-loopback public URL refuses to start without it (exit `2`): otherwise every request
  would come from loopback, every limit would be one shared bucket that any stranger could
  use to lock the owner out, and the audit log would record the proxy's address.
- **Only public clients with PKCE S256** are accepted; `plain` and a missing challenge are
  refused. Redirect URIs must be `https:` or loopback `http:`, and are matched exactly
  (a loopback URI may differ in its port only). A request naming an unknown client or an
  unregistered redirect URI gets an error page and is never redirected.
- **Tokens are opaque 256-bit random values; only their SHA-256 digests are stored**, in
  `.logins/mcp-oauth.json`. Access tokens live one hour and are bound to the public `/mcp`
  URL. Refresh tokens live 90 days and are rotated on every use; presenting an
  already-rotated one revokes the whole grant, except the one just rotated, presented
  again within 60 seconds by the same client (a retry), which gets the same answer again
  from memory (never from disk; after a restart it is refused without revoking).
  Authorization codes are single-use, live 60 seconds and are held in memory only; a
  replayed code revokes what it issued, even when the replay races the first exchange.
- **The consent page** sends no script, `Content-Security-Policy: default-src 'none'` with
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cache-Control: no-store` and
  `Referrer-Policy: same-origin` (the redirect back to the client is `no-referrer`). Its
  form is protected by a per-page token plus a `SameSite=Lax` cookie (`__Host-` prefixed
  over https), and must come from the public origin. Every value a client supplied is
  HTML-escaped; control and bidirectional-override characters are stripped from client
  names.
- **Registration and sign-in pages are bounded**: 16 KiB bodies, 20 registrations per
  address per hour, at most 100 clients (clients that never obtained a grant are forgotten
  after a day; only a client holding an unexchanged authorization code is protected from
  eviction, never one with a mere sign-in page open), 30 valid sign-in pages per address
  per 10 minutes (invalid requests cost nothing), 10 open per address, and 2000 open in all,
  past which a new page pushes out the oldest page of the address holding the most (so a
  new page is never refused, and an address with fewer pages never loses one to it).
- **Revoking.** Every grant and authorization code carries a fingerprint (SHA-256) of the
  admin password hash and active TOTP secret it was approved under, compared with
  `.logins/admin-auth.json` on every token check, refresh and code exchange. So changing
  the admin password, or turning TOTP on or off, revokes every grant and outstanding code
  at once, from any process; the OAuth server never writes the credentials file and the
  credential writers never touch the OAuth state. Without a readable admin account, no
  OAuth token is accepted. The state file is replaced atomically (a temporary file renamed
  over it), so it is never missing while the server runs, and a change another process
  made since the server read it is re-read and kept rather than overwritten. Delete
  `.logins/mcp-oauth.json` only with the server stopped, to also forget the registered
  clients; a credential change is the way to revoke everything on a running server. A
  damaged state file is never reset: the server refuses to start, or, while running,
  accepts no OAuth token until it is fixed.
- **Limitation: a known password can block OAuth sign-in.** Because the TOTP budget is
  global, someone who already has the admin password can keep new OAuth approvals (and
  admin logins needing a code) refused for as long as they keep guessing codes. Existing
  connections keep working; changing the admin password stops the guessing, and sign-in
  works again once the current 15-minute window passes.
- OAuth needs an `https:` public URL (`http:` only on a loopback host served from a
  loopback bind, for testing).

### Credentials on disk

`.logins/` in the workspace holds plaintext JSON files, each written with mode `0600` in
a directory created `0700`:

- `admin-auth.json`: the admin username, bcrypt password hash, and TOTP secret.
- `admin-audit.log`: login attempts with IP and User-Agent (OAuth consent sign-ins too).
- `mcp-oauth.json`: the MCP OAuth server's registered clients and grants, with SHA-256
  digests of its access and refresh tokens (never the tokens themselves).
- `archidekt.json`: your Archidekt access and refresh tokens. Your Archidekt password is
  sent to Archidekt to log in and never stored.
- `collection-sync.json`: the last collection sync's time and Archidekt user.

Anyone who can read the workspace can read these, so keep `.logins/` out of version
control. Ritual does that for you: whenever it writes into `.logins/` it also writes
`.logins/.gitignore`, which ignores the whole folder, so a workspace `ritual init-site` never
set up is covered too. `ritual migrate` adds the file to a `.logins/` folder made by an older
Ritual. It only keeps git from adding the folder: if `.logins/` was committed before,
`git rm -r --cached .logins` stops tracking it. The `.gitignore` that `init-site` writes excludes `.logins/` as well.

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
- **The cache feed** (opt-in, `cacheSource: feed` plus a `cacheFeedUrl` you set; there is
  no public feed): BitTorrent peers and the feed host, with every file checked against the
  feed's SHA-256.

### Releases and the Docker image

- Every release binary is published in a compressed archive (`.tar.gz`, or `.zip` for
  Windows), with a SHA-256 checksum of the archive and a build provenance attestation
  (`gh attestation verify <file> --repo sloshy/ritual`). The install scripts,
  `ritual self-update` and the generated deploy workflow verify the checksum before
  unpacking or using a download, and accept only an archive holding exactly the one
  binary. The binaries are not code-signed.
- Each release publishes `ritual-sbom.cdx.json`, a CycloneDX software bill of materials,
  attested against every archive (`gh attestation verify <file> --repo
sloshy/ritual --predicate-type https://cyclonedx.org/bom`).
- The Docker image runs as the non-root user `ritual`, and is built by the release
  workflow from the tagged commit, with an SBOM and build provenance attached as registry
  attestations.
