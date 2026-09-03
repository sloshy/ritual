---
title: 'cleanup'
---

Normalize every deck, collection, and wanted list file in the workspace to the current conventions. Useful after hand-editing files, importing from older tools, or upgrading a workspace whose files predate a convention change (for example, deck files that were still named in lower-kebab-case).

One pass over all list files applies four normalizations:

1. **Every deck gets a `format:`.** For each deck whose front matter declares no format, you are prompted to pick one — the format is always your call, but the deck's shape orders the choices so the likely answer is at the top:
   - A **command zone** (a `## Commander`, `## Oathbreaker`, or `## Signature Spell` section) lists the command-zone formats first (Commander, Oathbreaker, Brawl, Duel Commander, …), with a note that a commander was detected.
   - **60+ main-deck cards with no commander** lists the 60-card constructed formats first (Standard, Modern, Legacy, Vintage, …).
   - **40–59 main-deck cards with no commander** lists Limited first (a likely sealed or draft deck).

   Cancelling the prompt leaves that deck's file entirely untouched and moves on — it is not rewritten either, since any save would stamp the section-inferred format you just declined to confirm.

2. **Every file is rewritten in canonical form.** Each list is loaded and re-emitted through the standard serializers, so formatting converges on what a fresh save would write (see [List File Format](/list-format/)): a `- ` bullet on every card line, canonical token order and spacing, uppercase set codes in printings, omitted default finish/condition/language markers, an explicit `## Section` structure, a `# Title` heading on all three types, and `&N` card IDs on every line. A collection or wanted-list line that carries a quantity (`- 4 Lightning Bolt (LEA:161)`) is expanded to one line per copy — the first keeps the line's `&N`, the rest are allocated fresh ids. A deck whose name still lives in legacy `name:` front matter gets it as the `# Title` heading, and `name:` and `created:` are dropped (`tags:` and every other key stay).
3. **Every file is named after its list.** The file name is derived from the list's actual name — its `# Title` heading, or for a deck that has none yet, its legacy `name:` front matter — keeping capitalization and punctuation and stripping only filename-illegal characters. A file whose name drifted (or that still uses an old kebab-case slug) is renamed, and its `.sha256`, `.changes.md`, `.art.json`, `.categories.json` (with its own `.sha256`), and `.primer.md` sidecars move with it.
4. **Every list's [categories sidecar](/list-format/#categories-namecategoriesjson) is pruned and canonicalized.** A `<name>.categories.json` entry naming a card the list no longer holds is dropped (reported as `pruned 1 category assignment(s) for cards no longer in the list: Rhystic Study`), the vocabulary's display order is resolved and persisted, and the file is re-serialized in canonical form (`categories sidecar rewritten in canonical form`). Under `--dry-run` both are previewed without writing a byte. A file whose parse skipped lines is never pruned — a card whose line the parser could not read is still in the file — so its sidecar is only canonicalized, and `categories not pruned: …` says so. The stamp rule below applies to this sidecar as well: a hand-edited one is rewritten but keeps its stale (or absent) `.sha256`.

