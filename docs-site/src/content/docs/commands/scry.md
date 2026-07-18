---
title: 'scry'
---

Run a raw Scryfall card search, or fetch random cards with `--random`.

## Usage

```bash
./ritual scry <query> [options]
./ritual scry [query] --random [options]
```

## Arguments

| Argument  | Description                                                | Required                   |
| --------- | ---------------------------------------------------------- | -------------------------- |
| `[query]` | Scryfall search query (with `--random`, filters the picks) | Unless `--random` is given |

## Options

| Option              | Description                                       | Default                                    |
| ------------------- | ------------------------------------------------- | ------------------------------------------ |
| `--csv`             | Output results as CSV                             | `false`                                    |
| `--pages <number>`  | Fetch up to this many pages, without prompting    | `1` when interactive paging is unavailable |
| `--random`          | Fetch random cards instead of searching           | `false`                                    |
| `--count <number>`  | Number of random cards to fetch (`--random` only) | `1`                                        |
| `--fields <list>`   | Comma-separated fields for `json`/`ndjson` output | -                                          |
| `--output <format>` | Output format (`json`, `ndjson`, or `text`)       | `json`                                     |
| `--quiet`           | Suppress non-essential output                     | `false`                                    |

`--random` cannot be combined with `--pages` or `--csv`, and `--count` requires `--random`; either combination is rejected with a usage error. Without `--random`, a search query is required.

## Paging

Scryfall returns search results in pages. How many `scry` fetches:

- **`--pages <n>`** fetches up to `n` pages and never prompts, in a terminal or not.
- **Without `--pages`, in an interactive terminal** (stdout and stdin are both TTYs and prompting is allowed), `scry` asks "Fetch next page?" after each page until you decline or the results run out.
- **Everywhere else** — piped output, scripts, or the global `--no-input` flag (or the `RITUAL_NO_INPUT` environment variable) — exactly one page is fetched.

`--quiet` does not affect paging; it only suppresses non-essential output.

:::note
Use the global `--no-input` flag to guarantee no prompting, and `--pages <n>` to fetch a fixed number of pages. There is no fetch-all flag — pass a suitably large `--pages` value if you truly want everything.
:::

## Random Cards

`--random` fetches random cards instead of running a search. The query, when given, filters the random selection — each pick is a random card matching the query. Cards are fetched one request at a time (Scryfall rate limiting applies), so large `--count` values take proportionally longer.

Output shape: a single pick (`--count 1`, the default) emits a bare card object; `--count` greater than 1 emits an array (one line per card with `--output ndjson`). `--output text` prints one `Name (SET)` line per card. `--fields` projection works as with searches. If any fetch fails or a pick comes back empty, nothing is printed and the command exits non-zero.

Get a completely random card:

```bash
./ritual scry --random
```

Get a random legendary creature:

```bash
./ritual scry "type:legendary type:creature" --random
```

Get five random cards under $1:

```bash
./ritual scry "usd<1" --random --count 5
```

Get text output for shell scripts:

```bash
./ritual scry --random --output text
```

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

| Code | Meaning                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Results printed                                                                                                                                            |
| `1`  | Request failure while fetching a page or a random card                                                                                                     |
| `2`  | Usage error (missing query without `--random`, `--random` with `--pages` or `--csv`, `--count` without `--random`, `--fields` with `--csv` or text output) |
| `3`  | No search results found, or no card matched the random filter                                                                                              |

`--pages` and `--count` must be positive integers; any other value is rejected with a usage error.
