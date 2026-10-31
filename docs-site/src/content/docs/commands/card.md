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

| Option               | Description                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--fuzzy`            | Use fuzzy matching instead of exact                                                                                                                            |
| `--set <code>`       | Filter by set code                                                                                                                                             |
| `--stdin`            | Read card names from stdin (one per line)                                                                                                                      |
| `--from-file <path>` | Read card names from a file (one per line)                                                                                                                     |
| `--fields <list>`    | Comma-separated fields for `json`/`ndjson` output; implies `--output json` when `--output` is not given (with an explicit `--output text` it is a usage error) |
| `--output <format>`  | Output format: `text` (default), `json`, or `ndjson`                                                                                                           |

There is no `--quiet`: everything the command prints is either a card or an error ([shared convention](/cli-conventions/#scripting)).

## Text output

By default the card is printed for a person to read: its name and mana cost, type line and rules text (each face in turn for a double-faced, split or adventure card), then the printing shown and its price:

```text
Lightning Bolt  {R}
Instant
Lightning Bolt deals 3 damage to any target.

Printing: LEA:161 (Limited Edition Alpha)
Price: $450.00 (TCGplayer)
```

The printing is the one Scryfall returns for the name (narrow it with `--set`). The price is Scryfall's, in the currency of your [`defaultPriceSource`](/configuration/) store: TCGplayer (USD), Cardmarket (EUR) or Cardhoarder (tix). Card Kingdom's prices come from its own feed, which `card` does not read, so a `cardkingdom` default shows TCGplayer's USD price. `N/A` means Scryfall lists no price for that printing.

A name Scryfall does not know prints `Card '…' not found.` and, unless `--fuzzy` was already given, a hint to retry with it, and the command exits `3`.

**Scripts:** pass `--output json` (or `ndjson`) to get the full Scryfall card object. The text layout is for people and may change; the JSON is Scryfall's own.

## Batch output shape

`--stdin` and `--from-file` look up every name in the input.

- **`--output json`**: an input of two or more names emits **one** JSON array for the whole batch, like a multi-page [`scry`](/commands/scry/) search. Cards that were found are still emitted when some lookups fail (failures go to stderr and set the exit code); if all fail, the output is `[]`. A single name, as an argument or a one-line batch, emits a bare card object.
- **`--output ndjson`** streams one JSON object per card as it arrives. Use this for large inputs.
- **Text** (the default) prints each card's block, separated by a blank line.

## Examples

Look up a card by exact name:

```bash
ritual card "Sol Ring"
```

Get the full Scryfall card object as JSON:

```bash
ritual card "Sol Ring" --output json
```

Use fuzzy matching for approximate names:

```bash
ritual card "sol rng" --fuzzy
```

Look up a specific printing by set:

```bash
ritual card "Lightning Bolt" --set lea
```

Batch lookup from stdin as one JSON array:

```bash
printf "Sol Ring\nArcane Signet\n" | ritual card --stdin --output json
```

Project a few fields (JSON, since `--fields` implies it):

```bash
ritual card "Sol Ring" --fields name,set,prices.usd
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