Cleanup never touches a `.changes.md` changelog — a cleaned-up file has the same cards it had before, and a rename carries the changelog along unchanged. It refreshes a file's `.sha256` sidecar (and, separately, the categories sidecar's own) only when that sidecar already matched the file: a hand-edited list is rewritten but keeps its stale (or absent) sidecar, so [`detect-changes`](/commands/detect-changes/) still records the hand edits rather than having them stamped as recorded. Two cases are reported with a warning instead of fully acted on: a rename whose target name is already taken by another list — either the same file name, or one that merely [folds onto it](/commands/list-resolution/#names-that-would-collide-are-refused-at-creation), which would leave both lists unaddressable — and a file holding content the canonical rewrite cannot reproduce. The second covers two things: lines the parse skipped — refused card lines, but also prose or any other text the list grammar does not model (`//` comment lines are read and dropped, so they never block) — and [fenced code blocks](/commands/edit/#fenced-code-blocks), which parse cleanly as prose but which the canonical serializers do not emit. In either case the file is still renamed if its name drifted, but its content is left alone (rewriting it would silently drop that content; fix, remove, or accept it and rerun).

A file cleanup cannot read at all — broken YAML front matter, bad permissions — is reported by name and **skipped**: nothing about it is rewritten or renamed, every other list is still cleaned up, and the run exits 1. This is the case cleanup exists for (hand-edited workspaces), so one unparseable file can no longer abort the pass:

```
[dry-run] decks/Broken.md: warning: could not be read: unexpected end of the stream within a flow collection at line 3, column 1
[dry-run] decks/Broken.md: warning: skipped: fix the file and rerun cleanup
1 file could not be read and was skipped (see the warnings above).
```

Its per-file JSON result carries `"unreadable": true`.

Two further cases are reported _without_ holding anything back:

- A collection or wanted-list line that carries a quantity (`- 4 Sol Ring (C21:240)`) reads as that many copies. Cleanup reports it (`Read 4 copies: a collection holds one line per copy, so this line becomes 4 lines on the next save.`) and the rewrite expands it — see [Deck-Style Quantity Prefixes](/commands/collection-sync/#deck-style-quantity-prefixes).
- A deck's **empty extras section** — a `## Maybeboard` or `## Tokens` header with no cards under it, usually left behind by a sync or a `remove-card` that took its last card. Extras count toward no total, so the header holds nothing to lose: the rewrite drops it and cleanup reports `Dropped empty section: Maybeboard`. This is the one advisory that names something the rewrite _removes_. An empty `## Main` / `## Mainboard` / `## Deck` or `## Sideboard` header in a deck that has cards elsewhere is kept and written back bare, without a warning; any _other_ empty section (`## Creatures`, `## Commander`, …) is reported as `Skipped empty section` and blocks the rewrite like any other unreproducible line.

## Usage

```bash
./ritual cleanup [options]
```

## Options

| Option              | Description                                                                     | Default |
| ------------------- | ------------------------------------------------------------------------------- | ------- |
| `-n, --dry-run`     | Report what would change without writing files                                  | `false` |
| `--skip-formats`    | Never prompt for deck formats; leave formatless decks untouched and report them | `false` |
| `--check`           | Like `--dry-run`, but exit 1 when any file would change (for hooks and CI)      | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                      | `text`  |
| `--quiet`           | Suppress non-essential output                                                   | `false` |

Under `--dry-run` nothing is prompted either — decks with no declared format are reported as `needs a format` and left untouched. `--check` implies `--dry-run`.

## Headless Runs

The deck-format step is the only interactive part of cleanup. A real run that
encounters a formatless deck when prompts are unavailable (`--no-input` /
`RITUAL_NO_INPUT`, stdin is not a terminal, or `--output json`/`ndjson` owns
stdout) refuses **before touching any file** with a usage error (exit 2) naming
`--skip-formats`. Pass `--skip-formats` to run everything else and leave
formatless decks as they are (reported as `format skipped`), or run
interactively to answer the prompts.

## `--check`

`--check` is `--dry-run` with a meaningful exit code, for git hooks and CI:

```bash
./ritual cleanup --check
```

It exits 1 when any file would be rewritten or renamed, would have its
categories sidecar pruned or re-serialized, is blocked from its canonical
rewrite by parse warnings or a fenced code block, or could not be read at all — and 0 when the workspace is already clean. The messages say which of
those it was, so "needs cleanup" and "could not be parsed" are distinguishable
in a hook's output.
A formatless deck alone does not fail `--check`: a real run would not change it
without an interactive answer.

## Scripted Output

With `--output json` (or `ndjson`), the text report is replaced by a single
payload on stdout containing the per-file results (only files with something to
report) and every warning, prefixed with its file:

```json
{
  "files": [
    {
      "type": "wanted",
      "filePath": "/path/to/wanted/binder.md",
      "renamedTo": "Binder.md",
      "rewritten": true,
      "warnings": []
    }
  ],
  "warnings": []
}
```

## Exit Codes

| Code | Meaning                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Cleanup ran (or previewed) successfully                                                                                                                                |
| `1`  | A file could not be read or parsed (every mode, including `--dry-run`), a real run could not rewrite a file (skipped lines or a fenced block), or `--check` found work |
| `2`  | A real run needed the deck-format prompt but prompts were unavailable (see `--skip-formats`)                                                                           |

## Examples

Preview what a cleanup would do:

```bash
./ritual cleanup --dry-run
```

```text
[dry-run] decks/winota-stax.md: renamed to 'Winota Stax.md'
[dry-run] decks/Jank.md: needs a format
[dry-run] collections/Binder.md: rewritten in canonical form

Would clean up 3 of 12 list files.
```

Run the cleanup:

```bash
./ritual cleanup
```

Run headless (CI, scripts) without the format prompts:

```bash
./ritual cleanup --skip-formats
```

Fail a CI job when the workspace needs a cleanup:

```bash
./ritual cleanup --check
```

Clean up a workspace elsewhere:

```bash
./ritual --base-dir /path/to/site cleanup
```
