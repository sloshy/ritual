# Changelog

Notable changes a Ritual user would notice. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and each release's section here
is also its notes on the [releases page](https://github.com/sloshy/ritual/releases).

**Ritual is in 0.x.** Until 1.0, any release may change commands, flags, output formats,
MCP tools and the like; each change that needs something from you says so here.

**Your data carries forward.** Your decks, collections, wanted lists, their changelogs and
your `ritual.config.json` keep working as you upgrade from one version to the next. When a
release changes a file format or a generated file, it ships the change as a
`ritual migrate` migration, and Ritual tells you when one is pending.

## [Unreleased]

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
