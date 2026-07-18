---
title: 'git-detect-changes'
---

Detect card changes from git history and automatically update changelog files.

When deck, collection, or wanted list files are edited directly (e.g. via a text editor, git merge, or external tool) rather than through the admin UI or CLI commands, no `.changes.md` changelog entries are created. This command inspects git history to retroactively generate those changelog entries.

It is **hash-aware**, so it can be run safely even on files that Ritual itself edited: changes already recorded locally are skipped, and only hand edits are turned into changelog entries. This lets a repository mix both workflows — editing with Ritual (which records changelogs as it goes) and pushing raw git commits (which this command catches) — without ever double-recording a change. See [Hash-aware detection](#hash-aware-detection).

## Usage

```bash
./ritual git-detect-changes <commit> [options]
```

## Arguments

| Argument   | Description                                                              | Required |
| ---------- | ------------------------------------------------------------------------ | -------- |
| `<commit>` | Git commit hash or ref to diff against (e.g. `HEAD~1`, `abc123`, `main`) | Yes      |

## Options

| Option          | Description                                    | Default |
| --------------- | ---------------------------------------------- | ------- |
| `-n, --dry-run` | Preview detected changes without writing files | `false` |

## Examples

Detect changes since the previous commit:

```bash
./ritual git-detect-changes HEAD~1
```

Detect changes since a specific commit:

```bash
./ritual git-detect-changes abc123f
```

Preview changes without modifying any files:

```bash
./ritual git-detect-changes HEAD~5 --dry-run
```

Detect changes since a branch point:

```bash
./ritual git-detect-changes main
```

## Behavior

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

### Card Matching

Cards are matched between old and new versions using:

1. **Card ID** (`&N` suffix) — the primary stable identifier when present on both sides
2. **Composite key** — fallback using card name + set code + collector number + finish + condition

### File Operations

Depending on what happens to each list, the command will perform different actions:

| Git Status   | Action                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Modified** | Diff old → new content, append changes to `.changes.md`             |
| **Added**    | All cards treated as adds, append to `.changes.md`                  |
| **Renamed**  | Rename the `.changes.md` file, then diff old → new for card changes |
| **Deleted**  | Delete the corresponding `.changes.md` file                         |

### Hash-aware detection

Every time Ritual writes a list file (via the admin UI, `deck-sync`, `add-card`, `move`, and so on) it also writes a `.sha256` sidecar holding the hash of exactly what it wrote, and records the corresponding changelog entry. `git-detect-changes` uses that sidecar to avoid re-recording changes Ritual already logged:

- **Content matches the sidecar** → Ritual last wrote this exact state and already updated the changelog. The file is reported as `up to date with Ritual — skipping` and left untouched.
- **Content differs from the sidecar (or no sidecar exists)** → the file was hand-edited since Ritual last touched it. Changelog entries are generated from the diff, and the sidecar is **refreshed** to the new content so subsequent runs treat the file as up to date.

This makes the command idempotent and lets a repository freely mix Ritual edits with raw git edits. Running it twice over the same range is a no-op the second time, because the first run brings every sidecar up to date.

> **Limitation:** the sidecar reflects a file's _final_ state across the diff range, not its per-commit history. If a single range mixes a Ritual edit and a raw edit to the **same** file, the comparison only sees the final content: a range ending in a raw edit re-records the whole diff (including the part Ritual already logged), and a range ending in a Ritual edit is skipped entirely (dropping the raw edit's changelog). To keep changelogs exact, avoid mixing both kinds of edit to one file within a single detection range — in the CI workflow, that range is one push.

### Dry Run

When `--dry-run` (or `-n`) is specified, the command prints what it would do without modifying any files. This is useful for previewing detected changes before committing them.

## CI Integration

You can run `git-detect-changes` automatically in your GitHub Actions workflow. When you run [`init-site`](/commands/init-site/) with the "Publish for me" deploy mode, you'll be offered the option to enable automatic change detection.

When enabled, the generated workflow:

1. Checks out the repository with full history
2. Runs `git-detect-changes` against the previous branch state (`github.event.before`)
3. If changelog files were generated, commits and pushes them with a message like `Generated changes from commit abc1234`
4. Skips the site build for that run — the new commit will trigger a fresh build with the updated changelogs

Because detection is [hash-aware](#hash-aware-detection), pushes that were made with Ritual locally (which already commit their changelogs) produce no new changes here, so the workflow proceeds straight to the build. Only pushes containing hand edits generate a follow-up commit.

> **Note:** The generated `.gitignore` excludes the downloaded `/ritual` binary so that the workflow's `git add` step never tries to commit it. If you maintained your workflow before this entry existed, add `/ritual` to your `.gitignore` — otherwise the auto-commit step can fail trying to push the ~100 MB binary.

You can also enable it later by setting `"detectChanges": true` under the `site` key in `ritual.config.json` and re-running `ritual init-site --upgrade`.
