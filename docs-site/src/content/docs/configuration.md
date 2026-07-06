---
title: 'Configuration'
---

Ritual reads its configuration from `ritual.config.json` in the base directory (the current working directory by default, or the path passed to `--base-dir`). The file is created automatically with sane defaults the first time you run any Ritual command, so you only need to edit it when you want to change something.

## Location

- **File**: `ritual.config.json`
- **Default path**: `<base-dir>/ritual.config.json`

When you pass `--base-dir`, Ritual loads the config from that directory and resolves all directory paths in the file relative to it.

## Default file

```json
{
  "decksDir": "./decks",
  "collectionsDir": "./collections",
  "wantedDir": "./wanted",
  "defaultCurrency": "usd",
  "cacheLockTimeoutSeconds": 300,
  "cacheSource": "scryfall",
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
  }
}
```

## Directory options

| Field            | Default         | Description                                                             |
| ---------------- | --------------- | ----------------------------------------------------------------------- |
| `decksDir`       | `./decks`       | Where deck markdown files live. Used by the CLI, build-site, and admin. |
| `collectionsDir` | `./collections` | Where collection markdown files live.                                   |
| `wantedDir`      | `./wanted`      | Where wanted-list markdown files live.                                  |

Directory paths are resolved relative to the base directory. For example, with `--base-dir ~/mtg` and `"decksDir": "./my-decks"`, Ritual reads decks from `~/mtg/my-decks`.

You can use absolute paths (`"/srv/mtg/decks"`) or paths that step outside the base dir (`"../shared-decks"`) when that fits your workflow.

## Default currency

| Field             | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultCurrency` | `usd`   | The currency price-touching surfaces default to: `usd`, `eur`, or `tix`. Used by the [price](/commands/price/) command, the price lines shown when adding cards in the CLI editor, the [admin site](/commands/admin/)'s editor and move-cards price displays, and as the public site's initial currency (when that currency is built). [init-site](/commands/init-site/) prompts for it; change it later with `config-set defaultCurrency eur`. |

## Cache lock timeout

| Field                     | Default | Description                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheLockTimeoutSeconds` | `300`   | How long a cache-refreshing operation waits for another process's cache refresh to finish before failing. Refreshes take an exclusive lock (`cache/.ritual-cache-lock`) so concurrent processes — CLI commands, the [cache server](/commands/cache-server/), the [admin server](/commands/admin/) — never interleave writes to the cache. Must be a positive integer. |

A waiting process breaks the lock immediately when its holder is provably no longer running (e.g. it crashed without cleaning up), so a stale lock never wedges the cache for longer than one acquisition attempt.

## Cache source

| Field          | Default    | Description                                                                                                                                                                                                                                                                       |
| -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheSource`  | `scryfall` | Where card-cache refreshes download from. `scryfall` hits Scryfall's bulk API directly; `feed` syncs from a peer-to-peer [cache feed](/commands/cache-feed/) — checking the feed's infohashes and only downloading when they changed — falling back to Scryfall when unreachable. |
| `cacheFeedUrl` | —          | The feed URL used when `cacheSource` is `feed` (and by `cache-feed fetch` without `--url`). Must be an http(s) URL; the built-in default is used when absent.                                                                                                                     |

## Admin options (`admin` key)

The `admin` key holds settings that are configured through, and for, the [admin server](/commands/admin/): git integration for admin file changes, network access control, and login rate limiting. Set them from the admin **Settings** page, with [`config-set admin.<field>`](/commands/config-set/), or by hand. The key is always present and each field falls back to its default when omitted.

### Git integration

| Field                 | Default | Description                                                         |
| --------------------- | ------- | ------------------------------------------------------------------- |
| `admin.gitEnabled`    | `false` | Enable git integration for admin file changes.                      |
| `admin.gitAutoCommit` | `false` | When set with `gitEnabled`, admin saves auto-commit affected files. |
| `admin.gitAutoPush`   | `false` | When set with `gitAutoCommit`, push the commit after creating it.   |

These only affect changes made through the admin server.

### Network and authentication security

See [Admin → Configuration File](/commands/admin/#configuration-file) for the full reference, including:

- Network options (`admin.trustProxy`, `admin.secureCookies`)
- IP and User-Agent allow/deny lists (`admin.ipAllowList`, `admin.ipDenyList`, `admin.userAgentAllowList`, `admin.userAgentDenyList`)
- Rate limiting (`admin.rateLimitEnabled`, `admin.rateLimitMaxAttempts`, `admin.rateLimitWindowMinutes`, `admin.failedAuthDelayMs`)

## Site config (`site` key)

The `site` key holds public-site settings. It has two parts:

- **Deployment settings** (`version`, `ciSystem`, `deployMode`, `distDir`, `detectChanges`) are managed by `ritual init-site` and present only after you run it. Don't edit them by hand.
- **Publish lists** (`includeDecks`, `includeCollections`, `includeWantedLists` and their `exclude*` counterparts) are user-editable and decide which lists `build-site` publishes. You can set them from the admin **Settings** page, the per-list visibility toggles on the admin **Manage Lists** page, with [`config-set`](/commands/config-set/), or by hand.

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
    "excludeWantedLists": []
  }
}
```

