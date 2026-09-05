---
title: 'cache'
---

Manage the card cache: inspect it, preload it, and run the always-on cache server and peer-to-peer cache feed.

## Usage

```bash
ritual cache <subcommand> [options]
```

## Subcommands

### status

Report the card cache's state. It is purely diagnostic and script-safe: it never prompts, never downloads or refreshes anything, and exits `0` even when the cache is empty. Branch on the `empty` field, not the exit code.

```bash
ritual cache status [--output text|json|ndjson]
```

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `--output <format>` | Output format: `text` (default), `json`, or `ndjson` |

The status report is the command's entire output, so there is no `--quiet` ([shared convention](/cli-conventions/#scripting)).

Text output is aligned `key: value` lines. `json`/`ndjson` emit an object with these fields:

| Field             | Meaning                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`           | `true` when no cards are cached at all.                                                                                                                                                                                                                         |
| `cardCount`       | Distinct card **names** cached. Each name's cached value is the array of that card's printings, so the total number of printings is larger.                                                                                                                     |
| `lastCardRefresh` | ISO-8601 time of the last **bulk** refresh, or `null` until one has run — only a bulk load (`preload-all` / a feed sync) stamps this timestamp, so a cache populated purely by per-set or per-card lookups reports `null` (rendered as `never` in text output). |
| `priceAgeHours`   | Whole hours since `lastCardRefresh`, or `null` when that is `null`. Prices ride along inside the bulk card data, so price age equals bulk-cache age.                                                                                                            |
| `priceStale`      | `true` when prices are older than the 24-hour price-freshness convention, or when their age is unknown (`lastCardRefresh` is `null`).                                                                                                                           |
| `tagsPresent`     | Whether cached cards carry oracle/art tags (see [Tags](#tags)), determined from a small bounded sample of cached cards rather than a full scan — a cache where only rarely-tagged cards land in the sample can report `false` despite a completed tag refresh.  |
| `source`          | `local` when reading the on-disk cache, `cache-server` when a [cache server](#server) is configured via `--cache-server` or `RITUAL_CACHE_SERVER`.                                                                                                              |
| `defaultLanguage` | The configured [`defaultLanguage`](/configuration/#default-language) — what decides which Scryfall bulk backs the cache.                                                                                                                                        |
| `cardBulkType`    | Which bulk built the card cache: `default_cards` (English-only) or `all_cards` (every language), or `null` when no bulk ingest has recorded provenance yet (an empty cache, or one filled before provenance existed — necessarily `default_cards`).             |
| `bulkTypeStale`   | `true` when a non-empty cache's bulk disagrees with what `defaultLanguage` demands — the cache needs a full redownload, which the freshness gates offer (see [Bulk selection](#bulk-selection-and-language)).                                                   |

The same report is available over HTTP as [`GET /api/cache/status`](/admin/api/#cache-status).

### preload-set

Preload all cards from a specific set into the cache.

```bash
ritual cache preload-set <setCode>
```

| Argument    | Description                              | Required |
| ----------- | ---------------------------------------- | -------- |
| `<setCode>` | Set code to preload (e.g., `khm`, `lea`) | Yes      |

It caches exactly that set and nothing else. Unlike the interactive card lookups, it never offers to bulk-download every English card first, since picking this command is already a statement about how much you want cached. Use [`preload-all`](#preload-all) when you do want the whole database.

The outcomes are distinguished, so a script can trust the exit code:

| Outcome                                         | Exit | Output                                                                                                     |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| Cards cached                                    | `0`  | `Successfully cached N cards for set 'KHM'`                                                                |
| Set exists but holds no real printings          | `0`  | `Set 'TMKM' matched N items, none of which are real printings (token and Art Series sets are not cached).` |
| Unknown set code (Scryfall matched nothing)     | `3`  | `No cards found for set 'ZZZZ' — check the set code (see https://scryfall.com/sets)`                       |
| Search failed (HTTP error, network unreachable) | `1`  | `Failed to preload set 'KHM': <reason>`                                                                    |

Token sets (`tmkm`) and Art Series sets are real sets that cache nothing, since Ritual stores only real printings. They are reported as their own outcome rather than being mistaken for a typo'd set code.

### preload-all

Download and cache the full Scryfall bulk card data. This also downloads the **oracle** and **art** tag bulks and bakes them onto every cached card (see [Tags](#tags) below). With [`cacheSource: "feed"`](/configuration/#cache-source) or `--source feed`, it syncs from a peer-to-peer [cache feed](#feed-fetch) instead, falling back to Scryfall when the feed is unreachable.

```bash
ritual cache preload-all [options]
```

| Option              | Description                                                                                                                                          | Default                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `--source <source>` | Where to download from: `scryfall` or `feed` (overrides the `cacheSource` config key for this run)                                                   | `cacheSource` config key                         |
| `--url <feedUrl>`   | Feed URL for a feed-sourced refresh; implies `--source feed` (combining it with `--source scryfall` is a usage error)                                | `cacheFeedUrl` config, then the built-in default |
| `--force`           | Re-download and re-ingest even when the feed is unchanged (only meaningful with the feed source — a Scryfall refresh always downloads the full bulk) | off                                              |

Printings that no list should ever reference are dropped during ingestion and never enter the cache: **tokens**, **Arena-only** prints, and **Art Series** prints (the oversized art-only cards from set boosters, which share their card's name). Filtering them at ingest keeps them out of every search surface at once: CLI autocomplete and printing pickers, the admin editor, and the hosted public site's card search. An older cache built before this filtering existed still holds them; re-run `preload-all` to clear them out.

A failed preload exits `1`. The same refresh over HTTP ([`POST /api/cache/refresh`](/admin/api/#refresh-cache), and the MCP `refresh_cache` tool that reuses it) likewise **reports the failure** rather than answering success unconditionally, and honours cancellation from an in-process caller (the MCP tool): the download stops, nothing is written, the previous cache stands, and the cache lock is released.

#### The buylist rides along under sell mode

When [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is enabled, or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` (which wants the same feed), `preload-all` updates **every** cache the workspace uses, and the [Card Kingdom buylist](/commands/sell/) is one of them. A site built from a day-old feed bakes yesterday's offers. After the card cache refresh succeeds it runs the equivalent of `ritual sell --refresh auto` on the feed: a cached copy less than a day old is left alone, a day-old one is redownloaded, and a missing one is downloaded (~70 MB) without prompting, since reaching this command is already consent to bulk downloads. `--force` carries through, so it redownloads a feed that is merely fresh.

There is no `--sell-mode` flag here. This is cache maintenance, not a surface that offers sell mode, so it follows the config only. **A buylist failure is a warning, never the exit code**, since the card cache did refresh:

```
The card cache was updated, but the Card Kingdom buylist was not: <reason>
```

With sell mode off, no buylist work happens. The HTTP and MCP refreshes (`POST /api/cache/refresh`, `refresh_cache`) do **not** include this step. The buylist has its own route and tool (`POST /api/sell/refresh`, `refresh_buylist`).

### Bulk selection and language

Which Scryfall bulk a card refresh downloads follows the [`defaultLanguage`](/configuration/#default-language) config key:

- `en` (the default) → **`default_cards`**: one English card object per printing.
- anything else → **`all_cards`**: every language's card objects, so non-English printings can be verified, picked, and displayed. This bulk is several times larger; expect a much bigger download and cache.

The rule applies everywhere the card cache is fetched or synced: `preload-all`, the stale-cache prompts on other commands, the [cache server](#server)'s scheduled refreshes, and the [cache feed](#feed-fetch).

Every bulk ingest records **which bulk built the cache** in a `cache/card-bulk.json` sidecar. When that provenance disagrees with what `defaultLanguage` currently demands (you switched the key in either direction), the cache is the wrong dataset, and commands that check cache freshness say so instead of running a doomed staleness prompt. Under `--refresh ask` they offer a full redownload, under `--refresh auto` they run it, and `cache status` reports it as `bulkTypeStale: true`. A cache filled before provenance existed reads as `default_cards`.

### refresh-tags

Re-download only the oracle and art tag bulks and re-attach them to the cards already in the cache. Tag data is updated daily on Scryfall, while the much larger card bulk rarely changes, so this is the fast way to keep tags current without re-downloading every card. A failed refresh exits `1`.

```bash
ritual cache refresh-tags
```

### server

Start a local cache server for card and pricing cache data. Other Ritual commands (on this or other machines) use it instead of their local cache files. See [Client configuration](#client-configuration).

```bash
ritual cache server [options]
```

| Option                        | Description                                                                                                    | Default                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `-p, --port <number>`         | Port for the cache server                                                                                      | `4000`                                                  |
| `--host <hostname>`           | Host interface for the cache server                                                                            | `127.0.0.1`                                             |
| `--cards-refresh <interval>`  | Run full cards cache refresh on a cadence (`daily`, `weekly`, `monthly`)                                       | env `RITUAL_CACHE_SERVER_CARDS_REFRESH`, else disabled  |
| `--prices-refresh <interval>` | Run price cache refresh scheduling on a cadence (`daily`, `weekly`, `monthly`)                                 | env `RITUAL_CACHE_SERVER_PRICES_REFRESH`, else disabled |
| `--cache-source <source>`     | Where card refreshes download from: `scryfall` or `feed`                                                       | `cacheSource` config key                                |
| `--url <feedUrl>`             | Cache feed URL for feed-sourced refreshes (a usage error with `--cache-source scryfall`, which never reads it) | `cacheFeedUrl` config, then the built-in default        |
| `--torrent-port <n>`          | Fixed TCP port for incoming torrent peers while seeding feed artifacts                                         | random                                                  |
| `--no-seed`                   | With a feed source, sync without seeding the artifacts back to the swarm                                       | seeding on                                              |
| `-v, --verbose`               | Log every incoming cache-server request                                                                        | disabled                                                |
| `--deny-http`                 | Reject all outgoing HTTP requests (can be used for testing)                                                    | disabled                                                |

See [The cache server](#the-cache-server) for behavior details and the HTTP API.

### feed host

Host a **cache feed**: download the raw Scryfall bulk files (the card bulk(s) chosen with `--cards` plus the oracle/art tag bulks, as gzipped JSONL), create a BitTorrent torrent for each, and run an HTTP server that publishes a `feed.json` describing the current artifacts while seeding them to peers. Sharing the bulk data peer-to-peer puts daily load on Scryfall's servers once per group instead of once per machine.

```bash
ritual cache feed host --public-url https://feed.example.com
```

| Option                 | Description                                                                                                      | Default                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `-p, --port <number>`  | Port for the feed HTTP server                                                                                    | `4010`                                                                           |
| `--host <hostname>`    | Host interface for the feed HTTP server                                                                          | `127.0.0.1`                                                                      |
| `--public-url <url>`   | Public base URL peers reach this host at; embedded in the feed's file/torrent URLs and each torrent's web seed   | `http://<host>:<port>`                                                           |
| `--cards <which>`      | Card bulk(s) to publish: `default` (English-only `default_cards`), `all` (every-language `all_cards`), or `both` | whichever the host's [`defaultLanguage`](/configuration/#default-language) needs |
| `--refresh <interval>` | Re-check Scryfall for new bulk data (`daily`, `weekly`, `monthly`; env `RITUAL_CACHE_FEED_REFRESH`)              | `daily`                                                                          |
| `--upstream <url>`     | Bulk manifest URL to source artifacts from (point at another feed host's mirror, or a test stub)                 | Scryfall's `/bulk-data`                                                          |
| `--dir <path>`         | Feed data directory                                                                                              | `<cache>/feed`                                                                   |
| `--no-seed`            | Serve the feed and files over HTTP only, without BitTorrent seeding                                              | seeding on                                                                       |
| `--torrent-port <n>`   | Fixed TCP port for incoming torrent peers (random when omitted)                                                  | random                                                                           |
| `-v, --verbose`        | Log every feed-server request                                                                                    | off                                                                              |

### feed fetch

Sync the card cache from a cache feed, then stay open **seeding** the artifacts back to other peers. Every seeder reduces the load on both Scryfall and the feed host. Press Ctrl+C to stop.

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

- Downloaded artifacts are verified against the feed's per-file SHA-256 before anything is ingested. A corrupted download is deleted and the sync fails.
- Only the kinds the client actually needs are downloaded, ingested, and seeded: the tag bulks plus **one** card bulk, `default-cards` under an English [`defaultLanguage`](/configuration/#default-language), `all-cards` otherwise. A feed that does not publish the needed card kind fails the sync with a message naming it (point the host at `--cards both` to serve mixed clients).
- What was last ingested is tracked in `cache/feed-client/state.json` by torrent infohash, **per kind**, so switching `defaultLanguage` (which switches the needed card kind) forces a re-ingest even when the feed itself has not changed. An unchanged feed for an unchanged kind is a cheap no-op: no bulk download, no re-ingest.
- Ingestion runs the exact same local pipeline as a direct Scryfall preload (filtering, card mapping, tag baking), so a feed-synced cache is indistinguishable from a Scryfall-synced one.
- While seeding, the feed is re-checked on the `--refresh` cadence and new artifacts are ingested and seeded automatically.

To make feed syncing the default for **all** of Ritual's cache refreshes (the `cache preload-all` command, stale-cache prompts, `build-site --refresh auto`, price refreshes), set the [`cacheSource` config key](/configuration/#cache-source):

```bash
ritual config set cacheSource feed
ritual config set cacheFeedUrl https://feed.example.com/feed.json
```

Refreshes then check the feed's infohashes instead of re-downloading from Scryfall, fall back to Scryfall with a warning when the feed is unreachable, and seed to peers for the duration of any download.

For an always-on swarm member, run a [cache server](#server) with `--cache-source feed`. It syncs from the feed on its refresh cadence and keeps seeding the artifacts between refreshes.

## Tags

Scryfall publishes community [Tagger](https://tagger.scryfall.com/) data as bulk files. Ritual attaches these to cached cards as plain slug arrays:

- **`oracleTags`**: functional tags (e.g. `ramp`, `removal`, `tutor`). Matched by oracle identity, so every printing of a card shares the same oracle tags.
- **`artTags`**: artwork tags (e.g. `dragon`, `mountains`). Matched per printing's illustration, so different printings of the same card can have different art tags.

The derived tag lookup is stored in `cache/tags.json`. The [`sell`](/commands/sell/) command keeps its Card Kingdom buylist feed in its own file, `cache/cardkingdom.json`, with its own daily freshness. The only cache command that touches it is [`preload-all`](#the-buylist-rides-along-under-sell-mode), and only when sell mode is enabled; `cache status`, the [cache server](#the-cache-server), and the [cache feed](#feed-fetch) all ignore it.

## The cache server

### Behavior

- Uses local `cache/cache.json` as the cache storage backend.
- If the card cache is empty or stale for the selected cards cadence (weekly if unset) on startup, it performs a full preload before serving requests.
- Startup and scheduled full preloads take the exclusive cache-write lock (`cache/.ritual-cache-lock`), so they never interleave with another process's refresh. See [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).
- With a `feed` cache source, card refreshes sync from a peer-to-peer [cache feed](#feed-host) instead of Scryfall (unchanged feeds are a cheap infohash check; feed failures fall back to a direct Scryfall preload), and, unless `--no-seed`, the server **keeps seeding** the feed's artifacts between refreshes, making every always-on cache server a permanent swarm member. In feed-seeding mode the startup refresh always runs (it is what starts the seeding), even when the local cache is fresh.
- `--deny-http` also disables feed syncing and seeding.
- On cache misses, it performs read-through fetches and stores the results back into local cache.
- Price entries can be grouped into cadence buckets and refreshed on schedule.
- Price refresh scheduling is game-format-aware: USD/EUR price refreshes are skipped for cards without paper printings, and TIX refreshes are skipped for cards without MTGO printings.
- For weekly/monthly price cadence, a manual read after one day can invalidate the pending schedule, refresh immediately, and re-schedule.
- For daily/weekly/monthly price cadence, startup entries older than the selected cadence window are enqueued immediately with 200ms staggering between refreshes.
- For streamed/fallback refreshes, network refresh starts are staggered by 200ms and `price` events are emitted in completion order.
- Cache updates are always logged.
- Price min/max batch lookups can be streamed with SSE using `POST /cache/prices/stream`.
- With `--verbose`, each incoming request is logged with method, path, status, and duration.
- With `--deny-http`, the server will not make any outgoing HTTP requests. The startup card cache preload is skipped, and any cache-miss read-through that would normally fetch from Scryfall will throw an error. Use this for testing with pre-populated caches.

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

`updated` is `true` when the server refreshed and re-cached that entry during this request, otherwise `false`. Clients should parse events in order, handle each `price` event immediately (for progress/logging and partial results), and treat `done` as stream completion. For refreshed entries, events are emitted in completion order (not strictly request order), so use `key` to correlate each event to the requested card.

### Client configuration

To make Ritual commands use the cache server instead of local cache files:

- Set `RITUAL_CACHE_SERVER=<host:port>`, or
- Use top-level `--cache-server <host:port>`

The CLI option takes precedence over the environment variable.

On the server side, the refresh cadences can also come from environment variables when the flags are omitted:

- `RITUAL_CACHE_SERVER_CARDS_REFRESH=<daily|weekly|monthly>`
- `RITUAL_CACHE_SERVER_PRICES_REFRESH=<daily|weekly|monthly>`

## The cache feed

### HTTP endpoints

| Path                           | Description                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `/feed.json`                   | The current feed document (see below)                                   |
| `/files/<fileName>`            | A raw bulk artifact; supports HTTP range requests (torrent web seeding) |
| `/torrents/<infoHash>.torrent` | The `.torrent` file for an artifact                                     |
| `/health`                      | `{ status, entries, generatedAt }`                                      |

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

Clients decide whether anything changed by comparing each entry's `infoHash` against what they last ingested: content identity, not timestamps.

### Behavior

- **Raw artifacts, not processed caches.** The feed distributes Scryfall's bulk files byte-identical to the originals, and every peer runs its own local ingestion. A schema change in Ritual's processed cache can therefore never version-skew the swarm.
- **Web seeds make an empty swarm harmless.** Every torrent embeds this host's `--public-url` file URL as a BEP 19 web seed, so a download completes over plain HTTP(S) even with zero peers online. Peers only make it faster.
- **Transports:** plain TCP peers plus DHT discovery. Trackers and WebRTC are not used (Ritual's build stubs out WebRTC entirely).
- On each refresh interval the host re-reads Scryfall's bulk manifest and only downloads artifacts whose `updated_at` changed. A republished feed prunes the previous generation's files and torrents from disk.
- A restart serves the previously published feed immediately, then refreshes.
- A failed refresh on startup exits with an error when no previous feed exists. Once a feed has been published, later refresh failures are logged and the last good feed keeps being served (and seeded).
- The feed directory holds `feed.json`, `files/`, and `torrents/`.

### Serving publicly

Bind to localhost and put a TLS reverse proxy in front for the HTTP side, with `--public-url` set to the proxy's public origin. The feed URL is the trust root for clients, so it should be HTTPS. Peers additionally need the torrent TCP port (`--torrent-port`) reachable directly.

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
- Preloading a set fetches all cards and stores them locally, which speeds up later operations that reference cards from that set.
- The cache is stored in the `cache/` directory.
- Bulk data is downloaded in Scryfall's gzipped JSONL format and processed as a stream, so the full (multi-hundred-MB) file never needs to fit in memory.
- With [`cacheSource: "feed"`](/configuration/#cache-source), `preload-all` (and every other cache refresh) syncs from a peer-to-peer [cache feed](#feed-fetch) instead, falling back to Scryfall when the feed is unreachable.
- Cache refreshes take an exclusive lock (`cache/.ritual-cache-lock`) so concurrent processes never interleave writes. A waiting process breaks the lock when its holder has died, and otherwise gives up after the configurable [`cacheLockTimeoutSeconds`](/configuration/#cache-lock-timeout) (default 5 minutes).
