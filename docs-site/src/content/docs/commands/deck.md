---
title: 'deck'
---

Interactively build a deck by adding cards to named **sections**. This is the deck-building
counterpart to the [`collection`](/commands/collection/) and [`wanted`](/commands/wanted/) managers: it
shares the same name/collector entry modes, session filters, and menu actions, and adds
deck-specific section targeting.

## Usage

```bash
./ritual deck [options]
```

### Options

| Flag                          | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)   |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`              |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`         |
| `--section <name>`            | Add every card to this section (otherwise you are prompted) |
| `--collector`                 | Start in collector number mode                              |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results        |

When `--section` is omitted, the **target section** defaults to "prompt every time": you choose
a section (or create one) for each card. You can change the target section at any time from the
menu or via `⚙️ Configure Session Filters`.

On startup you select an existing deck or create a new one. Existing decks are listed by their
display name (the `name:` front matter field), not their slugified file name, sorted
alphabetically. A new deck is created with the same YAML front matter as
[`new-deck`](/commands/new-deck/) (display name preserved, file name slugified, default `commander`
format).

## Menu Options

The following options are available in the menu when no search text is typed:

| Option                               | Description                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `💾 Save N change(s) (keep editing)` | Write the deck file and changelog without leaving the session           |
| `🚪 Exit`                            | Leave the session (asks to save, discard, or cancel when unsaved)       |
| `🗂️ Set Target Section`              | Pin a section, create a new one, or prompt for each card                |
| `⚙️ Configure Session Filters`       | Adjust default sets, finish, condition, and target section              |
| `🔢 Switch to Collector Number Mode` | Switch to collector number entry mode                                   |
| `📦 Manage Set Codes`                | Add, remove, or switch active sets (collector mode)                     |
| `🔤 Switch to Name Mode`             | Switch back to name entry mode (collector mode)                         |
| `🛠️ Switch to Edit Mode`             | Browse and edit the deck's existing lines (see [Edit Mode](#edit-mode)) |
| `➕ Add Another Copy`                | Increment the quantity of the last added card                           |
| `📝 Add Note`                        | Attach a note to the last added card                                    |
| `✏️ Edit Previous Card`              | Re-pick the printing/finish/condition for the last card                 |
| `↩️ Undo Last Add`                   | Take back the most recently added card                                  |
| `↩️ Undo Last Edit`                  | Revert the most recent [edit-mode](#edit-mode) operation                |
| `📋 View Session Changes (N)`        | Review every change this session and optionally discard individual ones |

The `↩️ Undo Last Add` option appears only after you have added at least one card this session, and `📋 View Session Changes` once the session has any change to show. The viewer lists everything done this session — adds, edits, and removals — and selecting an entry offers to discard just that change (see [Reviewing Session Changes](#reviewing-session-changes)).

## Saving

Like the admin Deck Editor, the session keeps every change **in memory** until you save: nothing is
written to the deck file as you add or edit cards. `💾 Save` writes the file and appends the session
changelog while you keep working (everything saved this way is committed — the undo and discard
menus reset). Saving repeatedly in one session folds each save's changes into the session's existing
changelog entry (bumping its timestamp) rather than adding a new entry per save, so one editing
session is always one changelog entry. `🚪 Exit` leaves the session: with unsaved changes it opens a menu to **Save and
exit**, **Exit without saving** (throws away all unsaved changes), or **Cancel** (keep editing).
Pressing <kbd>Esc</kbd>/<kbd>Ctrl-C</kbd> at the main prompt behaves like `🚪 Exit`.

## Sections

Every card is added under a `## Section Name` (H2) header. The **target section** controls where
new cards land:

- **Prompt every time** (default) — you pick an existing section or create a new one per card.
- **A pinned section** — set with `--section`, the `🗂️ Set Target Section` menu, or the session
  filters. All subsequent cards go there until you change it.

Adding a card whose **printing already exists anywhere in the deck** increments that entry's
quantity instead of creating a new line (matching the admin Deck Editor and the
[`add-card`](/commands/add-card/) command). A different printing of the same card is kept as its own
entry.

## Entry Modes

Like the collection manager, the deck manager supports two entry modes you can toggle during a
session:

### Name Mode (default)

Autocomplete-driven card name entry. Session filters (sets, finish, condition) are applied
automatically; append `!` to a card name to force the finish/condition prompts for that entry.
If no printings can be found for a chosen card, it is added name-only rather than dropped.

### Collector Number Mode

Look up cards by collector number within one or more loaded sets, managed via `📦 Manage Set Codes`.

## Edit Mode

`🛠️ Switch to Edit Mode` repurposes the search prompt: instead of the card database, it
autocompletes over the deck's **existing lines** (e.g. `2 Sol Ring (C19:221) — Main &5`). Selecting
a line opens an action menu:

| Action                     | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| `🖼️ Change Printing`       | Pick a new printing, finish, and condition for the line                           |
| `➕ Add a Copy`            | Increment the line's quantity                                                     |
| `➖ Remove a Copy`         | Decrement the line's quantity (multi-copy lines only); keeps the `&N` id          |
| `🗂️ Move to Section`       | Move the line to another section (or a new one)                                   |
| `📝 Edit Note`             | Edit or clear the line's note                                                     |
| `🗑️ Remove Card`           | Delete a single-copy line (asks for confirmation); releases its `&N` id           |
| `🗑️ Remove All Copies (N)` | Delete all N copies of a multi-copy line (asks for confirmation); releases the id |

Every edit is undoable with `↩️ Undo Last Edit` (a linear stack, newest first); undoing a full-line
removal restores the line with its original `&N` id when the id has not been reused. Edits are
folded into the session changelog with "latest wins" semantics — changing a line and then changing
it back leaves no changelog entry. Removing copies that were added this session simply cancels
their adds. `➕ Switch to Add Mode` returns to the regular add flow; you can toggle between the two
modes freely within one session.

## Reviewing Session Changes

`📋 View Session Changes` opens a picker listing every change made this session — `➕` copy adds,
`✏️` field edits (printing, section, note), and `🗑️` removals. Selecting an entry asks whether to
discard that change, reverting just it while keeping the rest of the session intact:

- **Discarding an add** cancels that copy (decrementing or removing the line). When the discard
  fully removes a line first created this session, its `&N` id is freed and the remaining
  session-added lines keep dense, in-order ids (each later line slides down one, and the highest id
  returns to the pool). Because the re-pack renumbers ids, it also clears the edit-undo history.
  Decrementing a multi-copy line keeps its id.
- **Discarding an edit or removal** reverts that operation in place. When several changes touch the
  **same line**, they must be discarded newest-first — older ones are blocked until the newer
  change is discarded (the picker tells you which one).

Everything already saved with `💾 Save` is committed and no longer appears in the viewer.

## Output Format

Cards are written to a markdown deck file in the `decks/` directory under their section headers:

```
---
name: "Winota Stax"
format: "commander"
---

## Commander
1 Winota, Joiner of Forces (IKO:215) &1

## Main
1 Sol Ring (LTC:284) &2
4 Lightning Bolt (LEA:161) &3
```

The leading number is the card quantity. Non-foil finish and `NM` condition are omitted for
brevity. The `&N` suffix is a persistent card ID used internally for change tracking and is
auto-assigned. Decrementing a quantity keeps the ID; only removing the whole line releases it.

## Examples

Start the deck manager:

```bash
./ritual deck
```

Add everything to a specific section without per-card prompts:

```bash
./ritual deck --section Sideboard
```

Start in collector number mode with sets pre-loaded:

```bash
./ritual deck --collector --sets "FDN, SPG"
```
