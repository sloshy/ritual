# Changelog

Notable changes a Ritual user would notice. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and each release's section here
is also its notes on the [releases page](https://github.com/sloshy/ritual/releases).

**Ritual follows [semantic versioning](https://semver.org/).** A change that breaks
something you rely on (a command, flag or option, an exit code, the keys of
`--output json` or `ndjson`, an MCP tool or its schema, an admin API route, an export
column or a theme variable) ships only in a major release (2.0.0, 3.0.0, …); minor and
patch releases never break them. A major release's notes mark each breaking change and say
what to do. Features labelled **experimental** or **beta** are outside this promise and
may change in a minor release.

**Your data carries forward.** Your decks, collections, wanted lists, their changelogs and
your `ritual.config.json` keep working as you upgrade from one version to the next, major releases included. When a
release changes a file format or a generated file, it ships the change as a
`ritual migrate` migration, and Ritual tells you when one is pending.

## [Unreleased]

### Breaking

- The MCP `get_price_report` tool is now
  [`get_list_prices`](https://ritual.rpeters.dev/commands/mcp/#tools) and prices **one** list:
  `listType` and `slug` are both required. For totals across many lists (every list, or every
  list of a type), call the new [`summarize_lists`](https://ritual.rpeters.dev/commands/mcp/#summarizing-lists)
  with `source` instead. Rename the tool in any prompt, script or client allowlist that names it.
- `GET /api/price/summary` is removed. Use
  [`GET /api/lists/summary?source=<store>`](https://ritual.rpeters.dev/admin/api/lists/#list-summary)
  (with `listType=` in place of the old `type=`), which returns each list's `value` beside its
  counts. It has no default store: without `source` it reports counts only.
- `ritual price --summary` is removed. Run
  [`ritual lists --summary --source <store>`](https://ritual.rpeters.dev/commands/lists/#summary)
  for every list's totals (add `--deck`, `--collection` or `--wanted` to scope it, as before).
  Its JSON is shaped differently: rows are `lists[]` with `listType`, `slug`, `name`, `counts`
  and `value`, and the totals are `totals.value` and `typeTotals[].value`.
- A non-interactive `ritual price` (piped, `--output json`/`ndjson`, or `--no-input`) with
  neither a list name nor a card filter (`--name`, `--set`, `--collector`) now exits `2` with a
  usage error pointing at `ritual lists --summary --source <store>`. Before, it printed the
  summary. The interactive browser is unchanged.
- Price reports name each list by its display title (the list's `# Title`), not its file name:
  `list.name` and `cards[].listName` in `ritual price --output json` (and `ndjson`), in
  [`GET /api/price/:type/:slug`](https://ritual.rpeters.dev/admin/api/prices/#price-list) and in
  the MCP `get_list_prices` tool. To identify a list, read the new `list.slug` /
  `cards[].listSlug` (with the list type), which stay unique when two lists share a title; a
  script that matched rows by file name must switch to the slug.
- Price responses drop `mode` (`GET /api/price/:type/:slug`, MCP `get_list_prices`): there is
  only one body now. A client that branched on it can stop reading it.
- Price and sell `warnings` are message objects instead of strings, each naming its list:
  `{ message, messageKey, messageParams, list: { listType, slug } }`, where `messageParams.cause`
  nests what went wrong. This covers `ritual price --output json`, `ritual sell --output json`,
  `GET /api/price/:type/:slug`, `GET /api/sell/report` and the MCP `get_list_prices` and
  `get_sell_report` tools. Read `message` where you read the string, and match on `messageKey`.
  The stderr lines are unchanged.
- The sell routes (`GET /api/sell/report`, `GET /api/sell/cart`) take one list per repeated
  [`list=type:slug`](https://ritual.rpeters.dev/admin/api/prices/#parameters) parameter
  (`?list=collection:binder&list=deck:burn`) instead of the comma-separated `lists=`, so a slug
  holding a comma works. A list named twice is matched once, and the type half is
  case-insensitive. A malformed ref is refused with key `admin.api.listRefInvalid` (was
  `admin.api.sell.refInvalid`), and a slug holding a path separator is now that `400` instead of
  a `404`. A ref naming no list is a `404` keyed `admin.api.list.notFound` with `listType` and
  `slug` params (was `admin.api.listNotFound` with `list`). The MCP sell tools' `lists` input is
  unchanged.
- The sell routes' `type=` is matched case-insensitively and an unknown value is refused with
  `errors.enum.invalid`, like every other enum parameter, instead of `admin.api.listTypeInvalid`.
  The message keys `admin.api.listTypeInvalid` and `admin.api.listNotFound` no longer exist; a
  client matching on them must switch to `errors.enum.invalid` and `admin.api.list.notFound`.
- `GET /api/price/:type/:slug` answers `404` (`admin.api.list.notFound`) when the list's file
  disappears between the lookup and the read, rather than `200` with no `list`;
  `ritual price <list>` exits `1` in that case.

### Added

- [`ritual lists --summary`](https://ritual.rpeters.dev/commands/lists/#summary) counts every
  list's entries (lines) and cards (copies) in one pass, with per-type and grand totals
  (including distinct card names), and with `--source <store>` each list's value. Select with
  list names as arguments (`deck:Burn`), `--deck`/`--collection`/`--wanted`, `--name <terms>`,
  `--label`, `--format` and `--no-empty`; count only some deck boards with repeated
  `--section` (`--section Commander --section Main`); order with `--sort name|quantity|value`,
  `--ascending`/`--descending` and `--limit` (the totals still cover every selected list). It
  answers "how many cards are in all my collections", "which lists have box in the name",
  "each deck's board counts" and "my most valuable collections" in one command. Counting never
  needs the card cache; prices that cannot be had (an empty cache, no Card Kingdom feed) leave
  the counts with a warning, and only `--sort value` refuses then. Every summary option needs
  `--summary`; plain `ritual lists` is unchanged.
- [`GET /api/lists/summary`](https://ritual.rpeters.dev/admin/api/lists/#list-summary) and the
  MCP [`summarize_lists`](https://ritual.rpeters.dev/commands/mcp/#summarizing-lists) tool return
  the same summary, with the same filters (`listType`, `nameContains`, list refs, `label`,
  `format`, `includeEmpty`, deck sections; the route takes refs and sections as repeated
  `list=type:slug` and `section` parameters, the tool as `lists` and `sections` arrays), `source`, `sort`, `descending` and
  `limit`. Pricing is strictly cache-backed. A `list` ref naming no list is a warning, not an
  error. The MCP server's instructions now steer agents to one `summarize_lists` call instead
  of a `get_list` per list.
- [`ritual mcp --transport http --public-url <url>`](https://ritual.rpeters.dev/commands/mcp/#behind-a-reverse-proxy-or-tunnel)
  and [`ritual admin --mcp --mcp-public-url <url>`](https://ritual.rpeters.dev/commands/admin/#embedded-mcp-server)
  serve the MCP endpoint behind a tunnel or reverse proxy (such as a Cloudflare Tunnel) that
  forwards a public hostname to a loopback bind. The URL's host passes the loopback `Host`/`Origin`
  checks that used to answer every forwarded request with `403`, and the public endpoint is
  printed at startup. The value must be a bare `http://` or `https://` origin. Because a public
  URL exposes the endpoint, `ritual mcp` refuses it without a token or `--oauth` unless you pass
  `--allow-unauthenticated`.
- **Beta:** [OAuth sign-in for the MCP endpoint](https://ritual.rpeters.dev/commands/mcp/#oauth-sign-in-beta).
  `ritual mcp --transport http --oauth --public-url <url>` and
  `ritual admin --mcp --mcp-oauth --mcp-public-url <url>` serve a small, single-user OAuth 2.1
  authorization server beside `/mcp`, so hosted clients such as Claude's custom connectors can
  connect (Claude's custom connectors on the web are the target; the desktop and mobile apps, and
  voice mode, are not yet verified): enter `<url>/mcp` as the connector URL, and approve it by
  signing in with the Ritual admin account (and TOTP code, when enabled) on Ritual's consent page.
  Clients register themselves (dynamic client registration), PKCE S256 is required, access tokens
  last an hour and refresh tokens 90 days with rotation. A static token given alongside keeps
  working. OAuth needs an `https://` public URL and an existing admin account
  (`ritual admin setup`); behind a tunnel it also needs `admin.trustProxy` (the command
  refuses to start without it and says how to set it). Changing the admin password, or turning
  TOTP on or off, revokes every OAuth grant at once, even on a running server; deleting
  `.logins/mcp-oauth.json` with the server stopped also forgets every registered client.

### Changed

- Price reports at Card Kingdom (`source=cardkingdom`) report `lastRefreshedAt` as the age of the
  Card Kingdom feed they were priced from, not the card cache's last refresh: in
  `GET /api/price/:type/:slug`, MCP `get_list_prices`, the new summary surfaces, and the header
  of the `ritual price` browser. Every other store still reports the card cache's age.
- The `ritual price` browser's main screen is built from the new list summary, and a list's card
  screen is priced only when you open it, so a list file that cannot be read is left out with a
  warning rather than stopping the browser. **Refresh prices** also refreshes the Card Kingdom
  feed when Card Kingdom is the store.

### Fixed

- A deck whose front matter is not valid YAML is now reported as unreadable every time it is read
  by a long-running process (`ritual admin`, `ritual mcp`, `serve --api`). Before, only the first
  read failed and later ones saw empty front matter, so, for example, the deck-sync listing showed
  a broken deck as "not linked to Archidekt" instead of unreadable.
- **Security:** the admin login (`POST /api/login`) now counts each attempt before checking its
  password, so a burst of parallel wrong passwords gets no more checks than the rate limit allows;
  the extra requests get the usual "too many failed attempts" answer. Before, every request in a
  burst was checked.
- **Security:** wrong two-factor (TOTP) codes at the admin login are now also limited across all
  addresses: after 10 wrong codes in 15 minutes, each following a right password, no code is
  checked until the window passes, and the login answers with the usual "too many failed
  attempts" (`429`). Before, the per-address limit alone let someone who had the password try
  codes from many addresses at once. A wrong password is answered as before. The budget is shared
  with the new MCP OAuth consent page. The trade-off: someone who already has the password can
  keep code logins refused for as long as they keep guessing; changing the password stops them.
- **Security:** with [`admin.trustProxy`](https://ritual.rpeters.dev/commands/admin/#network-options)
  on, the admin site and the MCP OAuth sign-in now believe `X-Forwarded-For` and
  `X-Forwarded-Host` only from a trusted proxy: a connection from loopback (`127.0.0.0/8`, `::1`,
  `::ffff:127.x.x.x`), or from an address in the new `admin.trustedProxies` setting (IPv4 and IPv6
  addresses and CIDR ranges). Before, every connection's headers were believed, so a client that
  reached a server bound to a network address directly could write any address into the header,
  dodge the per-address login lockout and put a false address in the audit log. Any other
  connection is now taken at its own address and `Host`. `X-Forwarded-For` is read from the right,
  skipping entries that are trusted proxies themselves, so a chain (a CDN in front of your proxy)
  resolves to the real client once the CDN is listed. An entry that would trust every client (a
  `/0`, or an IPv6 range holding the IPv4-mapped block) is refused. A tunnel client or proxy on the
  same machine (cloudflared, Tailscale Serve, Caddy) needs nothing; nginx must be set to append the
  header (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), and a forwarder that
  does not rewrite HTTP headers (`ssh -L`, socat) must not be used with `admin.trustProxy`. **Action needed if your
  proxy is on another machine or in another container**, including any Docker or Docker Compose
  setup, where the proxy connects from a network address rather than loopback: add it with
  `ritual config set --add admin.trustedProxies <address-or-range>`, or on the admin Settings page under **Trusted proxies** (see
  [Docker](https://ritual.rpeters.dev/docker/#behind-a-reverse-proxy-container)). Until you do,
  Ritual sees every client as the proxy: one shared login lockout, and the proxy's address in the
  audit log and the IP allow and deny lists.
- **Security:** the admin login's per-address lockout now counts an IPv6 client by its /64, as the
  MCP OAuth sign-in already did, so moving to another address inside one prefix no longer gets a
  fresh set of attempts. The audit log still records each full address.

## [1.0.0] - 2026-11-25

The first release of Ritual. Ritual is a command-line program that keeps your Magic: The
Gathering decks, collections and wanted lists as plain markdown files in a folder, usually a
git repository. It prices them, imports and syncs them, lets you edit them in the terminal or
a browser, and builds them into a website you can host anywhere. Start with the
[install page](https://ritual.rpeters.dev/start/install/) and the
[quick tour](https://ritual.rpeters.dev/start/tour/), or look around the
[live demo](https://ritual.rpeters.dev/demo/).

### Lists and file format

- One markdown file per list under `decks/`, `collections/` and `wanted/`. Edit them with
  Ritual or by hand. The [list format](https://ritual.rpeters.dev/list-format/) page
  describes every token.
- A card line can carry a printing (`(SET:CN)`), finish, condition, card language
  (`[ja]`), labels, tags and a note. Each line ends in a stable card ID (`&N`).
- Decks have sections (Commander, Main, Sideboard, Maybeboard and any of your own) and a
  format. A new deck in a Commander-style format starts with a `## Commander` section.
- Collections hold exact printings, one line per copy. Collection labels (`sale`, `trade`,
  `keep`, `proxy`) can be set as a list default and adjusted per card; decks can mark proxies.
  Proxies, and cards with custom art, are priced at zero.
- Wanted lists name a card, a printing, or a printing and finish, and are priced to match.
- Per-card tags, per-list card categories (`<name>.categories.json`), custom card art
  (`.art.json`), list descriptions and a cover image for each list.
- Every change Ritual makes is logged in a `.changes.md` file beside the list. A small
  `.sha256` file lets Ritual tell its own edits from yours, and
  [`detect-changes`](https://ritual.rpeters.dev/commands/detect-changes/) logs hand edits.
- [`cleanup`](https://ritual.rpeters.dev/commands/cleanup/) rewrites every list in the
  standard form.

### Command line and editing

- `ritual edit` is an interactive terminal editor for any list, with card autocomplete,
  collector-number entry, undo, moving cards between lists, and save when you are done.
- One-shot commands for scripts: `new`, `add-card`, `remove-card`, `set-card`, `note`,
  `move`, `rename`, `delete`, `metadata`, `categories` and `set-list-image`. `config` changes
  settings, and `login` signs in to Archidekt.
- `lists`, `card`, `scry`, `diff`, `history` (read or tidy a list's change history) and
  `get-primer`.
- Deleting a list moves its files to the workspace's `.trash/` folder.
- `ritual --help` shows the commands a newcomer needs; `ritual help --all` shows every
  command.
- Most commands take `--output json` (or `ndjson`) for scripts, and the global `--no-input`
  never prompts. See [CLI conventions](https://ritual.rpeters.dev/cli-conventions/).

### Pricing and selling

- Prices from TCGplayer (the default), Cardmarket, Card Kingdom and Cardhoarder (MTGO
  tix). The `priceSources` and `defaultPriceSource` settings pick the stores you use.
- [`ritual price`](https://ritual.rpeters.dev/commands/price/) browses every list's value,
  down to the card, or prints one list's prices.
- [`ritual sell`](https://ritual.rpeters.dev/commands/sell/) shows what Card Kingdom's
  buylist would pay for cards in your lists, with filters by set, price, ratio, copies owned
  and tags.

### Import, export and sync

- [`import`](https://ritual.rpeters.dev/commands/import/) reads decks from Archidekt,
  Moxfield and MTGGoldfish URLs (Moxfield needs a User-Agent string it has approved), and lists from text files (MTG Arena and MTGO exports
  included) and CSV files, with a wizard for the CSV columns.
- `import-account` imports every deck on an Archidekt account.
- [`export`](https://ritual.rpeters.dev/commands/export/) writes cards as CSV, JSON, plain
  text or Markdown, in Ritual's, Archidekt's, Arena's or Moxfield's spelling, with saved
  presets.
- Two-way Archidekt sync for decks
  ([`deck-sync`](https://ritual.rpeters.dev/commands/deck-sync/) `pull`, `push`, `link`,
  `status`) and for your collection
  ([`collection-sync`](https://ritual.rpeters.dev/commands/collection-sync/) `pull`,
  `push`). Syncs preview with `--dry-run` and list every card with `--verbose`; deck syncs
  can also carry printings and categories. A sync never empties one side because the other is empty
  unless you pass `--allow-remove-all`. See the
  [Archidekt sync guide](https://ritual.rpeters.dev/guides/archidekt-sync/).
- [`import-changes`](https://ritual.rpeters.dev/commands/import-changes/) applies a change
  bundle exported from a site editor.

### The public site

- [`build-site`](https://ritual.rpeters.dev/commands/build-site/) writes your lists as a
  static website; `serve --build` builds and serves it locally.
  [`init-site`](https://ritual.rpeters.dev/commands/init-site/) sets up publishing to
  GitHub Pages, either built by GitHub Actions ("Publish for me") or from a local build.
- Browse lists as card images or text rows, open any card for its details and other printings, and
  jump between lists with Quick Switch (Ctrl+K).
- Filter, sort and group any list, and share the view by link. Combine several lists into
  one view.
- Find Cards searches every list for a set of names; Find in Lists shows other copies of
  one card.
- A Trade Planner for laying out a trade from your collections and wanted lists, shareable
  by URL.
- Visitors can edit any list in the browser and export the changes as a bundle for you to
  apply. See [taking edits from your site](https://ritual.rpeters.dev/guides/public-edits/).
- Prices from every store you enable, eleven themes (each with an inverted variant), custom
  themes and an in-browser theme editor, and a layout for phones.
- **Sell mode** shows Card Kingdom buylist offers beside your cards and exports a cart. It is
  **beta** and off by default: turn it on with `site.sellMode` or `--sell-mode`. See
  [Sell Mode](https://ritual.rpeters.dev/public-site/sell/).
- **`serve --api`** serves the same site with live list data and search over the card
  cache. It is **beta**, and its API has no sign-in. See
  [Hosting with a Live Backend](https://ritual.rpeters.dev/public-site/hosted/).
- Every page credits Scryfall, carries the Fan Content Policy notice, and links to the
  source of the Ritual version that built it.

### The admin site

- [`ritual admin`](https://ritual.rpeters.dev/commands/admin/) runs a browser interface for
  your workspace, behind a password and optional TOTP.
- Edit lists, move cards between them, create, rename and delete lists, import decks, CSV
  files and change bundles, browse and tidy change history, sync with Archidekt, build the
  site, refresh the card cache, and change settings. Every page has its own link.
- The [admin API](https://ritual.rpeters.dev/admin/api/) behind it is usable by any client.

### AI assistants

- [`ritual mcp`](https://ritual.rpeters.dev/commands/mcp/) runs an MCP server, over stdio or
  HTTP, or inside `ritual admin --mcp`. Its tools read and edit your lists with the same
  checks and change history as the admin site. Long tools report progress and run as tasks
  for clients that support them.
- [`ritual skills install`](https://ritual.rpeters.dev/commands/skills/) installs Claude Code
  skills that teach an agent to drive the `ritual` command. See the
  [AI agents guide](https://ritual.rpeters.dev/guides/ai-agents/).

### Card cache

- A local copy of Scryfall's card data, images and prices, shared by every workspace on
  your computer: about 80 MB to download and 450 MB on disk (more for a non-English `defaultLanguage`). Ritual asks before the first
  download, and most commands then work offline. See
  [Card Cache](https://ritual.rpeters.dev/card-cache/).
- `--refresh ask|auto|no-bulk|never` decides when commands refresh it.
- [`ritual cache`](https://ritual.rpeters.dev/commands/cache/) reports and refreshes it.
  `cache server` shares one cache between machines; it is for **trusted networks only**,
  since its write routes have no sign-in. `cache feed` shares the card data peer to peer
  and is **experimental**.

### Install, update and releases

- Binaries for Linux, macOS and Windows on x86_64 and arm64, installed with
  `install.sh` or `install.ps1`. The binaries are not code-signed, so macOS and Windows warn
  on the first run of one downloaded in a browser. See [Install](https://ritual.rpeters.dev/start/install/).
- Each release archive has a SHA-256 checksum and a build provenance attestation, and each
  release publishes a CycloneDX software bill of materials. Check a download with
  `gh attestation verify <file> --repo sloshy/ritual`.
- [`ritual self-update`](https://ritual.rpeters.dev/commands/self-update/) installs a newer
  release after checking it. A release build prints a one-line notice when a newer release
  is out.
- A Docker image, `ghcr.io/sloshy/ritual`, for `linux/amd64` and `linux/arm64`, with a
  health check. See [Docker](https://ritual.rpeters.dev/docker/).
- [`ritual doctor`](https://ritual.rpeters.dev/commands/doctor/) checks your setup and prints
  a report for bug reports. `RITUAL_DEBUG=1` prints the stack trace of an unexpected error.

### Workspaces and migrations

- A workspace is a folder holding your lists and `ritual.config.json`. See
  [Workspace](https://ritual.rpeters.dev/workspace/) and
  [Configuration](https://ritual.rpeters.dev/configuration/).
- [`ritual migrate`](https://ritual.rpeters.dev/commands/migrate/) brings a workspace up to
  date after an upgrade, backing up what it rewrites to `.backups/`. Ritual tells you when a
  migration is pending.
- Ritual saves files through a temporary file and a rename, so a crash cannot leave one
  half-written.

### Security and privacy

- No telemetry and no analytics. Ritual contacts Scryfall, Card Kingdom, Archidekt,
  Moxfield, MTGGoldfish and GitHub only for something you asked for, plus a daily update
  check you can turn off. See [Security and Privacy](https://ritual.rpeters.dev/reference/security/).
- Sign-ins live in the workspace's `.logins/` folder, readable only by you and kept out of
  git by its own `.gitignore`.
- The admin site refuses requests sent from other websites, and every server caps the size
  of a request.

### Language

- Every message Ritual shows goes through a message catalog, so Ritual can be translated.
  English is the only language that ships. See
  [Localization](https://ritual.rpeters.dev/localization/).

### Documentation and demo

- Documentation at [ritual.rpeters.dev](https://ritual.rpeters.dev/), with a getting-started
  path, guides, a reference page for every command, and troubleshooting.
- A [live demo](https://ritual.rpeters.dev/demo/) site, built by Ritual from made-up lists.
