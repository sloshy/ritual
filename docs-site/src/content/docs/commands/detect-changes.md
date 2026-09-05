---
title: 'detect-changes'
---

Record changelog entries for hand-edited lists, and manage the `.sha256` sidecars that decide what still needs recording.

This one command owns the whole sidecar/changelog contract. It has three modes:

| Mode                         | What it does                                                                                  | Needs git |
| ---------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| `detect-changes <commit>`    | Diff git history, append `.changes.md` entries for hand edits, refresh sidecars               | Yes       |
| `detect-changes --hash-only` | Stamp every list file's `.sha256` sidecar from its current content — **no changelog entries** | No        |
| `detect-changes --verify`    | Report each list file's sidecar status and write nothing                                      | No        |

## What a `.sha256` sidecar means

Every time Ritual writes a list file (the admin UI, `edit`, `add-card`, `move`, `deck-sync`, …) it writes a `<name>.md.sha256` sidecar holding the hash of exactly what it wrote, **and** records the corresponding changelog entry. So the sidecar means one specific thing:

> **Ritual wrote this exact content, and its changelog entries are already recorded.**

That is why detection can skip a file whose content matches its sidecar: re-diffing it would double-record changes Ritual already logged. And it is why stamping a sidecar over content Ritual did _not_ write throws those edits' changelog entries away. See [`--hash-only` forfeits changelog entries](#--hash-only-forfeits-changelog-entries).

## Usage

```bash
ritual detect-changes <commit> [options]
ritual detect-changes --hash-only [options]
ritual detect-changes --verify [options]
```

## Arguments

| Argument   | Description                                                              | Required                 |
| ---------- | ------------------------------------------------------------------------ | ------------------------ |
| `<commit>` | Git commit hash or ref to diff against (e.g. `HEAD~1`, `abc123`, `main`) | In the default mode only |

Passing `<commit>` together with `--hash-only` or `--verify` is a usage error, since neither mode reads git.

## Options

| Option              | Description                                                                  | Default |
| ------------------- | ---------------------------------------------------------------------------- | ------- |
| `--hash-only`       | Stamp `.sha256` sidecars from current content (no git, no changelog entries) | `false` |
| `--verify`          | Report each list file's sidecar status and write nothing                     | `false` |
| `-n, --dry-run`     | Preview what would change without writing files (not valid with `--verify`)  | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                   | `text`  |
| `--quiet`           | Suppress progress and status messages — never the data-loss warning          | `false` |

`--hash-only` and `--verify` are mutually exclusive (usage error, exit `2`).

## Default mode: detect from git history

When deck, collection, or wanted list files are edited directly (a text editor, a git merge, an external tool) rather than through the admin UI or CLI commands, no `.changes.md` changelog entries are created. The default mode inspects git history to generate them after the fact.

```bash
ritual detect-changes HEAD~1        # since the previous commit
ritual detect-changes abc123f       # since a specific commit
ritual detect-changes main          # since a branch point
ritual detect-changes HEAD~5 -n     # preview only
```

The base directory must be a git repository and `<commit>` must resolve. Otherwise the run fails with a message naming the problem (and pointing at `--hash-only` for the no-git case) rather than passing raw git output through.

### Change Detection

The command runs `git diff` between the specified commit and `HEAD` to find all modified, added, renamed, and deleted files in the `decks/`, `collections/`, and `wanted/` directories (excluding `.changes.md` and `.primer.md` files).

For each changed file, the old version (at the specified commit) and current version are parsed and compared to produce change events:

- **Added cards** → `Added` changelog entries
- **Removed cards** → `Removed` changelog entries
- **Finish changes** → `Set finish` entries
- **Quantity increases** (decks, wanted lists) → additional `Added` entries
- **Quantity decreases** (decks, wanted lists) → additional `Removed` entries
- **Commander promotions** (decks only) → `Set as commander` entries
- **Commander demotions** (decks only) → `Unset as commander` entries

Notes (`{note}`) and label overrides (`[labels]`) are invisible to the diff. Hand-editing only a card's note or labels produces no changelog entries, and the file still counts as `no card changes detected`. A list's `.art.json` [custom art](/custom-art/) sidecar is likewise untracked. Like a deck's `.primer.md`, it is metadata rather than card content, and the list file's `.sha256` covers the markdown file alone.

