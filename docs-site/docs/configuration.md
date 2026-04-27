---
sidebar_position: 3
---

# Configuration

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
```

## Directory options

| Field            | Default         | Description                                                             |
| ---------------- | --------------- | ----------------------------------------------------------------------- |
| `decksDir`       | `./decks`       | Where deck markdown files live. Used by the CLI, build-site, and admin. |
| `collectionsDir` | `./collections` | Where collection markdown files live.                                   |
| `wantedDir`      | `./wanted`      | Where wanted-list markdown files live.                                  |

Directory paths are resolved relative to the base directory. For example, with `--base-dir ~/mtg` and `"decksDir": "./my-decks"`, Ritual reads decks from `~/mtg/my-decks`.

You can use absolute paths (`"/srv/mtg/decks"`) or paths that step outside the base dir (`"../shared-decks"`) when that fits your workflow.

## Git options

| Field           | Default | Description                                                         |
| --------------- | ------- | ------------------------------------------------------------------- |
| `gitEnabled`    | `false` | Enable git integration for admin file changes.                      |
| `gitAutoCommit` | `false` | When set with `gitEnabled`, admin saves auto-commit affected files. |
| `gitAutoPush`   | `false` | When set with `gitAutoCommit`, push the commit after creating it.   |

These only affect changes made through the admin server.

## Admin security options

The remaining options affect the admin server. See [Admin → Configuration File](commands/admin#configuration-file) for the full reference, including:

- Network options (`trustProxy`, `secureCookies`)
- IP and User-Agent allow/deny lists
- Rate limiting (`rateLimitEnabled`, `rateLimitMaxAttempts`, `rateLimitWindowMinutes`, `failedAuthDelayMs`)

## Site config (`site` key)

The `site` key holds settings managed by `ritual init-site`. It is present only after you run `init-site`, and not to be edited by hand.

```json
{
  "decksDir": "./decks",
  "...": "...",
  "site": {
    "version": "1.2.3",
    "ciSystem": "github-actions",
    "deployMode": "publish-for-me",
    "distDir": "dist",
    "detectChanges": false
  }
}
```

| Field           | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `version`       | The Ritual version that initialized the site. Used to drive workflow upgrades. |
| `ciSystem`      | `github-actions` or `manual`.                                                  |
| `deployMode`    | `publish-for-me` or `local-build` (github-actions only).                       |
| `distDir`       | The directory containing your built site (github-actions only).                |
| `detectChanges` | Whether the workflow runs `git-detect-changes` (github-actions only).          |

## Editing the file

You can edit the top-level keys in `ritual.config.json` by hand, or — when running the admin server — use the **Settings** page in the web UI. Saving via the UI also refreshes the in-memory config so any later admin or CLI command picks up the change immediately.

The `site` key is owned by `ritual init-site`; let that command manage it.

If a field is missing from the file, Ritual falls back to the default for that field.
