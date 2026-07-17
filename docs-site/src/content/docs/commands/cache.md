---
title: 'cache'
---

Manage the card cache.

## Usage

```bash
./ritual cache <subcommand> [options]
```

## Subcommands

### preload-set

Preload all cards from a specific set into the cache.

```bash
./ritual cache preload-set <setCode>
```

| Argument    | Description                              | Required |
| ----------- | ---------------------------------------- | -------- |
| `<setCode>` | Set code to preload (e.g., `khm`, `lea`) | Yes      |

### preload-all

Download and cache the full Scryfall bulk card data. This also downloads the
**oracle** and **art** tag bulks and bakes them onto every cached card (see
[Tags](#tags) below).

```bash
./ritual cache preload-all
```

### refresh-tags

Re-download only the oracle and art tag bulks and re-attach them to the cards
already in the cache. Tag data is updated daily on Scryfall, while the much
larger card bulk rarely changes — so this is the fast way to keep tags current
without re-downloading every card.

```bash
./ritual cache refresh-tags
```

### status

Report the card cache's state. Purely diagnostic and script-safe: it never
prompts, never downloads or refreshes anything, and exits `0` even when the
cache is empty — branch on the `empty` field, not the exit code.

```bash
./ritual cache status [--output text|json|ndjson] [--quiet]
```

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `--output <format>` | Output format: `text` (default), `json`, or `ndjson` |
| `--quiet`           | Suppress non-essential output                        |

Text output is aligned `key: value` lines; `json`/`ndjson` emit an object with
these fields:

| Field             | Meaning                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`           | `true` when no cards are cached at all.                                                                                                                                                                                                                         |
| `cardCount`       | Distinct card **names** cached. Each name's cached value is the array of that card's printings, so the total number of printings is larger.                                                                                                                     |
| `lastCardRefresh` | ISO-8601 time of the last **bulk** refresh, or `null` until one has run — only a bulk load (`preload-all` / a feed sync) stamps this timestamp, so a cache populated purely by per-set or per-card lookups reports `null` (rendered as `never` in text output). |
| `priceAgeHours`   | Whole hours since `lastCardRefresh`, or `null` when that is `null`. Prices ride along inside the bulk card data, so price age equals bulk-cache age.                                                                                                            |
| `priceStale`      | `true` when prices are older than the 24-hour price-freshness convention, or when their age is unknown (`lastCardRefresh` is `null`).                                                                                                                           |
| `tagsPresent`     | Whether cached cards carry oracle/art tags (see [Tags](#tags)), determined from a small bounded sample of cached cards rather than a full scan — a cache where only rarely-tagged cards land in the sample can report `false` despite a completed tag refresh.  |
| `source`          | `local` when reading the on-disk cache, `cache-server` when a [cache server](/commands/cache-server/) is configured via `--cache-server` or `RITUAL_CACHE_SERVER`.                                                                                              |

## Tags

Scryfall publishes community [Tagger](https://tagger.scryfall.com/) data as bulk
files. Ritual attaches these to cached cards as plain slug arrays:

- **`oracleTags`** — functional tags (e.g. `ramp`, `removal`, `tutor`). Matched
  by oracle identity, so every printing of a card shares the same oracle tags.
- **`artTags`** — artwork tags (e.g. `dragon`, `mountains`). Matched per
  printing's illustration, so different printings of the same card can have
  different art tags.

The derived tag lookup is stored in `cache/tags.json`.

## Examples

Preload Kaldheim cards:

```bash
./ritual cache preload-set khm
```

Cache all cards and tags:

```bash
./ritual cache preload-all
```

Refresh just the tags on an already-populated cache:

```bash
./ritual cache refresh-tags
```

Check the cache's state from a script:

```bash
./ritual cache status --output json
```

## Notes

- Set codes are the official Scryfall/Gatherer set codes
- Preloading a set fetches all cards and stores them locally
- This speeds up subsequent operations that reference cards from that set
- The cache is stored in the `cache/` directory
- Bulk data is downloaded in Scryfall's gzipped JSONL format and processed as a
  stream, so the full (multi-hundred-MB) file never needs to fit in memory
- With [`cacheSource: "feed"`](/configuration/#cache-source), `preload-all` (and
  every other cache refresh) syncs from a peer-to-peer
  [cache feed](/commands/cache-feed/) instead, falling back to Scryfall when
  the feed is unreachable
- Cache refreshes take an exclusive lock (`cache/.ritual-cache-lock`) so
  concurrent processes never interleave writes; a waiting process breaks the
  lock when its holder has died, and otherwise gives up after the configurable
  [`cacheLockTimeoutSeconds`](/configuration/#cache-lock-timeout) (default 5 minutes)