### The categories sidecar

A list's [`<name>.categories.json`](/list-format/#categories-namecategoriesjson) is the one sidecar that **is** tracked. It carries a `.sha256` of its own and is walked alongside its list file, so a hand edit to it is recorded as `Set categories of "Sol Ring" to Ramp, Artifacts`, `Set category order to …` and `Renamed category "Draw" to "Card Draw"` entries in that **list's** `.changes.md` (the sidecar has no changelog of its own), and its own `.sha256` is stamped so a second run records nothing.

Both edges are real gestures:

- **Adding** a sidecar records every assignment in it.
- **Deleting** one by hand, while the list survives, means _clear every category_. The clearing entries are recorded and the stale `.sha256` is removed. Deleting the list **and** its sidecar together records only the list's own deletion.

A malformed sidecar produces a parse warning and is skipped entirely, never diffed partially. `--hash-only` and `--verify` cover the categories sidecar too, listing it beside the list file it belongs to.

### Card Matching

Cards are matched between old and new versions using:

1. **Card ID** (`&N` suffix), the primary stable identifier when present on both sides
2. **Composite key**, a fallback using card name + set code + collector number + finish + condition

### File Operations

Depending on what happens to each list, the command performs different actions:

| Git Status   | Action                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Modified** | Diff old → new content, append changes to `.changes.md`             |
| **Added**    | All cards treated as adds, append to `.changes.md`                  |
| **Renamed**  | Rename the `.changes.md` file, then diff old → new for card changes |
| **Deleted**  | Delete the corresponding `.changes.md` file                         |

A file that changed within the range but is **missing from the working tree** (for example committed, then deleted locally without committing) is skipped with a warning naming the file. The remaining files are still processed and the run finishes with exit `1`.

### Hash-aware detection

Detection uses the sidecar to avoid re-recording changes Ritual already logged:

- **Content matches the sidecar** → Ritual last wrote this exact state and already updated the changelog. The file is reported as `up to date with Ritual — skipping` and left untouched.
- **Content differs from the sidecar (or no sidecar exists)** → the file was hand-edited since Ritual last touched it. Changelog entries are generated from the diff, and the sidecar is **refreshed** to the new content so later runs treat the file as up to date.

