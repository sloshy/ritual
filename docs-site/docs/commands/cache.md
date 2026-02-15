---
sidebar_position: 5
---

# cache

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

## Examples

Preload Kaldheim cards:

```bash
./ritual cache preload-set khm
```

Preload Alpha cards:

```bash
./ritual cache preload-set lea
```

## Notes

- Set codes are the official Scryfall/Gatherer set codes
- Preloading a set fetches all cards and stores them locally
- This speeds up subsequent operations that reference cards from that set
- The cache is stored in the `cache/` directory
