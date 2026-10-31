---
title: 'ritual lists'
description: 'List every deck, collection and wanted list in the workspace.'
sidebar:
  label: 'lists'
---

List every deck, collection, and wanted list in the workspace. It is the quickest way to see what exists, and how a script learns the names it can pass to other commands.

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
Type         Name         File
deck         Burn         burn
deck         Winota Stax  stax
collection   Main Binder  main
wanted list  Needs        needs
```

The text output is a table under a heading row. **Type** is the list type, worded in your [UI language](/localization/) (`--output json` always spells it `deck`, `collection` or `wanted`). **Name** is the display name, the list's `# Title` heading. **File** is the slug, the file name without `.md`, which is what other commands match a list name against (see [List Names](/list-resolution/)). The **File** column appears only when some list's file name differs from its name; when every file is named after its list (the usual case, since Ritual names files that way), the table has just **Type** and **Name**:

```text
Type        Name
deck        Burn
collection  Main Binder
```

Scripts should read `--output json` rather than the text table.

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
