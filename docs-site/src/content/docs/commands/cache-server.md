---
title: 'cache-server'
---

Start a local cache server for card and pricing cache data.

## Usage

```bash
./ritual cache-server [options]
```

## Options

| Option                        | Description                                                                    | Default                                          |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `-p, --port <number>`         | Port for the cache server                                                      | `4000`                                           |
| `--host <hostname>`           | Host interface for the cache server                                            | `127.0.0.1`                                      |
| `--cards-refresh <interval>`  | Run full cards cache refresh on a cadence (`daily`, `weekly`, `monthly`)       | disabled                                         |
| `--prices-refresh <interval>` | Run price cache refresh scheduling on a cadence (`daily`, `weekly`, `monthly`) | disabled                                         |
| `--cache-source <source>`     | Where card refreshes download from: `scryfall` or `feed`                       | `cacheSource` config key                         |
| `--feed-url <url>`            | Cache feed URL for feed-sourced refreshes                                      | `cacheFeedUrl` config, then the built-in default |
| `--feed-torrent-port <n>`     | Fixed TCP port for incoming torrent peers while seeding feed artifacts         | random                                           |
| `--no-feed-seed`              | With a feed source, sync without seeding the artifacts back to the swarm       | seeding on                                       |
| `-v, --verbose`               | Log every incoming cache-server request                                        | disabled                                         |
| `--deny-http`                 | Reject all outgoing HTTP requests (can be used for testing)                    | disabled                                         |

## Behavior

- Uses local `cache/cache.json` as the cache storage backend.
- If the card cache is empty or stale for the selected cards cadence (weekly if unset) on startup, it performs a full preload before serving requests.
- Startup and scheduled full preloads take the exclusive cache-write lock (`cache/.ritual-cache-lock`), so they never interleave with another process's refresh — see [Configuration → Cache lock timeout](/configuration/#cache-lock-timeout).
- With a `feed` cache source, card refreshes sync from a peer-to-peer [cache feed](/commands/cache-feed/) instead of Scryfall (unchanged feeds are a cheap infohash check; feed failures fall back to a direct Scryfall preload), and — unless `--no-feed-seed` — the server **keeps seeding** the feed's artifacts between refreshes, making every always-on cache server a permanent swarm member. In feed-seeding mode the startup refresh always runs (it is what starts the seeding), even when the local cache is fresh.
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

## HTTP endpoints

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

### SSE event format (`/cache/prices/stream`)

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

`updated` is `true` when the server refreshed and re-cached that entry during this request, otherwise `false`.
Clients should parse events in order, handle each `price` event immediately (for progress/logging and partial results), and treat `done` as stream completion. For refreshed entries, events are emitted in completion order (not strictly request order), so use `key` to correlate each event to the requested card.

## Client configuration

To make Ritual commands use the cache server instead of local cache files:

- Set `RITUAL_CACHE_SERVER=<host:port>`, or
- Use top-level `--cache-server <host:port>`
- Optional refresh cadence env vars:
  - `RITUAL_CACHE_SERVER_CARDS_REFRESH=<daily|weekly|monthly>`
  - `RITUAL_CACHE_SERVER_PRICES_REFRESH=<daily|weekly|monthly>`

The CLI option takes precedence over the environment variable.

## Examples

Start the cache server locally:

```bash
./ritual cache-server
```

Start with weekly cards refresh and monthly prices refresh:

```bash
./ritual cache-server --cards-refresh weekly --prices-refresh monthly
```

Use the cache server from another Ritual command:

```bash
./ritual --cache-server 127.0.0.1:4000 price "My Deck"
```
