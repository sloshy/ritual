---
title: 'import-changes'
---

Apply a change bundle exported from the public site's [in-browser editor](/commands/build-site/#editing-on-the-public-site) (or the admin editor's Export panel) to your list files. The full change list is previewed grouped by target list, with the bundle's cross-list moves listed after them, and nothing is written until you confirm.

The same JSON can also be applied in the [admin site](/commands/admin/#import-changes) (**Import Changes** page) and via the [MCP](/commands/mcp/) `import_change_bundle` tool, all backed by the same engine.

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
| `--quiet`           | Suppress the preview and applied counts    | `false` |

## Format

The file is a **`ritual-change-bundle`** JSON (format version **2**) covering one or more lists — the Export panel's **This list** scope produces a one-list bundle, and its **All lists** scope (available when edit mode accumulated changes across several lists) covers every edited list in the same envelope.

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

- **`lists[]`** — one entry per edited list: its `kind` (`deck`, `collection`, or `wanted`), `slug`, display `name`, an optional `baseContentHash`, and the ordered `changes` to replay. A list's `changes` **never** contain `move-from` or `move-to` events — a bundle that does is rejected ("moves belong in the top-level moves array").
- **`moves[]`** — every cross-list move, **one entry per physical copy**, in timestamp order. Each names its source and destination list as `{ kind, slug?, name }` (`slug` is a best-effort hint; `name` is what the import resolves by when the slug is absent or stale), the copy's printing fields (`set`, `collectorNumber`, `finish`, `condition`, `language`), its optional `tags` (the card's [tags](/commands/edit/#card-tags), canonical; they land on the destination line), an optional `cardId` — the **source** list's `&N` line id the copy was taken from, a removal hint the importer falls back from to a printing/name match — an optional `toCardId` — the **destination** line id the exporting editor gave the arriving copy, re-targeted on import exactly like an `add`'s id so a later edit of that copy in the same export still finds it — for deck destinations, an optional `section` — and, for a copy that gives a **name-only** line of the destination its printing (the web editors' Swap Printings wizard), an optional `pinsCardId` (the destination line pinned: equal to `toCardId` when the line is converted in place, otherwise the line one copy is taken off before it lands on `toCardId`; re-targeted on import like any edit's id) and an optional `replacement` (`{ set, collectorNumber, finish?, language? }` — a printing added back to the **source** list in place of the copy taken). A move is recorded once, here, rather than as a `move-from` in one list and a `move-to` in the other; the changelog files still get both halves when it is applied.

## Preview and Confirmation

Before anything is applied, the command prints every pending change grouped by its target list:

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

Each move is listed once, after the per-list changes, naming both ends; the confirmation count includes the moves.

Pass `--yes` to skip the prompt (for scripts and agents). When stdin is not a terminal, prompts are disabled globally (`--no-input` / `RITUAL_NO_INPUT`), or `--output json`/`ndjson` owns stdout, `--yes` is required — instead of prompting, the command exits with code `2`.

`--quiet` suppresses the preview and the per-list applied counts. It never hides **skipped conflicts**: a quiet run that skipped changes prints a one-line `⚠ <list>: N changes skipped (card not found: 2, not applicable to this list: 1)` summary to stderr, because nothing else reports them and they do not affect the exit code. List failures are always reported on stderr too. Even without `--quiet`, one `⚠ Skipped (<reason>): …` line per skipped change goes to stderr — naming which of the three reasons applied — keeping stdout the applied-counts report.

A change can be skipped for three reasons, and each names a different fix: `card not found` (no entry of that name or id), `not applicable to this list` (a commander action aimed at a flat list), and `card has no printing for that finish` — the card is present, but the change would set a foil or etched finish on a line that names no printing, which Ritual refuses (see [`set-card`](/commands/set-card/#a-finish-belongs-to-a-printing)).

## How Changes Are Applied

Every list's changes and every move are merged into **one timestamp-ordered stream** — the order you made the edits in — and applied in batches: consecutive events aimed at the same list form a batch, and each batch loads its list fresh immediately before saving it (necessary because an earlier batch's cross-list move may have rewritten the file since). So add-then-move-out, or swap-a-printing-then-set-the-new-copy-foil, replay exactly as you did them rather than one list wholesale before the next.

- Changes are **re-targeted** to each list's current `&N` card IDs — added cards (and arriving moves) draw fresh IDs, and other changes match by ID when it still exists, otherwise by card name (a copy the same import just added first, then the list as loaded).
- Changes whose target card can no longer be found — or whose action cannot apply to that list, such as a commander change aimed at a collection, or which would set a foil/etched finish on a card that pins no printing — are **skipped and reported** as conflicts; the rest still apply. A conflict's `reason` is `"target-not-found"`, `"not-applicable"`, or `"needs-printing"` (the card is present; it just needs a printing pinned first).
- A **move** is applied on its **destination** list as a `move-to`: the destination's save adds the copy there and, in the same step, takes it out of the source list — by the source line id the move names when that line still holds the card, otherwise by the exact printing, otherwise (for a source line that pinned no printing, such as a wanted entry) by name — and writes **both** changelogs (`Moved … from …` on the destination, `Moved … to …` on the source). A move carrying a `replacement` also _adds_ that printing to the source list in the same step — into the section the departed line left, logged there as an `Added` line; like the removal, it happens inside the destination's save, so a source list reported with `0` applied may still have been written. Every removal is validated before anything is written; a source with no copy left to take fails that batch with nothing written. A destination named only by a move (its source list being the one you exported) is resolved by its slug, then by its name, exactly like a list entry, and reported as a list of its own. A list named only as a move **source** is reported too, with `0` applied — its copy left through the destination's save — so the report names every list the import touched.
- Every list that received changes gets an entry in its `.changes.md` changelog — the same save path the admin editors use.

A batch that fails (for example, a list that no longer exists, or a move whose source no longer holds the copy) is reported on that list's result: the failing batch applied nothing, that list's remaining batches are skipped (they would replay onto a file the earlier batch left unchanged), and the other lists' batches continue. Batches that already applied stay applied and are counted.

The CLI command never creates git commits — applied changes are left in the working tree for you to review. The admin **Import Changes** page and the MCP `import_change_bundle` tool apply the same engine to the same bundle, and those surfaces auto-commit each saved list when `admin.gitEnabled` and `admin.gitAutoCommit` are set (see [Git integration](/configuration/#git-integration)).

## Scripted Output

With `--output json` (or `ndjson`), the preview and glyph lines are replaced by a single payload on stdout after the apply — byte-for-byte the response body of the admin `POST /api/import-changes` route (the MCP `import_change_bundle` tool returns the same fields without the constant `success` key, which the MCP layer strips from every result), so a script can consume any of the three surfaces identically. `--yes` is required (there is no prompt outside text mode); without it a structured usage error is written to stderr and the command exits with code `2`.

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

`lists` carries one entry per list the bundle touched — the bundle's own entries plus any list named only as a move destination (whose `slug` is the file basename it resolved to). Moves count toward `applied` on their destination list. A list that failed to resolve, load, or save carries an `error` string (its later batches skipped; anything already applied is still counted) and is counted in `failedCount`. `success` stays `true` — it is the envelope flag, and the run _was_ processed; `failedCount` (and each list's own `error`) is what reports the failures. The exit code is still `1`, the same as text mode.

## Exit Codes

| Code | Meaning                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | All lists applied (skipped conflicts do not fail the run)                                                                                                                    |
| `1`  | At least one list failed to apply, or the file could not be read                                                                                                             |
| `2`  | Invalid change bundle, confirmation declined/cancelled, or missing `--yes` when prompts are unavailable (stdin is not a terminal, `--no-input`, or `--output json`/`ndjson`) |
| `3`  | Bundle file not found, or the bundle contains no changes to apply                                                                                                            |
