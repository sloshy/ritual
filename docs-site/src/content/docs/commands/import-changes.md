---
title: 'import-changes'
---

Apply a change bundle exported from the public site's [in-browser editor](/commands/build-site/#editing-on-the-public-site) (or the admin editor's Export panel) to your list files. The full change list is previewed grouped by target list, and nothing is written until you confirm.

The same JSON can also be applied in the [admin site](/commands/admin/#import-changes) (**Import Changes** page) and via the [MCP](/commands/mcp/) `import_changes` tool, all backed by the same engine.

## Usage

```bash
./ritual import-changes <file>
```

## Arguments

| Argument | Description                    | Required |
| -------- | ------------------------------ | -------- |
| `<file>` | Path to the exported JSON file | Yes      |

## Options

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `-y, --yes`         | Apply without asking for confirmation      | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |
| `--quiet`           | Suppress non-essential output              | `false` |

## Format

The file is a **`ritual-change-bundle`** JSON covering one or more lists — the Export panel's **This list** scope produces a one-list bundle, and its **All lists** scope (available when edit mode accumulated changes across several lists) covers every edited list in the same envelope.

## Preview and Confirmation

Before anything is applied, the command prints every pending change grouped by its target list:

```text
🎴 Winota Stax (deck 'Winota Stax') — 2 changes
  • Add Counterspell
  • Remove Lightning Bolt (LEA:161) &2

📦 Main Binder (collection 'main-binder') — 1 change
  • Add Sol Ring (C19:221)

? Apply 3 changes to 2 lists? › (y/N)
```

Pass `--yes` to skip the prompt (for scripts and agents). When stdin is not a terminal, prompts are disabled globally (`--no-input` / `RITUAL_NO_INPUT`), or `--output json`/`ndjson` owns stdout, `--yes` is required — instead of prompting, the command exits with code `2`.

`--quiet` suppresses the preview and the per-list applied/skipped lines; list failures are still reported on stderr.

## How Changes Are Applied

Lists are applied in file order, each loaded fresh immediately before saving (so a cross-list move applied by an earlier list never conflicts with a later one):

- Changes are **re-targeted** to each list's current `&N` card IDs — added cards draw fresh IDs, and other changes match by ID when it still exists, otherwise by card name.
- Changes whose target card can no longer be found are **skipped and reported** as conflicts; the rest still apply.
- `move-from` changes also write the destination list (the card is added there, with a `move-to` changelog entry), exactly like an admin editor save.
- Every list that received changes gets an entry in its `.changes.md` changelog, and files are auto-committed when `git.autoCommit` is enabled — the same save path the admin editors use.

A list that fails entirely (for example, one that no longer exists) is reported without stopping the remaining lists.

## Scripted Output

With `--output json` (or `ndjson`), the preview and glyph lines are replaced by a single payload on stdout after the apply — byte-for-byte the response body of the admin `POST /api/import-changes` route and the MCP `import_changes` tool, so a script can consume any of the three surfaces identically. `--yes` is required (there is no prompt outside text mode); without it a structured usage error is written to stderr and the command exits with code `2`.

```json
{
  "success": true,
  "lists": [
    {
      "kind": "deck",
      "slug": "test-deck",
      "name": "Test Deck",
      "applied": 2,
      "conflicts": [
        {
          "change": {
            "id": "r2",
            "timestamp": 3,
            "action": "remove",
            "cardName": "Not In Deck",
            "cardId": 99
          },
          "reason": "target-not-found"
        }
      ]
    }
  ],
  "message": "Applied 2 changes across 1 list"
}
```

A list that failed to load or save carries an `error` string instead of applying anything, `success` is `false`, and the exit code is `1` — the same as text mode.

## Exit Codes

| Code | Meaning                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | All lists applied (skipped conflicts do not fail the run)                                                                                                                    |
| `1`  | At least one list failed to apply, or the file could not be read                                                                                                             |
| `2`  | Invalid change bundle, confirmation declined/cancelled, or missing `--yes` when prompts are unavailable (stdin is not a terminal, `--no-input`, or `--output json`/`ndjson`) |
| `3`  | Bundle file not found, or the bundle contains no changes to apply                                                                                                            |
