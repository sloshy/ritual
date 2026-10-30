---
title: 'cache'
---

Manage the card cache: inspect it, preload it, and run the always-on cache server and the experimental peer-to-peer cache feed.

## Where the cache lives

The card cache is one folder per user, shared by every workspace on the computer, so the Scryfall download (about 75 MB, several hundred MB on disk) happens once rather than once per workspace:

| Platform               | Default folder                                                                  |
| ---------------------- | ------------------------------------------------------------------------------- |
| Linux and other Unixes | `$XDG_CACHE_HOME/ritual`, or `~/.cache/ritual` when that is unset (or relative) |
| macOS                  | `~/Library/Caches/ritual`                                                       |
| Windows                | `%LOCALAPPDATA%\ritual\cache`                                                   |

The folder is chosen in this order, highest precedence first:

1. The `RITUAL_CACHE_DIR` environment variable.
2. The workspace's [`cacheDir`](/configuration/#cache-directory-cachedir) config key.
3. The workspace's own old `cache/` folder, while it still holds a cache and [`ritual migrate`](/commands/migrate/#migration-3-the-shared-card-cache) has not yet moved it. So an upgraded workspace never downloads into the empty shared cache before its own cache has had the chance to move there.
4. The per-user default above.

A relative path in the first two is resolved against the workspace, so `cacheDir: "cache"` (or `RITUAL_CACHE_DIR=cache`) keeps a workspace's cache in its own `cache/` folder, as every workspace did before. A value starting with `~` is refused (only a shell expands it; write the full path), as is a file system root, your home folder itself, the workspace itself or a folder containing it, and a deck, collection or wanted-list folder: the cache writes and deletes hundreds of megabytes of files in its folder. A refused `RITUAL_CACHE_DIR` is a usage error (exit `2`) for a CLI command, while a server (`admin`, `serve`, `mcp`, `cache server`) ignores it with a warning and uses the next choice in the list; a refused `cacheDir` is refused by `config set` and the admin API, and ignored with a warning when hand-edited into the file. [`cache status`](#status) shows the folder in use and which setting chose it. The first command that offers to download the card database also says where it will go.

Everything below that names a cache file (`cache.json`, `card-bulk.json`, `tags.json`, `cardkingdom.json`, `images/`, `feed-client/`, `feed/`, `.ritual-cache-lock`) means that file inside this folder.

An older workspace's `cache/` folder is moved here by [`ritual migrate`](/commands/migrate/#migration-3-the-shared-card-cache) (migration 3), whole, when the shared folder does not exist yet or is empty. If it holds anything, both folders are left untouched and the migration tells you that you can delete the old one.

### Sharing the cache between workspaces

Processes in different workspaces can use the cache at the same time, as two processes in one workspace always could:

