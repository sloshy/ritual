---
title: 'config'
---

Read and change `ritual.config.json` from the command line. The `config` group has four subcommands:

```bash
ritual config set <property> <value...>   # set or update a value
ritual config get <property>              # print one effective value
ritual config list                        # print the full effective configuration
ritual config unset <property>            # remove a value, reverting to its default
```

All subcommands accept the standard scripting options:

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |
| `--quiet`           | Suppress non-essential output              | `false` |

## Properties

Each key is described in full on the [Configuration](/configuration/) page. This section lists what `config` can set, with the validation each value gets.

| Property                  | Type       | Default              |
| ------------------------- | ---------- | -------------------- |
| `decksDir`                | `string`   | `./decks`            |
| `collectionsDir`          | `string`   | `./collections`      |
| `wantedDir`               | `string`   | `./wanted`           |
| `artDir`                  | `string`   | `./art`              |
| `defaultCurrency`         | `string`   | `usd`                |
| `priceSources`            | `string[]` | `["tcgplayer"]`      |
| `defaultCategories`       | `string[]` | the 14 shipped names |
| `defaultLanguage`         | `string`   | `en`                 |
| `uiLocale`                | `string`   | `en`                 |
| `cacheLockTimeoutSeconds` | `number`   | `300`                |
| `cacheSource`             | `string`   | `scryfall`           |
| `cacheFeedUrl`            | `string`   | —                    |
| `searchDebounceMs`        | `number`   | `500`                |

