---
title: 'cache-feed'
---

Share Scryfall bulk cache data peer-to-peer, so a group of ritual users puts
daily load on Scryfall's servers once instead of once per machine.

## Subcommands

### host

Host a **cache feed**: download the raw Scryfall bulk files (`default_cards`
plus the oracle/art tag bulks, as gzipped JSONL), create a BitTorrent torrent
for each, and run an HTTP server that publishes a `feed.json` describing the
current artifacts while seeding them to peers.

```bash
./ritual cache-feed host --public-url https://feed.example.com
```

| Option                 | Description                                                                                                    | Default                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `-p, --port <number>`  | Port for the feed HTTP server                                                                                  | `4010`                  |
| `--host <hostname>`    | Host interface for the feed HTTP server                                                                        | `127.0.0.1`             |
| `--public-url <url>`   | Public base URL peers reach this host at; embedded in the feed's file/torrent URLs and each torrent's web seed | `http://<host>:<port>`  |
| `--refresh <interval>` | Re-check Scryfall for new bulk data (`daily`, `weekly`, `monthly`; env `RITUAL_CACHE_FEED_REFRESH`)            | `daily`                 |
| `--upstream <url>`     | Bulk manifest URL to source artifacts from (point at another feed host's mirror, or a test stub)               | Scryfall's `/bulk-data` |
| `--dir <path>`         | Feed data directory                                                                                            | `<cache>/feed`          |
| `--no-seed`            | Serve the feed and files over HTTP only, without BitTorrent seeding                                            | seeding on              |
| `--torrent-port <n>`   | Fixed TCP port for incoming torrent peers (random when omitted)                                                | random                  |
| `-v, --verbose`        | Log every feed-server request                                                                                  | off                     |

## HTTP endpoints

| Path                           | Description                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `/feed.json`                   | The current feed document (see below)                                   |
| `/files/<fileName>`            | A raw bulk artifact; supports HTTP range requests (torrent web seeding) |
| `/torrents/<infoHash>.torrent` | The `.torrent` file for an artifact                                     |
| `/health`                      | `{ status, entries, generatedAt }`                                      |

## The feed document

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-05T10:00:00.000Z",
  "entries": [
    {
      "kind": "default-cards", // default-cards | oracle-tags | art-tags
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

Clients decide whether anything changed by comparing each entry's `infoHash`
against what they last ingested — content identity, not timestamps.

## Behavior

- **Raw artifacts, not processed caches.** The feed distributes Scryfall's
  bulk files byte-identical to the originals; every peer runs its own local
  ingestion. A schema change in ritual's processed cache can therefore never
  version-skew the swarm.
- **Web seeds make an empty swarm harmless.** Every torrent embeds this host's
  `--public-url` file URL as a BEP 19 web seed, so a download completes over
  plain HTTP(S) even with zero peers online; peers only make it faster.
- **Transports:** plain TCP peers plus DHT discovery. Trackers and WebRTC are
  not used (ritual's build stubs out WebRTC entirely).
- On each refresh interval the host re-reads Scryfall's bulk manifest and only
  downloads artifacts whose `updated_at` changed; a republished feed prunes the
  previous generation's files and torrents from disk.
- A restart serves the previously published feed immediately, then refreshes.
- A failed refresh on startup exits with an error when no previous feed exists;
  once a feed has been published, later refresh failures are logged and the
  last good feed keeps being served (and seeded).
- The feed directory holds `feed.json`, `files/`, and `torrents/`.

## Serving publicly

Bind to localhost and put a TLS reverse proxy in front for the HTTP side, with
`--public-url` set to the proxy's public origin — the feed URL is the trust
root for clients, so it should be HTTPS. Peers additionally need the torrent
TCP port (`--torrent-port`) reachable directly.

```bash
./ritual cache-feed host --torrent-port 6885 --public-url https://feed.example.com
```
