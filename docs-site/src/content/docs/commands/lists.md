---
title: 'lists'
---

List every deck, collection, and wanted list in the workspace. This is the quickest way to see what exists, and the way a script learns the names it can pass to other commands.

## Usage

```bash
ritual lists [options]
```

## Options

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `--deck`            | Only list decks                            |         |
| `--collection`      | Only list collections                      |         |
| `--wanted`          | Only list wanted lists                     |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |
| `--quiet`           | Suppress non-essential output              | `false` |

The three type flags are mutually exclusive. Passing more than one is a usage error.

## Examples

List everything:

```bash
ritual lists
```

```text
deck        burn   Burn
deck        stax   Winota Stax
collection  main   Main Binder
wanted      needs  Needs
```

Each text row is three aligned columns: the list type, the slug (the file basename, which is what other commands resolve), and the display name (the list's `# Title` heading).

Only decks, as JSON:

```bash
ritual lists --deck --output json
```

```json
[
  { "type": "deck", "slug": "burn", "name": "Burn" },
  { "type": "deck", "slug": "stax", "name": "Winota Stax" }
]
```

`ndjson` emits the same rows, one JSON object per line.

## Behavior

Rows are sorted by type (decks, then collections, then wanted lists), then by slug. When nothing matches, the command still exits `0`: text output prints `(no lists)`, JSON output prints `[]`, and NDJSON prints nothing.

## Exit Codes

| Code | Meaning                               |
| ---- | ------------------------------------- |
| `0`  | Success (including an empty result)   |
| `2`  | Usage error (more than one type flag) |
| `1`  | Runtime error                         |
