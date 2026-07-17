---
title: 'diff'
---

Compare two lists — any mix of deck, collection, and wanted list — and report what is only in one
side, only in the other, and where quantities differ. The same engine backs the admin
[`GET /api/diff`](/admin/api/#diff-lists) endpoint and the [MCP](/commands/mcp/) `diff_lists` tool.

## Usage

```bash
./ritual diff <listA> <listB> [options]
```

Both list names resolve like every list command (see [List Resolution](/commands/list-resolution/));
a `deck:` / `collection:` / `wanted:` prefix pins the type. That prefix is the headline move here:
a deck and a collection sharing a name is exactly the situation you diff them in, so
`./ritual diff deck:vampires collection:vampires` disambiguates each side (an unprefixed ambiguous
name is a usage error that suggests the prefixed forms).

## Arguments

| Argument  | Description                                                                | Required |
| --------- | -------------------------------------------------------------------------- | -------- |
| `<listA>` | First list; optional `deck:` / `collection:` / `wanted:` prefix pins type  | Yes      |
| `<listB>` | Second list; optional `deck:` / `collection:` / `wanted:` prefix pins type | Yes      |

## Options

| Option              | Description                                  | Default |
| ------------------- | -------------------------------------------- | ------- |
| `--by <mode>`       | Identity to compare by: `name` or `printing` | `name`  |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`   | `text`  |
| `--quiet`           | Suppress list parse warnings                 | `false` |

## Identity modes

### `--by name` (default)

Entries match on the card name alone — case-, accent-, and punctuation-insensitive (`jaces
archivist` matches `Jace's Archivist`). Quantities are summed per name per side, and each side's
printings are aggregated into a per-printing breakdown, so a `LEA:161` Lightning Bolt on one side
matches a `2XM:157` on the other.

### `--by printing`

Entries match on name **plus** set, collector number, and finish:

- **Nonfoil folding** — a line with no finish marked is treated as `nonfoil`, so an unmarked line
  matches an explicit `[nonfoil]` line (and never a `[foil]` one).
- **The no-printing bucket** — lines with no printing at all (name-only deck or wanted lines) form
  their own bucket per finish. They match other name-only lines but never a pinned printing, since
  the card they refer to is unknown.

## Sections

Quantities are summed across **all** sections of each list — Maybeboard and other extra deck
sections are included. Diff a narrower selection by exporting first if you need section-level
control.

## Output

Text output prints up to three sections, omitting empty ones — set codes are always uppercase:

```text
Only in Burn (2)
  1 Fireblast (VIS:78 [foil] x1)
  1 Price of Progress

Only in Binder (1)
  1 Sol Ring (C21:263 [foil] x1)

Different quantities (1)
  Lightning Bolt: 2 in Burn, 1 in Binder
```

When the two sides share a display name, the section headers fall back to the `type:slug` form.
Identical lists (no one-sided entries, no quantity mismatches) print
`Lists are identical by <mode>.` instead.

### JSON

`--output json` emits the full result, including matches whose quantities are equal:

```json
{
  "a": { "type": "deck", "slug": "burn", "name": "Burn" },
  "b": { "type": "collection", "slug": "binder", "name": "Binder" },
  "by": "name",
  "matches": [
    {
      "name": "Lightning Bolt",
      "a": {
        "quantity": 2,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 2 }
        ]
      },
      "b": {
        "quantity": 1,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 1 }
        ]
      }
    }
  ],
  "onlyInA": [
    {
      "name": "Fireblast",
      "quantity": 1,
      "printings": [{ "set": "vis", "collectorNumber": "78", "finish": "foil", "quantity": 1 }]
    }
  ],
  "onlyInB": [],
  "warnings": []
}
```

Set codes are lowercase in JSON (a data format) and uppercase in text output, matching every other
surface. `printings` entries omit `set`/`collectorNumber` for the no-printing bucket, and `finish`
is always concrete (unmarked lines fold to `"nonfoil"`). Results keep a stable order: identities
appear in first-seen file order, side A before side B. `warnings` carries list parse warnings from
either side.

## Exit Codes

A diff that finds differences is still a successful diff — the exit code stays `0` either way.

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Success (with or without differences)                  |
| `2`  | Usage error (ambiguous list name, invalid `--by` mode) |
| `3`  | Not found (no lists exist, or a name matched nothing)  |
| `1`  | Runtime error                                          |

## See also

- [`export`](/commands/export/) — the flattened per-entry view the diff is computed over.
- [MCP `diff_lists`](/commands/mcp/#read-read-only) — the same comparison as an MCP tool.
- [Admin API: Diff Lists](/admin/api/#diff-lists) — the underlying HTTP endpoint.
