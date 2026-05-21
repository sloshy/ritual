---
sidebar_position: 1
---

# config-set

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

| Property                 | Type       | Default         |
| ------------------------ | ---------- | --------------- |
| `decksDir`               | `string`   | `./decks`       |
| `collectionsDir`         | `string`   | `./collections` |
| `wantedDir`              | `string`   | `./wanted`      |
| `gitEnabled`             | `boolean`  | `false`         |
| `gitAutoCommit`          | `boolean`  | `false`         |
| `gitAutoPush`            | `boolean`  | `false`         |
| `trustProxy`             | `boolean`  | `false`         |
| `secureCookies`          | `boolean`  | `false`         |
| `ipAllowList`            | `string[]` | `[]`            |
| `ipDenyList`             | `string[]` | `[]`            |
| `userAgentAllowList`     | `string[]` | `[]`            |
| `userAgentDenyList`      | `string[]` | `[]`            |
| `rateLimitEnabled`       | `boolean`  | `true`          |
| `rateLimitMaxAttempts`   | `number`   | `5`             |
| `rateLimitWindowMinutes` | `number`   | `5`             |
| `failedAuthDelayMs`      | `number`   | `3000`          |

The following nested `site` keys — the [public-site publish lists](./build-site#choosing-which-lists-to-build) — are also settable:

| Property                  | Type       | Default |
| ------------------------- | ---------- | ------- |
| `site.includeDecks`       | `string[]` | `["*"]` |
| `site.includeCollections` | `string[]` | `["*"]` |
| `site.includeWantedLists` | `string[]` | `["*"]` |

The rest of the `site` key (the deployment settings) is managed exclusively by `ritual init-site` and cannot be set with this command.

## Value types

- **`string`** — passed as-is.
- **`boolean`** — must be `true` or `false` (case-insensitive).
- **`number`** — must be a non-negative integer.
- **`string[]`** — one or more values. By default the whole array is replaced. Use `--add` or `--remove` to modify individual entries. Arrays are treated as sets; duplicate values are ignored.

## Examples

Enable git integration:

```bash
./ritual config-set gitEnabled true
```

Change the decks directory:

```bash
./ritual config-set decksDir ./my-decks
```

Set an IP allowlist (replaces the whole list):

```bash
./ritual config-set ipAllowList "192.168.1.0/24" "10.0.0.1"
```

Add an IP to an existing allowlist:

```bash
./ritual config-set --add ipAllowList "10.0.0.2"
```

Remove an IP from the allowlist:

```bash
./ritual config-set --remove ipAllowList "10.0.0.1"
```

Increase the rate-limit window:

```bash
./ritual config-set rateLimitWindowMinutes 10
```

Publish only specific decks on the built site (replaces the whole list):

```bash
./ritual config-set site.includeDecks "Izzet Storm" "Atraxa Superfriends"
```

Reset a publish list back to "everything":

```bash
./ritual config-set site.includeCollections "*"
```

## Notes

- Changes are written to `ritual.config.json` immediately.
- Running the admin server picks up config changes on its next request; a running server does not need to be restarted.
- Use `--base-dir` to target a config file in a directory other than the current working directory.