- `artDir`: where [custom card art](/custom-art/) images live. Never created; a missing directory means no local art.
- `defaultCurrency`: `usd`, `eur`, or `tix`.
- `priceSources`: any of `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), `cardkingdom` (Card Kingdom NM retail), `cardhoarder` (Scryfall MTGO tix). Values are lowercased and deduped; unknown store names are rejected. Works with `--add`/`--remove`. Removing every entry hides all price UI on the sites. Enabling `cardkingdom` makes builds and servers download the Card Kingdom feed, like [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) does. See [Price stores](/configuration/#price-stores-pricesources).
- `defaultCategories`: the global category vocabulary suggested wherever a category is typed. Works with `--add`/`--remove`; each name must follow the category shape rule. See [Default categories](/configuration/#default-categories).
- `defaultLanguage`: a Scryfall language code (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`), not ISO. Aliases (`jp`, `Japanese`, …) are accepted and the canonical code is stored. An unknown value is rejected with the list of all 17 codes. **A non-English value switches card-cache downloads, including the cache feed, to Scryfall's much larger `all_cards` bulk file.** See [Default language](/configuration/#default-language).
- `uiLocale`: the language of **Ritual's own interface text**, as a BCP-47 tag (`en`, `de`, `de-AT`, `pt-BR`), stored canonicalized (`de-at` → `de-AT`). A tag with no known language is rejected. **This is not `defaultLanguage`**, which picks the card printing and has a download cost. See [Interface language](/configuration/#interface-language), [Localization](/localization/), and [`ritual locale`](/commands/locale/).
- `cacheLockTimeoutSeconds`: how long a cache refresh waits for another process's refresh before failing. See [Cache lock timeout](/configuration/#cache-lock-timeout).
- `cacheSource`: where card-cache refreshes download from, `scryfall` or `feed`. `cacheFeedUrl` is the feed URL and must be an http(s) URL. See [Cache source](/configuration/#cache-source).
- `searchDebounceMs`: how long the web editors' add-card search waits after a keystroke before querying autocomplete. A non-negative integer; `0` disables the debounce. See [Search debounce](/configuration/#search-debounce).

The nested `admin` keys, settings for the [admin server](/commands/admin/), use dot notation:

| Property                       | Type       | Default |
| ------------------------------ | ---------- | ------- |
| `admin.gitEnabled`             | `boolean`  | `false` |
| `admin.gitAutoCommit`          | `boolean`  | `false` |
| `admin.gitAutoPush`            | `boolean`  | `false` |
| `admin.trustProxy`             | `boolean`  | `false` |
| `admin.secureCookies`          | `boolean`  | `false` |
| `admin.ipAllowList`            | `string[]` | `[]`    |
| `admin.ipDenyList`             | `string[]` | `[]`    |
| `admin.userAgentAllowList`     | `string[]` | `[]`    |
| `admin.userAgentDenyList`      | `string[]` | `[]`    |
| `admin.rateLimitEnabled`       | `boolean`  | `true`  |
| `admin.rateLimitMaxAttempts`   | `number`   | `5`     |
| `admin.rateLimitWindowMinutes` | `number`   | `5`     |
| `admin.failedAuthDelayMs`      | `number`   | `3000`  |

The nested `collectionSync` key, for [`collection-sync`](/commands/collection-sync/):

| Property                    | Type     | Default |
| --------------------------- | -------- | ------- |
| `collectionSync.pullTarget` | `string` | `Inbox` |

`collectionSync.pullTarget` names the collection list a `collection-sync pull` adds new cards to, created on first use. It must be a non-empty list name; `--into` overrides it for one run. See [Collection sync](/configuration/#collection-sync).

The nested `site` keys, the [public-site publish lists](/commands/build-site/#choosing-which-lists-to-build) and other public-site settings:

| Property                  | Type       | Default |
| ------------------------- | ---------- | ------- |
| `site.includeDecks`       | `string[]` | `["*"]` |
| `site.includeCollections` | `string[]` | `["*"]` |
| `site.includeWantedLists` | `string[]` | `["*"]` |
| `site.excludeDecks`       | `string[]` | `[]`    |
| `site.excludeCollections` | `string[]` | `[]`    |
| `site.excludeWantedLists` | `string[]` | `[]`    |
| `site.bannedPrintings`    | `string[]` | `[]`    |
| `site.apiBaseUrl`         | `string`   | —       |
| `site.sellMode`           | `boolean`  | `false` |

- `site.exclude*`: drops lists by display name even when the matching `include*` list selects them. Exclusion always wins. No wildcard. The admin **Manage Lists** page edits these through per-list [visibility toggles](/admin/manage-lists/#publishing-visibility).
- `site.bannedPrintings`: printings that may not be chosen as a card's **default (featured) printing** when none is specified. Each entry is a `SET:COLLECTOR` pair (e.g. `SLD:123`). Ritual normally features the most recent non-outlier printing among a card's five newest priced printings; a banned one is skipped for the next eligible printing. A banned printing can still be viewed and entered by hand. Set codes are stored lowercase; either case is accepted.
- `site.apiBaseUrl`: points a statically deployed site at a separately hosted [`serve --api`](/commands/serve/#live-api-mode---api) backend. An `http(s)` URL (stored without a trailing slash), or the empty string for a same-origin reverse proxy. See [Hosting with a live backend](/public-site/hosted/).
- `site.sellMode`: whether the sites, admin included, offer [sell mode](/public-site/sell/). Off by default because it makes every build and cache refresh download Card Kingdom's ~70 MB buylist. `--sell-mode` on [`build-site`](/commands/build-site/#sell-mode---sell-mode), [`serve`](/commands/serve/), [`admin`](/commands/admin/), or [`mcp`](/commands/mcp/#sell-tools-need-sell-mode) opts in for one run without a config write; `config get site.sellMode` still reports the stored value, and exits `3` (`not_found`) when the key was never set. The admin [Settings](/admin/dashboard/#settings) page's **Offer sell mode** checkbox writes this key; unticking it is a `config unset site.sellMode`, not a stored `false`. See [Offering sell mode](/configuration/#offering-sell-mode-sellmode).

The rest of the `site` key (the deployment settings) belongs to `ritual init-site` and cannot be set or unset here. `exportPresets` belongs to [`ritual export --save-preset`](/commands/export/); `config get exportPresets` reads it, but it cannot be written here.

## config set

```bash
ritual config set [options] <property> <value...>
```

| Argument     | Description                                     | Required |
| ------------ | ----------------------------------------------- | -------- |
| `<property>` | The config key to set (dot notation for nested) | Yes      |
| `<value...>` | One or more values to set                       | Yes      |

| Option     | Description                                          |
| ---------- | ---------------------------------------------------- |
| `--add`    | Append value(s) to an array property (no duplicates) |
| `--remove` | Remove value(s) from an array property               |

`--add` and `--remove` are mutually exclusive and apply only to `string[]` properties.

### Value types

- **`string`**: passed as-is.
- **`boolean`**: `true` or `false` (case-insensitive).
- **`number`**: a non-negative integer (`cacheLockTimeoutSeconds` must be positive).
- **`string[]`**: one or more values. The whole array is replaced unless you use `--add` or `--remove`. Arrays are sets: duplicate values are ignored.

### Examples

```bash
ritual config set admin.gitEnabled true
ritual config set decksDir ./my-decks
ritual config set defaultLanguage ja        # aliases work too: jp, Japanese
ritual config set uiLocale de-AT            # the interface language, not the card language
ritual config set admin.ipAllowList "192.168.1.0/24" "10.0.0.1"   # replaces the whole list
ritual config set --add admin.ipAllowList "10.0.0.2"
ritual config set --remove admin.ipAllowList "10.0.0.1"
ritual config set site.includeDecks "Izzet Storm" "Atraxa Superfriends"
ritual config set site.includeCollections "*"                     # back to "everything"
ritual config set --add site.excludeDecks "Untuned Brew"
ritual config set --add site.bannedPrintings "SLD:123"
```

## config get

```bash
ritual config get <property>
```

Prints the effective value of one property: what Ritual uses, whether from the file or a built-in default. Text output is the bare value (arrays and objects as JSON); `--output json` emits the value as JSON.

```bash
$ ritual config get decksDir
./decks
$ ritual config get admin.ipAllowList --output json
["192.168.1.0/24"]
```

Optional keys that have never been set exit with `not_found` (code `3`): `cacheFeedUrl`, `exportPresets`, `site.bannedPrintings`, `site.apiBaseUrl`, `site.sellMode`, and the `site.*` selection lists before a `site` object exists. An unknown property is a usage error (code `2`) that lists the available keys.

## config list

```bash
ritual config list
```

Prints the full effective configuration as flat `key = value` lines (dot notation for nested keys), one per settable property:

```text
decksDir = ./my-decks
collectionsDir = ./collections (default)
...
cacheFeedUrl = (unset)
admin.gitEnabled = false (default)
```

`(default)` marks keys whose value **equals** the built-in default; `(unset)` marks optional keys with no value. The marker compares values against the defaults, not against what is in `ritual.config.json`: any write puts the defaulted keys on disk, so file presence says nothing about whether you customized a value. The `site.*` selection lists compare against their effective defaults (`["*"]` for include lists, `[]` for exclude lists).

`--output json` emits the effective config as one JSON object, the same payload the admin server's [`GET /api/config`](/admin/api/#get-config) and the MCP `get_config` tool report as `config`. Those two can also report an `overrides` object when the running server was started with a session flag such as `--sell-mode`. A CLI run is a fresh process with no overrides to report.

## config unset

```bash
ritual config unset <property>
```

Removes a property from `ritual.config.json`:

- A key with a built-in default reverts to it: `Reset decksDir to default (./decks)`.
- An optional key is removed: `Unset cacheFeedUrl`.

Unsetting a key that is already at its default (or was never set) succeeds with the same message. Nested parents that become empty are removed from the file. The `site` deployment keys belong to `ritual init-site` and cannot be unset here.

```bash
ritual config unset decksDir
ritual config unset cacheFeedUrl
ritual config unset site.includeDecks    # back to ["*"] (publish everything)
```

## Exit Codes

| Code | Meaning                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| `0`  | Success (including idempotent `unset` of an already-default key)                                |
| `1`  | Runtime error (including a `ritual.config.json` that is not valid JSON)                         |
| `2`  | Usage error (unknown property, invalid value, `--add`/`--remove` misuse, init-site-managed key) |
| `3`  | Not found (`get` on an optional key that is not set)                                            |

## Notes

- Changes are written to `ritual.config.json` immediately. `config set`/`unset` **create** the file if it does not exist; reading config never does. See [Configuration](/configuration/#when-the-file-is-created).
- If the existing file is not valid JSON, every subcommand, including `set`, fails with exit `1` and leaves the file untouched, so a hand-edit typo is never overwritten with defaults.
- A running admin server picks up config changes on its next request. No restart is needed.
- Use `--base-dir` to target a config file in another directory. The directory must already exist.