The sidecar is refreshed only for a file whose diff actually produced changelog entries. A file whose card list is unchanged (a prose-only edit, a reordering, a front-matter tweak) is reported as `no card changes detected` and keeps its stale or absent sidecar. There was nothing to record, so nothing is declared recorded. Such a file therefore keeps showing up as `diverged`/`no sidecar` under [`--verify`](#--verify-report-sidecar-drift) no matter how often the default mode runs; `--hash-only` is what clears it.

This makes the command idempotent and lets a repository freely mix Ritual edits with raw git edits. Running it twice over the same range is a no-op the second time, because the first run records, and stamps, every file that had card changes.

The [card-ID backfill](/cli-conventions/#the-card-id-backfill) cooperates with this scheme from the other side. When a list-writing command persists missing `&N` IDs into a hand-edited file, it refreshes the `.sha256` sidecar only if the sidecar already matched the file. A hand edit therefore keeps its stale or absent sidecar, and detection still records it. `detect-changes` itself never runs the backfill, in any mode, since it must see the working tree exactly as you committed it.

> **Limitation:** the sidecar reflects a file's _final_ state across the diff range, not its per-commit history. If a single range mixes a Ritual edit and a raw edit to the **same** file, the comparison only sees the final content: a range ending in a raw edit re-records the whole diff (including the part Ritual already logged), and a range ending in a Ritual edit is skipped entirely (dropping the raw edit's changelog). To keep changelogs exact, avoid mixing both kinds of edit to one file within a single detection range. In the CI workflow, that range is one push.

### Dry Run

With `-n`/`--dry-run` the command prints what it would do without modifying any files, so you can preview detected changes before committing them.

## `--hash-only`: stamp sidecars without git

```bash
ritual detect-changes --hash-only
```

Rewrites every list file's `.sha256` sidecar from the file's current on-disk content. It needs no git repository, writes no changelog entries, and never modifies list file content. `detect-changes` is exempt from the [card-ID backfill](/cli-conventions/#the-card-id-backfill) in every mode, so a `--dry-run` preview always shows exactly the hashes a real run would write.

Deck, collection, and wanted **list files** are stamped, together with their [`.categories.json`](/list-format/#categories-namecategoriesjson) sidecars. Never `.changes.md` changelogs, `.primer.md` primers, `.art.json` custom art, or anything else.

In text mode each stamped file is printed with the hash written for it, followed by a count:

```
decks/Burn.md: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
collections/Binder.md: 60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752

Stamped 2 files.
```

Under `--dry-run` each line is prefixed `[dry-run] ` and the count reads `Would stamp 2 files.`. With no list files at all it prints `No list files found.`. `--quiet` suppresses all of that (the sidecars are still written, so scripts can rely on the exit code alone), but never the data-loss warning below.

### `--hash-only` forfeits changelog entries

Stamping a file declares "Ritual wrote this, and it is already recorded". For a file whose content has drifted from its sidecar, or that never had one, that declaration is false: `detect-changes` will skip the file from then on, and those edits will never receive changelog entries.

The command therefore names every such file:

```
⚠️  stamped 3 files with unrecorded edits — these edits will not receive changelog entries:
⚠️    decks/Burn.md
⚠️    collections/Binder.md
⚠️    wanted/To Buy.md
```

This warning goes to **stderr in every output mode and prints even under `--quiet`**. It reports data loss, which `--quiet` never suppresses. Run `--verify` first if you want to see the list before deciding, or run the default mode against a commit to record those edits instead of discarding them.

Use `--hash-only` when you deliberately do **not** want the current state recorded as changelog entries, for example after restoring from a backup, or after a bulk mechanical rewrite whose per-card history would be noise.

## `--verify`: report sidecar drift

```bash
ritual detect-changes --verify
```

Answers "which lists have been hand-edited since Ritual last wrote them?" and writes nothing at all. Each list file is reported as:

- `clean`: content matches the sidecar (Ritual wrote it; already recorded)
- `diverged`: a sidecar exists but does not match (an unrecorded edit)
- `no sidecar`: Ritual has never stamped this file (nothing recorded)

```
decks/Burn.md: diverged
decks/Winota Stax.md: clean
wanted/To Buy.md: no sidecar

3 files: 1 clean, 1 diverged, 1 without a sidecar.
Run "ritual detect-changes <commit>" to record these edits in changelogs, or "ritual detect-changes --hash-only" to stamp them as already recorded.
```

With no list files at all it prints `No list files found.` instead. `--quiet` suppresses the report entirely; the exit code still tells you whether anything drifted.

The default mode only clears drift for files whose edits produced changelog entries (see [Hash-aware detection](#hash-aware-detection)). A file edited without changing its cards stays `diverged` until it is stamped with `--hash-only`.

`--dry-run` is a usage error here. `--verify` never writes, so there is nothing to preview.

## Scripted Output

With `--output json` (or `ndjson`), the progress lines are suppressed and stdout carries a single payload. Warnings and errors stay on stderr. Each mode has its own shape, tagged by `mode`.

### Default mode

The changelogs are still updated (or previewed under `--dry-run`) exactly as in text mode. Only the reporting changes. File paths are repo-relative, as git emits them. Warnings are printed on stderr in every mode _and_ carried in the payload's `warnings` array.

```json
{
  "mode": "detect",
  "commit": "HEAD~1",
  "dryRun": false,
  "changelogsUpdated": 1,
  "renames": {
    "decks/old-name.md": "decks/New Name.md"
  },
  "results": [
    {
      "file": "decks/New Name.md",
      "kind": "deck",
      "status": "R",
      "changes": [
        {
          "id": "1752624000000-a1b2c3",
          "timestamp": 1752624000000,
          "cardName": "Lightning Bolt",
          "cardId": 2,
          "action": "remove",
          "set": "2x2",
          "collectorNumber": "117"
        }
      ],
      "ritualClean": false
    }
  ],
  "warnings": [
    {
      "kind": "parse",
      "file": "decks/New Name.md",
      "revision": "working-tree",
      "message": "decks/New Name.md: Skipped malformed line: Sideboard plan: bring in Pyroblast"
    }
  ]
}
```

- `commit`: the ref that was diffed against, as given on the command line.
- `changelogsUpdated`: the number of list files whose changelog was (or, under `--dry-run`, would be) updated.
- `renames`: old path → new path for renamed list files.
- `results`: one entry per changed list file: its `kind` (`deck`, `collection`, or `wanted`), git `status` (`A`, `M`, `D`, or `R`), whether it was skipped as `ritualClean` (see [Hash-aware detection](#hash-aware-detection)), and the detected change events.
- `warnings`: everything the run noticed but did not stop for. Each carries a `kind`:
  - `missing-file`: the file changed in the range but is gone from the working tree, so it was skipped entirely. The run is **partial**, so this (and only this) makes the exit code `1`.
  - `parse`: a line the parser could not read, with `revision` saying whether it was seen in the `working-tree` or the `committed` copy. The rest of the file is still diffed, so the exit code stays `0`. The note exists because that line gets no changelog entry.

### `--hash-only`

`priorState` is the sidecar's state **before** the run overwrote it, so it identifies the files whose edits were forfeited. Paths are base-dir-relative.

```json
{
  "mode": "hash-only",
  "dryRun": false,
  "stamped": [
    {
      "file": "decks/Burn.md",
      "priorState": "diverged",
      "hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    },
    {
      "file": "collections/Binder.md",
      "priorState": "clean",
      "hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
    }
  ],
  "unrecordedEdits": 1
}
```

### `--verify`

Here `state` is the file's live sidecar status. `--verify` writes nothing, so the condition still holds after the run.

```json
{
  "mode": "verify",
  "files": [
    {
      "file": "decks/Burn.md",
      "state": "diverged",
      "hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  ],
  "clean": 0,
  "diverged": 1,
  "missing": 0
}
```

## Exit Codes

| Code | Meaning                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `0`  | Detection ran (or previewed) successfully / sidecars stamped / `--verify` found every list clean                       |
| `1`  | `--verify` found drift; or a file was skipped entirely; or the run failed (not a git repo, unknown ref, write failure) |
| `2`  | Usage error (missing `<commit>`, `--hash-only` with `--verify`, `--verify` with `--dry-run`, invalid `--output`)       |

`--verify`'s exit `1` on drift mirrors [`cleanup --check`](/commands/cleanup/): a nonzero exit means "the workspace needs attention", so a CI job or pre-commit hook can gate on it.

## CI Integration

You can run `detect-changes` automatically in your GitHub Actions workflow. When you run [`init-site`](/commands/init-site/) with the "Publish for me" deploy mode, you'll be offered the option to enable automatic change detection.

When enabled, the generated workflow:

1. Checks out the repository with full history
2. Runs `detect-changes` against the previous branch state (`github.event.before`), falling back to `HEAD~1` when that is empty or the all-zeros SHA (the first push to a branch)
3. If changelog files were generated, commits and pushes them with a message like `Generated changes from commit abc1234`
4. Skips the site build for that run, since the new commit will trigger a fresh build with the updated changelogs
5. Fails the step afterwards if `detect-changes` exited nonzero. The commit and push happen first, so a partial run never strands the changelogs it did write

Because detection is [hash-aware](#hash-aware-detection), pushes that were made with Ritual locally (which already commit their changelogs) produce no new changes here, so the workflow proceeds straight to the build. Only pushes containing hand edits generate a follow-up commit.

> **Note:** The generated `.gitignore` excludes the downloaded `/ritual` binary so that the workflow's `git add` step never tries to commit it. If you maintained your workflow before this entry existed, add `/ritual` to your `.gitignore`. Otherwise the auto-commit step can fail trying to push the ~100 MB binary.

You can also enable it later by setting `"detectChanges": true` under the `site` key in `ritual.config.json` and re-running `ritual init-site --upgrade`.

## Examples

Emit the detection report as JSON for scripting:

```bash
ritual detect-changes HEAD~1 --output json
```

Check for drift without writing anything:

```bash
ritual detect-changes --verify
```

Use a custom base directory:

```bash
ritual --base-dir /path/to/site detect-changes HEAD~1
```
