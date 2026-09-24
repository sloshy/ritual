---
title: 'diff'
---

Compare two lists, in any mix of deck, collection, and wanted list. The report shows what is only in one side, only in the other, and where quantities differ. The same engine backs the admin [`GET /api/diff`](/admin/api/#diff-lists) endpoint and the [MCP](/commands/mcp/) `diff_lists` tool.

## Usage

```bash
ritual diff <listA> <listB> [options]
```

Both names resolve like every list command (see [List Names](/list-resolution/)). A `deck:` / `collection:` / `wanted:` prefix selects the type. The prefix matters more here than elsewhere: a deck and a collection sharing a name is exactly what you diff, so `ritual diff deck:vampires collection:vampires` disambiguates each side. An unprefixed ambiguous name is a usage error; see [what the ambiguity error advises](/list-resolution/#what-the-ambiguity-error-advises).

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

`diff` has no `--quiet`: it prints its payload plus parse warnings and nothing else ([shared convention](/cli-conventions/#scripting)).

## Identity modes

### `--by name` (default)

Entries match on card name alone, ignoring case, accents, and punctuation (`jaces archivist` matches `Jace's Archivist`). Quantities are summed per name per side, and each side's printings are broken down per printing, so a `LEA:161` Lightning Bolt on one side matches a `2XM:157` on the other. The breakdown separates languages: an English and a `[ja]` copy of the same printing are two rows.

### `--by printing`

Entries match on name **plus** set, collector number, finish, and language:

- **Nonfoil folding.** A line with no finish marked counts as `nonfoil`, so it matches an explicit `[nonfoil]` line and never a `[foil]` one.
- **English folding.** A line with no language token counts as `en`, so it matches an explicit `[en]` line and never a `[ja]` one.
- **The no-printing bucket.** Lines with no printing (name-only deck or wanted lines) form their own bucket per finish. They match other name-only lines but never a specific printing.

## Sections

Quantities are summed across **all** sections of each list, maybeboard and other extra deck sections included. To diff a narrower selection, export first.

## Output

Text output prints up to three sections, omitting empty ones. Set codes are uppercase:

```text
Only in Burn (2)
  1 Fireblast (VIS:78 [foil] x1)
  1 Price of Progress

Only in Binder (1)
  1 Sol Ring (C21:263 [foil] x1)

Different quantities (1)
  Lightning Bolt: 2 in Burn, 1 in Binder
```

When the two sides share a display name, the section headers use the `type:slug` form instead. Identical lists print `Lists are identical by <mode>.` instead.

### JSON

`--output json` emits the full result, including matches whose quantities are equal:

```json
{
  "a": { "listType": "deck", "slug": "burn", "name": "Burn" },
  "b": { "listType": "collection", "slug": "binder", "name": "Binder" },
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

- Set codes are lowercase in JSON (a data format) and uppercase in text output.
- `printings` entries omit `set`/`collectorNumber` for the no-printing bucket. `finish` is always concrete (unmarked lines fold to `"nonfoil"`). Each row also carries the bucket's language, so `en` and `[ja]` copies of one printing are separate rows.
- Results keep a stable order: identities appear in first-seen file order, side A before side B.
- `warnings` carries list parse warnings from either side, and names a list's `<name>.categories.json` sidecar that could not be read (the diff still runs). The same warnings print to stderr in every output mode, since a skipped line means the diff compared incomplete lists.

## Exit Codes

A diff that finds differences is still a successful diff and exits `0`.

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