| Field                | Default | Description                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------ |
| `version`            | —       | The Ritual version that initialized the site. Used to drive workflow upgrades. |
| `ciSystem`           | —       | `github-actions` or `manual`.                                                  |
| `deployMode`         | —       | `publish-for-me` or `local-build` (github-actions only).                       |
| `distDir`            | —       | The directory containing your built site (github-actions only).                |
| `detectChanges`      | —       | Whether the workflow runs `git-detect-changes` (github-actions only).          |
| `includeDecks`       | `["*"]` | Which decks `build-site` publishes (see below).                                |
| `includeCollections` | `["*"]` | Which collections `build-site` publishes.                                      |
| `includeWantedLists` | `["*"]` | Which wanted lists `build-site` publishes.                                     |
| `excludeDecks`       | `[]`    | Decks to drop even when `includeDecks` selects them.                           |
| `excludeCollections` | `[]`    | Collections to drop even when `includeCollections` selects them.               |
| `excludeWantedLists` | `[]`    | Wanted lists to drop even when `includeWantedLists` selects them.              |

### Choosing which lists to publish

Each `include*` list controls which lists in that category are published when you run [`build-site`](/commands/build-site/):

- `["*"]` — the reserved wildcard meaning **publish everything** in that category. This is the default, and applies even when there is no `site` key at all.
- An explicit list of **display names** (a deck's `name:` frontmatter or a collection/wanted-list `# Title`, each falling back to the file name) — publishes only the matching lists and filters out the rest. Names must match exactly.
- `[]` — an empty list publishes **none** of that category.

Each category also has a sister `exclude*` list. Any display name in it is dropped even when the `include*` list selects it (including under the wildcard) — **exclusion always wins**. The exclude lists default to `[]` and have no wildcard. This makes "publish everything except a few" easy: keep `includeDecks` at `["*"]` and add the odd one out to `excludeDecks`. The admin **Manage Lists** page's per-list visibility toggles edit only these exclude lists.

The corresponding `build-site` flags (`--decks`, `--collections`, `--wanted-lists`) override these settings for a single run.

## Editing the file

You can edit the directory keys and the nested `admin` settings in `ritual.config.json` by hand, or — when running the admin server — use the **Settings** page in the web UI. Saving via the UI also refreshes the in-memory config so any later admin or CLI command picks up the change immediately.

The deployment portion of the `site` key is owned by `ritual init-site`; let that command manage it. The publish lists (`site.includeDecks`, `site.includeCollections`, `site.includeWantedLists` and their `site.exclude*` counterparts) are the exception — they are user settings you can edit from the admin **Settings** page, the **Manage Lists** visibility toggles, or with `config-set`.

If a field is missing from the file, Ritual falls back to the default for that field.
