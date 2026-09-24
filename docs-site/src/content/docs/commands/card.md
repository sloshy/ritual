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

There is no `--quiet`: everything the command prints is either a card or an error ([shared convention](/cli-conventions/#scripting)).

## Batch output shape

`--stdin` and `--from-file` look up every name in the input.

- **`--output json`** (the default): an input of two or more names emits **one** JSON array for the whole batch, like a multi-page [`scry`](/commands/scry/) search. Cards that were found are still emitted when some lookups fail (failures go to stderr and set the exit code); if all fail, the output is `[]`. A single name, as an argument or a one-line batch, emits a bare card object.
- **`--output ndjson`** streams one JSON object per card as it arrives. Use this for large inputs.
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
