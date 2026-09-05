---
title: 'card'
---

Look up a single card by name on Scryfall, or a batch of names from a file or stdin.

## Usage

```bash
ritual card [name] [options]
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

`card` registers no `--quiet`. Everything it prints is either a card or an error, so there would be nothing for the flag to suppress ([shared convention](/cli-conventions/#scripting)).

## Batch output shape

`--stdin` and `--from-file` look up every name in the input. The output shape depends only on the flag you passed, never on how many lines the input happened to hold:

- **`--output json`** (the default) emits **one** JSON array of cards for the whole batch, the same contract [`scry`](/commands/scry/) gives a multi-page search. A run where some lookups failed still emits the cards that were found (the failures go to stderr and set the exit code), and a run where all of them failed emits `[]`. A single-name lookup, batch or not, emits a bare card object.
- **`--output ndjson`** streams one JSON object per card as it arrives. This is the streaming mode for large inputs.
- **`--output text`** prints one `Name (SET)` line per card.

## Examples

Look up a card by exact name:

```bash
ritual card "Sol Ring"
```

Use fuzzy matching for approximate names:

```bash
ritual card "sol rng" --fuzzy
```

Look up a specific printing by set:

```bash
ritual card "Lightning Bolt" --set lea
```

Get plain text output:

```bash
ritual card "Sol Ring" --output text
```

Batch lookup from stdin as one JSON array:

```bash
printf "Sol Ring\nArcane Signet\n" | ritual card --stdin --output json
```

Stream a large batch as NDJSON instead:

```bash
ritual card --from-file cards.txt --output ndjson --fields name,set,prices.usd
```

## Exit Codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | All requested cards were found and printed                                     |
| `1`  | Request failure (network error or a Scryfall server error)                     |
| `2`  | Usage error (missing card name, `--stdin` with `--from-file`, invalid fields)  |
| `3`  | Not found (a card does not exist, or the `--from-file` file could not be read) |

In batch mode each failure is reported individually. If both a request failure and a not-found occur, the exit code is `1`.
