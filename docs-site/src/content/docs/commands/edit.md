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
./ritual edit [listName] [options]
```

With no arguments, the editor starts at the [list selection menu](#the-list-selection-menu). Pass
a `[listName]` to skip the menu and open that list's session directly — see
[Opening a List Directly](#opening-a-list-directly).

The editor is interactive end to end and requires a terminal with prompts enabled. When prompts
are unavailable (stdin is not a terminal, or `--no-input` / `RITUAL_NO_INPUT` is in force), it
exits with code `2` (`Input required: …`) instead of opening — scripts should use the one-shot
commands ([`add-card`](/commands/add-card/), [`remove-card`](/commands/remove-card/),
[`set-card`](/commands/set-card/), [`note`](/commands/note/), [`move`](/commands/move/)) instead.

### Options

| Flag                          | Description                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--deck`                      | Resolve `[listName]` as a deck                                                                                        |
| `--collection`                | Resolve `[listName]` as a collection                                                                                  |
| `--wanted`                    | Resolve `[listName]` as a wanted list                                                                                 |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)                                                             |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`                                                                        |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`                                                                   |
| `--section <name>`            | Add deck cards to this section (otherwise you are prompted)                                                           |
| `--collector`                 | Start in collector number mode                                                                                        |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results                                                                  |
| `--refresh <mode>`            | Card cache refresh policy: `ask` (default — prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never` |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper
printings. Options can be combined; when `--collector` is used with `--sets`, the set card data is
pre-loaded automatically. The type flags only matter together with `[listName]`; without it they
are ignored, since the selection menu already covers every type.

## Opening a List Directly

`./ritual edit <listName>` opens that list's editing session immediately, skipping the selection
menu. The name is resolved across all three list types with the shared
[list resolution](/commands/list-resolution/) rules (case- and accent-insensitive, exact match
first, then a unique substring). Narrow the search with a type flag, or with a
`deck:` / `collection:` / `wanted:` prefix on the name itself. The prefix supplies the type when no
flag is given; a prefix that **contradicts** the flag is a usage error (exit `2`) naming both:

```bash
./ritual edit Burn                # any list named Burn
./ritual edit "To Buy" --wanted   # only wanted lists are searched
./ritual edit collection:Binder   # prefix form of the same idea
```

Once open, the session behaves exactly as if you had picked the list from the menu: the same
session filters apply, and `🔀 Switch List` (or <kbd>Esc</kbd>) backs out to the normal selection
menu rather than quitting, so a direct open can still grow into a multi-list session.

A name that matches nothing (or more than one list) fails with an error before the editor starts —
see [Exit Codes](#exit-codes).

:::note
The name is matched against the list's **file name** (without `.md`), like every other command. The
selection menu, by contrast, shows decks by their **display name** (the `name:` front matter
field) — so a deck whose title differs from its file name is addressed here by the file name. A
deck at `decks/old-burn.md` titled `Modern Burn` opens with `./ritual edit old-burn`, not
`./ritual edit "Modern Burn"`.
:::

The session filters (sets, finish, condition, entry mode, and the deck target section) are shared
across every list you open, so they carry over when you switch lists. The condition applies to
decks and collections; wanted lists track desired cards, not owned ones, so they have no condition.

## Cache Freshness

The editor reads card data from the built-in Scryfall cache. The shared `--refresh <mode>` option
decides how its freshness is handled before the session starts:

- **`ask`** (the default) — when the cache was last fully downloaded **more than a week ago**,
  prompts to redownload it (default no). When prompts are unavailable (`--no-input` /
  `RITUAL_NO_INPUT`, or stdin is not a terminal) the prompt is skipped and the existing cache is
  used as-is.
- **`auto`** — redownloads the cache without prompting whenever its prices are **more than a day
  old** (prices ride along inside the cached card data, so a redownload is how they refresh).
- **`no-bulk`** / **`never`** — leave the cache alone; the session uses it as-is.

## The List Selection Menu

On startup (and whenever you back out of a list) you pick what to edit next:

- `🗃️ All Lists`, `🎴 All Decks`, `📦 All Collections`, `🎯 All Wanted Lists` — edit several lists at
  once, without switching between them (see [Multi-List Modes](#multi-list-modes)). Each is offered
  only when it spans at least two lists, and `All Lists` is skipped when every list is of the same
  type (it would open the same session as that type's own entry).
- Every **deck** (`🎴`, by display name), **collection** (`📦`), and **wanted list** (`🎯`) on disk,
  plus any list created this session. Lists with unsaved changes show a `— N unsaved change(s)`
  badge, and a list that does not exist on disk yet is badged `— new`. Decks are listed by their
  display name (the `name:` front matter field), which is what an older or hand-renamed deck's
  file name may differ from.
- `➕ New Deck` / `➕ New Collection` / `➕ New Wanted List` — create a list and start editing it (see
  [Creating Lists](#creating-lists)).
- `🚪 Exit` — leave the editor (with unsaved changes anywhere, asks to save all, discard all, or
  cancel).

## Creating Lists

A new list is created **in memory only**: its file (and changelog) appear when you save the editor,
and never if you exit without saving. Until then it behaves like any other open list — you can add
cards to it, switch away and back, and see it in the selection menu badged `— new`.

Because the creation is itself an unsaved change, a brand-new list with no cards still counts as
unsaved: saving writes an empty list file, and discarding leaves nothing behind. It also appears in
[`📋 View Session Changes`](#reviewing-session-changes) as `Created this deck` (or collection, or
wanted list), ahead of any card change made to that list:

```text
? 2 change(s) this session — select one to discard it:
❯   🎯 Scratch: Created this wanted list
    🎯 Scratch: ➕ Added - Black Lotus &1
```

Discarding that entry takes the whole list back out of the session — so it is refused while the list
still has card changes of its own (`Cannot discard this change yet — discard this wanted list's 1
card change(s) first`). Discard those first, and the list can go. If you were editing that list
directly, you are returned to the selection menu, since there is nothing left to edit. Saving
commits the creation, and the entry disappears.

A new deck prompts for its [format](#deck-format) and is written with the same YAML front matter as
[`new deck`](/commands/new/); new collections and wanted lists get a `# Title` heading. Every
list type's file is named as the list is named — see
[List file names](/commands/new/#list-file-names). A name with no usable file-name characters
is rejected at the prompt, and so is a name that would
[collide with an existing list](/commands/list-resolution/#names-that-would-collide-are-refused-at-creation)
— including one that merely folds onto it, and including a list created earlier in the same session
that has not been saved yet.

Lists can be created from two places: the `➕ New …` items in the list selection menu, and the same
items in the `Add to which list?` prompt of a [multi-list mode](#multi-list-modes) — where the card you
were adding goes straight into the list you just created.

## Switching Lists

Inside a list session, `🔀 Switch List` backs out to the list selection menu, keeping the list's
unsaved changes in memory. Pressing <kbd>Esc</kbd>/<kbd>Ctrl-C</kbd> at the main card prompt does
the same. Reopening a list you already edited resumes exactly where you left off — pending changes,
undo history, and all.

## Multi-List Modes

Four menu entries open several lists at once in a single session, so you never have to switch lists
to touch a card in a different one:

| Entry                 | Spans                                   |
| --------------------- | --------------------------------------- |
| `🗃️ All Lists`        | every deck, collection, and wanted list |
| `🎴 All Decks`        | every deck                              |
| `📦 All Collections`  | every collection                        |
| `🎯 All Wanted Lists` | every wanted list                       |

They behave identically apart from which lists they span, and each behaves like a normal list
session with two differences.

**Adding a card asks where it goes.** After you pick a card name (or a collector number), a
`Add to which list?` prompt appears, listing every list in scope plus the `➕ New …` items. Whichever
list you pick then runs **its own** add flow for the rest of that card's prompts, exactly as if you
had opened that list directly. In `All Lists`, adding to a deck may therefore leave the printing
unspecified and ask for a target section, while adding the very next card to a collection still
demands a specific printing — each list keeps its own rules:

```text
? Enter card name to add › Sol Ring
? Add to which list? › 🎯 To Buy
? How specific for Sol Ring? › Name only (cheapest printing)
Added: - Sol Ring &2
```

Picking a `➕ New …` item [creates the list](#creating-lists) (in memory) and adds the card to it,
without leaving the mode. A single-type mode offers only its own type's create item — a list created
in `All Decks` could only ever be a deck, so there is nothing to choose:

```text
? Add to which list? ›
❯   🎴 Atraxa
    🎴 Winota
    ➕ New Deck
```

The last added card's shortcuts (`➕ Add Exact Copy`, `➕ Add Similar Copy`, `📝 Add Note`, `✏️ Edit Previous Card`,
`↩️ Undo Last Add`) all act on the list that card went into, so you are never asked twice.

**Edit mode spans every list in scope.** `🛠️ Switch to Edit Mode` autocompletes over the entries of
those lists at once, each labelled with the list it belongs to, and each entry offers the action menu
of its own list type. Searching matches the list name too, so typing `binder` narrows to one list:

```text
? Search for a card to edit › o
❯   🎴 Test Deck: 1 Sol Ring (LEA:161) — Commander &1
    📦 Main Binder: - Lightning Bolt (LEA:161) &1
    🎯 To Buy: - Mox Ruby &1
```

`📋 View Session Changes` likewise pools those lists' changes, labelled by list, and discarding one
affects only its own list. Because every list in scope is the "current" list here, there is no
`💾 Save current list changes` item — a single save item covers everything, whichever
[label](#saving) it carries. Note that **Save writes every open list**, including ones opened outside
the current scope.

Changes made in a multi-list mode are the same in-memory per-list changes as anywhere else: switching
to a single list (or another mode) and back keeps them, and each list is written to its own file with
its own changelog entry on save.

## Menu Options

The following options are available in the session menu when no search text is typed, listed in the
order they appear. The card you just added comes first, so its shortcuts are always the nearest ones
to reach; the session-wide settings follow, and `🚪 Exit` sits at the very bottom where you cannot
land on it by overshooting.

| Option                                   | Description                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `➕ Add Exact Copy`                      | Add another copy of the last added card, identical options                     |
| `➕ Add Similar Copy`                    | Add a copy of the last added card, re-prompting its options                    |
| `📝 Add Note`                            | Attach a note to the last added card                                           |
| `✏️ Edit Previous Card`                  | Re-enter the last added card with forced prompts                               |
| `↩️ Undo Last Add`                       | Take back the most recently added card                                         |
| `↩️ Undo Last Edit`                      | Revert the most recent [edit-mode](#edit-mode) operation                       |
| `🗂️ Set Target Section`                  | Pin a deck section, create a new one, or prompt for each card (decks)          |
| `🏷️ Change Format`                       | Change the deck's [format](#deck-format) (decks)                               |
| `⚙️ Configure Session Filters`           | Adjust default sets, finish, condition, and (decks) target section (name mode) |
| `🔢 Switch to Collector Number Mode`     | Switch to collector number entry mode (name mode)                              |
| `📦 Manage Set Codes`                    | Add, remove, or switch active sets (collector mode)                            |
| `🔤 Switch to Name Mode`                 | Switch back to name entry mode (collector mode)                                |
| `🛠️ Switch to Edit Mode`                 | Browse and edit the list's existing entries (see [Edit Mode](#edit-mode))      |
| `📋 View Session Changes (N)`            | Review every change this session and optionally discard individual ones        |
| `💾 Save all changes (N across M lists)` | Write every open list's file and changelog, keep editing                       |
| `💾 Save current list changes (N)`       | Write only the list you are editing, keep the rest in memory                   |
| `🔀 Switch List`                         | Back to the list selection menu, keeping unsaved changes in memory             |
| `🚪 Exit`                                | Leave the editor (asks to save all, discard all, or cancel when unsaved)       |

The `↩️ Undo Last Add` option appears only after you have added at least one card this session, and
`📋 View Session Changes` once the session has any change to show (see
[Reviewing Session Changes](#reviewing-session-changes)).

[Edit mode](#edit-mode) pares this down: the undo shortcuts lead, followed by `➕ Switch to Add Mode`,
then the review, save, and exit items.

## Saving

Changes accumulate **in memory per list**; nothing is written to any file as you add or edit cards.

A save re-serializes the whole list file in canonical form, so any line the parser could not read —
prose, comments, malformed card lines — is dropped by the save, and so is a
[fenced code block](#fenced-code-blocks), which the canonical form cannot express. Both are printed
as warnings when the session loads the list, so check the session output before saving a
hand-edited file (or run [`cleanup --check`](/commands/cleanup/) first to find them). For an edit
that must leave such lines untouched, use the line-preserving one-shot commands
([`set-card`](/commands/set-card/), [`remove-card`](/commands/remove-card/), [`note`](/commands/note/)).

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
a [multi-list mode](#multi-list-modes) there is no current list to single out, so the save-current item
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

What you type is split on whitespace and **every term must appear in the card name**, in any order —
`in tre` finds "In the Trenches", `bolt light` finds "Lightning Bolt". Case, accents, and punctuation
don't have to match (`jaces archivist` finds "Jace's Archivist").

Suggestions are ordered by EDHRec popularity, except that closer matches come first: a card whose
**whole name** you have typed leads, ahead of more popular cards that merely contain what you typed.
Searching `The En` lists the popular cards first; finishing the name as `The End` puts the card named
"The End" at the top. Typing the front face of a double-faced card counts as its whole name. Below
those come the cards your query prefixes, then the cards whose **words your terms begin** — which is
what puts "In the Trenches" at the top of `in tre`, ahead of the 80 cards that merely contain those
letters somewhere.

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

### Printing and Finish Prices

Once a card is chosen in [Name Mode](#name-mode-default), the `Select Printing:` list shows each
printing's price in your configured [`defaultCurrency`](/configuration/#default-currency), aligned in
a right-hand column. (Collector-number entry already identifies one printing, so it goes straight to
the finish prompt.)

```
? Select Printing: ›
❯   Marvel Super Heroes Commander (MSC) #211 [uncommon]  $1.85
    Secrets of Strixhaven Commander (SOC) #427 [mythic]  $14.93 foil
    Secret Lair Drop (SLD) #2683 [rare]                  N/A
```

Each printing is quoted at its default finish — nonfoil where the printing has one, otherwise the
finish it actually comes in, named after the price (`$14.93 foil`) so a foil-only or etched-only
printing doesn't read as a nonfoil quote. `N/A` (or `N/A foil`, for a printing quoted at a
non-nonfoil finish) means the card cache carries no price for that printing in that currency.

Typing filters the list by set code, set name, collector number, and rarity — never by price, so a
number always searches collector numbers rather than matching everything that happens to cost that
much.

The finish prompts price the same way, so you can see what a foil or etched copy costs before
picking it — `Select Finish:` when adding a card, and `✨ Change Finish` in [Edit Mode](#edit-mode):

```
? Select Finish: › - Use arrow-keys. Return to submit.
❯   Nonfoil  $1.85
    Foil     N/A
```

A wanted list's `No preference (any finish)` choice covers every finish, so it shows no price; an
entry whose pinned printing is missing from the card cache shows no price column at all. An `Etched`
row is always `N/A` when your currency is `eur` — Scryfall publishes no etched euro price (see
[How Cards Are Priced](/commands/price/#how-cards-are-priced)).

Prices come from the local card cache, so they are as fresh as your last
[cache refresh](#cache-freshness).

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
- **Discarding a list's creation** removes the whole list from the session (see
  [Creating Lists](#creating-lists)). It leads that list's changes and is blocked until the list's
  own card changes are discarded.

Everything already saved is committed and no longer appears in the viewer. The viewer covers the
**current list**; switch lists to review another list's changes. In
a [multi-list mode](#multi-list-modes) it covers every list in scope at once, each entry labelled with its list.

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

A deck with no `format:` — an older file, or one imported from a source that reports no format —
is not formatless: it is read as Commander when it has a `## Commander` section (Oathbreaker for a
`## Oathbreaker` or `## Signature Spell` section), which is what the menu shows and what the site
displays. Saving the deck writes that resolved format into the file, so the guess only has to be
made once. See [new](/commands/new/#deck-format) for the full list of formats.

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
- Sol Ring (C19:221) [foil] &1
- Lightning Bolt (LEA:161) [LP] &2
- Mana Crypt (2XM:270) [foil] {Japanese language, ignore pricing} &3
```

Non-foil finish and the default `NM` condition are omitted for brevity, matching deck lines (a
"Don't Care" condition choice is treated as `NM` and therefore not written). The note is optional and can be added
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
- Black Lotus (LEB:233) {birthday present to self} &4
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
- Sol Ring (C19:221) [foil] &1

## Keep
- Lightning Bolt (LEA:161) &2
```

Section order is preserved as written. Cards added by this command go to the file's **last**
section. On the generated site, a list with two or more sections defaults to grouping by section,
and **Section** appears as a grouping option in the toolbar. Sections are managed from the
[admin editors](/admin/editors/#sections); pricing commands ignore section headers.

## Fenced Code Blocks

List files are hand-authored markdown, so a deck, collection, or wanted list may carry a fenced
code block — an example line, a template, a snippet of output. **Everything inside a fence is
prose.** Card parsing ignores it completely: a card-looking line inside a fence is not a card, a
`## Heading` inside a fence is not a section, an `&N` inside a fence is not a card ID, and none of
it is reported as an unreadable line.

````markdown
# My Binder

## Main

- Sol Ring (C19:221) &1

Cards are written like this:

```
- Card Name (SET:CN) [finish] [condition] {note} &N
- Black Lotus (LEA:232) &99
```

- Lightning Bolt (LEA:161) &2
````

That file holds two cards. The `- Black Lotus (LEA:232) &99` line is an example: it is not counted,
not priced, not exported, never offered by a picker, and never the target of `add-card`,
`set-card`, `remove-card`, `note`, or `move`. `&99` is not "in use", so a future card may be
assigned that ID. The `&N` backfill leaves fenced lines unstamped, and every line-preserving edit
leaves the block byte-for-byte as you wrote it.

Both fence styles are recognized: three or more backticks or three or more tildes, indented by up
to three spaces, with an optional info string (` ```markdown `). The closing fence uses the same
character, is at least as long, and carries nothing after it. Fences do not nest — tildes inside a
backtick fence are ordinary content, and vice versa. **An unclosed fence runs to the end of the
file** (the CommonMark rule), so a stray ` ``` ` hides every card line below it: if cards go
missing from a list, check for an unbalanced fence.

Inline code spans (`` `like this` ``) and four-space indented blocks are _not_ treated as code —
only fenced blocks are. A four-space indent is indistinguishable from a nested list item, so an
indented block's card lines are read as real cards and its ` ``` ` delimiters as unreadable lines.
Use a fenced block whenever a list file needs to hold prose card lines.

### Whole-file rewrites

The surfaces that rewrite a whole file from its parsed cards cannot re-emit a fenced block, so they
treat one exactly as they treat an unreadable line:

| Surface                                                                               | Behavior with a fenced block                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The admin editors' save (and the MCP tools that reuse it)                             | Refuses with a `400` and writes nothing                                                         |
| [`cleanup`](/commands/cleanup/)                                                       | Reports the block and skips the content rewrite; a drifted file name is still corrected         |
| [`deck-sync`](/commands/deck-sync/) / [`collection-sync`](/commands/collection-sync/) | Held back by the unreadable-lines gate (`-y/--yes` accepts the loss)                            |
| [`import --append`](/commands/import/)                                                | Refuses and writes nothing                                                                      |
| A deck on either side of [`move`](/commands/move/)                                    | Refuses and writes nothing                                                                      |
| `ritual edit` sessions                                                                | **Warns on load and drops the block on the next save** — check the session output before saving |

The one-shot card commands (`add-card`, `set-card`, `remove-card`, `note`) are line-preserving and
work normally, as does a `move` between two collections or wanted lists. The one exception is an
**append into an unclosed fence**: because an unclosed fence runs to end of file, a new card line
appended at the end would be prose, so `add-card` and `move` refuse rather than write a line no
later parse can see.

## Examples

Start the editor at the list selection menu:

```bash
./ritual edit
```

Jump straight into a list — a deck by file name, or any list with a type prefix:

```bash
./ritual edit Burn
./ritual edit collection:Binder
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

## Exit Codes

The failure codes apply only to startup — [opening a list directly](#opening-a-list-directly) and
the interactivity requirement; once open, the interactive editor itself always exits `0`.

| Code | Meaning                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Editor exited normally                                                                                                                                                            |
| `2`  | Usage error (conflicting type flags, a type prefix contradicting a type flag, `[listName]` matched more than one list, or prompts are unavailable — no terminal, or `--no-input`) |
| `3`  | Not found (`[listName]` matched nothing, or no lists exist in the searched scope)                                                                                                 |
