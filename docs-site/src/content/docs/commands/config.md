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

| Property                  | Type       | Default         |
| ------------------------- | ---------- | --------------- |
| `decksDir`                | `string`   | `./decks`       |
| `collectionsDir`          | `string`   | `./collections` |
| `wantedDir`               | `string`   | `./wanted`      |
| `artDir`                  | `string`   | `./art`         |
| `defaultCurrency`         | `string`   | `usd`           |
| `priceSources`            | `string[]` | `["tcgplayer"]` |
| `defaultLanguage`         | `string`   | `en`            |
| `uiLocale`                | `string`   | `en`            |
| `cacheLockTimeoutSeconds` | `number`   | `300`           |
| `cacheSource`             | `string`   | `scryfall`      |
| `cacheFeedUrl`            | `string`   | —               |
| `searchDebounceMs`        | `number`   | `500`           |

`artDir` is where [custom card art](/custom-art/) images live, the directory a card's `file` reference is relative to. It is never created. A missing directory just means the workspace has no local art.

`defaultCurrency` must be one of `usd`, `eur`, or `tix`. It sets the currency every price-touching command defaults to.

`priceSources` lists the stores the sites offer prices from: any of `tcgplayer` (Scryfall USD), `cardmarket` (Scryfall EUR), and `cardkingdom` (Card Kingdom NM retail). Values are lowercased and deduped, and unknown store names are rejected. Being an array, it works with `--add`/`--remove`; removing every entry hides all price UI on the sites. Enabling `cardkingdom` makes builds and servers download the Card Kingdom feed like [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) does. See [Configuration → Price stores](/configuration/#price-stores-pricesources).

`defaultLanguage` is the Scryfall language code stamped on newly added cards: `en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`. These are Scryfall's codes, not ISO, so Chinese is `zhs`/`zht`. `config set` accepts aliases (`jp`, `Japanese`, ...) and persists the canonical code; an unknown value is rejected listing all 17 codes. **A non-English value switches card-cache downloads, including the cache feed, to Scryfall's much larger `all_cards` bulk.** See [Configuration → Default language](/configuration/#default-language).

`uiLocale` is the language **Ritual's own interface text** is written in: a BCP-47 tag (`en`, `de`, `de-AT`, `pt-BR`), persisted canonicalized (`de-at` → `de-AT`). A tag no language is known for is rejected. **This is not `defaultLanguage`**: that one picks which _printing of a card_ is recorded and has a real download cost, while this one only changes what language Ritual speaks. See [Configuration → Interface language](/configuration/#interface-language), [Localization](/localization/), and [`ritual locale`](/commands/locale/), which prints both settings side by side.

`cacheLockTimeoutSeconds` is how long a cache-refreshing operation waits for another process's refresh to finish before failing. See [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).

`cacheSource` must be `scryfall` or `feed`, and `cacheFeedUrl` must be an http(s) URL. Together they route cache refreshes through a peer-to-peer [cache feed](/commands/cache/#feed-fetch). See [Configuration → Cache source](/configuration/#cache-source).

`searchDebounceMs` is how long the web editors' add-card search waits after a keystroke before querying autocomplete. It is a non-negative integer, and `0` disables the debounce. See [Configuration → Search debounce](/configuration/#search-debounce).

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

The nested `collectionSync` key, settings for [`collection-sync`](/commands/collection-sync/), uses dot notation too:

| Property                    | Type     | Default |
| --------------------------- | -------- | ------- |
| `collectionSync.pullTarget` | `string` | `Inbox` |

`collectionSync.pullTarget` names the collection list a `collection-sync pull` adds new cards to, created on first use. It must be a non-empty list name, and `--into` overrides it for one run. See [Configuration → Collection sync](/configuration/#collection-sync).

The following nested `site` keys, the [public-site publish lists](/commands/build-site/#choosing-which-lists-to-build) and other public-site settings, are also settable:

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

Each `exclude*` list drops lists by display name even when the matching `include*` list selects them. Exclusion always wins. The exclude lists have no wildcard and default to empty. The admin **Manage Lists** page edits them through per-list [visibility toggles](/admin/manage-lists/#publishing-visibility).

`site.bannedPrintings` blocks specific printings from being chosen as a card's **default (featured) printing** when no printing is otherwise specified. Each entry is a `SET:COLLECTOR` pair (e.g. `SLD:123`). Ritual normally features the most recent non-outlier printing among a card's five newest priced printings. When that printing is banned, it skips to the next eligible one. A banned printing can still be viewed and entered manually; it is only barred from automatic selection. Set codes are stored lowercase, and the value you pass may use either case.

`site.apiBaseUrl` points a statically deployed site at a separately hosted [`serve --api`](/commands/serve/#live-api-mode---api) backend. It must be an `http(s)` URL (stored without a trailing slash) or the empty string for a same-origin reverse proxy. See [Hosting with a live backend](/public-site/hosted/).

`site.sellMode` decides whether the sites offer [sell mode](/public-site/sell/), the admin site included. It defaults to **off**, because turning it on makes every build and cache refresh download and index Card Kingdom's ~70 MB buylist. Set it to `true` to opt in. A single run can opt in without a config write using `--sell-mode` on [`build-site`](/commands/build-site/#sell-mode---sell-mode), [`serve`](/commands/serve/), [`admin`](/commands/admin/), or [`mcp`](/commands/mcp/#sell-tools-need-sell-mode). `config get site.sellMode` keeps reporting the stored value under such a run, and exits `3` (`not_found`) when the key has never been set, since the flag is a session setting rather than configuration. The admin's [Settings](/admin/dashboard/#settings) page writes the same key from its **Offer sell mode** checkbox. Unticking it is a `config unset site.sellMode`, not a stored `false`. See [Offering sell mode](/configuration/#offering-sell-mode-sellmode).

The rest of the `site` key (the deployment settings) is managed exclusively by `ritual init-site` and cannot be set or unset with this command. `exportPresets` is managed by [`ritual export --save-preset`](/commands/export/). It can be read with `config get exportPresets` but not written here.

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

`--add` and `--remove` are mutually exclusive, and only apply to `string[]` properties.

### Value types

- **`string`**: passed as-is.
- **`boolean`**: must be `true` or `false` (case-insensitive).
- **`number`**: must be a non-negative integer.
- **`string[]`**: one or more values. By default the whole array is replaced. Use `--add` or `--remove` to modify individual entries. Arrays are treated as sets, so duplicate values are ignored.

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

Prints the effective value of a single property: the value the rest of Ritual actually uses, whether it came from the file or a built-in default. Text output is the bare value (arrays and objects as JSON), and `--output json` emits the value as JSON.

```bash
$ ritual config get decksDir
./decks
$ ritual config get admin.ipAllowList --output json
["192.168.1.0/24"]
```

Genuinely optional keys that have never been set (`cacheFeedUrl`, `exportPresets`, `site.bannedPrintings`, `site.apiBaseUrl`, `site.sellMode`, and the `site.*` selection lists before a `site` object exists) exit with `not_found` (code `3`). An unknown property is a usage error (code `2`) that lists the available keys.

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

`(default)` marks keys whose value **equals** the built-in default, and `(unset)` marks optional keys with no value. The marker is computed by comparing values against the built-in defaults, not by checking whether the key is present in `ritual.config.json`. Any write to the config file materializes the defaulted keys onto disk, so file presence says nothing about whether you customized a value. For the `site.*` selection lists the comparison uses their documented effective defaults (`["*"]` for include lists, `[]` for exclude lists).

`--output json` emits the effective config as one JSON object, the same payload the admin server's [`GET /api/config`](/admin/api/#get-config) (and the MCP `get_config` tool) reports as its `config` field. Those two can report one thing this command cannot: a **running** server started with a session flag such as `--sell-mode` also answers with an `overrides` object saying what it is actually operating with. A CLI run is a fresh process with no session overrides, so there is nothing here to report.

## config unset

```bash
ritual config unset <property>
```

Removes a property from `ritual.config.json`:

- For keys with a built-in default the value reverts to that default: `Reset decksDir to default (./decks)`.
- For genuinely optional keys the value is simply removed: `Unset cacheFeedUrl`.

Unsetting a key that is already at its default (or was never set) succeeds with the same message, so the command is idempotent. Nested parents that become empty are pruned from the file. The `site` deployment keys are owned by `ritual init-site` and cannot be unset here.

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

- Changes are written to `ritual.config.json` immediately. `config set`/`unset` are what **create** the file if it does not exist yet; reading config never does. See [Configuration](/configuration/#when-the-file-is-created).
- If the existing file is not valid JSON, every subcommand, including `set`, fails with exit `1` and leaves the file untouched, so a hand-edit typo can never be overwritten with defaults.
- A running admin server picks up config changes on its next request. It does not need to be restarted.
- Use `--base-dir` to target a config file in a directory other than the current working directory. The directory must already exist.
