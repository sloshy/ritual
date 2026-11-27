---
title: 'ritual cleanup'
description: 'Rewrite every list file in the standard format, after hand edits or older tools.'
sidebar:
  label: 'cleanup'
---

Normalize every deck, collection, and wanted list file in the workspace to the current conventions. Run it after hand-editing files, importing from older tools, or upgrading a workspace whose files predate a convention change.

One pass over all list files applies five normalizations:

1. **Every deck gets a `format:`.** For each deck whose front matter declares no format, you are prompted to pick one. The deck's shape orders the choices so the likely answer is at the top:
   - A **command zone** (a `## Commander`, `## Oathbreaker`, or `## Signature Spell` section) lists the command-zone formats first (Commander, Oathbreaker, Brawl, Duel Commander, …), with a note that a commander was detected.
   - **60+ main-deck cards with no commander** lists the 60-card constructed formats first (Standard, Modern, Legacy, Vintage, …).
   - **40–59 main-deck cards with no commander** lists Limited first.

   Cancelling the prompt leaves that deck's file untouched (it is not rewritten either) and moves on.

2. **Every file is rewritten in canonical form.** Each list is loaded and re-emitted through the standard serializers, so formatting converges on what a fresh save would write (see [List Files](/list-format/)): a `- ` bullet on every card line, canonical token order and spacing, uppercase set codes, omitted default finish/condition/language markers, an explicit `## Section` structure, a `# Title` heading on all three types, and `&N` card IDs on every line. A collection or wanted-list line that carries a quantity (`- 4 Lightning Bolt (LEA:161)`) is expanded to one line per copy; the first keeps the line's `&N`, the rest get fresh ids.
3. **Every file is named after its list.** A list's title (its `# Title` heading) and its file name are the same name, and no two lists of one type share a title (see [List Names](/list-resolution/#a-lists-title-is-its-file-name)). The file name is derived from the title, keeping capitalization and punctuation and stripping only filename-illegal characters, so `# Burn?` lives in `Burn.md`. A file whose name drifted from its title (a `# Title` edited by hand, a file renamed on disk, an old kebab-case slug) is renamed to match, through the same rename [`ritual rename`](/commands/rename/) makes: its `.sha256` (kept only when it matched the file), `.changes.md`, `.art.json`, `.categories.json` (with its own `.sha256`), and `.primer.md` companion files move with it, and the same name collisions are refused.
4. **Every list's [categories file](/list-format/#categories-namecategoriesjson) is pruned and canonicalized.** A `<name>.categories.json` entry naming a card the list no longer holds is dropped (reported as `pruned 1 category assignment for a card no longer in the list: Rhystic Study`). The vocabulary's display order is resolved and persisted, and the file is re-serialized in canonical form (`categories sidecar rewritten in canonical form`). Under `--dry-run` both are previewed without writing. A file whose parse skipped lines is never pruned, since a card the parser could not read is still in the file; its categories file is only canonicalized, and `categories not pruned: …` says so. The `.sha256` rule below applies to this file as well.
5. **Every repeated-face card name is folded onto its card.** A line spelled the way Scryfall names a [reversible printing](/commands/cache/#preload-all), `- Steam Vents // Steam Vents (ECL:348)`, is renamed to the card it prints, `- Steam Vents (ECL:348)`, which is the name the card cache files that printing under. The line keeps its printing, finish, and `&N`. Its category assignments move to the folded name, merged after any the card already has. The run reports `folded 1 repeated-face card name onto the card it prints: Steam Vents // Steam Vents`, and the JSON result lists the original spellings in `cardNamesFolded`. A file whose parse skipped lines is left alone.

Cleanup never touches a `.changes.md` changelog: a cleaned-up file has the same cards it had before, and a rename carries the changelog along unchanged. It refreshes a file's `.sha256` content hash (and, separately, the categories file's own) only when that hash already matched the file. A hand-edited list is rewritten but keeps its stale or absent hash, so [`detect-changes`](/commands/detect-changes/) still records the hand edits.

These cases are reported with a warning instead of fully acted on:

