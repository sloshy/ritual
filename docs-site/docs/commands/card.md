---
sidebar_position: 6
---

# card

Look up a single card by name using Scryfall.

## Usage

```bash
./ritual card [name] [options]
```

## Arguments

| Argument | Description             | Required                                                       |
| -------- | ----------------------- | -------------------------------------------------------------- |
| `[name]` | Card name to search for | Conditional (required unless using `--stdin` or `--from-file`) |

## Options

| Option               | Description                                       |
| -------------------- | ------------------------------------------------- |
| `--fuzzy`            | Use fuzzy matching instead of exact               |
| `--set <code>`       | Filter by set code                                |
| `--stdin`            | Read card names from stdin (one per line)         |
| `--from-file <path>` | Read card names from a file (one per line)        |
| `--fields <list>`    | Comma-separated fields for `json`/`ndjson` output |
| `--output <format>`  | Output format (`json`, `ndjson`, or `text`)       |
| `--quiet`            | Suppress non-essential output                     |

## Examples

Look up a card by exact name:

```bash
./ritual card "Sol Ring"
```

Use fuzzy matching for approximate names:

```bash
./ritual card "sol rng" --fuzzy
```

Look up a specific printing by set:

```bash
./ritual card "Lightning Bolt" --set lea
```

Get plain text output:

```bash
./ritual card "Sol Ring" --output text
```

Batch lookup from stdin as NDJSON:

```bash
printf "Sol Ring\nArcane Signet\n" | ./ritual card --stdin --output ndjson
```
