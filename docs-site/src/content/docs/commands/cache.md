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

## Notes

- Set codes are the official Scryfall/Gatherer set codes
- Preloading a set fetches all cards and stores them locally
- This speeds up subsequent operations that reference cards from that set
- The cache is stored in the `cache/` directory