- **Refreshes wait for each other.** A bulk download or ingest, a tag refresh, and the cache server's scheduled preloads take the exclusive cache-write lock (`.ritual-cache-lock` in the cache folder), so two workspaces never interleave a refresh. See [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).
- **Files are never seen half-written.** Every cache file is written to a temporary file and renamed into place.
- **A running process notices another's write.** Before using what it has loaded, a process checks whether `cache.json` changed on disk and reloads it if so.
- **A write never replaces a newer file with an older copy.** Saving a card rewrites the whole `cache.json`. Just before the new file replaces the old one, Ritual checks that the old one is still the copy it changed; if another process rewrote it meanwhile, the change is made again on the newer copy instead. What remains is the instant between that check and the replacement: two saves landing within it can lose one card, which the next lookup fetches again. (Bulk refreshes also hold the lock, so two of them never race.)
- **An unreadable cache is never overwritten.** If `cache.json` exists but cannot be read or is not valid JSON, lookups treat the cache as empty and every single-card write is refused with an error naming the file, rather than replacing it (and every other workspace's data) with a nearly empty one. A full refresh (`ritual cache preload-all`, or `--refresh auto`) replaces the whole file and so repairs it; deleting the file works too.

The cache's contents never depend on the workspace (with one exception: [`defaultLanguage`](/configuration/#default-language) decides which Scryfall bulk the cache holds). If workspaces with different `defaultLanguage` values share a cache, each refresh replaces the other's bulk; give one of them its own `cacheDir`.

## Usage

```bash
ritual cache <subcommand> [options]
```

## Subcommands

### status

Report the card cache's state. The command is diagnostic and script-safe: it never prompts, never downloads or refreshes anything, and exits `0` even when the cache is empty. Branch on the `empty` field, not the exit code.

```bash
ritual cache status [--output text|json|ndjson]
```

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `--output <format>` | Output format: `text` (default), `json`, or `ndjson` |

The report is the command's entire output, so there is no `--quiet` ([shared convention](/cli-conventions/#scripting)).

Text output is aligned `label: value` lines worded for the reader in your [UI language](/localization/): yes/no for the flags, the source's name, the refresh time as a local date and time. `json`/`ndjson` keep the raw values, and emit an object with these fields:

| Field             | Meaning                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`           | `true` when no cards are cached at all.                                                                                                                                                                         |
| `cardCount`       | Distinct card **names** cached. Each name holds all of that card's printings, so the printing count is larger.                                                                                                  |
| `lastCardRefresh` | ISO-8601 time of the last **bulk** refresh, or `null` until one has run (`never` in text output).                                                                                                               |
| `priceAgeHours`   | Whole hours since `lastCardRefresh`, or `null` when that is `null`.                                                                                                                                             |
| `priceStale`      | `true` when prices are older than 24 hours, or when their age is unknown (`lastCardRefresh` is `null`).                                                                                                         |
| `tagsPresent`     | Whether cached cards carry oracle/art tags (see [Tags](#tags)).                                                                                                                                                 |
| `source`          | `local` for the on-disk cache, `cache-server` when a [cache server](#server) is configured.                                                                                                                     |
| `cacheDir`        | The absolute path of the local cache folder (see [Where the cache lives](#where-the-cache-lives)).                                                                                                              |
| `cacheDirSource`  | Which setting chose `cacheDir`: `env` (`RITUAL_CACHE_DIR`), `config` (the `cacheDir` key), `legacy` (the workspace's old `cache/`, until `ritual migrate` moves it), or `default` (the shared per-user folder). |
| `defaultLanguage` | The configured [`defaultLanguage`](/configuration/#default-language), which decides which Scryfall bulk backs the cache.                                                                                        |
| `cardBulkType`    | Which bulk built the card cache: `default_cards` (English-only), `all_cards` (every language), or `null`.                                                                                                       |
| `bulkTypeStale`   | `true` when a non-empty cache's bulk disagrees with what `defaultLanguage` demands (see [Bulk selection](#bulk-selection-and-language)).                                                                        |

Notes on the fields:

- Only a bulk load (`preload-all` or a feed sync) stamps `lastCardRefresh`. A cache populated purely by per-set or per-card lookups reports `null`.
- Prices are part of the bulk card data, so price age equals bulk-cache age.
- `tagsPresent` comes from a small sample of cached cards, not a full scan. If only rarely-tagged cards land in the sample, it can report `false` after a completed tag refresh.
- `source` is `cache-server` when `--cache-server` or `RITUAL_CACHE_SERVER` is set. `cacheDir` is reported either way: card data then comes from the server, but images and the Card Kingdom buylist still live in the local folder.
- The text report's **Location** row shows `cacheDir` followed by what chose it: `(from RITUAL_CACHE_DIR)`, `(from cacheDir in ritual.config.json)`, the workspace's old folder awaiting `ritual migrate`, or `(per-user default, shared by every workspace)`.
- `cardBulkType` is `null` when no bulk ingest has recorded which bulk it used: an empty cache, or one filled before this was recorded (necessarily `default_cards`).
- A `bulkTypeStale` cache needs a full redownload, which the freshness checks on other commands offer.

The same report is available over HTTP as [`GET /api/cache/status`](/admin/api/#cache-status).

### preload-set

Preload all cards from one set into the cache.

```bash
ritual cache preload-set <setCode>
```

| Argument    | Description                              | Required |
| ----------- | ---------------------------------------- | -------- |
| `<setCode>` | Set code to preload (e.g., `khm`, `lea`) | Yes      |

It caches exactly that set and nothing else, and never offers to bulk-download every card first. Use [`preload-all`](#preload-all) when you want the whole database.

Each outcome has its own exit code, so a script can trust it:

| Outcome                                         | Exit | Output                                                                                                     |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| Cards cached                                    | `0`  | `Successfully cached N cards for set 'KHM'`                                                                |
| Set exists but holds no real printings          | `0`  | `Set 'TMKM' matched N items, none of which are real printings (token and Art Series sets are not cached).` |
| Unknown set code (Scryfall matched nothing)     | `3`  | `No cards found for set 'ZZZZ' — check the set code (see https://scryfall.com/sets)`                       |
| Search failed (HTTP error, network unreachable) | `1`  | `Failed to preload set 'KHM': <reason>`                                                                    |

Token sets (`tmkm`) and Art Series sets are real sets that cache nothing, since Ritual stores only real printings. They get their own outcome so they are not mistaken for a mistyped set code.

### preload-all

Download and cache the full Scryfall bulk card data. This also downloads the **oracle** and **art** tag bulks and attaches them to every cached card (see [Tags](#tags)). With [`cacheSource: "feed"`](/configuration/#cache-source) or `--source feed`, it syncs from a peer-to-peer [cache feed](#feed-fetch) instead, falling back to Scryfall when the feed is unreachable.

```bash
ritual cache preload-all [options]
```

| Option              | Description                                                                                                      | Default                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `--source <source>` | Where to download from: `scryfall` or `feed` (experimental; overrides the `cacheSource` config key for this run) | `cacheSource` config key                         |
| `--url <feedUrl>`   | Feed URL for a feed-sourced refresh; implies `--source feed`                                                     | `cacheFeedUrl` config, then the built-in default |
| `--force`           | Re-download and re-ingest even when the feed is unchanged (feed source only)                                     | off                                              |

`--url` combined with `--source scryfall` is a usage error. `--force` has no effect on a Scryfall refresh, which always downloads the full bulk.

Printings that no list should ever reference are dropped during ingestion and never enter the cache or any search surface (CLI autocomplete, printing pickers, the admin editor, the hosted public site's card search): **tokens**, **Arena-only** prints, and **Art Series** prints (the oversized art-only cards from set boosters, which share their card's name). An older cache built before this filtering existed still holds them; re-run `preload-all` to clear them out.

**Reversible printings** (one card printed on both sides with different art, such as a Secret Lair `Steam Vents` that Scryfall names `Steam Vents // Steam Vents`) are filed under the card they print rather than under a doubled name. Searching `Steam Vents` offers one card, and its printing pickers list the reversible printings beside the ordinary ones. Such a printing keeps both sides and still flips to its back face. A list line written as `Steam Vents // Steam Vents` still resolves to the same card, and [`ritual cleanup`](/commands/cleanup/) renames such lines to the card's own name.

Every preload **replaces** the card cache rather than merging into it. An entry the new data no longer produces (a printing an exclusion now drops, a doubled name now folded) is gone once `preload-all` finishes.

A failed preload exits `1`. The same refresh over HTTP ([`POST /api/cache/refresh`](/admin/api/#refresh-cache), and the MCP `refresh_cache` tool that reuses it) also reports the failure, and honours cancellation from an in-process caller (the MCP tool): the download stops, nothing is written, the previous cache stands, and the cache lock is released.

#### The buylist rides along under sell mode

When [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is enabled, `preload-all` also refreshes the [Card Kingdom buylist](/commands/sell/), so a site you build next uses today's offers. After the card cache refresh succeeds it runs the equivalent of `ritual sell --refresh auto`: a cached buylist less than a day old is left alone, a day-old one is redownloaded, and a missing one is downloaded (~70 MB) without prompting. `--force` carries through and redownloads even a fresh buylist.

There is no `--sell-mode` flag here; the command follows the config only. **A buylist failure is a warning, never the exit code**, since the card cache did refresh:

```
The card cache was updated, but the Card Kingdom buylist was not: <reason>
```

With sell mode off, no buylist work happens. The HTTP and MCP refreshes (`POST /api/cache/refresh`, `refresh_cache`) do **not** include this step. The buylist has its own route and tool (`POST /api/sell/refresh`, `refresh_buylist`).

### Bulk selection and language

Which Scryfall bulk a card refresh downloads follows the [`defaultLanguage`](/configuration/#default-language) config key:

- `en` (the default) → **`default_cards`**: one English card object per printing.
- anything else → **`all_cards`**: every language's card objects, so non-English printings can be verified, picked, and displayed. Expect a several-times-larger download and cache.

The rule applies everywhere the card cache is fetched or synced: `preload-all`, the stale-cache prompts on other commands, the [cache server](#server)'s scheduled refreshes, and the [cache feed](#feed-fetch).

Every bulk ingest records **which bulk built the cache** in `card-bulk.json` in the cache folder. When that disagrees with what `defaultLanguage` currently demands (you switched the key in either direction), the cache is the wrong dataset, and commands that check cache freshness say so instead of running a staleness prompt. Under `--refresh ask` they offer a full redownload, under `--refresh auto` they run it, and `cache status` reports `bulkTypeStale: true`. A cache filled before this was recorded reads as `default_cards`.

### refresh-tags

Re-download only the oracle and art tag bulks and re-attach them to the cards already in the cache. Scryfall updates tag data daily while the much larger card bulk rarely changes, so this is the fast way to keep tags current. A failed refresh exits `1`.

```bash
ritual cache refresh-tags
```

### server

:::caution[Trusted networks only]
The cache server has no authentication, and its write routes can clear or replace the cache. Bind it to loopback (the default) or a private network you trust.
:::

Start a local cache server for card and pricing cache data. Other Ritual commands (on this or other machines) use it instead of their local cache files. See [Client configuration](#client-configuration).

```bash
ritual cache server [options]
```

| Option                        | Description                                                                | Default                                                 |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `-p, --port <number>`         | Port for the cache server                                                  | `4000`                                                  |
| `--host <hostname>`           | Host interface for the cache server                                        | `127.0.0.1`                                             |
| `--cards-refresh <interval>`  | Run a full cards cache refresh on a cadence (`daily`, `weekly`, `monthly`) | env `RITUAL_CACHE_SERVER_CARDS_REFRESH`, else disabled  |
| `--prices-refresh <interval>` | Run price cache refreshes on a cadence (`daily`, `weekly`, `monthly`)      | env `RITUAL_CACHE_SERVER_PRICES_REFRESH`, else disabled |
| `--cache-source <source>`     | Where card refreshes download from: `scryfall` or `feed` (experimental)    | `cacheSource` config key                                |
| `--url <feedUrl>`             | Cache feed URL for feed-sourced refreshes                                  | `cacheFeedUrl` config, then the built-in default        |
| `--torrent-port <n>`          | Fixed TCP port for incoming torrent peers while seeding feed artifacts     | random                                                  |
| `--no-seed`                   | With a feed source, sync without seeding the artifacts back to the swarm   | seeding on                                              |
| `-v, --verbose`               | Log every incoming cache-server request                                    | disabled                                                |
| `--deny-http`                 | Reject all outgoing HTTP requests (for testing)                            | disabled                                                |

`--url` with `--cache-source scryfall` is a usage error, since that source never reads it. See [The cache server](#the-cache-server) for behavior details and the HTTP API.

### feed host

:::caution[Experimental]
The cache feed is experimental: it may change or be removed in any release. Refreshing straight from Scryfall (the default `cacheSource`) is the supported path.
:::

Host a **cache feed**: download the raw Scryfall bulk files (the card bulks chosen with `--cards` plus the oracle/art tag bulks, as gzipped JSONL), create a BitTorrent torrent for each, and run an HTTP server that publishes a `feed.json` describing the current files while seeding them to peers. Sharing the bulk data peer-to-peer means Scryfall serves each daily download once per group instead of once per machine.

```bash
ritual cache feed host --public-url https://feed.example.com
```

| Option                 | Description                                                                                                          | Default                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `-p, --port <number>`  | Port for the feed HTTP server                                                                                        | `4010`                                                                           |
| `--host <hostname>`    | Host interface for the feed HTTP server                                                                              | `127.0.0.1`                                                                      |
| `--public-url <url>`   | Public base URL peers reach this host at; embedded in the feed's file/torrent URLs and each torrent's web seed       | `http://<host>:<port>`                                                           |
| `--cards <which>`      | Which card bulks to publish: `default` (English-only `default_cards`), `all` (every-language `all_cards`), or `both` | whichever the host's [`defaultLanguage`](/configuration/#default-language) needs |
| `--refresh <interval>` | Re-check Scryfall for new bulk data (`daily`, `weekly`, `monthly`; env `RITUAL_CACHE_FEED_REFRESH`)                  | `daily`                                                                          |
| `--upstream <url>`     | Bulk manifest URL to source artifacts from (another feed host's mirror, or a test stub)                              | Scryfall's `/bulk-data`                                                          |
| `--dir <path>`         | Feed data directory                                                                                                  | `<cache>/feed`                                                                   |
| `--no-seed`            | Serve the feed and files over HTTP only, without BitTorrent seeding                                                  | seeding on                                                                       |
| `--torrent-port <n>`   | Fixed TCP port for incoming torrent peers                                                                            | random                                                                           |
| `-v, --verbose`        | Log every feed-server request                                                                                        | off                                                                              |

### feed fetch

:::caution[Experimental]
The cache feed is experimental: it may change or be removed in any release. Refreshing straight from Scryfall (the default `cacheSource`) is the supported path.
:::

Sync the card cache from a cache feed, then stay open **seeding** the files back to other peers. Every seeder reduces the load on both Scryfall and the feed host. Press Ctrl+C to stop.

```bash
ritual cache feed fetch --url https://feed.example.com/feed.json
```

| Option                 | Description                                                                                     | Default                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `--url <feedUrl>`      | Feed URL                                                                                        | `cacheFeedUrl` config, then the built-in default |
| `--no-p2p`             | Download over plain HTTP (from the feed's file URLs) instead of BitTorrent                      | BitTorrent with web-seed fallback                |
| `--no-seed`            | Exit after ingesting instead of staying open to seed                                            | seeding on                                       |
| `--torrent-port <n>`   | Fixed TCP port for incoming torrent peers                                                       | random                                           |
| `--force`              | Re-download and re-ingest even when the feed is unchanged                                       | off                                              |
| `--refresh <interval>` | Re-check the feed while seeding (`daily`, `weekly`, `monthly`; env `RITUAL_CACHE_FEED_REFRESH`) | `daily`                                          |

Behavior:

- Downloaded files are verified against the feed's per-file SHA-256 before anything is ingested. A corrupted download is deleted and the sync fails.
- Only the kinds the client needs are downloaded, ingested, and seeded: the tag bulks plus **one** card bulk (`default-cards` under an English [`defaultLanguage`](/configuration/#default-language), `all-cards` otherwise). A feed that does not publish the needed card kind fails the sync with a message naming it; point the host at `--cards both` to serve mixed clients.
- The last ingested torrent infohash is tracked **per kind** in `feed-client/state.json` in the cache folder. Switching `defaultLanguage` changes the needed card kind and so forces a re-ingest even when the feed has not changed. An unchanged feed for an unchanged kind is a cheap no-op.
- Ingestion runs the same local pipeline as a direct Scryfall preload (filtering, card mapping, tag attachment), so a feed-synced cache is indistinguishable from a Scryfall-synced one.
- While seeding, the feed is re-checked on the `--refresh` cadence and new files are ingested and seeded automatically.

To make feed syncing the default for **all** of Ritual's cache refreshes (`cache preload-all`, stale-cache prompts, `build-site --refresh auto`, price refreshes), set the [`cacheSource` config key](/configuration/#cache-source):

```bash
ritual config set cacheSource feed
ritual config set cacheFeedUrl https://feed.example.com/feed.json
```

Refreshes then check the feed's infohashes instead of re-downloading from Scryfall, fall back to Scryfall with a warning when the feed is unreachable, and seed to peers for the duration of any download.

For an always-on swarm member, run a [cache server](#server) with `--cache-source feed`. It syncs from the feed on its refresh cadence and keeps seeding between refreshes.

## Tags

Scryfall publishes community [Tagger](https://tagger.scryfall.com/) data as bulk files. Ritual attaches these to cached cards as plain slug arrays:

- **`oracleTags`**: functional tags (e.g. `ramp`, `removal`, `tutor`). Matched by oracle identity, so every printing of a card shares the same oracle tags.
- **`artTags`**: artwork tags (e.g. `dragon`, `mountains`). Matched per illustration, so different printings of the same card can have different art tags.

The tag lookup is stored in `tags.json` in the cache folder. The [`sell`](/commands/sell/) command keeps its Card Kingdom buylist in its own file there, `cardkingdom.json`, with its own daily freshness. The only cache command that touches it is [`preload-all`](#the-buylist-rides-along-under-sell-mode), and only when sell mode is enabled; `cache status`, the [cache server](#the-cache-server), and the [cache feed](#feed-fetch) all ignore it.

## The cache server

### Behavior

- Uses the local `cache.json` in the [cache folder](#where-the-cache-lives) as its storage backend.
- If the card cache is empty or stale for the selected cards cadence (weekly if unset) on startup, it performs a full preload before serving requests.
- Startup and scheduled full preloads take the exclusive cache-write lock (`.ritual-cache-lock` in the cache folder), so they never interleave with another process's refresh. See [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).
- With a `feed` cache source (experimental), card refreshes sync from a peer-to-peer [cache feed](#feed-host) instead of Scryfall. Unchanged feeds are a cheap infohash check, and feed failures fall back to a direct Scryfall preload. Unless `--no-seed` is given, the server **keeps seeding** the feed's files between refreshes. In feed-seeding mode the startup refresh always runs (it is what starts the seeding), even when the local cache is fresh.
- `--deny-http` also disables feed syncing and seeding.
- On cache misses, it fetches from Scryfall and stores the results back into the local cache.
- Price entries can be grouped into cadence buckets and refreshed on schedule.
- Price refresh scheduling is game-format-aware: USD/EUR refreshes are skipped for cards without paper printings, and TIX refreshes for cards without MTGO printings.
- For weekly/monthly price cadence, a manual read after one day can invalidate the pending schedule, refresh immediately, and re-schedule.
- For daily/weekly/monthly price cadence, startup entries older than the cadence window are enqueued immediately, staggered 200ms apart.
- For streamed/fallback refreshes, network refresh starts are staggered by 200ms and `price` events are emitted in completion order.
- Cache updates are always logged.
- Price min/max batch lookups can be streamed with SSE using `POST /cache/prices/stream`.
- With `--verbose`, each incoming request is logged as `key=value` fields: `[cache-server] method=GET path=/cache/cards/Sol%20Ring status=200 durationMs=3`.
- The server's console lines are worded in its own UI language (see [Configuration → Interface language](/configuration/#interface-language)); the `[cache-server]` prefix and the `key=value` fields of the cache-update and request lines never change, so they stay safe to grep.
- With `--deny-http`, the server makes no outgoing HTTP requests. The startup card cache preload is skipped. A price read that would have to fetch from Scryfall fails: a single read answers `500` with `domain.cache.serverReply.httpDenied`, and a streamed one emits that as an `error` event. A card cache miss is not a failure; it answers `200` with `{ "value": null }`. Use this for testing with pre-populated caches.

### HTTP endpoints

`<section>` is `cards` or `prices`.

| Path                               | Methods                | Description                                          |
| ---------------------------------- | ---------------------- | ---------------------------------------------------- |
| `/health`                          | `GET`                  | Health check (`{ "status": "ok" }`)                  |
| `/cache/<section>`                 | `DELETE`               | Clear all entries in a section                       |
| `/cache/<section>/bulk`            | `PUT`                  | Bulk set entries (`{ "entries": { ... } }`)          |
| `/cache/<section>/is-empty`        | `GET`                  | Check whether a section has any entries              |
| `/cache/<section>/keys`            | `GET`                  | List keys in a section                               |
| `/cache/<section>/values`          | `GET`                  | List values in a section                             |
| `/cache/<section>/metadata`        | `GET`                  | Get section metadata timestamp                       |
| `/cache/<section>/<key>/timestamp` | `GET`                  | Get timestamp for a specific key                     |
| `/cache/<section>/<key>`           | `GET`, `PUT`, `DELETE` | Get/set/delete value for a key                       |
| `/cache/prices/stream`             | `POST`                 | Stream price entries as SSE (`event: price`, `done`) |

#### SSE event format (`/cache/prices/stream`)

Send a JSON body with keys:

```json
{ "keys": ["Sol Ring", "Arcane Signet"] }
```

Each resolved entry is emitted as:

```text
event: price
data: {"key":"Sol Ring","value":{"latest":1.23,"min":0.9,"max":2.1},"updated":false}
```

When streaming is complete, the server emits:

```text
event: done
data: {"count":2}
```

An entry the server could not resolve (a Scryfall request that failed while refreshing it) is emitted as an `error` event naming its `key`; a failure of the whole stream has no `key`:

```text
event: error
data: {"key":"Sol Ring:usd","message":"Failed to fetch batch prices: 503 Service Unavailable","messageKey":"domain.cache.scryfall.pricesFailed","messageParams":{"status":503,"statusText":"Service Unavailable"}}
```

`message` is English whatever the server's UI language; `messageKey` and `messageParams` (present when the failure has a catalog entry, and possibly nested) let a client render it in its own language.

`updated` is `true` when the server refreshed and re-cached that entry during this request. Parse events in order, handle each `price` event as it arrives (for progress and partial results), and treat `done` as stream completion. Refreshed entries arrive in completion order, not request order, so use `key` to match each event to the requested card.

#### Error replies

Every HTTP error the server answers (`400`, `404`, `405`, `500`) has the same body as an [admin API refusal](/admin/api/): `success: false`, the reason in English as `message`, and `messageKey` / `messageParams` beside it. For example:

```json
{
  "success": false,
  "message": "Invalid cache route.",
  "messageKey": "domain.cache.serverReply.invalidRoute"
}
```

A request the server refuses carries a `domain.cache.serverReply.*` key: a path outside `/cache/`, an unknown section, route or method, a missing or badly `%`-encoded key, a body that is not a JSON object, or a body missing its `entries`, `keys` or `value`. A request that fails outright (`500`) carries the failure itself, such as a failed Scryfall price batch (`domain.cache.scryfall.pricesFailed`).

A Ritual client nests the reply into its own error, worded in the client's language, and keeps the server's English when the key or a param is one it does not know. Through the admin API that error is English plus the keys; [MCP](/commands/mcp/) tool errors carry its English `message` without them. A reply that is not such a body (a proxy's error page, an older server's) is quoted as text, cut to about 1,000 characters and stripped of control characters; the text params of a nested reply are cut and stripped the same way.

### Client configuration

To make Ritual commands use the cache server instead of local cache files, either:

- set `RITUAL_CACHE_SERVER=<host:port>`, or
- pass the top-level `--cache-server <host:port>` option.

The CLI option takes precedence over the environment variable.

On the server side, the refresh cadences can also come from environment variables when the flags are omitted:

- `RITUAL_CACHE_SERVER_CARDS_REFRESH=<daily|weekly|monthly>`
- `RITUAL_CACHE_SERVER_PRICES_REFRESH=<daily|weekly|monthly>`

## The cache feed

:::caution[Experimental]
The cache feed is experimental: it may change or be removed in any release. Refreshing straight from Scryfall (the default `cacheSource`) is the supported path.
:::

### HTTP endpoints

| Path                           | Description                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `/feed.json`                   | The current feed document (see below)                                   |
| `/files/<fileName>`            | A raw bulk artifact; supports HTTP range requests (torrent web seeding) |
| `/torrents/<infoHash>.torrent` | The `.torrent` file for an artifact                                     |
| `/health`                      | `{ status, entries, generatedAt }`                                      |

A request the host refuses is answered with the same JSON body a [cache server](#the-cache-server) refuses with, `{ "success": false, "message": …, "messageKey": … }`, its `message` in English whatever the host's UI language, and `Cache-Control: no-store`. Clients act on the status:

| Status | When                                                                                                      | `messageKey`                                                             |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `400`  | A file or torrent name with a broken `%` escape                                                           | `domain.cache.feedReply.pathMalformed`                                   |
| `404`  | A path the host does not serve, or a file or torrent the current feed does not list                       | `domain.cache.feedReply.notFound`, `…fileNotListed`, `…torrentNotListed` |
| `405`  | A method other than `GET` or `HEAD` (the `Allow` header names both)                                       | `domain.cache.feedReply.methodNotAllowed`                                |
| `416`  | A malformed `Range`, or one past the end of the file (`Content-Range: bytes */<length>` gives the length) | `domain.cache.feedReply.rangeNotSatisfiable`                             |
| `503`  | `/feed.json` before the first feed is generated (`Retry-After: 60`)                                       | `domain.cache.feedReply.notGenerated`                                    |

`HEAD` answers with the headers `GET` would, and ignores `Range`. A `ritual cache feed fetch` (or feed-backed refresh) that a host refuses reports the host's reason in its own UI language, after the URL and the status.

### The feed document

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-05T10:00:00.000Z",
  "entries": [
    {
      "kind": "default-cards", // default-cards | all-cards | oracle-tags | art-tags
      "fileName": "default-cards-20260705090855.jsonl.gz",
      "infoHash": "dc07075b03442a407376342d2e32911465e5915a",
      "magnet": "magnet:?xt=urn:btih:…&ws=…", // includes the web-seed URL
      "length": 72283247,
      "sha256": "…", // whole-file hash, verified by clients
      "scryfallUpdatedAt": "2026-07-05T09:08:55.003+00:00",
      "publishedAt": "2026-07-05T10:00:00.000Z",
      "fileUrl": "https://feed.example.com/files/default-cards-20260705090855.jsonl.gz",
      "torrentUrl": "https://feed.example.com/torrents/dc07….torrent",
    },
  ],
}
```

Clients decide whether anything changed by comparing each entry's `infoHash` against what they last ingested, not by timestamps.

### Behavior

- **Raw files, not processed caches.** The feed distributes Scryfall's bulk files byte-identical to the originals, and every peer runs its own local ingestion. A schema change in Ritual's processed cache can never break the swarm.
- **Web seeds make an empty swarm harmless.** Every torrent embeds this host's `--public-url` file URL as a BEP 19 web seed, so a download completes over plain HTTP(S) even with zero peers online. Peers only make it faster.
- **Transports:** plain TCP peers plus DHT discovery. Trackers and WebRTC are not used.
- On each refresh interval the host re-reads Scryfall's bulk manifest and only downloads files whose `updated_at` changed. A republished feed prunes the previous generation's files and torrents from disk.
- A restart serves the previously published feed immediately, then refreshes.
- A failed refresh on startup exits with an error when no previous feed exists. Once a feed has been published, later refresh failures are logged and the last good feed keeps being served (and seeded).
- The feed directory holds `feed.json`, `files/`, and `torrents/`.
- The host's console lines are worded in its own UI language (see [Configuration → Interface language](/configuration/#interface-language)); the `[cache-feed]` prefix never changes. With `--verbose`, each request is logged as `key=value` fields that are never translated: `[cache-feed] method=GET path=/feed.json status=200 durationMs=3`.

### Serving publicly

Bind to localhost and put a TLS reverse proxy in front for the HTTP side, with `--public-url` set to the proxy's public origin. The feed URL is what clients trust, so it should be HTTPS. Peers also need the torrent TCP port (`--torrent-port`) reachable directly.

```bash
ritual cache feed host --torrent-port 6885 --public-url https://feed.example.com
```

## Exit Codes

| Code | Meaning                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success — including `status` on an empty cache, a `feed fetch --no-seed` sync, and a long-running `server`, `feed host`, or seeding `feed fetch` stopped with Ctrl+C                        |
| `1`  | Runtime failure — a preload or tag refresh failed, initial feed generation failed with no previous feed, seeding could not start, a server port could not be bound, or the feed sync failed |
| `2`  | Usage error (invalid option value, e.g. a bad `--port`, `--torrent-port`, `--refresh`, `--source`, or `--url`, or `--url` combined with a non-feed `--source`/`--cache-source`)             |
| `3`  | Not found — `preload-set` was given a set code Scryfall has no cards for                                                                                                                    |

## Examples

Preload Kaldheim cards:

```bash
ritual cache preload-set khm
```

Cache all cards and tags:

```bash
ritual cache preload-all
```

Preload from a specific cache feed regardless of the configured source:

```bash
ritual cache preload-all --url https://feed.example.com/feed.json
```

Refresh just the tags on an already-populated cache:

```bash
ritual cache refresh-tags
```

Check the cache's state from a script:

```bash
ritual cache status --output json
```

Start the cache server with weekly cards refresh and monthly prices refresh:

```bash
ritual cache server --cards-refresh weekly --prices-refresh monthly
```

Use the cache server from another Ritual command:

```bash
ritual --cache-server 127.0.0.1:4000 price "My Deck"
```

Sync the cache from a feed without staying open to seed:

```bash
ritual cache feed fetch --url https://feed.example.com/feed.json --no-seed
```

## Notes

- Set codes are the official Scryfall/Gatherer set codes.
- The cache is stored in the per-user cache folder, shared by every workspace (see [Where the cache lives](#where-the-cache-lives)).
- Bulk data is downloaded in Scryfall's gzipped JSONL format and processed as a stream, so the full (multi-hundred-MB) file never needs to fit in memory.
- Cache refreshes take an exclusive lock (`.ritual-cache-lock` in the cache folder) so concurrent processes never interleave writes. A waiting process breaks the lock when its holder has died, and otherwise gives up after the configurable [`cacheLockTimeoutSeconds`](/configuration/#cache-lock-timeout) (default 5 minutes).
