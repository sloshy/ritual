---
title: 'cleanup'
---

Normalize every deck, collection, and wanted list file in the workspace to the current conventions. Useful after hand-editing files, importing from older tools, or upgrading a workspace whose files predate a convention change (for example, deck files that were still named in lower-kebab-case).

One pass over all list files applies three normalizations:

1. **Every deck gets a `format:`.** For each deck whose front matter declares no format, you are prompted to pick one — the format is always your call, but the deck's shape orders the choices so the likely answer is at the top:
   - A **command zone** (a `## Commander`, `## Oathbreaker`, or `## Signature Spell` section) lists the command-zone formats first (Commander, Oathbreaker, Brawl, Duel Commander, …), with a note that a commander was detected.
   - **60+ main-deck cards with no commander** lists the 60-card constructed formats first (Standard, Modern, Legacy, Vintage, …).
   - **40–59 main-deck cards with no commander** lists Limited first (a likely sealed or draft deck).

   Cancelling the prompt leaves that deck's file entirely untouched and moves on — it is not rewritten either, since any save would stamp the section-inferred format you just declined to confirm.

2. **Every file is rewritten in canonical form.** Each list is loaded and re-emitted through the standard serializers, so formatting converges on what a fresh save would write: uppercase set codes in printings, omitted default finish/condition markers, an explicit `## Section` structure, a `# Title` heading on collections and wanted lists (a deck's name lives in its `name:` front matter instead), and `&N` card IDs on every line.
3. **Every file is named after its list.** The file name is derived from the list's actual name — a deck's `name:` front matter, or a collection/wanted list's `# Title` heading — keeping capitalization and punctuation and stripping only filename-illegal characters. A file whose name drifted (or that still uses an old kebab-case slug) is renamed, and its `.sha256`, `.changes.md`, and `.primer.md` sidecars move with it.

Cleanup never adds changelog entries — a cleaned-up file has the same cards it had before. Two cases are skipped with a warning instead of acted on: a rename whose target file name is already taken by another list, and a file whose parse skipped malformed lines (rewriting it would silently drop them; fix the reported lines and rerun).

## Usage

```bash
./ritual cleanup [options]
```

## Options

| Option          | Description                                    | Default |
| --------------- | ---------------------------------------------- | ------- |
| `-n, --dry-run` | Report what would change without writing files | `false` |

Under `--dry-run` nothing is prompted either — decks with no declared format are reported as `needs a format` and left untouched.

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

Clean up a workspace elsewhere:

```bash
./ritual --base-dir /path/to/site cleanup
```