- A rename whose target name another list already goes by, either the same file name or one that [folds onto it](/list-resolution/#names-that-would-collide-are-refused-at-creation). Cleanup does not guess which list should give the title up. The warning names the other list, and one of the two needs a new title by hand:

  ```text
  collections/b.md: not renamed to 'Burn.md': 'Burn' ('Burn.md') already goes by this list's title; give one of the two a new title with `ritual rename <list> "<new title>"`
  ```

  The JSON result of the blocked list carries the other as `renameBlockedBy` (`{ listType, slug, name }`). A name that a list frees later in the same pass is taken after all: `b.md` titled `Burn` waits for `Burn.md` titled `Red` to move to `Red.md`, whichever the pass reaches first. Only a true cycle (two lists swapping names) stays blocked, each list naming the other. When two drifted lists' titles name the same file, the first takes it and the second is blocked. `--dry-run` and `--check` model the whole pass, so they report exactly what the real run does.

- Lists of one type whose titles fold to the same name (`Trade Binder` and `trade-binder`). Each is reported naming the others (`shares the title 'Trade Binder' with 'trade-binder.md'; …`) as `sharesTitleWith`, except a list whose own rename was blocked by one of them: that list carries `renameBlockedBy` instead, and the list holding the name carries `sharesTitleWith`, so each pair is named once from each side, never both on one list. Rename all but one with [`ritual rename`](/commands/rename/).
- A title no file can be named after (`# ???`, or one ending like a companion file, `# Burn.changes`): the warning says so, the result carries `titleUnusable: true`, and nothing is renamed. Give the list a usable title with `ritual rename`.
- A rename that cannot be made: a companion file already at the destination with no list of its own (an orphaned `Burn.changes.md`, perhaps left by an interrupted rename, which a rename would overwrite or adopt), or a file-system error. A failed rename moves back whatever it had moved. The result carries `renameFailed: true` and the warning says why; every other list is still cleaned up. `--dry-run` models the pass against every list on disk.
- A file holding content the canonical rewrite cannot reproduce: lines the parse skipped (refused card lines, prose, or any other text the list grammar does not model) and [fenced code blocks](/list-format/#fenced-code-blocks), which parse cleanly but which the serializers do not emit. `//` comment lines are read and dropped, so they never block.

A file holding such content is still renamed if its name drifted, but its content is left alone. Rewriting it would silently drop that content. Fix, remove, or accept it and rerun.

A file cleanup cannot read at all (broken YAML front matter, bad permissions) is reported by name and skipped. Nothing about it is rewritten or renamed, every other list is still cleaned up, and the run exits 1:

```
[dry-run] decks/Broken.md: warning: could not be read: unexpected end of the stream within a flow collection at line 3, column 1
[dry-run] decks/Broken.md: warning: skipped: fix the file and rerun cleanup
1 file could not be read and was skipped (see the warnings above).
```

Its per-file JSON result carries `"unreadable": true`.

Two further cases are reported without holding anything back:

- A collection or wanted-list line that carries a quantity (`- 4 Sol Ring (C21:240)`) reads as that many copies. Cleanup reports it (`Read 4 copies: a collection holds one line per copy, so this line becomes 4 lines on the next save.`) and the rewrite expands it. See [Deck-Style Quantity Prefixes](/commands/collection-sync/#deck-style-quantity-prefixes).
- A deck's **empty extras section**: a `## Maybeboard` or `## Tokens` header with no cards under it, usually left behind by a sync or a `remove-card` that took its last card. The rewrite drops it and reports `Dropped empty section: Maybeboard`; this is the one advisory that names something the rewrite removes. Any other empty section header (`## Sideboard`, `## Commander`, `## Creatures`, …) in a deck that has cards elsewhere is kept and written back bare, without a warning.

## Usage

```bash
ritual cleanup [options]
```

## Options

| Option              | Description                                                                     | Default |
| ------------------- | ------------------------------------------------------------------------------- | ------- |
| `-n, --dry-run`     | Report what would change without writing files                                  | `false` |
| `--skip-formats`    | Never prompt for deck formats; leave formatless decks untouched and report them | `false` |
| `--check`           | Like `--dry-run`, but exit 1 when any file would change (for hooks and CI)      | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                      | `text`  |
| `--quiet`           | Suppress non-essential output                                                   | `false` |

Under `--dry-run` nothing is prompted. Decks with no declared format are reported as `needs a format` and left untouched. `--check` implies `--dry-run`.

## Headless Runs

The deck-format step is the only interactive part of cleanup. A real run that meets a formatless deck when prompts are unavailable (`--no-input` / `RITUAL_NO_INPUT`, stdin is not a terminal, or `--output json`/`ndjson` owns stdout) refuses before touching any file with a usage error (exit 2) naming `--skip-formats`. Pass `--skip-formats` to run everything else and leave formatless decks as they are (reported as `format skipped`), or run interactively to answer the prompts.

## `--check`

`--check` is `--dry-run` with a meaningful exit code, for git hooks and CI:

```bash
ritual cleanup --check
```

It exits 1 when any file would be rewritten or renamed, would have its categories file pruned or re-serialized, is blocked from its canonical rewrite by parse warnings or a fenced code block, shares its title with another list of its type (or could not be renamed to its title for that reason), has a title no file can be named after, could not be renamed (`renameFailed`), or could not be read at all. It exits 0 when the workspace is already clean. The messages say which case applied, so "needs cleanup" and "could not be parsed" are distinguishable in a hook's output. A formatless deck alone does not fail `--check`, since a real run would not change it without an interactive answer.

## Scripted Output

With `--output json` (or `ndjson`), the text report is replaced by a single JSON document on stdout containing the per-file results (only files with something to report) and every warning, with the file it is about:

```json
{
  "files": [
    {
      "listType": "collection",
      "filePath": "/path/to/collections/Bad.md",
      "name": "Bad",
      "rewritten": false,
      "rewriteBlocked": true,
      "warnings": [
        {
          "message": "Skipped malformed line: this is not a card line",
          "messageKey": "domain.import.text.malformedLine",
          "messageParams": { "line": "this is not a card line" }
        },
        {
          "message": "not rewritten: fix the lines above and rerun cleanup",
          "messageKey": "cli.cleanup.notRewritten"
        },
        {
          "message": "categories not pruned: the parse skipped lines, so a card still in the file could look gone",
          "messageKey": "cli.cleanup.categoriesNotPruned"
        }
      ]
    }
  ],
  "warnings": [
    {
      "file": "collections/Bad.md",
      "message": "Skipped malformed line: this is not a card line",
      "messageKey": "domain.import.text.malformedLine",
      "messageParams": { "line": "this is not a card line" }
    },
    {
      "file": "collections/Bad.md",
      "message": "not rewritten: fix the lines above and rerun cleanup",
      "messageKey": "cli.cleanup.notRewritten"
    },
    {
      "file": "collections/Bad.md",
      "message": "categories not pruned: the parse skipped lines, so a card still in the file could look gone",
      "messageKey": "cli.cleanup.categoriesNotPruned"
    }
  ]
}
```

Each warning is a message: `message` is English whatever the CLI's language, with `messageKey` and `messageParams` beside it. A card-line grammar refusal is keyed `domain.card.line.atLine` (or `domain.card.line.inFile`), its diagnostic nested as `text` (`domain.card.line.*`). Params may nest, as in `import --output json`. A rename refused because another list goes by the title is keyed `cli.cleanup.renameTaken`, and a title shared with other lists `cli.cleanup.sharedTitle`. Each file result also carries the list's title as `name` (absent for a file that could not be read). Match on `messageKey` rather than on `message`. The text report prints the same warnings in the CLI's language.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Cleanup ran (or previewed) successfully                                                                                                                                                                                                       |
| `1`  | A file could not be read or parsed (every mode, including `--dry-run`), a real run could not rewrite a file (skipped lines or a fenced block) or left a list unrenamed (a shared or unusable title, a failed rename), or `--check` found work |
| `2`  | A real run needed the deck-format prompt but prompts were unavailable (see `--skip-formats`)                                                                                                                                                  |

## Examples

Preview what a cleanup would do:

```bash
ritual cleanup --dry-run
```

```text
[dry-run] decks/winota-stax.md: renamed to 'Winota Stax.md'
[dry-run] decks/Jank.md: needs a format
[dry-run] collections/Binder.md: rewritten in canonical form

Would clean up 3 of 12 list files.
```

Run the cleanup:

```bash
ritual cleanup
```

Run headless (CI, scripts) without the format prompts:

```bash
ritual cleanup --skip-formats
```

Fail a CI job when the workspace needs a cleanup:

```bash
ritual cleanup --check
```

Clean up a workspace elsewhere:

```bash
ritual --base-dir /path/to/site cleanup
```
