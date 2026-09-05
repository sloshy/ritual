---
title: 'Importing'
description: Import a deck from a URL, file, or pasted text, import a CSV, or apply a change bundle from the public site.
---

The admin site has three import pages. Each one runs the same engine as its CLI counterpart, so an import from the browser and one from the terminal produce the same files.

## Import Deck

Import a deck three ways, selected with a segmented control:

- **URL** — fetch from Archidekt, Moxfield, or MTGGoldfish.
- **Upload File** — choose a decklist or exported deck file (markdown or plain text); it is read in the browser and parsed server-side.
- **Paste Text** — paste a decklist directly (`QTY Name` per line, `## Heading` lines start new sections). MTG Arena/MTGO exports are understood too, printings included.

For upload and paste, an optional **Deck Name** is used unless the text defines its own name (a `# Title` heading, or an Arena `About` block's `Name` line). Optionally overwrite an existing deck on conflict. URL imports also carry an **Import the exact printings…** checkbox (ticked by default, URL mode only) — unticking it imports bare card names; see [Printings from a URL import](/commands/import/#printings-from-a-url-import).

## Import CSV

Import cards from a CSV export (Moxfield, Deckbox, ManaBox, ...) into a deck, collection, or wanted list — either **creating a new list** or **appending to an existing one**. Upload a file or paste CSV text; the page parses it in the browser, guesses whether the first row is a header, and pre-selects which column holds each card field (name, set, collector number, condition, finish, language, tags, categories, section, quantity) for you to confirm. A `Category`/`Categories` header now maps to the **categories** field (written to the list's [`<name>.categories.json`](/list-format/#categories-namecategoriesjson) sidecar), while `Section`/`Board` remain the section headers. Values are normalized on import (e.g. `Near Mint` → `NM`, `F` → foil, `side` → `Sideboard`) exactly like the [`import`](/commands/import/#csv-imports) CLI command's CSV mode, which shares the same engine.

When creating, an **Overwrite if a list with this name exists** checkbox replaces an existing list of the same name; in **Append to Existing** mode the target is picked from a dropdown of the existing lists of the selected type. Appends record every added card in the list's changelog. Rows that fail validation are listed with their line numbers; the valid rows still import. Non-fatal notices — a category value the grammar refused, a category value that named a board, a categories sidecar that could not be written — are listed separately below the failures; the import itself succeeded.

## Import Changes

The **Import Changes** page applies a change bundle exported from the public site's [in-browser editor](/public-site/editing/) — a version-2 `ritual-change-bundle` JSON covering one or more lists plus the cross-list moves touching them (the export panel's **This list** and **All lists** scopes both produce it; see the [format](/commands/import-changes/#format)). Upload the file or paste its contents; the page parses it in the browser and shows a full **preview of every pending change grouped by target list**, the bundle's **moves** (each copy with its source and destination), and per-list and total counts. Nothing is written until you press **Apply N changes to K lists**.

Applying replays every list's changes and every move in one timestamp-ordered stream, re-targets each list's changes to its current card IDs (by ID when it still exists, otherwise by card name), applies each move on its destination list — whose save also takes the copy out of the source list and writes both changelogs — writes the list files and their changelogs, and reports a per-list outcome: applied count (moves included), every skipped change with the reason it was skipped (card not found, not applicable to this list, or the card has no printing for that finish), and any list that failed (which stops that list's remaining batches, not the others). This is the same engine as the [`import-changes`](/commands/import-changes/) CLI command and the MCP `import_change_bundle` tool.

## Loading changes into an editor

Alternatively, the deck, collection, and wanted-list editors each have an **Import…** button that loads a change bundle as **pending edits** rather than applying it immediately — useful when you want to adjust the changes before committing them. The dialog loads the bundle entry for the list being edited plus every move leaving or arriving at it (matched by slug or display name; other entries are ignored), and rejects a bundle that names no list of this kind and no move touching it:

- Each change is **re-targeted** to the current list's card IDs — added cards get fresh IDs, and other changes match by ID when it still exists, otherwise by card name.
- Changes that cannot be applied are skipped and listed after the import, each with its reason: the card is not in the list, the action does not apply to this kind of list, or it would set a foil/etched finish on a card that pins no printing.
- The loaded changes appear in the editor for you to review and then **Save Changes** as a normal edit (recorded in the changelog).
