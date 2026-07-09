---
title: 'edit'
---

The interactive editor for **every** list type: decks, collections, and wanted lists. A **list
selection menu** covers all lists at once; picking one opens a card-entry session with
autocomplete over the card database, per-type prompts, an edit mode over existing entries, and
undo. You can back out of the list you are editing, pick another list of any type, and keep going —
every opened list keeps its unsaved changes in memory until you save or exit.

This makes multi-list workflows painless: move on from cataloging a collection to updating a deck,
or mirror a change across two lists, all in one session with one save at the end.

## Usage

```bash
./ritual edit [options]
```

### Options

| Flag                          | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)   |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`              |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`         |
| `--section <name>`            | Add deck cards to this section (otherwise you are prompted) |
| `--collector`                 | Start in collector number mode                              |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results        |
| `--no-cache-prompt`           | Do not prompt to update a card cache older than a week      |
| `--refresh-prices`            | Refresh cached prices that are more than a day old          |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper
printings. Options can be combined; when `--collector` is used with `--sets`, the set card data is
pre-loaded automatically.

The session filters (sets, finish, condition, entry mode, and the deck target section) are shared
across every list you open, so they carry over when you switch lists. The condition applies to
decks and collections; wanted lists track desired cards, not owned ones, so they have no condition.

## Cache Freshness

The editor reads card data from the built-in Scryfall cache. When that cache was last fully
downloaded **more than a week ago**, the command prompts you to redownload it before the session
starts. Pass `--no-cache-prompt` to skip the prompt and use the existing cache as-is.

Card prices ride along inside the cached card data. Pass `--refresh-prices` to redownload the
cache (and thus refresh prices) whenever the cached prices are **more than a day old**; this
happens without prompting because you asked for it explicitly.

## The List Selection Menu

On startup (and whenever you back out of a list) you pick what to edit next:

