---
title: 'Admin API: Site, Cache and Settings'
description: 'Admin API routes to build the site, check and refresh the card cache, run setup diagnostics, and read or change settings.'
sidebar:
  label: 'Site, cache and settings'
  order: 7
---

Routes that build the public site, report on and refresh the [card cache](/card-cache/), run the same checks as [`ritual doctor`](/commands/doctor/), and read or change `ritual.config.json`. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## Build Site

```
POST /api/build-site
```

Build and publish the public static site — the same build as [`ritual build-site`](/commands/build-site/), run as a child process so the server stays responsive. The child runs with the server's own [`--refresh`](/commands/build-site/#card-cache-refresh) mode, `ask` (the default) answered as `auto` since the child cannot prompt. The build writes into a scratch directory beside `dist/` and swaps it into place only once the child exits cleanly, so `dist/` always holds either the previous site or the new one. Exposed as the MCP `build_site` tool.

**Request Body:** None.

**Response:**

```json
{
  "success": true,
  "message": "Site built successfully",
  "messageKey": "admin.api.buildSite.built",
  "outDir": "/home/user/ritual/dist",
  "durationMs": 42000
}
```

- One build runs at a time: a second request while one is in flight is refused with `503`.
- A failed build answers `500` with the tail of the child's stderr in `message`, and `dist/` is left as it was.
- An in-process caller can cancel the build through its request context (the MCP tool does, on a client's `notifications/cancelled`): the child is killed, the scratch directory removed, and the response is `499` with `dist/` untouched.

## Build Site Stream

```
GET /api/build-site/stream
```

The same build as `POST /api/build-site`, streamed as server-sent events. The admin **Build Site** page's progress bar and live log read it. It takes no parameters.

| Event      | Payload                                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | `{ kind: "step", progress, total, message }` for one of the build's structural steps on a 0–3 scale (starting → building → publishing → done), or `{ kind: "output", line }` for one line of the child's stdout or stderr, forwarded as it is printed.                                                           |
| `done`     | `{ message, messageKey?, messageParams?, outDir, durationMs }` — the same [message triple](/admin/api/#the-message-triple) and publish details the JSON route returns.                                                                                                                                           |
| `error`    | `{ message, messageKey?, messageParams? }` for a build that was refused (one is already running) or failed; `message` carries the same text the JSON route would, and it is a [message triple](/admin/api/#the-message-triple) whose params may nest (an error the build raised, such as a cache-lock time-out). |

Failures ride the stream rather than an HTTP status, since `EventSource` exposes no response body for a non-2xx open. Closing the stream does **not** cancel the build: it runs to completion and publishes on its own, as a dropped sync stream leaves its run in flight.

## Cache Status

```
GET /api/cache/status
```

Report the card cache's size, freshness, tag coverage, and source — the same payload [`ritual cache status --output json`](/commands/cache/) prints. Diagnostic only: it never refreshes or writes the cache. Tag presence is checked over a bounded sample of cached cards, not a full scan.

**Response:**

```json
{
  "success": true,
  "empty": false,
  "cardCount": 31240,
  "lastCardRefresh": "2026-07-28T04:00:00.000Z",
  "priceAgeHours": 6,
  "priceStale": false,
  "tagsPresent": true,
  "source": "local",
  "cacheDir": "/home/you/.cache/ritual",
  "cacheDirSource": "default",
  "defaultLanguage": "en",
  "cardBulkType": "default_cards",
  "bulkTypeStale": false
}
```

| Field             | Description                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `empty`           | Whether the cache holds no cards at all                                                                                                                      |
| `cardCount`       | Distinct card **names** cached (each holds an array of printings)                                                                                            |
| `lastCardRefresh` | ISO-8601 time of the last bulk refresh, or `null` until one has run                                                                                          |
| `priceAgeHours`   | Whole hours since that refresh (prices come with the bulk data), or `null`                                                                                   |
| `priceStale`      | `true` when prices are older than 24 hours, or their age is unknown                                                                                          |
| `tagsPresent`     | Whether any sampled card carries oracle/art tags                                                                                                             |
| `source`          | `local`, or `cache-server` when a [cache server](/commands/cache/) is configured                                                                             |
| `cacheDir`        | Absolute path of the local [cache folder](/commands/cache/#where-the-cache-lives)                                                                            |
| `cacheDirSource`  | Which setting chose it: `env` (`RITUAL_CACHE_DIR`), `config` (the `cacheDir` key) or `default` (the per-user folder every workspace shares)                  |
| `defaultLanguage` | The configured [`defaultLanguage`](/configuration/#default-language)                                                                                         |
| `cardBulkType`    | Which bulk built the cache (`default_cards`/`all_cards`), or `null` when no ingest has recorded provenance                                                   |
| `bulkTypeStale`   | `true` when the cache's bulk disagrees with `defaultLanguage`; a full refresh is needed (see [bulk selection](/commands/cache/#bulk-selection-and-language)) |

## Refresh Cache

```
POST /api/cache/refresh
```

Download and cache all Scryfall card data — the Scryfall half of `ritual cache preload-all`, without the [buylist](/commands/sell/) refresh that command also runs under sell mode (that is [`POST /api/sell/refresh`](/admin/api/prices/#sell-refresh)). Returns a JSON response when complete. A refresh that fails answers a non-2xx with the failure's message. A refresh cancelled by its caller (only an in-process caller such as the MCP `refresh_cache` tool can cancel one) answers `499`: the download stops, nothing is written, the previous cache is left as it was, and the cache lock is released.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "Cache refreshed successfully",
  "messageKey": "admin.api.cache.refreshed"
}
```

## Refresh Cache Stream

```
GET /api/cache/refresh/stream
```

Stream cache refresh progress as Server-Sent Events (SSE). The UI uses it for its real-time progress bar.

**Response:** `text/event-stream` with the following event types:

| Event      | Data Fields                                                       | Description                    |
| ---------- | ----------------------------------------------------------------- | ------------------------------ |
| `progress` | `stage`, `percentage?`, `message`, `messageKey`, `messageParams?` | Progress update during refresh |
| `done`     | `message`, `messageKey`                                           | Refresh completed successfully |
| `error`    | `message`, `messageKey?`, `messageParams?`                        | Refresh failed                 |

All three are [message triples](/admin/api/#the-message-triple): `message` is English whatever the server's UI language, and `messageKey` and `messageParams` let a client render the line in its reader's language — the admin Cache Refresh page does, and relabels a line already on screen when the reader switches language. A `progress` line's key is a `domain.cache.refresh.*` message, and its params nest: a download size or the amount received so far is a size, `{ sizeBytes }`, rendered as a two-decimal mebibyte figure in the reader's locale (the line spells the `MiB` unit itself). An `error` with a catalog entry carries its key and params as an [error response](/admin/api/#error-responses) does: a cache-lock time-out (`domain.cache.lockTimedOut`), or a refresh failure (`domain.cache.refresh.*`) — Scryfall refusing the bulk manifest or the bulk download (`manifestFailed`, `bulkFetchFailed`, whose params are the HTTP `status` and `statusText`), a manifest with no bulk of the kind needed (`noBulkUri`, whose `bulk` is the Scryfall bulk name), an empty download (`bulkNoBody`) or a malformed bulk line (`invalidJsonLine`, whose `line` is its number).

**Stage values:** `metadata`, `tags`, `download`, `save`, `done`, `info`. Parsing and processing happen inline while the gzipped-JSONL bulk streams, so `download` covers them. The stages come from the refresh engine itself, and `percentage` is present on a `download` event whenever the compressed download size is known.

**Example event stream:**

```
event: progress
data: {"stage":"download","percentage":45,"message":"Processing: 45% (32.50/72.50 MiB)","messageKey":"domain.cache.refresh.processing","messageParams":{"percentage":45,"received":{"sizeBytes":34078720},"total":{"sizeBytes":76021760}}}

event: progress
data: {"stage":"save","message":"Saving to cache…","messageKey":"domain.cache.refresh.saving"}

event: done
data: {"message":"Cache refreshed successfully","messageKey":"admin.api.cache.refreshed"}
```

## Setup Diagnostics

```
GET /api/doctor
```

Check the setup — the same report [`ritual doctor --output json`](/commands/doctor/) prints, and what the [`get_diagnostics`](/commands/mcp/) MCP tool returns. Read-only and offline: it never refreshes the cache, asks a configured cache server anything, or looks up releases. A failing check is still a `200`; `ok` is `false` when any check failed. The config verdict reads `ritual.config.json` as it is on disk now, so a file edited by hand after the server started is reported as it stands.

**Response:**

```json
{
  "success": true,
  "ok": true,
  "checks": [
    {
      "id": "ritual",
      "status": "ok",
      "summary": {
        "message": "Ritual 0.1.0 (release build, installed binary) on linux x64, Bun 1.4.4",
        "messageKey": "domain.doctor.ritual.summary",
        "messageParams": {
          "version": "0.1.0",
          "build": { "messageKey": "domain.doctor.build.release" },
          "install": { "messageKey": "domain.doctor.install.binary" },
          "platform": "linux",
          "arch": "x64",
          "bun": "1.4.4"
        }
      },
      "hint": null,
      "details": []
    }
  ],
  "ritual": {
    "version": "0.1.0",
    "build": "release",
    "install": "binary",
    "platform": "linux",
    "arch": "x64",
    "bunVersion": "1.4.4",
    "issuesUrl": "https://github.com/sloshy/ritual/issues"
  },
  "workspace": {
    "baseDir": "/home/you/mtg",
    "configFile": true,
    "folders": {
      "deck": { "dir": "/home/you/mtg/decks", "exists": true, "lists": 12 },
      "collection": { "dir": "/home/you/mtg/collections", "exists": true, "lists": 2 },
      "wanted": { "dir": "/home/you/mtg/wanted", "exists": true, "lists": 1 }
    }
  },
  "config": { "state": "valid", "problems": [] },
  "migrations": { "state": "current", "remedy": null, "problem": null },
  "cache": {
    "dir": "/home/you/.cache/ritual",
    "dirSource": "default",
    "dirExists": true,
    "server": null,
    "status": { "empty": false, "cardCount": 31240, "…": "the Cache Status payload" },
    "problem": null
  },
  "update": {
    "mode": "on",
    "latest": "0.1.0",
    "checkedAt": "2026-10-30T09:00:00.000Z",
    "available": false
  }
}
```

(`checks` holds one entry per area, in the order `ritual`, `workspace`, `config`, `migrations`, `cache`, `update`; one is shown.)

| Field        | Description                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`         | `false` when any check's `status` is `fail`                                                                                                                                                                                                                                                                                                    |
| `checks`     | One verdict per area: `status` (`ok`, `warn`, `fail`), `summary`, a one-line `hint` (or `null`) and further `details` lines, each an English `message` plus `messageKey`/`messageParams`                                                                                                                                                       |
| `ritual`     | The running build: `build` is `release` or `development`, `install` is `binary`, `source` or `docker`; `issuesUrl` is where its bugs are reported (a fork's own tracker for a fork's build)                                                                                                                                                    |
| `workspace`  | The base directory, whether `ritual.config.json` exists, and each list folder's path, existence and list count                                                                                                                                                                                                                                 |
| `config`     | `state` is `absent`, `valid`, `invalid` (`problems` lists every refused setting) or `unreadable` (`problems` holds the parser's reason)                                                                                                                                                                                                        |
| `migrations` | `state` is `no-config`, `current`, `pending`, `ahead` (`remedy` is the command that updates Ritual), `invalid` (`problem` is the refused setting) or `unknown` (the check failed — `problem` says why — or was skipped behind a failing config check)                                                                                          |
| `cache`      | The cache folder, the setting that chose it (`dirSource`, as in [Cache Status](#cache-status)), whether it exists, the configured cache `server` (or `null`), the [Cache Status](#cache-status) payload as `status` (`null` with a cache server, or when reading the cache failed), and `problem`, why the cache could not be read (or `null`) |
| `update`     | `mode` is `on`, `off` (`updateCheck: false` or `RITUAL_NO_UPDATE_CHECK`), `development` or `docker`; `latest`/`checkedAt` are the last successful [update check](/commands/self-update/#update-notice)'s answer (or `null`), and `available` says whether `latest` is newer                                                                    |

## Get Config

```
GET /api/config
```

Returns the current application configuration.

**Response:**

```json
{
  "success": true,
  "config": {
    "decksDir": "./decks",
    "collectionsDir": "./collections",
    "wantedDir": "./wanted",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
    "updateCheck": true,
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
}
```

`config` is the **stored** configuration. When this server was started with a session flag that displaces one of those values — today that means [`--sell-mode`](/commands/admin/#sell-mode) — the response also carries an `overrides` object saying what the running process is actually operating with, keyed by the config path each override displaces:

```json
{
  "success": true,
  "config": { "site": {} },
  "overrides": { "site.sellMode": true }
}
```

The flag writes nothing, so `config.site.sellMode` keeps reporting the stored value (usually unset) while the server's sell routes answer anyway. `overrides` is **absent entirely** when no override is in force. It is a process-local fact, so `ritual config get` has no equivalent and `PUT /api/config` never returns it: a write echoes back what it persisted.

## Update Config

```
PUT /api/config
```

Update the application configuration. Partial updates are supported: only the fields you include change. The nested `admin` object is merged field by field, so you can send just the admin settings you want to change.

Every key in the request body is validated **before** the merge is persisted; a malformed update is rejected with a `400` and never written to disk:

- Unknown top-level keys are rejected (`Unknown config key "x"`).
- Unknown keys inside `admin` are rejected (`Unknown admin config key "x"`), matching `config set admin.<field>`.
- When `admin` or `site` is present, its fields are validated field by field with the config loader's rules, and any malformed field rejects the whole update.
- `collectionSync` replaces wholesale like `site` rather than merging like `admin`. Its fields are validated (`pullTarget` must be a non-empty list name) and any absent field takes its default, so a partial object round-trips to a complete one. A malformed value rejects the whole update.
- `defaultPriceSource` (an empty string clears it), `priceSources` (store names only — lowercased and deduped, unknown stores rejected), `defaultLanguage` (canonical Scryfall codes only, no aliases), `uiLocale` (a BCP-47 tag naming the interface language, not the card language; see [Localization](/localization/)), `cacheLockTimeoutSeconds`, `cacheSource`, `cacheFeedUrl`, `cacheDir` (a non-blank path, trimmed; a leading `~`, a root, the home folder, the workspace or a list folder is refused with a `domain.config.cacheDir*` key), `searchDebounceMs`, and `updateCheck` (a boolean) are validated as [`config set`](/commands/config/) validates them.
- `cacheFeedUrl` and `cacheDir` have one extra rule: sending either as an **empty string** clears a previously-set value (`cacheFeedUrl` to no feed URL, so a `feed` cache source refreshes from Scryfall with a warning; `cacheDir` to the [per-user cache every workspace shares](/commands/cache/#where-the-cache-lives)). Omitting the field leaves the current value untouched; a whitespace-only `cacheDir` is refused (`domain.config.mustBePath`).
- `site.theme` is stored lowercase and must name a built-in theme, or (only while `site.themeFiles` is non-empty) a custom theme name (`domain.config.siteThemeUnknown`). `site.themeFiles` must be an array of non-blank paths (`domain.config.mustBeStringArray`, `domain.config.blankEntry`). Because `site` replaces wholesale, send `themeFiles` with a custom `theme` in the same object.
- `managed` is accepted so a client can send back the whole config it read, but it is **ignored**: the stored [`managed` block](/configuration/#ritual-bookkeeping-managed-key) belongs to `init-site` and `migrate` and is never taken from a request.

A rejected value answers in the shared [error envelope](/admin/api/#error-responses), in English plus its key. The config validator's keys are `domain.config.*`: a top-level field's refusal names it as `field` (`domain.config.mustBeBoolean`, `mustBeOneOf` — whose `values` is a `{ list, join: "unit" }` — and so on), and a field inside a block is refused by `domain.config.inSection`, whose `section` is the block (`site`, `admin`, `collectionSync`) and whose `reason` nests the field's own refusal:

```json
{
  "success": false,
  "message": "site config: \"ciSystem\" must be \"github-actions\" or \"manual\"",
  "messageKey": "domain.config.inSection",
  "messageParams": {
    "section": "site",
    "reason": {
      "messageKey": "domain.config.mustBeEither",
      "messageParams": { "field": "ciSystem", "first": "github-actions", "second": "manual" }
    }
  }
}
```

A `priceSources` or `defaultPriceSource` refusal is keyed `domain.config.mustBeOneOf`, `domain.config.mustBeStringArray`, or `domain.config.unknownStore` (`{ field, value, values }`, with the accepted stores a `{ list, join }`). An `exportPresets` refusal is keyed `domain.export.problem.*` (a preset's column list's own refusal nested as `reason` inside `domain.export.problem.presetColumnsInvalid`). A `defaultCategories` refusal is keyed: `domain.config.defaultCategoriesNotArray` / `domain.config.defaultCategoriesNotText`, or the category rule's own `domain.card.category.invalid`, whose `rule` nests `domain.card.category.shapeRule`.

A `uiLocale` refusal is keyed `domain.config.uiLocaleMalformed` for a value that is not a language tag at all, whose `reason` nests the tag parser's own refusal — `errors.i18n.localeTag.invalid` (`{ value }`, the value as given), `errors.i18n.localeTag.empty` or `errors.i18n.localeTag.notAString` — or `domain.config.uiLocaleUnknown` (`{ tag }`) for a well-formed tag naming no language the server knows.

**Request body:**

```json
{
  "admin": {
    "gitEnabled": true,
    "gitAutoCommit": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "config": {
    "decksDir": "./decks",
    "collectionsDir": "./collections",
    "wantedDir": "./wanted",
    "priceSources": ["tcgplayer"],
    "defaultLanguage": "en",
    "uiLocale": "en",
    "cacheLockTimeoutSeconds": 300,
    "cacheSource": "scryfall",
    "searchDebounceMs": 500,
    "updateCheck": true,
    "admin": {
      "gitEnabled": true,
      "gitAutoCommit": true,
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
}
```
