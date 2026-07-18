---
title: 'scry'
---

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

| Option              | Description                                       | Default                                    |
| ------------------- | ------------------------------------------------- | ------------------------------------------ |
| `--csv`             | Output results as CSV                             | `false`                                    |
| `--pages <number>`  | Fetch up to this many pages, without prompting    | `1` when interactive paging is unavailable |
| `--fields <list>`   | Comma-separated fields for `json`/`ndjson` output | -                                          |
| `--output <format>` | Output format (`json`, `ndjson`, or `text`)       | `json`                                     |
| `--quiet`           | Suppress non-essential output                     | `false`                                    |

## Paging

Scryfall returns results in pages. How many `scry` fetches:

- **`--pages <n>`** fetches up to `n` pages and never prompts, in a terminal or not.
- **Without `--pages`, in an interactive terminal** (stdout and stdin are both TTYs and prompting is allowed), `scry` asks "Fetch next page?" after each page until you decline or the results run out.
- **Everywhere else** — piped output, scripts, or the global `--no-input` flag (or the `RITUAL_NO_INPUT` environment variable) — exactly one page is fetched.

`--quiet` does not affect paging; it only suppresses non-essential output.

:::note
Use the global `--no-input` flag to guarantee no prompting, and `--pages <n>` to fetch a fixed number of pages. There is no fetch-all flag — pass a suitably large `--pages` value if you truly want everything.
:::

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

Get multiple pages of results without prompts:

```bash
./ritual scry "type:planeswalker" --pages 5
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

## Exit Codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Results printed                                                               |
| `1`  | Request failure while fetching a page                                         |
| `2`  | Usage error (invalid `--pages` value, `--fields` with `--csv` or text output) |
| `3`  | No results found                                                              |

`--pages` must be a positive integer; any other value is rejected with a usage error.
