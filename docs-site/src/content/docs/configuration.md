---
title: 'Configuration'
description: The optional ritual.config.json file, every key it accepts, and where each one is edited.
---

Ritual reads its settings from `ritual.config.json` in the base directory: the directory you run it from, or the one named by [`--base-dir`](/cli-conventions/#--base-dir). The file is **optional**. Every setting has a built-in default, so a workspace with no config file behaves like one holding the defaults. Directory paths in the file are resolved relative to the base directory.

## Default settings

Ritual uses these values when there is no config file. A first write puts them on disk:

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

| Field            | Default         | Description                                        |
| ---------------- | --------------- | -------------------------------------------------- |
| `decksDir`       | `./decks`       | Where deck markdown files live.                    |
| `collectionsDir` | `./collections` | Where collection markdown files live.              |
| `wantedDir`      | `./wanted`      | Where wanted-list markdown files live.             |
| `artDir`         | `./art`         | Where [custom card art](/custom-art/) images live. |

Paths are relative to the base directory. With `--base-dir ~/mtg` and `"decksDir": "./my-decks"`, Ritual reads decks from `~/mtg/my-decks`. Absolute paths (`"/srv/mtg/decks"`) and paths outside the base directory (`"../shared-decks"`) also work.

Ritual never creates `artDir`. It reads the directory only when a list references [custom art](/custom-art/); a missing directory means the workspace has none. A card's `file` reference is relative to this directory, so moving the directory or changing `artDir` never breaks a reference.

## Default currency

| Field             | Default | Description                                                     |
| ----------------- | ------- | --------------------------------------------------------------- |
| `defaultCurrency` | `usd`   | The currency price displays default to: `usd`, `eur`, or `tix`. |

This key sets the starting currency for:

- the [price](/commands/price/) command
- the CLI editor's [printing and finish picker price columns](/commands/edit/#printing-and-finish-prices) and the price lines shown when adding or editing cards
- the [admin site](/commands/admin/)'s editor and move-cards price displays
- the public site's initial currency, when an enabled [price store](#price-stores-pricesources) quotes in it. Otherwise the site opens in the first offered currency.

[init-site](/commands/init-site/) prompts for it. Change it later with `config set defaultCurrency eur`.

## Price stores (`priceSources`)

| Field          | Default         | Description                                                      |
| -------------- | --------------- | ---------------------------------------------------------------- |
| `priceSources` | `["tcgplayer"]` | The stores the published and admin sites offer card prices from. |

Use any combination of four store names. The stores also decide which **currencies** the sites offer: only the ones an enabled store quotes in. TIX appears only with `cardhoarder`.

| Store         | Price                                     | Notes                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tcgplayer`   | Scryfall's USD market price (TCGplayer)   | The default.                                                                                                                                                                                                                     |
| `cardmarket`  | Scryfall's EUR trend price (Cardmarket)   | Already in the card cache; no extra download.                                                                                                                                                                                    |
| `cardkingdom` | Card Kingdom's Near Mint **retail** price | Read from the daily pricelist feed [sell mode](/public-site/sell/) also uses. Enabling it makes builds and servers download and refresh that ~70&nbsp;MB feed, like `site.sellMode` does, and opens the same buylist API routes. |
| `cardhoarder` | Scryfall's MTGO tix price (Cardhoarder)   | Already in the card cache. Enable it to offer TIX on the sites.                                                                                                                                                                  |

With both USD stores enabled, list pages gain a **Prices** source selector; see [Prices on the site](/public-site/prices/).

An **empty array** (`config set priceSources --remove tcgplayer`) hides every price surface on the sites: per-card prices, totals, the price sort/filter/grouping, and the currency selector. The CLI [`price`](/commands/price/) command (which has its own `--source` flag) and sell mode are unaffected.

```bash
ritual config set priceSources tcgplayer cardkingdom
ritual config set priceSources --add cardmarket
```

## Default categories

| Field               | Default            | Description                                                                    |
| ------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `defaultCategories` | the fourteen below | The global [category](/list-format/#categories-namecategoriesjson) vocabulary. |

The shipped vocabulary is `Ramp, Draw, Removal, Board Wipes, Counterspells, Tutors, Recursion, Protection, Combo, Tokens, Burn, Lifegain, Finishers, Utility`.

This key decides two things:

- which categories are suggested wherever a category is typed, in the CLI and in both site editors
- the display order of a category that a list's `.categories.json` file does not declare

A list may use any category name; nothing has to be declared here first. Edit the key on the admin **Settings** page as **Default Categories** (comma-separated; see [Settings](/admin/dashboard/#settings)) or with `config set`. The admin site reads the value at runtime; the public site picks it up on the next [build-site](/commands/build-site/).

Each name must follow the [category shape rule](/list-format/#categories-namecategoriesjson). A malformed name is refused where it is typed. A malformed entry found on load warns and resets the whole key to the shipped default. An explicit empty array means no suggestions.

```bash
ritual config set defaultCategories Ramp Draw Removal
ritual config set defaultCategories --add "Board Wipes"
ritual config set defaultCategories --remove Burn
```

## Default language

| Field             | Default | Description                                                                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultLanguage` | `en`    | The language stamped on newly added cards. Also decides [which Scryfall bulk file backs the card cache](#the-all-cards-consequence). |

This key applies to [`add-card`](/commands/add-card/), the editors, and imports whose source states no language. The value is a **Scryfall language code**, stored lowercase:

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

These are **Scryfall's codes, not ISO codes**: Chinese is `zhs`/`zht` (not `zh`), and `grc`/`ph` have no ISO equivalent. `config set defaultLanguage` accepts common aliases (`jp` → `ja`, `kr` → `ko`, `sp` → `es`, `cs` → `zhs`, `ct` → `zht`, and full English names like `Japanese`) and stores the canonical code. The admin **Settings** page offers the same list as a dropdown.

On card lines the language is a bracket token (`[ja]`) that is **omitted for English**. A bare line always means `en`, whatever this key says. The key only controls what is stamped on _new_ cards; it never reinterprets existing lines.

An [`edit`](/commands/edit/) session starts with this key as its [session language](/commands/edit/#the-session-language) and can change it from the `🌐 Card Language` menu row without writing the config file. `edit` also warns once on startup when the key is absent.

### This is not the interface language

`defaultLanguage` decides which **printing of a card** is recorded. The language of **Ritual's own text** is a separate key, [`uiLocale`](#interface-language).

### The all-cards consequence

Any non-English `defaultLanguage` switches every card-cache download from Scryfall's `default_cards` bulk file (one English card object per printing) to the much larger `all_cards` bulk file, which carries every language. This covers [`cache preload-all`](/commands/cache/), the freshness prompts, and the [cache feed](/commands/cache/#feed-fetch). Expect a several-times-larger download and cache.

The cache records which bulk file built it. When that disagrees with `defaultLanguage`, in either direction, commands that check cache freshness offer a full redownload, or run one under `--refresh auto`. See [`cache status`](/commands/cache/#status).

## Interface language

| Field      | Default | Description                                                                                                                                                                                          |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uiLocale` | `en`    | The language of **Ritual's own interface text**: CLI output, prompts, menus, help, and both web apps. A [BCP-47](https://www.rfc-editor.org/info/bcp47) tag such as `en`, `de`, `de-AT`, or `pt-BR`. |

The tag is stored canonicalized (`de-at` is persisted as `de-AT`).

:::caution[`uiLocale` is not `defaultLanguage`]

- **`uiLocale`** picks the language **Ritual speaks to you**. BCP-47 tags. Free to change.
- **[`defaultLanguage`](#default-language)** picks which **printing of a card** is recorded. Scryfall's own codes (`ja`, `zhs`, `ph`, …). A non-English value switches the card cache to the [much larger `all_cards` bulk file](#the-all-cards-consequence).

The two are independent, and every combination is valid. Setting one never changes the other.
:::

You can override the value per run or per shell without touching the file. When the key is absent, Ritual falls back to detecting your OS locale:

```
--locale <tag>  →  RITUAL_LOCALE  →  uiLocale  →  OS detection  →  en
```

`ritual locale` prints which of those tiers won, beside the current `defaultLanguage`. Detection has limits, notably [under WSL and on native Windows](/localization/#what-ritual-can-detect-per-platform); on those platforms set this key.

Where the value takes effect:

- The CLI and the admin site read it at runtime. It is also editable on the admin [Settings page](/admin/dashboard/#settings).
- The public site picks it up on the next [build-site](/commands/build-site/#localized-builds), where `--locale` overrides it for one build.
- A live-backend [`serve --api`](/commands/serve/#live-api-mode---api) deployment reports the current value on every index request with no rebuild.

**Translations are separate from this setting.** No translated catalogs ship yet, so every value renders English text today. Dates, numbers, and currency do follow the tag. See [Localization](/localization/), including how to contribute a translation.

## Cache lock timeout

| Field                     | Default | Description                                                                                              |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `cacheLockTimeoutSeconds` | `300`   | How long a cache refresh waits for another process's refresh to finish before failing. Positive integer. |

Refreshes take an exclusive lock (`cache/.ritual-cache-lock`) so concurrent processes (CLI commands, the [cache server](/commands/cache/#server), the [admin server](/commands/admin/)) never interleave writes. A waiting process breaks the lock immediately when its holder is provably no longer running, so a stale lock from a crash never blocks the cache for longer than one attempt.

## Search debounce

| Field              | Default | Description                                                                                                                                        |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchDebounceMs` | `500`   | Milliseconds the web editors' add-card search waits after a keystroke before requesting autocomplete. Non-negative integer; `0` disables the wait. |

The admin editors read the value at runtime. The public site picks it up on the next [build-site](/commands/build-site/). Also editable on the admin [Settings page](/admin/dashboard/).

## Cache source

| Field          | Default    | Description                                                                                                                                               |
| -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheSource`  | `scryfall` | Where card-cache refreshes download from: `scryfall` (Scryfall's bulk API directly) or `feed` (a peer-to-peer [cache feed](/commands/cache/#feed-fetch)). |
| `cacheFeedUrl` | —          | The feed URL used when `cacheSource` is `feed`, and by `cache feed fetch` without `--url`. Must be an http(s) URL.                                        |

With `feed`, a refresh checks the feed's infohashes and downloads only when they changed. It falls back to Scryfall when the feed is unreachable. When `cacheFeedUrl` is absent, the built-in default feed is used.

## Collection sync

| Field                       | Default | Description                                                                                                      |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `collectionSync.pullTarget` | `Inbox` | The collection list [`collection-sync pull`](/commands/collection-sync/) adds new cards to. Non-empty list name. |

Every card that appeared on Archidekt lands in this list, which is created on first use. Only you know which binder it belongs in, so move it from there. The key falls back to its default when omitted. Override it for one run with `collection-sync pull --into <list>`.

## Export presets (`exportPresets` key)

| Field           | Default | Description                                                      |
| --------------- | ------- | ---------------------------------------------------------------- |
| `exportPresets` | —       | Named output shapes for the [export](/commands/export/) command. |

Each preset holds:

- `format`: `csv`, `json`, `text`, or `md`
- `columns`: an array in output order. Always stored; read only by `csv`/`json` output.
- `header` and `quoteAll`: the CSV toggles
- `dialect` (optional): `ritual` (the default), `archidekt`, `arena`, or `moxfield`. See [dialects](/commands/export/#dialects). A dialect spells `csv`/`json` values (`archidekt` writes finish and condition the way Archidekt's importer reads them) and picks the `text` decklist's line and board form (`arena` and `moxfield` write bare board markers over `N Name (SET) CN` lines). `md` ignores it and always writes Ritual's canonical markdown.

Manage presets with `export --save-preset`, the export wizard, or by hand; `config set` does not manage this key. The key is present only after a preset has been saved. The built-in `archidekt` preset needs no config; a saved preset of that name shadows it.

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

The `admin` key holds settings for the [admin server](/commands/admin/): git integration, network access control, and login rate limiting. Set them from the admin **Settings** page, with [`config set admin.<field>`](/commands/config/), or by hand. Each field falls back to its default when omitted.

### Git integration

| Field                 | Default | Description                                                                              |
| --------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `admin.gitEnabled`    | `false` | Enable git integration for admin-surface file changes.                                   |
| `admin.gitAutoCommit` | `false` | With `gitEnabled`, auto-commit files written through the admin web UI or the MCP server. |
| `admin.gitAutoPush`   | `false` | With `gitAutoCommit`, push each commit after creating it.                                |

These keys apply to the admin web UI and the [MCP server](/commands/mcp/). CLI commands never auto-commit, including [`ritual import-changes`](/commands/import-changes/), which leaves applied changes in your working tree.

### Network and authentication security

The remaining `admin` keys secure the server. The [`config` property table](/commands/config/#properties) lists their types and defaults, and the [admin command's Security section](/commands/admin/#security) explains each one:

- Network options (`admin.trustProxy`, `admin.secureCookies`)
- IP and User-Agent allow/deny lists (`admin.ipAllowList`, `admin.ipDenyList`, `admin.userAgentAllowList`, `admin.userAgentDenyList`)
- Rate limiting (`admin.rateLimitEnabled`, `admin.rateLimitMaxAttempts`, `admin.rateLimitWindowMinutes`, `admin.failedAuthDelayMs`)

## Site config (`site` key)

The `site` key holds public-site settings in three groups:

- **Deployment settings** (`version`, `ciSystem`, `deployMode`, `distDir`, `detectChanges`). `ritual init-site` manages them, and they exist only after you run it. Don't edit them by hand.
- **Publish lists** (`includeDecks`, `includeCollections`, `includeWantedLists` and their `exclude*` counterparts) decide which lists `build-site` publishes. Set them from the admin **Settings** page, the per-list visibility toggles on the admin **Manage Lists** page, with [`config set`](/commands/config/), or by hand.
- **Other user settings**: `bannedPrintings` (see [`config`](/commands/config/#properties)), `apiBaseUrl`, and `sellMode`, described below.

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
| `version`            | —       | The Ritual version that initialized the site. Drives workflow upgrades.                          |
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

`site.apiBaseUrl` supports a [split deployment](/public-site/hosted/): the static build lives on a CDN, and a separately hosted [`serve --api`](/commands/serve/#live-api-mode---api) instance provides live list data and card search. When set, `build-site` writes the URL into `index.json`, and the site uses that backend. If the backend is unreachable, the site falls back to its static data.

The value must be an `http(s)` URL (stored without a trailing slash), or the empty string for a site reverse-proxied on the same origin as its API. Leave it unset for a fully static site. `serve --api` itself needs no configuration.

### Offering sell mode (`sellMode`)

`site.sellMode` decides whether the sites offer [sell mode](/public-site/sell/): Card Kingdom buylist prices beside each card, the buylist filters, buylist grouping and sorting, and the sell-cart export. It defaults to **off**, because enabling it makes builds and cache refreshes download and index Card Kingdom's ~70 MB pricelist. Opt in with:

```bash
ritual config set site.sellMode true
```

or tick **Offer sell mode** on the admin's [Settings](/admin/dashboard/#settings) page. Unticking it removes the key rather than storing `false`.

The `cardkingdom` entry of [`priceSources`](#price-stores-pricesources) uses the same feed and turns on the same feed behavior: the build's buylist download and quote generation, the servers' startup refresh, and the buylist API routes. (`cache preload-all` refreshes the buylist only under `site.sellMode`.) Sell mode itself (the toggle, filters, and cart export) is governed by this key alone.

The key governs **every** surface, the admin site included:

- [`build-site`](/commands/build-site/#sell-mode---sell-mode) refreshes the buylist under the run's `--refresh` policy and writes each list's buy prices into its JSON, so a fully static site offers sell mode with no backend.
- [`serve`](/commands/serve/) includes the same quotes in its live payloads. `serve --api` reads the key at startup to decide whether to refresh a day-old buylist, so turning it on for a running server leaves that process's feed unrefreshed until it restarts.
- [`admin`](/commands/admin/) refreshes the buylist at startup, offers the editors' sell toggle and the **Refresh buylist** card, and answers its `/api/sell/*` and `/api/buylist/*` routes. With the key off those routes answer `404` and the UI hides the surfaces that call them. Both follow a change to this key immediately; no restart or page reload is needed.
- [`cache preload-all`](/commands/cache/#preload-all) refreshes the buylist alongside the card cache.

[`ritual sell`](/commands/sell/) is the exception: running it is itself the request for Card Kingdom prices, so it works whatever this key says.

A single run can opt in without a config write: `--sell-mode` on `build-site`, `serve`, `admin`, or [`mcp`](/commands/mcp/#sell-tools-need-sell-mode) (see [Sell mode](/commands/build-site/#sell-mode---sell-mode)). The flag is enable-only and lasts for that process, so `config get site.sellMode` keeps reporting the stored value, and an `admin --sell-mode` server keeps offering sell mode even after its Settings checkbox is unticked and saved.

A **running** server started with the flag reports it: [`GET /api/config`](/admin/api/#get-config) and the MCP [`get_config`](/commands/mcp/#stored-config-vs-what-this-server-runs-with) tool answer with the stored config as `config` plus `overrides: {"site.sellMode": true}`. The CLI never reports overrides, since each command is a fresh process.

### Choosing which lists to publish

Each `include*` list controls which lists in that category [`build-site`](/commands/build-site/) publishes:

- `["*"]` means **publish everything** in that category. This is the default, and applies even when there is no `site` key at all.
- An explicit list of **display names** (the list's `# Title` heading, falling back to the file name) publishes only the matching lists. Names must match exactly: unlike the `--decks`-style flags, config names are not folded for case, accents, or separators. An entry that matches no list is a warning, not a failure:

  ```
  ⚠️  site.includeDecks lists 'Old Name', which matches no deck in /home/you/ritual/decks — it may have been renamed or removed.
  ```

- `[]` publishes **none** of that category.

Each category also has an `exclude*` list. Any display name in it is dropped even when the `include*` list selects it, including under the wildcard. **Exclusion always wins.** The exclude lists default to `[]` and have no wildcard. To publish everything except a few lists, keep `includeDecks` at `["*"]` and add the exceptions to `excludeDecks`. The admin **Manage Lists** page's per-list visibility toggles edit only these exclude lists.

The `build-site` flags `--decks`, `--collections`, and `--wanted-lists` override these settings for one run. They accept display names or file base names, case- and accent-insensitive. A name they cannot resolve **fails the build** rather than warning. See [When a list will not build](/commands/build-site/#when-a-list-will-not-build).

## Editing the file

Edit `ritual.config.json` by hand, with [`config set`](/commands/config/), or from the admin **Settings** page. If the file does not exist, create it by hand (a `{}` document is valid and means "all defaults") or let `config set` write the first one. Saving from the admin UI also refreshes the in-memory config, so later admin or CLI commands pick up the change immediately.

`ritual init-site` owns the deployment portion of the `site` key. The publish lists (`site.includeDecks`, `site.includeCollections`, `site.includeWantedLists` and their `site.exclude*` counterparts) are user settings you can edit from the admin **Settings** page, the **Manage Lists** visibility toggles, or with `config set`.

A field missing from the file takes its default.

### Validation

Invalid values are rejected where they are entered. [`config set`](/commands/config/) refuses them with an error. Saving from the admin **Settings** page (`PUT /api/config`) rejects the whole update, including unknown top-level keys and wrong-typed fields, before anything is persisted.

Values edited into the file by hand are validated when the config loads. A malformed field (or an invalid `admin` or `site` object) is ignored with a warning, and its default applies for that run. Fix the file to clear the warning. A file whose **JSON itself** is broken fails the command outright; see [Malformed files are a hard error](#malformed-files-are-a-hard-error).

## When the file is created

Reading the config never creates it. The file appears only when something **writes** a setting:

- [`ritual config set`](/commands/config/) (or `config unset`)
- [`ritual init-site`](/commands/init-site/), which records the `site` key
- the admin server's **Settings** page or the MCP `update_config` tool (both `PUT /api/config`), and other admin writes such as the **Manage Lists** visibility toggles
- [`ritual export --save-preset`](/commands/export/#presets)

A plain `ritual lists` in a fresh directory leaves it untouched. A workspace is defined by its `decks/`, `collections/`, and `wanted/` folders, not by a config file.

The first write puts the full defaulted document on disk, not just the key you set. See [`config list`](/commands/config/#config-list) on why its `(default)` markers say nothing about which keys are on disk.

## Malformed files are a hard error

If `ritual.config.json` exists but is not valid JSON, or is not a JSON object, the command **fails** instead of falling back to defaults. The file is never rewritten:

```
$ ritual lists
ritual.config.json is not valid JSON: /home/you/mtg/ritual.config.json
  JSON Parse error: Property name must be a string literal
Fix the file (or delete it to fall back to defaults) and try again.
```

The exit code is `1`. Failing loudly protects your settings: treating a broken file as "no config" would let the next write replace what is still on disk. Fix the syntax, or delete the file to start again from defaults.

This applies to the whole document. A single field with a bad value is a softer failure; see [Validation](#validation).
