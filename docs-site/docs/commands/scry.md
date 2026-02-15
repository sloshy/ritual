---
sidebar_position: 8
---

# scry

Run a raw Scryfall card search.

## Usage

```bash
./ritual scry <query> [options]
```

## Arguments

| Argument  | Description           | Required |
| --------- | --------------------- | -------- |
| `<query>` | Scryfall search query | Yes      |

## Options

| Option              | Description                                                       | Default           |
| ------------------- | ----------------------------------------------------------------- | ----------------- |
| `--csv`             | Output results as CSV                                             | `false`           |
| `--pages <number>`  | Number of pages to output                                         | `1` (for non-TTY) |
| `--fields <list>`   | Comma-separated fields for `json`/`ndjson` output                 | -                 |
| `--output <format>` | Output format (`json`, `ndjson`, or `text`)                       | `json`            |
| `--quiet`           | Suppress non-essential output and default to one page in TTY mode | `false`           |
| `--non-interactive` | Disable interactive pagination prompts                            | `false`           |
| `-y, --yes`         | Automatically fetch additional pages in TTY mode                  | `false`           |

## Examples

Search for legendary creatures:

```bash
./ritual scry "type:legendary type:creature"
```

Search for cards legal in Commander under $5:

```bash
./ritual scry "legal:commander usd<5"
```

Export search results to CSV:

```bash
./ritual scry "set:mh2 type:creature" --csv > creatures.csv
```

Force text output:

```bash
./ritual scry "type:artifact" --output text
```

Stream projected card fields as NDJSON:

```bash
./ritual scry "type:artifact" --fields name,set,prices.usd --output ndjson
```

Get multiple pages of results:

```bash
./ritual scry "type:planeswalker" --pages 5
```

Fetch all pages in TTY mode without prompts:

```bash
./ritual scry "type:planeswalker" --yes
```

## Query Syntax

This command uses [Scryfall's search syntax](https://scryfall.com/docs/syntax). Some common operators:

| Operator | Example           | Description               |
| -------- | ----------------- | ------------------------- |
| `type:`  | `type:creature`   | Filter by card type       |
| `set:`   | `set:mh2`         | Filter by set code        |
| `cmc:`   | `cmc:3`           | Filter by mana value      |
| `c:`     | `c:blue`          | Filter by color           |
| `legal:` | `legal:commander` | Filter by format legality |
| `usd<`   | `usd<10`          | Filter by price           |
