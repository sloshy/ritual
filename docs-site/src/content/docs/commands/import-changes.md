---
title: 'import-changes'
---

Apply a change bundle to your list files. A bundle is the JSON exported by the public site's [in-browser editor](/public-site/editing/) or the admin editor's Export panel. The command previews every change grouped by target list, lists cross-list moves after them, and writes nothing until you confirm.

The same JSON can be applied on the [admin site](/admin/import/#import-changes) (**Import Changes** page) and via the [MCP](/commands/mcp/) `import_change_bundle` tool.

## Usage

```bash
ritual import-changes <file>
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
| `--quiet`           | Suppress the preview and applied counts    | `false` |

## Format

The file is a **`ritual-change-bundle`** JSON (format version **2**) covering one or more lists. The Export panel's **This list** scope produces a one-list bundle. Its **All lists** scope (offered when edit mode has changes across several lists) covers every edited list in one envelope.

```json
{
  "format": "ritual-change-bundle",
  "version": 2,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "lists": [
    {
      "kind": "deck",
      "slug": "winota-stax",
      "name": "Winota Stax",
      "changes": [
        { "id": "a1", "timestamp": 1, "action": "add", "cardName": "Counterspell" },
        {
          "id": "r1",
          "timestamp": 2,
          "action": "remove",
          "cardName": "Lightning Bolt",
          "cardId": 2
        }
      ]
    }
  ],
  "moves": [
    {
      "id": "m1",
      "timestamp": 3,
      "cardName": "Sol Ring",
      "from": { "kind": "collection", "slug": "main-binder", "name": "Main Binder" },
      "to": { "kind": "deck", "slug": "winota-stax", "name": "Winota Stax" },
      "set": "c19",
      "collectorNumber": "221",
      "cardId": 7,
      "toCardId": 12,
      "section": "Main"
    }
  ]
}
```

**`lists[]`** has one entry per edited list: its `kind` (`deck`, `collection`, or `wanted`), `slug`, display `name`, an optional `baseContentHash`, and the ordered `changes` to replay. A list's `changes` **never** contain `move-from` or `move-to` events; a bundle that does is rejected ("moves belong in the top-level moves array").

**`moves[]`** holds every cross-list move, **one entry per physical copy**, in timestamp order. A move is recorded once here, not as a `move-from` and `move-to` in two lists; the changelog files still get both halves when it is applied. Each move carries:

- `from` and `to`: the source and destination list as `{ kind, slug?, name }`. `slug` is a hint; `name` is what the import resolves by when the slug is absent or stale.
- The copy's printing fields: `set`, `collectorNumber`, `finish`, `condition`, `language`.
- Optional `tags`: the card's [tags](/list-format/#card-tags) in canonical form, written to the destination line.
- Optional `cardId`: the **source** list's `&N` line id the copy came from. It is a removal hint; the importer falls back to a printing or name match.
- Optional `toCardId`: the **destination** line id the exporting editor gave the arriving copy. It is re-targeted on import like an `add`'s id, so a later edit of that copy in the same export still finds it.
- Optional `section`, for deck destinations.
- Optional `pinsCardId` and `replacement`, for a copy that gives a **name-only** destination line its printing (the web editors' Swap Printings wizard). `pinsCardId` is the destination line pinned: equal to `toCardId` when the line is converted in place, otherwise the line one copy is taken off before it lands on `toCardId`. It is re-targeted on import like any edit's id. `replacement` is `{ set, collectorNumber, finish?, language? }`, a printing added back to the **source** list in place of the copy taken.

## Preview and Confirmation

Before anything is applied, the command prints every pending change grouped by target list:

```text
🎴 Winota Stax (deck 'winota-stax') — 2 changes
  • Add Counterspell
  • Remove Lightning Bolt (LEA:161) &2

📦 Main Binder (collection 'main-binder') — 1 change
  • Add Sol Ring (C19:221)

🔀 Moves between lists — 1 move
  • Move Sol Ring (C19:221) &7 to Deck 'Winota Stax' (from Collection 'Main Binder')

? Apply 4 changes to 2 lists? › (y/N)
```

Each move is listed once, after the per-list changes, naming both ends. The confirmation count includes the moves.

Pass `--yes` to skip the prompt. `--yes` is **required** when stdin is not a terminal, when prompts are disabled (`--no-input` / `RITUAL_NO_INPUT`), or under `--output json`/`ndjson`. Without it the command exits `2` instead of prompting.

`--quiet` suppresses the preview and the per-list applied counts. It never hides **skipped conflicts** or list failures, which always go to stderr. A quiet run that skipped changes prints a one-line summary such as `⚠ <list>: N changes skipped (card not found: 2, not applicable to this list: 1)`, since skips do not affect the exit code and nothing else would report them. Without `--quiet`, one `⚠ Skipped (<reason>): …` line per skipped change goes to stderr, keeping stdout for the applied-counts report.

A change is skipped for one of three reasons:

| Reason                                 | Meaning                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `card not found`                       | No entry of that name or id                                                                                                                          |
| `not applicable to this list`          | A commander change on a collection or wanted list, or a label change on a wanted list                                                                |
| `card has no printing for that finish` | The change would set a foil or etched finish on a line that names no printing (see [`set-card`](/commands/set-card/#a-finish-belongs-to-a-printing)) |

## How Changes Are Applied

Every list's changes and every move are merged into **one timestamp-ordered stream**, the order you made the edits in, and applied in batches. Consecutive events aimed at the same list form a batch. Each batch loads its list fresh right before saving, because an earlier batch's cross-list move may have rewritten the file. So add-then-move-out, or swap-a-printing-then-set-it-foil, replay exactly as you did them.

- Changes are **re-targeted** to each list's current `&N` card IDs. Added cards (and arriving moves) draw fresh IDs. Other changes match by ID when it still exists, otherwise by card name (a copy the same import just added first, then the list as loaded).
- Changes that cannot apply are **skipped and reported** as conflicts; the rest still apply. A conflict's `reason` is `"target-not-found"`, `"not-applicable"`, or `"needs-printing"` (the card is present but needs a printing pinned first).
- A **move** is applied on its **destination** list as a `move-to`. The destination's save adds the copy there and, in the same step, removes it from the source list: by the source line id when that line still holds the card, otherwise by the exact printing, otherwise (for a source line with no printing, such as a wanted entry) by name. It writes **both** changelogs (`Moved … from …` on the destination, `Moved … to …` on the source). A move carrying a `replacement` also adds that printing to the source list in the same step, into the section the departed line left, logged there as an `Added` line. Because this happens inside the destination's save, a source list reported with `0` applied may still have been written. Every removal is validated before anything is written; a source with no copy left to take fails that batch with nothing written.
- A destination named only by a move (its source being the list you exported) is resolved by slug, then by name, like a list entry, and reported as a list of its own. A list named only as a move **source** is reported too, with `0` applied. The report therefore names every list the import touched.
- Every list that received changes gets an entry in its `.changes.md` changelog, the same way the admin editors save.

A batch that fails (a list that no longer exists, or a move whose source no longer holds the copy) is reported on that list's result. The failing batch applied nothing, that list's remaining batches are skipped, and the other lists' batches continue. Batches that already applied stay applied and are counted.

The CLI never creates git commits; applied changes stay in the working tree for you to review. The admin **Import Changes** page and the MCP tool auto-commit each saved list when `admin.gitEnabled` and `admin.gitAutoCommit` are set (see [Git integration](/configuration/#git-integration)).

## Scripted Output

With `--output json` (or `ndjson`), the preview and glyph lines are replaced by a single payload on stdout after the apply. It is byte-for-byte the response body of the admin `POST /api/import-changes` route, so a script can consume the CLI, admin API, and MCP tool identically (the MCP tool returns the same fields minus the constant `success` key). `--yes` is required; without it a structured usage error goes to stderr and the command exits `2`.

```json
{
  "success": true,
  "failedCount": 0,
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

- `lists` has one entry per list the bundle touched: the bundle's own entries plus any list named only as a move destination (whose `slug` is the file basename it resolved to). Moves count toward `applied` on their destination list.
- A list that failed to resolve, load, or save carries an `error` string and is counted in `failedCount`. Its later batches are skipped; anything already applied is still counted.
- `success` stays `true` even then. It is the envelope flag and means the run was processed; `failedCount` and each list's `error` report the failures. The exit code is `1`, as in text mode.

## Exit Codes

| Code | Meaning                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| `0`  | All lists applied (skipped conflicts do not fail the run)                                                  |
| `1`  | At least one list failed to apply, or the file could not be read                                           |
| `2`  | Invalid change bundle, confirmation declined or cancelled, or missing `--yes` when prompts are unavailable |
| `3`  | Bundle file not found, or the bundle contains no changes to apply                                          |

Prompts are unavailable when stdin is not a terminal, under `--no-input`, or with `--output json`/`ndjson`.
