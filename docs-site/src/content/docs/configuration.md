---
title: 'Configuration'
---

Ritual reads its configuration from `ritual.config.json` in the base directory (the current working directory by default, or the path passed to `--base-dir`). The file is **optional** — every setting has a built-in default, so a workspace with no config file works exactly like one holding the defaults.

## Location

- **File**: `ritual.config.json`
- **Default path**: `<base-dir>/ritual.config.json`

When you pass `--base-dir`, Ritual loads the config from that directory and resolves all directory paths in the file relative to it.

## When the file is created

Reading the config never creates it. The file appears only when something actually **writes** a setting:

- [`ritual config set`](/commands/config/) (or `config unset`)
- [`ritual init-site`](/commands/init-site/), which records the `site` key
- the admin server's **Settings** page or the MCP `update_config` tool (both `PUT /api/config`), and other admin writes such as the **Manage Lists** visibility toggles
- [`ritual export --save-preset`](/commands/export/#presets)

So a plain `ritual lists` in a fresh directory leaves that directory untouched. A workspace is defined by its `decks/`, `collections/`, and `wanted/` folders — not by the presence of a config file. (Older builds seeded a defaults file on every invocation, which made any directory you happened to run a command in look like a workspace.)

The first write materializes the full defaulted document, not just the key you set — see [`config list`](/commands/config/#config-list) on why `(default)` markers say nothing about which keys are on disk.

## Malformed files are a hard error

If `ritual.config.json` exists but is not valid JSON — or parses to something other than a JSON object — the command **fails** rather than falling back to defaults, and the file is never rewritten:

```
$ ritual lists
ritual.config.json is not valid JSON: /home/you/mtg/ritual.config.json
  JSON Parse error: Property name must be a string literal
Fix the file (or delete it to fall back to defaults) and try again.
```

The exit code is `1`. Failing loudly is the point: silently treating a broken file as "no config" would run the command against defaults and let the next write replace settings you still have on disk. Fix the syntax, or delete the file to start again from defaults.

Note that this applies to the _document_: an individual field with a bad value is a softer failure — see [Validation](#validation) below.

## Default settings

These are the values Ritual uses when there is no config file, and what a first write puts on disk:

```json
{
  "decksDir": "./decks",
  "collectionsDir": "./collections",
  "wantedDir": "./wanted",
  "artDir": "./art",
  "defaultCurrency": "usd",
  "priceSources": ["tcgplayer"],
  "defaultCategories": [
    "Ramp",
    "Draw",
    "Removal",
    "Board Wipes",
    "Counterspells",
    "Tutors",
    "Recursion",
    "Protection",
    "Combo",
    "Tokens",
    "Burn",
    "Lifegain",
    "Finishers",
    "Utility"
  ],
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

## Directory options

| Field            | Default         | Description                                                             |
| ---------------- | --------------- | ----------------------------------------------------------------------- |
| `decksDir`       | `./decks`       | Where deck markdown files live. Used by the CLI, build-site, and admin. |
| `collectionsDir` | `./collections` | Where collection markdown files live.                                   |
| `wantedDir`      | `./wanted`      | Where wanted-list markdown files live.                                  |
| `artDir`         | `./art`         | Where [custom card art](/custom-art/) images live.                      |

Directory paths are resolved relative to the base directory. For example, with `--base-dir ~/mtg` and `"decksDir": "./my-decks"`, Ritual reads decks from `~/mtg/my-decks`.

You can use absolute paths (`"/srv/mtg/decks"`) or paths that step outside the base dir (`"../shared-decks"`) when that fits your workflow.

`artDir` is the one directory Ritual never creates: it is read only when a list references [custom art](/custom-art/), and a missing directory simply means the workspace has none. A card's `file` reference is a path **relative to** this directory, so moving the directory (or pointing `artDir` somewhere else) never invalidates a reference.

## Default currency

| Field             | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultCurrency` | `usd`   | The currency price-touching surfaces default to: `usd`, `eur`, or `tix`. Used by the [price](/commands/price/) command, the [printing and finish picker price columns](/commands/edit/#printing-and-finish-prices) and the price lines shown when adding or editing cards in the CLI editor, the [admin site](/commands/admin/)'s editor and move-cards price displays, and as the public site's initial currency (when that currency is built). [init-site](/commands/init-site/) prompts for it; change it later with `config set defaultCurrency eur`. |

## Price stores (`priceSources`)

| Field          | Default         | Description                                                      |
| -------------- | --------------- | ---------------------------------------------------------------- |
| `priceSources` | `["tcgplayer"]` | The stores the published and admin sites offer card prices from. |

Any combination of three store names:

- **`tcgplayer`** — Scryfall's USD market price (TCGplayer). The default, and what every
  price display used before this key existed.
- **`cardmarket`** — Scryfall's EUR trend price (Cardmarket). Already part of the card
  cache, so enabling it costs nothing extra.
- **`cardkingdom`** — Card Kingdom's Near Mint **retail** price, read from the same daily
  pricelist feed [sell mode](/public-site/sell/) uses. Enabling it makes builds and servers
  download and refresh that ~70&nbsp;MB feed exactly as `site.sellMode` does, and opens the
  same buylist API routes.

With both USD stores enabled, list pages grow a **Prices** source selector — see
[Price stores on the site](/public-site/price-sources/). An **empty array** (`config set
priceSources --remove tcgplayer`) hides every price surface on the sites: per-card prices,
totals, the price sort/filter/grouping, and the currency selector. The CLI
[`price`](/commands/price/) command (which has its own `--source` flag) and sell mode are
unaffected by an empty list.

```bash
ritual config set priceSources tcgplayer cardkingdom
ritual config set priceSources --add cardmarket
```

## Default categories

| Field               | Default            | Description                                                                                                                                                                                                                    |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultCategories` | the fourteen below | The global [category](/list-format/#categories-namecategoriesjson) vocabulary: the suggestions offered wherever a category is typed, and the fallback display order for a list whose `.categories.json` sidecar declares none. |

The shipped vocabulary is `Ramp, Draw, Removal, Board Wipes, Counterspells, Tutors, Recursion, Protection, Combo, Tokens, Burn, Lifegain, Finishers, Utility`. A list may use any category name at all — nothing has to be declared here first; this key only decides what is suggested and how an undeclared category sorts into a list's display order.

Each name follows the [category shape rule](/list-format/#categories-namecategoriesjson); a malformed one is refused where it is typed, and on load a malformed entry warns and resets the whole key to the shipped default. An explicit empty array is meaningful: no suggestions.

```bash
ritual config set defaultCategories Ramp Draw Removal
ritual config set defaultCategories --add "Board Wipes"
ritual config set defaultCategories --remove Burn
```

## Default language

| Field             | Default | Description                                                                                                                                                                                                                                                                                        |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultLanguage` | `en`    | The language stamped on newly added cards — [`add-card`](/commands/add-card/), the editors, and imports whose source states no language. Also decides [which Scryfall bulk backs the card cache](#the-all-cards-consequence): `en` downloads `default_cards`; anything else downloads `all_cards`. |

The value is a **Scryfall language code**, stored lowercase:

| Code | Language   | Code  | Language            |
| ---- | ---------- | ----- | ------------------- |
| `en` | English    | `ru`  | Russian             |
| `es` | Spanish    | `zhs` | Simplified Chinese  |
| `fr` | French     | `zht` | Traditional Chinese |
| `de` | German     | `he`  | Hebrew              |
| `it` | Italian    | `la`  | Latin               |
| `pt` | Portuguese | `grc` | Ancient Greek       |
| `ja` | Japanese   | `ar`  | Arabic              |
| `ko` | Korean     | `sa`  | Sanskrit            |
|      |            | `ph`  | Phyrexian           |

These are **Scryfall's codes, not ISO codes** — Chinese is `zhs`/`zht` (not `zh`), and `grc`/`ph` have no ISO equivalent at all. `config set defaultLanguage` accepts common aliases (`jp` → `ja`, `kr` → `ko`, `sp` → `es`, `cs` → `zhs`, `ct` → `zht`, and full English names like `Japanese`) and persists the canonical code; the admin **Settings** page offers the same vocabulary as a dropdown.

On card lines the language is a bracket token (`[ja]`) that is **omitted for English**: a bare line always means `en`, whatever this key says, so list files stay self-describing. The key only controls what gets stamped on _new_ cards — it never reinterprets existing lines.

An [`edit`](/commands/edit/) session seeds its own [session language](/commands/edit/#the-session-language) from this key and can move it from the `🌐 Card Language` menu row without writing the config file, so one session's adds can be Japanese while the key stays `en`. `edit` also warns once on startup when the key is absent, since every card added is then stamped English by default.

### This is not the interface language

`defaultLanguage` decides which **printing of a card** is recorded. The language
**Ritual's own text** is written in is a separate key, [`uiLocale`](#interface-language)
— see below.

### The all-cards consequence

Setting any non-English `defaultLanguage` switches every card-cache download — [`cache preload-all`](/commands/cache/), the freshness prompts, and the [cache feed](/commands/cache/#feed-fetch) — from Scryfall's `default_cards` bulk (one English card object per printing) to the much larger `all_cards` bulk, which carries every language's card objects. Expect a several-times-larger download and cache. The cache records which bulk built it; when that disagrees with `defaultLanguage` (in either direction), commands that check cache freshness offer (or, under `--refresh auto`, run) a full redownload — see [`cache status`](/commands/cache/#status).

## Interface language

| Field      | Default | Description                                                                                                                                                                                                                                                             |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uiLocale` | `en`    | The language **Ritual's own interface text** is written in: CLI output, prompts, menus, help, and both web apps. A [BCP-47](https://www.rfc-editor.org/info/bcp47) tag such as `en`, `de`, `de-AT`, or `pt-BR`, stored canonicalized (`de-at` is persisted as `de-AT`). |

:::caution[`uiLocale` is not `defaultLanguage`]
These two keys are deliberately spelled nothing alike, because they do completely
different jobs:

- **`uiLocale`** picks the language **Ritual speaks to you**. BCP-47 tags. Free to
  change — it costs nothing.
- **[`defaultLanguage`](#default-language)** picks which **printing of a card** is
  recorded. Scryfall's own codes (`ja`, `zhs`, `ph`, …). Setting it to anything other
  than `en` switches the card cache to the [much larger `all_cards` bulk](#the-all-cards-consequence).

They are independent, and every combination is valid — a German interface listing
English printings is a normal setup. Setting one never changes the other.
:::

The value can be overridden per run or per shell without touching the file, and Ritual
falls back to detecting your OS locale when the key is absent:

```
--locale <tag>  →  RITUAL_LOCALE  →  uiLocale  →  OS detection  →  en
```

`ritual locale` prints which of those tiers won, alongside the current
`defaultLanguage`. Detection has real limits (notably [under WSL and on native
Windows](/localization/#what-ritual-can-detect-per-platform)), so on those platforms
setting this key is the reliable route.

The CLI and the admin site pick the value up at runtime; the public site bakes it in on
the next [build-site](/commands/build-site/#localized-builds), where `--locale`
overrides it for one build — except under a live-backend
[`serve --api`](/commands/serve/#live-api-mode---api) deployment, which reports the
current value on every index request with no rebuild. It is also editable on the admin
[Settings page](/commands/admin/#settings).

**Translations are a separate matter from this setting.** No translated catalogs ship
yet, so today every value renders English text (dates, numbers and currency still
follow the tag). See [Localization](/localization/) for the full picture, including how
to contribute one.

## Cache lock timeout

| Field                     | Default | Description                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheLockTimeoutSeconds` | `300`   | How long a cache-refreshing operation waits for another process's cache refresh to finish before failing. Refreshes take an exclusive lock (`cache/.ritual-cache-lock`) so concurrent processes — CLI commands, the [cache server](/commands/cache/#server), the [admin server](/commands/admin/) — never interleave writes to the cache. Must be a positive integer. |

A waiting process breaks the lock immediately when its holder is provably no longer running (e.g. it crashed without cleaning up), so a stale lock never wedges the cache for longer than one acquisition attempt.

## Search debounce

| Field              | Default | Description                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchDebounceMs` | `500`   | How long (in milliseconds) the web editors' add-card search waits after a keystroke before firing an autocomplete request. Must be a non-negative integer; `0` disables the debounce. The admin editors pick the value up at runtime; the public site bakes it in on the next [build-site](/commands/build-site/). Also editable on the admin [Settings page](/commands/admin/). |

## Cache source

| Field          | Default    | Description                                                                                                                                                                                                                                                                             |
| -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheSource`  | `scryfall` | Where card-cache refreshes download from. `scryfall` hits Scryfall's bulk API directly; `feed` syncs from a peer-to-peer [cache feed](/commands/cache/#feed-fetch) — checking the feed's infohashes and only downloading when they changed — falling back to Scryfall when unreachable. |
| `cacheFeedUrl` | —          | The feed URL used when `cacheSource` is `feed` (and by `cache feed fetch` without `--url`). Must be an http(s) URL; the built-in default is used when absent.                                                                                                                           |

## Collection sync

| Field                       | Default | Description                                                                                                                                                                                                                                                                    |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collectionSync.pullTarget` | `Inbox` | The collection list [`collection-sync pull`](/commands/collection-sync/) adds new cards to. A card that appeared on Archidekt belongs in _some_ binder and only you know which, so every addition lands here; the list is created on first use. Must be a non-empty list name. |

The `collectionSync` key is always present and falls back to its default when omitted. A single run
can override it with `collection-sync pull --into <list>`.

## Export presets (`exportPresets` key)

| Field           | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportPresets` | —       | Named output shapes for the [export](/commands/export/) command: each preset holds a `format` (`csv`/`json`/`text`/`md`), a `columns` array (in output order — stored always, read only by `csv`/`json` output), the CSV toggles `header` and `quoteAll`, and an optional [`dialect`](/commands/export/#dialects) (`ritual` — the default — `archidekt`, `arena`, or `moxfield`): it spells `csv`/`json` values (`archidekt` writes finish and condition the way Archidekt's importer reads them) and picks the `text` decklist's line and board form (`arena` and `moxfield` write bare board markers over `N Name (SET) CN` lines), and is ignored by `md`, which is always Ritual's canonical markdown. Managed with `export --save-preset`, the export wizard, or by hand — `config set` does not manage this key. Present only after a preset has been saved; the built-in `archidekt` preset needs no config, and a saved preset of that name shadows it. |

```json
{
  "exportPresets": {
    "trade-sheet": {
      "format": "csv",
      "columns": ["name", "set", "collectorNumber", "condition", "quantity"],
      "header": true,
      "quoteAll": false
    }
  }
}
```

## Admin options (`admin` key)

The `admin` key holds settings that are configured through, and for, the [admin server](/commands/admin/): git integration for admin file changes, network access control, and login rate limiting. Set them from the admin **Settings** page, with [`config set admin.<field>`](/commands/config/), or by hand. The key is always present and each field falls back to its default when omitted.

### Git integration

| Field                 | Default | Description                                                                                                        |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `admin.gitEnabled`    | `false` | Enable git integration for admin-surface file changes.                                                             |
| `admin.gitAutoCommit` | `false` | When set with `gitEnabled`, writes made through the admin web UI or the MCP server auto-commit the affected files. |
| `admin.gitAutoPush`   | `false` | When set with `gitAutoCommit`, push the commit after creating it.                                                  |

These keys govern the admin surfaces: the admin web UI and the [MCP server](/commands/mcp/), which reuses the admin handlers in-process. CLI commands never auto-commit — including [`ritual import-changes`](/commands/import-changes/), which replays bundles through the same save handlers but suppresses auto-commit, leaving the applied changes in your working tree.

### Network and authentication security

See [Admin → Configuration File](/commands/admin/#configuration-file) for the full reference, including:

- Network options (`admin.trustProxy`, `admin.secureCookies`)
- IP and User-Agent allow/deny lists (`admin.ipAllowList`, `admin.ipDenyList`, `admin.userAgentAllowList`, `admin.userAgentDenyList`)
- Rate limiting (`admin.rateLimitEnabled`, `admin.rateLimitMaxAttempts`, `admin.rateLimitWindowMinutes`, `admin.failedAuthDelayMs`)

## Site config (`site` key)

The `site` key holds public-site settings. It has two parts:

- **Deployment settings** (`version`, `ciSystem`, `deployMode`, `distDir`, `detectChanges`) are managed by `ritual init-site` and present only after you run it. Don't edit them by hand.
- **Publish lists** (`includeDecks`, `includeCollections`, `includeWantedLists` and their `exclude*` counterparts) are user-editable and decide which lists `build-site` publishes. You can set them from the admin **Settings** page, the per-list visibility toggles on the admin **Manage Lists** page, with [`config set`](/commands/config/), or by hand.
- **Other user settings**: `bannedPrintings` (see [`config`](/commands/config/#properties)), `apiBaseUrl` (below), and `sellMode` (below).

```json
{
  "decksDir": "./decks",
  "...": "...",
  "site": {
    "version": "1.2.3",
    "ciSystem": "github-actions",
    "deployMode": "publish-for-me",
    "distDir": "dist",
    "detectChanges": false,
    "includeDecks": ["*"],
    "includeCollections": ["Red Binder", "ECL"],
    "includeWantedLists": ["*"],
    "excludeDecks": ["Untuned Brew"],
    "excludeCollections": [],
    "excludeWantedLists": [],
    "sellMode": false
  }
}
```

| Field                | Default | Description                                                                                      |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `version`            | —       | The Ritual version that initialized the site. Used to drive workflow upgrades.                   |
| `ciSystem`           | —       | `github-actions` or `manual`.                                                                    |
| `deployMode`         | —       | `publish-for-me` or `local-build` (github-actions only).                                         |
| `distDir`            | —       | The directory containing your built site (github-actions only).                                  |
| `detectChanges`      | —       | Whether the workflow runs `detect-changes` (github-actions only).                                |
| `includeDecks`       | `["*"]` | Which decks `build-site` publishes (see below).                                                  |
| `includeCollections` | `["*"]` | Which collections `build-site` publishes.                                                        |
| `includeWantedLists` | `["*"]` | Which wanted lists `build-site` publishes.                                                       |
| `excludeDecks`       | `[]`    | Decks to drop even when `includeDecks` selects them.                                             |
| `excludeCollections` | `[]`    | Collections to drop even when `includeCollections` selects them.                                 |
| `excludeWantedLists` | `[]`    | Wanted lists to drop even when `includeWantedLists` selects them.                                |
| `bannedPrintings`    | `[]`    | Printings barred from default-printing selection (see [`config`](/commands/config/#properties)). |
| `apiBaseUrl`         | —       | Base URL of a live backend for a split deployment (see below).                                   |
| `sellMode`           | `false` | Whether the sites offer [sell mode](/public-site/sell/) (see below).                             |

### Pointing a static build at a live backend (`apiBaseUrl`)

`site.apiBaseUrl` supports the [split deployment](/public-site/hosted/) of the public site: the static build lives on a CDN while a separately hosted [`serve --api`](/commands/serve/#live-api-mode---api) instance provides live list data and cache-backed card search. When set, `build-site` bakes the URL into `index.json` and the site uses that backend, falling back to the baked static data if it's unreachable. Must be an `http(s)` URL (stored without a trailing slash), or the empty string for a site reverse-proxied on the same origin as its API. Leave it unset for a fully static site — `serve --api` itself needs no configuration, since it marks the index it serves.

### Offering sell mode (`sellMode`)

`site.sellMode` decides whether the sites offer [sell mode](/public-site/sell/): Card Kingdom
buylist prices beside each card, the buylist filters, buylist grouping and sorting, and the
sell-cart export. It defaults to **disabled**, because enabling it makes builds and cache refreshes
download and index Card Kingdom's ~70 MB pricelist. Opt in with:

Every feed-touching behavior this key drives — the build's buylist download and quote bake, the servers' startup refresh, the buylist API routes, and `cache preload-all`'s buylist half — is equally triggered by the `cardkingdom` entry of [`priceSources`](#price-stores-pricesources), whose retail prices ride on the same feed. Sell mode itself (the toggle, filters, and cart export) stays governed by this key alone.

```bash
ritual config set site.sellMode true
```

or tick **Offer sell mode** on the admin's [Settings](/commands/admin/#settings) page, which writes
the same key (and removes it, rather than storing `false`, when you untick it).

The key governs **every** surface, the admin site included — it is not a "what a published site
discloses" setting:

- [`build-site`](/commands/build-site/#sell-mode---sell-mode) refreshes the buylist under the run's
  `--refresh` policy and bakes each list's buy prices into its JSON, so a fully static site offers
  sell mode with no backend at all.
- [`serve`](/commands/serve/) bakes the same quotes into the live payloads, and `serve --api` reads
  the key at startup to decide whether to refresh a day-old buylist — turning it on for an
  already-running server leaves that process's feed unwarmed until it restarts.
- [`admin`](/commands/admin/) refreshes the buylist at startup, offers the editors' sell toggle and
  the **Refresh buylist** card, and answers its `/api/sell/*` and `/api/buylist/*` routes. With the
  key off those routes answer `404` and the UI hides the surfaces that call them. Both the routes
  and the UI follow a change to this key immediately — the routes re-read it per request, and a
  Settings save re-reads the effective value — so nothing here needs a restart or a page reload.
- [`cache preload-all`](/commands/cache/#preload-all) refreshes the buylist alongside the card cache.

[`ritual sell`](/commands/sell/) is the deliberate exception: running it _is_ the request for Card
Kingdom prices, so it works whatever this key says.

A single run can opt in without a config write: `--sell-mode` on `build-site`, `serve`, `admin`, or
[`mcp`](/commands/mcp/#sell-tools-need-sell-mode) (see
[Sell mode](/commands/build-site/#sell-mode---sell-mode)). The flag is enable-only and is a session
setting, so `config get site.sellMode` keeps reporting the stored value — and an `admin --sell-mode`
server keeps offering sell mode even after its Settings checkbox is unticked and saved.

A **running** server is the one place that difference is visible: its
[`GET /api/config`](/commands/admin/#get-apiconfig) (and the MCP
[`get_config`](/commands/mcp/#stored-config-vs-what-this-server-runs-with) tool) answers with the
stored config as `config` plus `overrides: {"site.sellMode": true}` when the process was started
with the flag, so a client can tell that this instance answers its sell routes despite the key
being unset on disk. The CLI never reports overrides — each command is a fresh process that has
none.

### Choosing which lists to publish

Each `include*` list controls which lists in that category are published when you run [`build-site`](/commands/build-site/):

- `["*"]` — the reserved wildcard meaning **publish everything** in that category. This is the default, and applies even when there is no `site` key at all.
- An explicit list of **display names** (the list's `# Title` heading, falling back to the file name) — publishes only the matching lists and filters out the rest. Names must match exactly: unlike the `--decks`-style flags, config names are not folded for case, accents, or separators. An entry that matches no list is a warning, not a failure — the build says so and continues:

  ```
  ⚠️  site.includeDecks lists 'Old Name', which matches no deck in /home/you/ritual/decks — it may have been renamed or removed.
  ```

- `[]` — an empty list publishes **none** of that category.

Each category also has a sister `exclude*` list. Any display name in it is dropped even when the `include*` list selects it (including under the wildcard) — **exclusion always wins**. The exclude lists default to `[]` and have no wildcard. This makes "publish everything except a few" easy: keep `includeDecks` at `["*"]` and add the odd one out to `excludeDecks`. The admin **Manage Lists** page's per-list visibility toggles edit only these exclude lists.

The corresponding `build-site` flags (`--decks`, `--collections`, `--wanted-lists`) override these settings for a single run. They accept a superset of these names — display name or file base name, case- and accent-insensitive — and a name they cannot resolve **fails the build** rather than warning, since it was asked for explicitly. See [When a list will not build](/commands/build-site/#when-a-list-will-not-build).

## Editing the file

You can edit the directory keys and the nested `admin` settings in `ritual.config.json` by hand, or — when running the admin server — use the **Settings** page in the web UI. If the file does not exist yet, create it by hand (a `{}` document is valid and means "all defaults") or let `config set` write the first one for you. Saving via the UI also refreshes the in-memory config so any later admin or CLI command picks up the change immediately.

The deployment portion of the `site` key is owned by `ritual init-site`; let that command manage it. The publish lists (`site.includeDecks`, `site.includeCollections`, `site.includeWantedLists` and their `site.exclude*` counterparts) are the exception — they are user settings you can edit from the admin **Settings** page, the **Manage Lists** visibility toggles, or with `config set`.

If a field is missing from the file, Ritual falls back to the default for that field.

### Validation

Invalid values are rejected at the point of entry: [`config set`](/commands/config/) refuses them with an error, and saving from the admin **Settings** page (`PUT /api/config`) rejects the whole update — including unknown top-level keys and wrong-typed fields — before anything is persisted. Values edited into the file by hand are instead validated when the config is loaded: a malformed field (or an invalid `admin` or `site` object) is ignored with a warning and its default applies for that run. Fix the file to clear the warning. A file whose **JSON itself** is broken is not recoverable this way and fails the command outright — see [Malformed files are a hard error](#malformed-files-are-a-hard-error).
