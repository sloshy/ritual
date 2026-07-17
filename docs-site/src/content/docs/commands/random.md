---
title: 'random'
---

Fetch a random card from Scryfall.

## Usage

```bash
./ritual random [options]
```

## Options

| Option              | Description                                       |
| ------------------- | ------------------------------------------------- |
| `--filter <query>`  | Scryfall search query to filter random selection  |
| `--fields <list>`   | Comma-separated fields for `json`/`ndjson` output |
| `--output <format>` | Output format (`json`, `ndjson`, or `text`)       |
| `--quiet`           | Suppress non-essential output                     |

## Examples

Get a completely random card:

```bash
./ritual random
```

Get a random legendary creature:

```bash
./ritual random --filter "type:legendary type:creature"
```

Get a random card under $1:

```bash
./ritual random --filter "usd<1"
```

Get text output for shell scripts:

```bash
./ritual random --output text
```

## Exit Codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | A card was fetched and printed                             |
| `1`  | Request failure (network error or a Scryfall server error) |
| `2`  | Usage error (`--fields` without `json`/`ndjson` output)    |
| `3`  | No card matched the `--filter` query                       |
