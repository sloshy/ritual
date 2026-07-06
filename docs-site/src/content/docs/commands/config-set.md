---
title: 'config-set'
---

Set or update a value in `ritual.config.json`.

## Usage

```bash
./ritual config-set [options] <property> <value...>
```

| Argument     | Description                                     | Required |
| ------------ | ----------------------------------------------- | -------- |
| `<property>` | The config key to set (dot notation for nested) | Yes      |
| `<value...>` | One or more values to set                       | Yes      |

| Option     | Description                                          |
| ---------- | ---------------------------------------------------- |
| `--add`    | Append value(s) to an array property (no duplicates) |
| `--remove` | Remove value(s) from an array property               |

## Settable properties

| Property                  | Type     | Default         |
| ------------------------- | -------- | --------------- |
| `decksDir`                | `string` | `./decks`       |
| `collectionsDir`          | `string` | `./collections` |
| `wantedDir`               | `string` | `./wanted`      |
| `defaultCurrency`         | `string` | `usd`           |
| `cacheLockTimeoutSeconds` | `number` | `300`           |
| `cacheSource`             | `string` | `scryfall`      |
| `cacheFeedUrl`            | `string` | —               |

`defaultCurrency` must be one of `usd`, `eur`, or `tix`; it sets the currency every price-touching command defaults to.

`cacheLockTimeoutSeconds` is how long a cache-refreshing operation waits for another process's refresh to finish before failing — see [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).

`cacheSource` must be `scryfall` or `feed`; `cacheFeedUrl` must be an http(s) URL. Together they route cache refreshes through a peer-to-peer [cache feed](/commands/cache-feed/) — see [Configuration → Cache source](/configuration/#cache-source).

The nested `admin` keys — settings for the [admin server](/commands/admin/) — are set with dot notation:

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

The following nested `site` keys — the [public-site publish lists](/commands/build-site/#choosing-which-lists-to-build) — are also settable:

| Property                  | Type       | Default |
| ------------------------- | ---------- | ------- |
| `site.includeDecks`       | `string[]` | `["*"]` |
| `site.includeCollections` | `string[]` | `["*"]` |
| `site.includeWantedLists` | `string[]` | `["*"]` |
| `site.excludeDecks`       | `string[]` | `[]`    |
| `site.excludeCollections` | `string[]` | `[]`    |
| `site.excludeWantedLists` | `string[]` | `[]`    |
| `site.bannedPrintings`    | `string[]` | `[]`    |

Each `exclude*` list drops lists by display name even when the matching `include*` list selects them; exclusion always wins. The exclude lists have no wildcard and default to empty. The admin **Manage Lists** page edits them through per-list [visibility toggles](/admin/manage-lists/#publishing-visibility).

`site.bannedPrintings` blocks specific printings from being chosen as a card's **default (featured) printing** when no printing is otherwise specified. Each entry is a `SET:COLLECTOR` pair (e.g. `SLD:123`). Ritual normally features the most recent non-outlier printing among a card's five newest priced printings; when that printing is banned, it skips to the next eligible one. A banned printing can still be viewed and entered manually — it is only barred from automatic selection. Set codes are stored lowercase; the value you pass may use either case.

The rest of the `site` key (the deployment settings) is managed exclusively by `ritual init-site` and cannot be set with this command.

## Value types

- **`string`** — passed as-is.
- **`boolean`** — must be `true` or `false` (case-insensitive).
- **`number`** — must be a non-negative integer.
- **`string[]`** — one or more values. By default the whole array is replaced. Use `--add` or `--remove` to modify individual entries. Arrays are treated as sets; duplicate values are ignored.

## Examples

Enable git integration:

```bash
./ritual config-set admin.gitEnabled true
```

Change the decks directory:

```bash
./ritual config-set decksDir ./my-decks
```

Set an IP allowlist (replaces the whole list):

```bash
./ritual config-set admin.ipAllowList "192.168.1.0/24" "10.0.0.1"
```

Add an IP to an existing allowlist:

```bash
./ritual config-set --add admin.ipAllowList "10.0.0.2"
```

Remove an IP from the allowlist:

```bash
./ritual config-set --remove admin.ipAllowList "10.0.0.1"
```

Increase the rate-limit window:

```bash
./ritual config-set admin.rateLimitWindowMinutes 10
```

Publish only specific decks on the built site (replaces the whole list):

```bash
./ritual config-set site.includeDecks "Izzet Storm" "Atraxa Superfriends"
```

Reset a publish list back to "everything":

```bash
./ritual config-set site.includeCollections "*"
```

Hide a single deck from the built site (leaving the rest published):

```bash
./ritual config-set --add site.excludeDecks "Untuned Brew"
```

Stop a specific printing from being featured as a card's default (it can still be selected manually):

```bash
./ritual config-set --add site.bannedPrintings "SLD:123"
```

## Notes

- Changes are written to `ritual.config.json` immediately.
- Running the admin server picks up config changes on its next request; a running server does not need to be restarted.
- Use `--base-dir` to target a config file in a directory other than the current working directory.
