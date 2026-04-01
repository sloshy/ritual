---
sidebar_position: 23
---

# git-detect-changes

Detect card changes from git history and automatically update changelog files.

When deck, collection, or wanted list files are edited directly (e.g. via a text editor, git merge, or external tool) rather than through the admin UI or CLI commands, no `.changes.md` changelog entries are created. This command inspects git history to retroactively generate those changelog entries.

## Usage

```bash
./ritual git-detect-changes <commit> [options]
```

## Arguments

| Argument   | Description                                                              | Required |
| ---------- | ------------------------------------------------------------------------ | -------- |
| `<commit>` | Git commit hash or ref to diff against (e.g. `HEAD~1`, `abc123`, `main`) | Yes      |

## Options

| Option      | Description                                    | Default |
| ----------- | ---------------------------------------------- | ------- |
| `--dry-run` | Preview detected changes without writing files | `false` |

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
- **Quantity increases** (decks) → additional `Added` entries
- **Quantity decreases** (decks) → additional `Removed` entries
- **Commander promotions** (decks) → `Set as commander` entries
- **Commander demotions** (decks) → `Unset as commander` entries
- **Finish changes** (decks) → `Set finish` entries

### Card Matching

Cards are matched between old and new versions using:

1. **Card ID** (`&N` suffix) — the primary stable identifier when present on both sides
2. **Composite key** — fallback using card name + set code + collector number + finish + condition

### File Operations

| Git Status   | Action                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Modified** | Diff old → new content, append changes to `.changes.md`             |
| **Added**    | All cards treated as adds, append to `.changes.md`                  |
| **Renamed**  | Rename the `.changes.md` file, then diff old → new for card changes |
| **Deleted**  | Delete the corresponding `.changes.md` file                         |

### Dry Run

When `--dry-run` is specified, the command prints what it would do without modifying any files. This is useful for previewing detected changes before committing them.

## CI Integration

You can run `git-detect-changes` automatically in your GitHub Actions workflow. When you run [`init-site`](./init-site) with the "Publish for me" deploy mode, you'll be offered the option to enable automatic change detection.

When enabled, the generated workflow:

1. Checks out the repository with full history
2. Runs `git-detect-changes` against the previous branch state (`github.event.before`)
3. If changelog files were generated, commits and pushes them with a message like `Generated changes from commit abc1234`
4. Skips the site build for that run — the new commit will trigger a fresh build with the updated changelogs

You can also enable it later by setting `"detectChanges": true` in `ritual-site.json` and re-running `ritual init-site --upgrade`.
