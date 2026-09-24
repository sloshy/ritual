---
title: 'Importing'
description: Import a deck from a URL, file, or pasted text, import a CSV, or apply a change bundle from the public site.
---

The admin site has three import pages. Each runs the same engine as its CLI counterpart, so an import from the browser and one from the terminal produce the same files.

## Import Deck

Pick one of three sources with the segmented control:

- **URL**: fetch from Archidekt, Moxfield, or MTGGoldfish.
- **Upload File**: choose a decklist or exported deck file (markdown or plain text). It is read in the browser and parsed on the server.
- **Paste Text**: paste a decklist (`QTY Name` per line; `## Heading` lines start new sections). MTG Arena and MTGO exports work too, printings included.

Options:

- **Deck Name** (upload and paste): used unless the text defines its own name (a `# Title` heading, or the `Name` line of an Arena `About` block).
- **Overwrite existing deck if it exists**: replace a deck of the same name instead of failing on conflict.
- **Import the exact printings…** (URL only, ticked by default): untick it to import bare card names. See [Printings from a URL import](/commands/import/#printings-from-a-url-import).

## Import CSV

Import cards from a CSV export (Moxfield, Deckbox, ManaBox, and others) into a deck, collection, or wanted list. Upload a file or paste CSV text.

The page parses the CSV in the browser, guesses whether the first row is a header, and pre-selects which column holds each card field for you to confirm: name, set, collector number, condition, finish, language, tags, categories, section, and quantity.

- A `Category`/`Categories` header maps to the **categories** field, written to the list's [`<name>.categories.json`](/list-format/#categories-namecategoriesjson) file. `Section`/`Board` remain the section headers.
- Values are normalized on import (`Near Mint` → `NM`, `F` → foil, `side` → `Sideboard`), exactly like the [`import`](/commands/import/#csv-imports) command's CSV mode.

Choose a target:

- **Create New List**. An **Overwrite if a list with this name exists** checkbox replaces an existing list of the same name.
- **Append to Existing**. Pick the target from a dropdown of the existing lists of the selected type. Appends record every added card in the list's changelog.

Rows that fail validation are listed with their line numbers; the valid rows still import. Non-fatal notices are listed separately below the failures: a category value the grammar refused, a category value that named a board, or a categories file that could not be written. In those cases the import itself succeeded.

## Import Changes

The **Import Changes** page applies a change bundle exported from the public site's [in-browser editor](/public-site/editing/). A bundle is a version-2 `ritual-change-bundle` JSON covering one or more lists plus the cross-list moves touching them. The export panel's **This list** and **All lists** scopes both produce one; see the [format](/commands/import-changes/#format).

Upload the file or paste its contents. The page parses it in the browser and shows:

- a preview of every pending change, grouped by target list
- the bundle's **moves**, each copy with its source and destination
- per-list and total counts

Nothing is written until you press **Apply N changes to K lists**.

Applying replays every list's changes and every move in one timestamp-ordered stream:

- Each list's changes are re-targeted to its current card IDs: by ID when the card still exists, otherwise by card name.
- Each move is applied on its destination list. That save also takes the copy out of the source list and writes both changelogs.
- The list files and their changelogs are written.

The result is reported per list: the applied count (moves included), every skipped change with its reason (card not found, not applicable to this list, or the card has no printing for that finish), and any list that failed. A failure stops that list's remaining batches but not the other lists. This is the same engine as the [`import-changes`](/commands/import-changes/) command and the MCP `import_change_bundle` tool.

## Loading changes into an editor

The deck, collection, and wanted-list editors each have an **Import…** button that loads a change bundle as **pending edits** instead of applying it immediately. Use it when you want to adjust the changes before committing them.

The dialog loads the bundle entry for the list being edited plus every move leaving or arriving at it (matched by slug or display name). Other entries are ignored. A bundle that names no list of this kind and no move touching it is rejected.

- Each change is re-targeted to the current list's card IDs. Added cards get fresh IDs; other changes match by ID when it still exists, otherwise by card name.
- Changes that cannot be applied are skipped and listed after the import with a reason: the card is not in the list, the action does not apply to this kind of list, or it would set a foil/etched finish on a card with no printing.
- The loaded changes appear in the editor for review. **Save Changes** writes them as a normal edit, recorded in the changelog.
