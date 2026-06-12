---
title: 'collection'
---

Interactively manage a collection of cards. Alias: `collect`.

## Usage

```bash
./ritual collection [options]
```

### Options

| Flag                          | Description                                               |
| ----------------------------- | --------------------------------------------------------- |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`) |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`            |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`       |
| `--collector`                 | Start in collector number mode                            |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results      |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper printings.

Options can be combined. When `--collector` is used with `--sets`, the set card data is pre-loaded automatically.

## Menu Options

The following options are available in the menu when no search text is typed:

| Option                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `💾 Save N change(s) (keep editing)` | Write the file and changelog without leaving the session                      |
| `✅ Done — Save N change(s) & Exit`  | Write the file and changelog, then exit                                       |
| `🚪 Exit Without Saving`             | Exit and discard every unsaved change (asks for confirmation)                 |
| `⚙️ Configure Session Filters`       | Adjust default set codes, finish, and condition                               |
| `🔢 Switch to Collector Number Mode` | Switch to collector number entry mode                                         |
| `📦 Manage Set Codes`                | Add, remove, or switch active sets (collector mode)                           |
| `🔤 Switch to Name Mode`             | Switch back to name entry mode (collector mode)                               |
| `🛠️ Switch to Edit Mode`             | Browse and edit the collection's existing cards (see [Edit Mode](#edit-mode)) |
| `➕ Add Another Copy`                | Append another copy of the last added card                                    |
| `📝 Add Note`                        | Attach a note to the last added card                                          |
| `✏️ Edit Previous Card`              | Re-enter the last added card with forced prompts                              |
| `↩️ Undo Last Add`                   | Take back the most recently added card                                        |
| `↩️ Undo Last Edit`                  | Revert the most recent [edit-mode](#edit-mode) operation                      |
| `📋 View Session Changes (N)`        | Review every change this session and optionally discard individual ones       |

The `↩️ Undo Last Add` option appears only after you have added at least one card this session, and `📋 View Session Changes` once the session has any change to show. The viewer lists everything done this session — adds, edits, and removals — and selecting an entry offers to discard just that change (see [Reviewing Session Changes](#reviewing-session-changes)).

## Saving

Like the admin Collection Editor, the session keeps every change **in memory** until you save:
nothing is written to the collection file as you add or edit cards. `💾 Save` writes the file and
appends the session changelog while you keep working (everything saved this way is committed — the
undo and discard menus reset); `✅ Done` does the same and exits. `🚪 Exit Without Saving` throws
away all unsaved changes after a confirmation. Pressing <kbd>Esc</kbd>/<kbd>Ctrl-C</kbd> at the
main prompt behaves like `✅ Done`.

## Entry Modes

The collection manager supports two entry modes that you can toggle between during a session:

### Name Mode (default)

Autocomplete-driven card name entry. Type a card name and select from suggestions.

- **Session Filters** — Configure default set codes, finish, and condition via the `⚙️ Configure Session Filters` menu option. When set, these defaults are applied automatically to each card without prompting.
- **Force Prompts** — Append `!` to a card name to override finish and condition session filters for that entry, forcing the prompts to appear regardless of filter settings.
- **Edit Last Card** — Re-enter the most recently added card with forced prompts, useful for correcting mistakes.

### Collector Number Mode

Look up cards by collector number within one or more loaded sets.

- **Set Management** — Add, remove, and switch between multiple active set codes via the `📦 Manage Set Codes` menu.
- **Autocomplete** — Type a collector number prefix to filter the card list for the active set.

## Edit Mode

`🛠️ Switch to Edit Mode` repurposes the search prompt: instead of the card database, it
autocompletes over the collection's **existing entries** (rendered as their canonical lines).
Selecting an entry opens an action menu:

| Action                | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `🖼️ Change Printing`  | Pick a new printing, finish, and condition for the entry       |
| `✨ Change Finish`    | Switch between `nonfoil`, `foil`, and `etched`                 |
| `📋 Change Condition` | Switch between `NM`, `LP`, `MP`, `HP`, and `DMG`               |
| `📝 Edit Note`        | Edit or clear the entry's note                                 |
| `🗑️ Remove`           | Delete the entry (asks for confirmation); releases its `&N` id |

Every edit is undoable with `↩️ Undo Last Edit` (a linear stack, newest first); undoing a removal
restores the entry with its original `&N` id when the id has not been reused. Edits are folded into
the session changelog with "latest wins" semantics — changing a card and then changing it back
leaves no changelog entry. Removing a card that was added this session simply cancels the add.
`➕ Switch to Add Mode` returns to the regular add flow; you can toggle between the two modes
freely within one session.

## Reviewing Session Changes

`📋 View Session Changes` opens a picker listing every change made this session — `➕` adds,
`✏️` field edits, and `🗑️` removals. Selecting an entry asks whether to discard that
change, reverting just it while keeping the rest of the session intact:

- **Discarding an add** removes the card and frees its `&N` id; the remaining cards added this
  session keep dense, in-order ids (each later card slides down one, and the highest id returns to
  the pool). Because the re-pack renumbers ids, it also clears the edit-undo history.
- **Discarding an edit or removal** reverts that operation in place. When several changes touch the
  **same card**, they must be discarded newest-first — older ones are blocked until the newer
  change is discarded (the picker tells you which one).

Everything already saved with `💾 Save` is committed and no longer appears in the viewer.

## Output Format

Each card entry is written to a markdown collection file in the `collections/` directory:

```
- Card Name (SET:CN) [finish] [condition] {note} &N
```

For example:

```
- Sol Ring (C19:221) [foil] [NM] &1
- Lightning Bolt (LEA:161) [NM] &2
- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing} &3
```

Non-foil finish is omitted for brevity; the condition is always written (a "Don't Care" choice is stored as `[NM]`, matching the admin Collection Editor). The note is optional and can be added after entry via the `📝 Add Note` menu option. Notes are displayed in the card detail modal on the generated site. The `&N` suffix is a persistent card ID used internally for change tracking and is auto-assigned.

### Sections

A collection can be split into named **sections** using `## Section Name` (H2) headers beneath the `# Title`. Cards are grouped under the header that precedes them; cards before the first header (or in a section-less file) belong to an implicit **Main** section that is written out explicitly the next time the file is saved.

```
# My Binder

## Trade Binder
- Sol Ring (C19:221) [foil] [NM] &1

## Keep
- Lightning Bolt (LEA:161) &2
```

Section order is preserved as written. Cards added by this command go to the file's **last** section. On the generated site, a collection with two or more sections defaults to grouping by section, and **Section** appears as a grouping option in the toolbar. Sections are managed from the [admin Collection Editor](/admin/editors/#sections); pricing commands ignore section headers.

## Examples

Start the collection manager:

```bash
./ritual collection
```

Pre-set condition and finish:

```bash
./ritual collect --condition NM --finish foil
```

Start in collector number mode with sets pre-loaded:

```bash
./ritual collect --collector --sets "FDN, SPG"
```

Filter by set in name mode:

```bash
./ritual collect -s "MOM, ONE" -c NM
```
