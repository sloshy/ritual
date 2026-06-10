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

| Property         | Type     | Default         |
| ---------------- | -------- | --------------- |
| `decksDir`       | `string` | `./decks`       |
| `collectionsDir` | `string` | `./collections` |
| `wantedDir`      | `string` | `./wanted`      |

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

Each `exclude*` list drops lists by display name even when the matching `include*` list selects them; exclusion always wins. The exclude lists have no wildcard and default to empty. The admin **Manage Lists** page edits them through per-list [visibility toggles](/admin/manage-lists/#publishing-visibility).

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

## Notes

- Changes are written to `ritual.config.json` immediately.
- Running the admin server picks up config changes on its next request; a running server does not need to be restarted.
- Use `--base-dir` to target a config file in a directory other than the current working directory.