- `🗃️ All Lists` — edit every list at once, without switching between them (see
  [All Lists Mode](#all-lists-mode)). Offered only when there are at least two lists to span.
- Every **deck** (`🎴`, by display name), **collection** (`📦`), and **wanted list** (`🎯`) on disk.
  Lists with unsaved changes show a `— N unsaved change(s)` badge. Decks are listed by their
  display name (the `name:` front matter field), not their slugified file name.
- `➕ New Deck` / `➕ New Collection` / `➕ New Wanted List` — create a list and start editing it. A
  new deck prompts for its [format](#deck-format) and is created with the same YAML front matter as
  [`new-deck`](/commands/new-deck/) (display name preserved, file name slugified); new collections
  and wanted lists get a `# Title` heading.
- `🚪 Exit` — leave the editor (with unsaved changes anywhere, asks to save all, discard all, or
  cancel).

## Switching Lists

Inside a list session, `🔀 Switch List` backs out to the list selection menu, keeping the list's
unsaved changes in memory. Pressing <kbd>Esc</kbd>/<kbd>Ctrl-C</kbd> at the main card prompt does
the same. Reopening a list you already edited resumes exactly where you left off — pending changes,
undo history, and all.

## All Lists Mode

`🗃️ All Lists` opens **every** list at once in a single session, so you never have to switch lists
to touch a card in a different one. It behaves like a normal list session, with two differences.

**Adding a card asks where it goes.** After you pick a card name (or a collector number), a
`Add to which list?` prompt appears. Whichever list you pick then runs **its own** add flow for the
rest of that card's prompts, exactly as if you had opened that list directly. Adding to a deck may
therefore leave the printing unspecified and ask for a target section, while adding the very next
card to a collection still demands a specific printing — each list keeps its own rules:

```text
? Enter card name to add › Sol Ring
? Add to which list? › 🎯 To Buy
? How specific for Sol Ring? › Name only (cheapest printing)
Added: - Sol Ring &2
```

The last added card's shortcuts (`➕ Add Another Copy`, `📝 Add Note`, `✏️ Edit Previous Card`,
`↩️ Undo Last Add`) all act on the list that card went into, so you are never asked twice.

**Edit mode spans every list.** `🛠️ Switch to Edit Mode` autocompletes over the entries of all
lists at once, each labelled with the list it belongs to, and each entry offers the action menu of
its own list type. Searching matches the list name too, so typing `binder` narrows to one list:

```text
? Search for a card to edit › o
❯   🎴 Test Deck: 1 Sol Ring (LEA:161) — Commander &1
    📦 Main Binder: - Lightning Bolt (LEA:161) [NM] &1
    🎯 To Buy: - Mox Ruby &1
```

`📋 View Session Changes` likewise pools every list's changes, labelled by list, and discarding one
affects only its own list. Because every list is the "current" list here, there is no
`💾 Save current list changes` item — a single save item covers everything, whichever
[label](#saving) it carries.

Changes made in All Lists mode are the same in-memory per-list changes as anywhere else: switching
to a single list and back keeps them, and each list is written to its own file with its own
changelog entry on save.

## Menu Options

The following options are available in the session menu when no search text is typed:

| Option                                   | Description                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `💾 Save all changes (N across M lists)` | Write every open list's file and changelog, keep editing                       |
| `💾 Save current list changes (N)`       | Write only the list you are editing, keep the rest in memory                   |
| `🔀 Switch List`                         | Back to the list selection menu, keeping unsaved changes in memory             |
| `🚪 Exit`                                | Leave the editor (asks to save all, discard all, or cancel when unsaved)       |
| `🗂️ Set Target Section`                  | Pin a deck section, create a new one, or prompt for each card (decks)          |
| `🏷️ Change Format`                       | Change the deck's [format](#deck-format) (decks)                               |
| `⚙️ Configure Session Filters`           | Adjust default sets, finish, condition, and (decks) target section (name mode) |
| `🔢 Switch to Collector Number Mode`     | Switch to collector number entry mode (name mode)                              |
| `📦 Manage Set Codes`                    | Add, remove, or switch active sets (collector mode)                            |
| `🔤 Switch to Name Mode`                 | Switch back to name entry mode (collector mode)                                |
| `🛠️ Switch to Edit Mode`                 | Browse and edit the list's existing entries (see [Edit Mode](#edit-mode))      |
| `➕ Add Another Copy`                    | Add another copy of the last added card                                        |
| `📝 Add Note`                            | Attach a note to the last added card                                           |
| `✏️ Edit Previous Card`                  | Re-enter the last added card with forced prompts                               |
| `↩️ Undo Last Add`                       | Take back the most recently added card                                         |
| `↩️ Undo Last Edit`                      | Revert the most recent [edit-mode](#edit-mode) operation                       |
| `📋 View Session Changes (N)`            | Review every change this session and optionally discard individual ones        |

The `↩️ Undo Last Add` option appears only after you have added at least one card this session, and
`📋 View Session Changes` once the session has any change to show (see
[Reviewing Session Changes](#reviewing-session-changes)).

## Saving

Changes accumulate **in memory per list**; nothing is written to any file as you add or edit cards.
The save actions cover all open lists:

- `💾 Save all changes (N across M lists)` writes every open list's file and appends each list's
  session changelog while you keep working. Everything saved this way is committed — the undo and
  discard menus reset.
- `💾 Save current list changes (N)` writes only the list you are editing, keeping the other
  lists' changes in memory.

The save-current item appears only when the list you are editing has anything unsaved **and** at
least one other open list does too. When just one list has anything unsaved, saving all and saving
the current list are the same thing, so a single `💾 Save N change(s) (keep editing)` item is
shown — even when that one dirty list is not the one you are currently in. In
[All Lists Mode](#all-lists-mode) there is no current list to single out, so the save-current item
is never shown.

The counts track card changes. Pending work that is not a card change (currently only a changed
[deck format](#deck-format)) still surfaces the save items, but is left out of the counts — a list
whose only pending work is a format change shows count-less labels instead
(`💾 Save changes (keep editing)`, `💾 Save current list changes`, `💾 Save all changes (M lists)`).

Saving repeatedly in one session does **not** create a new changelog entry per save — each list's
later changes are folded into that list's existing entry (bumping its timestamp), so one editing
session is always one changelog entry per list.

`🚪 Exit` (from a session or the selection menu) opens the exit menu when anything is unsaved:
**Save and exit** flushes every open list, **Exit without saving** discards every open list's
pending changes, **Cancel** keeps editing.

## Entry Modes

Two entry modes are available while adding cards, toggleable at any time:

### Name Mode (default)

Autocomplete-driven card name entry. Type a card name and select from suggestions.

- **Session Filters** — Configure default set codes, finish, condition, and (for decks) the target
  section via `⚙️ Configure Session Filters`. When set, these defaults are applied automatically
  to each card without prompting.
- **Force Prompts** — Append `!` to a card name to override the finish/condition session filters
  for that entry, forcing the prompts to appear regardless of filter settings.
- **Edit Previous Card** — Re-enter the most recently added card with forced prompts, useful for
  correcting mistakes.

If no printings can be found for a chosen card, decks and wanted lists fall back to a name-only
entry rather than dropping the card; collections skip it (a collection entry requires a printing).

### Collector Number Mode

Look up cards by collector number within one or more loaded sets.

- **Set Management** — Add, remove, and switch between multiple active set codes via the
  `📦 Manage Set Codes` menu.
- **Autocomplete** — Type a collector number prefix to filter the card list for the active set.

## Edit Mode

`🛠️ Switch to Edit Mode` repurposes the search prompt: instead of the card database, it
autocompletes over the list's **existing entries** (rendered as their canonical lines). Selecting
an entry opens an action menu that depends on the list type.

For a **deck** line:

| Action                     | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| `🖼️ Change Printing`       | Pick a new printing, finish, and condition for the line                           |
| `➕ Add a Copy`            | Increment the line's quantity                                                     |
| `➖ Remove a Copy`         | Decrement the line's quantity (multi-copy lines only); keeps the `&N` id          |
| `🗂️ Move to Section`       | Move the line to another section (or a new one)                                   |
| `📝 Edit Note`             | Edit or clear the line's note                                                     |
| `🗑️ Remove Card`           | Delete a single-copy line (asks for confirmation); releases its `&N` id           |
| `🗑️ Remove All Copies (N)` | Delete all N copies of a multi-copy line (asks for confirmation); releases the id |

For a **collection** entry:

| Action                | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `🖼️ Change Printing`  | Pick a new printing, finish, and condition for the entry       |
| `✨ Change Finish`    | Switch between `nonfoil`, `foil`, and `etched`                 |
| `📋 Change Condition` | Switch between `NM`, `LP`, `MP`, `HP`, and `DMG`               |
| `📝 Edit Note`        | Edit or clear the entry's note                                 |
| `🗑️ Remove`           | Delete the entry (asks for confirmation); releases its `&N` id |

For a **wanted list** entry:

| Action               | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| `🖼️ Change Printing` | Re-pick the specificity: name-only, or a specific printing with optional finish     |
| `✨ Change Finish`   | Switch between `nonfoil`, `foil`, `etched`, or no preference (printed entries only) |
| `📝 Edit Note`       | Edit or clear the entry's note                                                      |
| `🗑️ Remove`          | Delete the entry (asks for confirmation); releases its `&N` id                      |

Every edit is undoable with `↩️ Undo Last Edit` (a linear stack, newest first); undoing a removal
restores the entry with its original `&N` id when the id has not been reused. Edits are folded into
the session changelog with "latest wins" semantics — changing a card and then changing it back
leaves no changelog entry. Removing a card that was added this session simply cancels the add.
`➕ Switch to Add Mode` returns to the regular add flow; you can toggle between the two modes
freely within one session.

## Reviewing Session Changes

`📋 View Session Changes` opens a picker listing every change made this session — `➕` adds,
`✏️` field edits, and `🗑️` removals. Selecting an entry asks whether to discard that change,
reverting just it while keeping the rest of the session intact:

- **Discarding an add** removes the card and frees its `&N` id; the remaining cards added this
  session keep dense, in-order ids (each later card slides down one, and the highest id returns to
  the pool). Because the re-pack renumbers ids, it also clears the edit-undo history. On a deck,
  discarding one copy of a multi-copy line just decrements the quantity and keeps its id.
- **Discarding an edit or removal** reverts that operation in place. When several changes touch the
  **same card**, they must be discarded newest-first — older ones are blocked until the newer
  change is discarded (the picker tells you which one).

Everything already saved is committed and no longer appears in the viewer. The viewer covers the
**current list**; switch lists to review another list's changes.

## Decks

### Deck Sections

Every deck card is added under a `## Section Name` (H2) header. The **target section** controls
where new cards land:

- **Prompt every time** (default) — you pick an existing section or create a new one per card.
- **A pinned section** — set with `--section`, the `🗂️ Set Target Section` menu, or the session
  filters. All subsequent cards go there until you change it.

Adding a card whose **printing already exists anywhere in the deck** increments that entry's
quantity instead of creating a new line (matching the admin Deck Editor and the
[`add-card`](/commands/add-card/) command). A different printing of the same card is kept as its
own entry.

### Deck Format

Every deck records a format (Commander, Standard, Modern, …) in its `format:` front matter field,
used by the generated site for the deck's cover label and expected size. Creating a deck in the
editor prompts for the format, and `🏷️ Change Format` in a deck session changes it later — the
menu item shows the current format, and the change is written on the next save like any other
pending edit (it counts as unsaved work, but is not a card change, so it does not appear in the
changelog or the session-changes viewer).

### Deck Files

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

## Collections

### Collection Files

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

Non-foil finish is omitted for brevity; the condition is always written (a "Don't Care" choice is
stored as `[NM]`, matching the admin Collection Editor). The note is optional and can be added
after entry via the `📝 Add Note` menu option. Notes are displayed in the card detail modal on the
generated site. The `&N` suffix is a persistent card ID used internally for change tracking and is
auto-assigned.

## Wanted Lists

### Card States

Each card on a wanted list exists in one of three states, which determines how pricing works:

| State               | Format                          | Pricing Behavior                              |
| ------------------- | ------------------------------- | --------------------------------------------- |
| **Name only**       | `- Card Name`                   | Uses cheapest printing across all sets        |
| **Printing**        | `- Card Name (SET:CN)`          | Uses cheapest _finish_ of that exact printing |
| **Fully specified** | `- Card Name (SET:CN) [finish]` | Uses the exact printing and finish specified  |

When adding a card to a wanted list, you are prompted to choose the specificity level:

1. **Name only (cheapest printing)** — skips printing and finish selection entirely
2. **Choose specific printing** — enters the printing selection flow, then optionally choose a finish

### Wanted List Files

Each card entry is written to a markdown file in the `wanted/` directory:

```
- Card Name (SET:CN) [finish] {note} &N
```

For example:

```
- Sol Ring &1
- Lightning Bolt (LEA:161) &2
- Mana Crypt (2XM:270) [foil] &3
- Black Lotus (LEB:233) [nonfoil] {birthday present to self} &4
```

Any combination of set/collector number and finish can be omitted depending on the desired
specificity level. The note is optional. The `&N` suffix is a persistent card ID used internally
for change tracking and is auto-assigned.

## Sections

Collections and wanted lists can be split into named **sections** using `## Section Name` (H2)
headers beneath the `# Title`. Cards are grouped under the header that precedes them; cards before
the first header (or in a section-less file) belong to an implicit **Main** section that is written
out explicitly the next time the file is saved.

```
# My Binder

## Trade Binder
- Sol Ring (C19:221) [foil] [NM] &1

## Keep
- Lightning Bolt (LEA:161) &2
```

Section order is preserved as written. Cards added by this command go to the file's **last**
section. On the generated site, a list with two or more sections defaults to grouping by section,
and **Section** appears as a grouping option in the toolbar. Sections are managed from the
[admin editors](/admin/editors/#sections); pricing commands ignore section headers.

## Examples

Start the editor:

```bash
./ritual edit
```

Cataloging session with defaults, hopping between a collection and a wanted list:

```bash
./ritual edit --sets "FDN" --finish nonfoil --condition NM
```

Build a deck's sideboard without per-card section prompts:

```bash
./ritual edit --section Sideboard
```

Collector-number entry with sets pre-loaded:

```bash
./ritual edit --collector --sets "FDN, SPG"
```
