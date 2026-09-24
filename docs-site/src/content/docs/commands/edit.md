---
title: 'edit'
---

The interactive editor for decks, collections, and wanted lists. Pick a list from a menu, add cards with autocomplete over the card database, edit existing entries, and undo mistakes. You can back out to the menu, open another list of any type, and keep going. Every open list keeps its unsaved changes in memory until you save or exit, so one session can touch several lists with one save at the end.

## Usage

```bash
ritual edit [listName] [options]
```

With no arguments, the editor starts at the [list selection menu](#the-list-selection-menu). Pass a `[listName]` to open that list directly; see [Opening a List Directly](#opening-a-list-directly).

The editor needs a terminal with prompts enabled. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), it exits with code `2` (`Input required: …`). Scripts should use the one-shot commands instead: [`add-card`](/commands/add-card/), [`remove-card`](/commands/remove-card/), [`set-card`](/commands/set-card/), [`note`](/commands/note/), and [`move`](/commands/move/).

### Options

| Flag                          | Description                                                               |
| ----------------------------- | ------------------------------------------------------------------------- |
| `--deck`                      | Resolve the name as a deck                                                |
| `--collection`                | Resolve the name as a collection                                          |
| `--wanted`                    | Resolve the name as a wanted list                                         |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)                 |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`                            |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`                       |
| `--section <name>`            | Add deck cards to this section (otherwise you are prompted)               |
| `--collector`                 | Start in collector number mode (search printings by `SET:CN`)             |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results                      |
| `--refresh <mode>`            | Card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never` |

Digital-only sets (Alchemy sets, plus `OM1`) have no paper printings and are filtered out by default. Options can be combined. `--collector` needs no `--sets`, since [collector number mode](#collector-number-mode) searches every printing in the card cache; add `--sets` only to narrow that pool. The type flags only matter together with `[listName]`; without it they are ignored, since the selection menu already covers every type. Passing more than one type flag is a usage error either way.

## Opening a List Directly

`ritual edit <listName>` opens that list immediately. The name is resolved across all three list types with the shared [list name](/list-resolution/) rules. Narrow it with a type flag, or with a `deck:` / `collection:` / `wanted:` prefix on the name. A prefix that **contradicts** the flag is a usage error (exit `2`) naming both.

```bash
ritual edit Burn                # any list named Burn
ritual edit "To Buy" --wanted   # only wanted lists are searched
ritual edit collection:Binder   # prefix form of the same idea
```

Once open, the session behaves exactly as if you had picked the list from the menu. `🔀 Switch List` (or <kbd>Esc</kbd>) backs out to the selection menu rather than quitting, so a direct open can still grow into a multi-list session.

A name that matches nothing, or more than one list, fails before the editor starts. See [Exit Codes](#exit-codes).

:::note
The name is matched against the list's **file name** (without `.md`), like every other command. The selection menu shows decks by their **display name** (the `# Title` heading). A deck at `decks/old-burn.md` titled `Modern Burn` opens with `ritual edit old-burn`, not `ritual edit "Modern Burn"`.
:::

## Cache Freshness

The editor reads card data from the local Scryfall cache. `--refresh <mode>` decides what happens before the session starts:

- **`ask`** (default): when the cache was last fully downloaded **more than a week ago**, offers to redownload it (default no).
- **`auto`**: redownloads without asking whenever the cached prices are **more than a day old**. Prices are part of the cached card data, so a redownload is how they refresh.
- **`no-bulk`** / **`never`**: leave the cache alone.

When the cache was downloaded for a different `defaultLanguage` than the one now configured, `ask` offers a full redownload instead (default yes) and `auto` runs it; `no-bulk` / `never` keep the mismatched cache.

When the cache is **empty** the session cannot start, so the same policy decides the download that fills it. `ask` offers it (default yes), naming the English-only `default_cards` bulk, or the every-language `all_cards` bulk when `defaultLanguage` is not `en`. `auto` downloads without asking. `no-bulk` / `never` skip the offer, and the session fails with the `ritual cache preload-all` advice.

## The List Selection Menu

On startup, and whenever you back out of a list, you pick what to edit next:

- `🗃️ All Lists`, `🎴 All Decks`, `📦 All Collections`, `🎯 All Wanted Lists` edit several lists at once (see [Multi-List Modes](#multi-list-modes)). Each is offered only when it spans at least two lists. `All Lists` is skipped when every list is of the same type, since it would duplicate that type's own entry.
- Every **deck** (`🎴`, by display name), **collection** (`📦`), and **wanted list** (`🎯`) on disk, plus any list created this session. Lists with unsaved changes show a `— N unsaved change(s)` badge; a list not yet on disk is badged `— new`.
- `➕ New Deck` / `➕ New Collection` / `➕ New Wanted List` create a list and start editing it (see [Creating Lists](#creating-lists)).
- `🚪 Exit` leaves the editor. With unsaved changes anywhere, it asks to save all, discard all, or cancel.

## Creating Lists

A new list exists **in memory only** until you save. Its file and changelog appear on save, and never if you exit without saving. Until then it behaves like any other open list: add cards to it, switch away and back, and see it in the selection menu badged `— new`.

The creation is itself an unsaved change, so a new list with no cards still counts as unsaved. Saving writes an empty list file; discarding leaves nothing behind. It appears in [`📋 View Session Changes`](#reviewing-session-changes) as `Created this deck` (or collection, or wanted list), ahead of any card change made to that list:

```text
? 2 changes this session — select one:
❯   🎯 Scratch: ➕ Added - Black Lotus &1
    🎯 Scratch: Created this wanted list
    ← Back
```

Discarding that entry removes the whole list from the session. It is refused while the list still has card changes (`Cannot discard this change yet — discard this wanted list's 1 card change(s) first`). If you were editing that list, you return to the selection menu. Saving commits the creation, and the entry disappears.

A new deck prompts for its [format](#deck-format) and is written with the same front matter as [`new deck`](/commands/new/). New collections and wanted lists get a `# Title` heading. Files are named as the list is named; see [List file names](/commands/new/#list-file-names). The prompt rejects a name with no usable file-name characters, and a name that would [collide with an existing list](/list-resolution/#names-that-would-collide-are-refused-at-creation), including an unsaved list created earlier in the session.

Lists can be created from the `➕ New …` items in the selection menu, and from the same items in the `Add to which list?` prompt of a [multi-list mode](#multi-list-modes), where the card you were adding goes straight into the new list.

## Switching Lists

Inside a list session, `🔀 Switch List` backs out to the selection menu, keeping the list's unsaved changes in memory. Pressing <kbd>Esc</kbd>/<kbd>Ctrl-C</kbd> at the main card prompt does the same. Reopening a list you already edited resumes where you left off, pending changes and undo history included.

The session filters (sets, finish, condition, entry mode, and the deck target section) are shared across every list you open. The condition applies to decks and collections only; wanted lists have no condition.

## Multi-List Modes

Four menu entries open several lists at once in one session:

| Entry                 | Spans                                   |
| --------------------- | --------------------------------------- |
| `🗃️ All Lists`        | every deck, collection, and wanted list |
| `🎴 All Decks`        | every deck                              |
| `📦 All Collections`  | every collection                        |
| `🎯 All Wanted Lists` | every wanted list                       |

Each behaves like a normal list session with two differences.

**Adding a card asks where it goes.** After you pick a card name (or a collector number), an `Add to which list?` prompt lists every list in scope plus the `➕ New …` items. The list you pick then runs **its own** add flow for the remaining prompts. In `All Lists`, adding to a deck may leave the printing unspecified and ask for a section, while adding the next card to a collection still demands a specific printing:

```text
? Enter card name to add › Sol Ring
? Add to which list? › 🎯 To Buy
? How specific for Sol Ring? › Name only (cheapest printing)
Added: - Sol Ring &2
```

Picking a `➕ New …` item [creates the list](#creating-lists) in memory and adds the card to it, without leaving the mode. A single-type mode offers only its own type's create item:

```text
? Add to which list? ›
❯   🎴 Atraxa
    🎴 Winota
    ➕ New Deck
```

The last-added-card shortcuts (`➕ Add Exact Copy`, `➕ Add Similar Copy`, `📝 Add Note`, `✏️ Edit Previous Card`, `🌐 Change Language`, `↩️ Undo Last Add`) act on the list that card went into, so you are never asked twice.

**Edit mode spans every list in scope.** `🛠️ Switch to Edit Mode` autocompletes over the entries of all those lists, each labelled with its list, and each entry offers the action menu of its own list type. Searching matches the list name too, so typing `binder` narrows to one list:

```text
? Select a card to edit (type to search) › o
❯   🎴 Test Deck: 1 Sol Ring (LEA:161) — Commander &1
    📦 Main Binder: - Lightning Bolt (LEA:161) &1
    🎯 To Buy: - Mox Ruby &1
```

`📋 View Session Changes` likewise pools those lists' changes, labelled by list, and discarding one affects only its own list. There is no `💾 Save current list changes` item here, since every list in scope is "current"; a single save item covers everything, whichever [label](#saving) it carries. **Save writes every open list**, including ones opened outside the current scope.

Changes made in a multi-list mode are ordinary per-list changes. Switching to a single list and back keeps them, and each list is written to its own file with its own changelog entry on save.

## Menu Options

These options appear in the session menu when no search text is typed, in this order. The card you just added comes first, so its shortcuts are nearest; `🚪 Exit` sits at the bottom where you cannot land on it by overshooting.

| Option                                   | Description                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `➕ Add Exact Copy`                      | Add another copy of the last added card, identical options                                                                           |
| `➕ Add Similar Copy`                    | Add a copy of the last added card, re-prompting its options                                                                          |
| `📝 Add Note`                            | Attach a note to the last added card                                                                                                 |
| `✏️ Edit Previous Card`                  | Re-enter the last added card with forced prompts                                                                                     |
| `🌐 Change Language`                     | Re-pick the last added card's [language](#card-language), leaving its printing alone                                                 |
| `↩️ Undo Last Add`                       | Take back the most recently added card                                                                                               |
| `↩️ Undo Last Edit`                      | Revert the most recent [edit-mode](#edit-mode) operation                                                                             |
| `🗂️ Set Target Section`                  | Pin a deck section, create a new one, or prompt for each card (decks)                                                                |
| `🏷️ Change Format`                       | Change the deck's [format](#deck-format) (decks)                                                                                     |
| `🔖 Edit Deck Tags`                      | Edit the deck's front-matter `tags:` (the deck's own, not any card's), comma-separated; empty clears them (decks)                    |
| `🏷️ Edit List Labels`                    | Change the list's default card labels (decks — `proxy` only — and collections); shows the current default                            |
| `🗂️ Rename Category…`                    | Rename a [category](#card-categories) across the open list (all list types)                                                          |
| `🗂️ Reorder Categories…`                 | Set the open list's [category](#card-categories) display order (all list types)                                                      |
| `🌐 Card Language (…)`                   | Change the [language](#card-language) stamped on cards added from here on; shows the current one                                     |
| `⚙️ Configure Session Filters`           | Adjust default sets, finish, condition, and (decks) target section (both entry modes)                                                |
| `🔢 Switch to Collector Number Mode`     | Switch to collector number entry mode (name mode)                                                                                    |
| `🔤 Switch to Name Mode`                 | Switch back to name entry mode (collector mode)                                                                                      |
| `🛠️ Switch to Edit Mode`                 | Browse and edit the list's existing entries (see [Edit Mode](#edit-mode))                                                            |
| `📋 View Session Changes (N)`            | Review every change this session, editing or discarding individual ones                                                              |
| `💾 Save all changes (N across M lists)` | Write every open list's file and changelog, keep editing                                                                             |
| `💾 Save current list changes (N)`       | Write the list you are editing (plus any list receiving its pending [moves](#moving-cards-to-another-list)), keep the rest in memory |
| `🔀 Switch List`                         | Back to the list selection menu, keeping unsaved changes in memory                                                                   |
| `🚪 Exit`                                | Leave the editor (asks to save all, discard all, or cancel when unsaved)                                                             |

Unlike the other type-specific rows, the two `🗂️` category rows appear on every list type, since every list type carries categories.

Some rows appear only when they apply:

- `↩️ Undo Last Add` and `🌐 Change Language` need a card added this session.
- `📝 Add Note` needs the last added card to have no note yet.
- `↩️ Undo Last Edit` needs an [edit-mode](#edit-mode) change to undo.
- `📋 View Session Changes` needs a change to show (see [Reviewing Session Changes](#reviewing-session-changes)).
- Neither language row appears in [edit mode](#edit-mode). The session default only governs adds, and an existing entry's language is one of its own edit actions.

While you are **adding** cards, typing narrows the menu rows along with the card suggestions, and past three characters (or a `:`) the rows step aside entirely. See **Menu Rows Step Aside** under [Name Mode](#name-mode-default).

[Edit mode](#edit-mode) pares this menu down: the undo shortcuts lead, followed by `➕ Switch to Add Mode`, then the review, save, and exit items. Its rows are narrowed by what you type but never step aside, since the entry lines it searches contain colons. With nothing typed, the entries follow the menu rows so the list can be scrolled.

## Saving

Changes accumulate **in memory per list**. Nothing is written to any file as you add or edit cards.

A save rewrites the whole list file in canonical form. Any line the parser could not read (prose, comments, malformed card lines) is dropped, and so is a [fenced code block](/list-format/#fenced-code-blocks), which the canonical form cannot express. Both are printed as warnings when the session loads the list, so check the output before saving a hand-edited file, or run [`cleanup --check`](/commands/cleanup/) first. For an edit that must leave such lines untouched, use the line-preserving one-shot commands: [`set-card`](/commands/set-card/), [`remove-card`](/commands/remove-card/), and [`note`](/commands/note/).

The save actions:

- `💾 Save all changes (N across M lists)` writes every open list's file and appends each list's session changelog while you keep working. Everything saved is committed, and the undo and discard menus reset.
- `💾 Save current list changes (N)` writes only the list you are editing, keeping the other lists' changes in memory. A list receiving cards from its pending [moves](#moving-cards-to-another-list) is saved in the same step, other pending changes included.

The save-current item appears only when the list you are editing has unsaved changes **and** at least one other open list does too. When just one list is dirty, both saves would do the same thing, so a single `💾 Save N change(s) (keep editing)` item is shown, even when that dirty list is not the one you are in. In a [multi-list mode](#multi-list-modes) there is no current list, so the save-current item is never shown.

The counts track card changes. Pending work that is not a card change (a changed [deck format](#deck-format), edited deck tags, or an edited list [default-labels block](/list-format/#default-labels-and-descriptions)) still surfaces the save items but is left out of the counts. A list whose only pending work is such an edit shows count-less labels (`💾 Save changes (keep editing)`, `💾 Save current list changes`, `💾 Save all changes (M lists)`).

Saving repeatedly in one session does **not** create a new changelog entry per save. Later changes are folded into the list's existing entry (bumping its timestamp), so one session is one changelog entry per list.

`🚪 Exit` (from a session or the selection menu) opens the exit menu when anything is unsaved: **Save and exit** writes every open list, **Exit without saving** discards every open list's pending changes, and **Cancel** keeps editing.

## Entry Modes

Two entry modes are available while adding cards, and you can switch between them at any time.

### Name Mode (default)

Type a card name and select from the suggestions.

What you type is split on whitespace, and **every term must appear in the card name**, in any order. `in tre` finds "In the Trenches", and `bolt light` finds "Lightning Bolt". Case, accents, and punctuation don't have to match (`jaces archivist` finds "Jace's Archivist").

Suggestions are ordered by EDHRec popularity, with closer matches first:

1. A card whose **whole name** you have typed (the front face of a double-faced card counts). Searching `The En` lists popular cards first; finishing the name as `The End` puts "The End" at the top.
2. Cards your query prefixes.
3. Cards whose **words your terms begin**. This puts "In the Trenches" at the top of `in tre`, ahead of the 80 cards that merely contain those letters.
4. Everything else that contains the terms.

- **Session Filters**: `⚙️ Configure Session Filters` sets default set codes, finish, condition, and (for decks) the target section. Once set, they apply to each card without prompting.
- **Menu Rows Step Aside**: the menu shortcuts lead the suggestions while you have typed at most three characters. Past that, or as soon as the input contains a `:`, the list is card matches only. Menu rows are still reachable by their first few letters (`sav`, `exi`), though the two `💾 Save…` rows share a prefix and can only be told apart with the arrow keys. The same rule applies in [collector number mode](#collector-number-mode).
- **Force Prompts**: append `!` to a card name to force the finish/condition prompts for that entry, overriding the session filters.
- **Edit Previous Card**: re-enter the most recently added card with forced prompts, to correct a mistake.

If no printings can be found for a chosen card, decks and wanted lists fall back to a name-only entry. Collections skip the card, since a collection entry requires a printing.

### Collector Number Mode

Look up printings by **set code and collector number**, across every printing in your local card cache. `🔢 Switch to Collector Number Mode` switches into it, and `--collector` starts a session there. Rows read `MKM:123 — Card Name`, ordered by set code and then collector number.

The search matches only the set code and the collector number. **Card names are not matched in this mode**; `🔤 Switch to Name Mode` is one row away when you want them. Type either half, in either order:

| You type  | Matches                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `mkm:123` | set codes containing `mkm`, collector numbers starting with `123`                   |
| `mkm 123` | nearly the same — a space separates the terms, but `123` may still match a set code |
| `123 mkm` | the same again — terms are searched independently, so order never matters           |
| `mkm:`    | every printing in a set code containing `mkm`                                       |
| `:123`    | collector number `123` (and `1230`…) in every set                                   |
| `se 456`  | `456`… in **every** set code containing `se` — a half-typed code still works        |
| `123`     | one bare token: set codes containing it, or numbers starting with it                |

Each whitespace-separated term is classified on its own and all of them must match, so a third term narrows further. An **all-letter** term searches set codes only, since a collector number effectively always carries a digit. Any other term searches both halves, because numeric set codes (`2XM`, `40K`, `10E`) and letter-bearing collector numbers (`123a`, `M10-146`) are both common. A colon overrides the guess for the terms it joins: `:2xm` searches collector numbers only, `284:` searches set codes only, and a term further out keeps its own classification (`123 mkm:12` narrows a `123` already typed).

Set codes match on **substring** and collector numbers on **prefix**, or exactly once leading zeros are trimmed from both sides (`012` finds `12`). The same query grammar filters the sites' printing pickers: the [add-card grid](/admin/editors/#step-2-select-printing) in both editors, the [Swap Printings wizard](/admin/editors/#swap-printings), and the [Trade Planner picker](/public-site/trade/).

- **Narrowing the pool**: the `⚙️ Configure Session Filters` set filter restricts collector mode to particular sets. Changing it rebuilds the printing pool.
- **Building the pool**: the first collector-mode prompt of a session pauses to build the row list (`Loading printings for collector number search...`, then `Loaded N printings.`). With no set filter that is every printing in the cache, so expect a short wait the first time. The pool is reused for the rest of the session across every open list; only a change to the set filter rebuilds it, so a printing that enters the cache mid-session will not appear until then.
- **Printings**: a collector-number row already identifies one printing, so the add flow skips the printing picker, and with it the picker's language-availability check. Under a non-English [session language](#the-session-language) the entry is stamped with that language whether or not the printing exists in it. Add through [Name Mode](#name-mode-default) when you want the fallback-to-English confirmation.

### Printing and Finish Prices

Once a card is chosen in [Name Mode](#name-mode-default), the `Select Printing:` list shows each printing's price in your configured [`defaultCurrency`](/configuration/#default-currency), aligned in right-hand columns. (Collector-number entry already identifies one printing, so it goes straight to the finish prompt.)

```
? Select Printing: ›
❯   Marvel Super Heroes Commander (MSC) #211 [uncommon]  $1.85  $4.20 foil
    Secrets of Strixhaven Commander (SOC) #427 [mythic]         $14.93 foil  $22.00 etched
    Secret Lair Drop (SLD) #2683 [rare]                  N/A
```

Each printing is quoted in **every finish it comes in**, one column per finish: nonfoil first, then foil and etched. A column appears only when some printing in the list has that finish. Non-nonfoil prices are tagged with the finish (`$14.93 foil`) so they never read as a nonfoil price, and a printing that lacks a column's finish leaves that cell blank. `N/A` (or `N/A foil`) means the card cache has no price for that printing and finish in that currency.

The currency affects the columns. `tix` collapses to one untagged column, since MTGO prices every finish the same. An `eur` etched column often reads `N/A`, since Scryfall publishes `eur_etched` only for the few etched printings Cardmarket quotes (see [How Cards Are Priced](/commands/price/#how-cards-are-priced)).

Typing filters the list by set code, set name, collector number, and rarity, never by price, so a number always searches collector numbers.

The finish prompts price the same way, so you can see what a foil or etched copy costs before picking it: `Select Finish:` when adding a card, and `✨ Change Finish` in [Edit Mode](#edit-mode):

```
? Select Finish: › - Use arrow-keys. Return to submit.
❯   Nonfoil  $1.85
    Foil     N/A
```

A wanted list's `No preference (any finish)` choice covers every finish, so it shows no price. An entry whose pinned printing is missing from the card cache shows no price column at all. An `Etched` row is often `N/A` under `eur`, for the reason above.

Prices come from the local card cache, so they are as fresh as your last [cache refresh](#cache-freshness).

## Edit Mode

`🛠️ Switch to Edit Mode` repurposes the search prompt to autocomplete over the list's **existing entries**, shown as their canonical lines. With nothing typed, the whole list is shown below the menu rows so you can scroll it; typing narrows it. Selecting an entry opens an action menu that depends on the list type.

For a **deck** line:

| Action                     | Description                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `🖼️ Change Printing`       | Pick a new printing, finish, and condition for the line (reads `🖼️ Set Printing` when the line pins none yet) |
| `➕ Add a Copy`            | Increment the line's quantity                                                                                 |
| `➖ Remove a Copy`         | Decrement the line's quantity (multi-copy lines only); keeps the `&N` id                                      |
| `🌐 Change Language`       | Pick the line's [language](#card-language) (`en` removes the token)                                           |
| `🏷️ Change Label`          | Set the line's [label override](#card-labels) to **Proxy**, or revert to the deck's default                   |
| `🔖 Edit Tags`             | Edit the line's [tags](#card-tags) in one field (empty clears them)                                           |
| `🎨 Set Custom Art`        | Set or clear the line's [custom art](#custom-art) (an image URL, or a file from the art directory)            |
| `🗂️ Edit Categories`       | Set the line's [categories](#card-categories) in this list (comma-separated; empty clears them)               |
| `🗂️ Move to Section`       | Move the line to another section (or a new one)                                                               |
| `📤 Move to Another List`  | Move every copy of the line to a different list (see [Moving Cards](#moving-cards-to-another-list))           |
| `📝 Edit Note`             | Edit or clear the line's note                                                                                 |
| `🗑️ Remove Card`           | Delete a single-copy line (asks for confirmation); releases its `&N` id                                       |
| `🗑️ Remove All Copies (N)` | Delete all N copies of a multi-copy line (asks for confirmation); releases the id                             |

For a **collection** entry:

| Action                    | Description                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `🖼️ Change Printing`      | Pick a new printing, finish, and condition for the entry                                                        |
| `✨ Change Finish`        | Switch between `nonfoil`, `foil`, and `etched`                                                                  |
| `📋 Change Condition`     | Switch between `NM`, `LP`, `MP`, `HP`, and `DMG`                                                                |
| `🌐 Change Language`      | Pick the entry's [language](#card-language) (`en` removes the token)                                            |
| `🏷️ Change Label`         | Set the [label override](#card-labels) (For sale / For trade / both / To keep / Proxy) or revert to the default |
| `🔖 Edit Tags`            | Edit the entry's [tags](#card-tags) in one field (empty clears them)                                            |
| `🎨 Set Custom Art`       | Set or clear the entry's [custom art](#custom-art) (an image URL, or a file from the art directory)             |
| `🗂️ Edit Categories`      | Set the entry's [categories](#card-categories) in this list (comma-separated; empty clears them)                |
| `📤 Move to Another List` | Move the entry to a different list (see [Moving Cards](#moving-cards-to-another-list))                          |
| `📝 Edit Note`            | Edit or clear the entry's note                                                                                  |
| `🗑️ Remove`               | Delete the entry (asks for confirmation); releases its `&N` id                                                  |

For a **wanted list** entry:

| Action                    | Description                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `🖼️ Change Printing`      | Re-pick the specificity: name-only, or a specific printing with optional finish (reads `🖼️ Set Printing` for a name-only entry) |
| `✨ Change Finish`        | Switch between `nonfoil`, `foil`, `etched`, or no preference (printed entries only)                                             |
| `🌐 Change Language`      | Pick the entry's [language](#card-language) (`en` removes the token)                                                            |
| `🔖 Edit Tags`            | Edit the entry's [tags](#card-tags) in one field (empty clears them)                                                            |
| `🎨 Set Custom Art`       | Set or clear the entry's [custom art](#custom-art)                                                                              |
| `🗂️ Edit Categories`      | Set the entry's [categories](#card-categories) in this list (comma-separated; empty clears them)                                |
| `📤 Move to Another List` | Move the entry to a different list (see [Moving Cards](#moving-cards-to-another-list))                                          |
| `📝 Edit Note`            | Edit or clear the entry's note                                                                                                  |
| `🗑️ Remove`               | Delete the entry (asks for confirmation); releases its `&N` id                                                                  |

Every edit is undoable with `↩️ Undo Last Edit` (newest first). Undoing a removal restores the entry with its original `&N` id when the id has not been reused. Edits are folded into the session changelog with "latest wins" semantics: changing a card and then changing it back leaves no changelog entry, and removing a card that was added this session simply cancels the add. `➕ Switch to Add Mode` returns to the add flow; you can toggle between the two modes freely.

## Moving Cards to Another List

`📤 Move to Another List` sends a card from the list being edited to any other list, including one created earlier in the session. A deck line moves with **all of its copies**, each arriving as one physical card (deck destinations merge copies onto an existing matching line). A **name-only** card headed into a collection first runs the printing picker, since every collection line pins a printing; cancelling the picker cancels the move.

Like every session edit, the move is **deferred until you save**. The card leaves the in-memory list immediately (recorded as a `Moved … to …` changelog entry), and the destination receives it when the source list is saved. `↩️ Undo Last Edit` or discarding the change from `📋 View Session Changes` takes the whole move back, and exiting without saving moves nothing. On save:

- A destination that is open in the editor receives the card in memory and is saved in the same step, along with its other pending changes. Its _own_ pending moves commit too, so a chain of moves resolves in one save.
- Any other destination's file is written directly, exactly as [`ritual move`](/commands/move/) writes it, with a `Moved … from …` entry in its changelog.
- The destination line gets a fresh `&N` id, and the source id is released.

A new line at a deck destination lands in the deck's default section (the first non-Commander, non-Sideboard section, creating `Main` if there is none). The move never prompts for a section. The action refuses up front when the edited list is the only list, or when a name-only card is headed into a collection and the printing picker finds nothing.

If a destination cannot be written at save time (its file was deleted, a deck destination has unreadable lines, or a printing-less card cannot enter a collection), the save is refused and the source list stays unsaved with its session intact. Saving from the exit menu then keeps the editor open rather than discarding the changes.

What follows a moved card:

- **Note**: no. Notes never move across lists, and the CLI warns when one is left behind.
- **[Label override](#card-labels)**: no. (The one-shot [`ritual move`](/commands/move/) carries it as far as the destination type can express it.)
- **[Tags](#card-tags)**: yes, on every path, since every list type carries them.
- **[Custom art](/custom-art/#art-follows-the-card)**: yes. The entry leaves the source list's `.art.json` and is re-filed under the destination line's new `&N`, unless the copy merged onto a line the destination already had, which keeps its own art.
- **[Categories](#card-categories)**: no. A category belongs to a card _name in one list_, so the destination inherits nothing. The save also prunes the source list's `<list>.categories.json` of any name the source no longer holds. It skips that pruning for a list with a bullet the card-line grammar could not read.

## Card Labels

Labels (`[proxy]`, `[sale,trade]`, `[keep]`) are a card-line token described on [List Files](/list-format/#card-labels). In a session, `🏷️ Change Label` in [edit mode](#edit-mode) sets a card's override, offering only what the list type carries (on a deck, **Proxy** or the list default), and **Use list default** clears it. `🏷️ Edit List Labels` on the list menu sets the list's front-matter [default](/list-format/#default-labels-and-descriptions), deferred to the next save like any other edit. A proxied card [carries no price](/list-format/#proxies-carry-no-price).

## Card Tags

Tags (`#Ramp, Staple` on the line) are described on [List Files](/list-format/#card-tags). `🔖 Edit Tags` in [edit mode](#edit-mode) opens one free-text field prefilled with the line's current tags, **comma-separated** (`My Tag, My Other Tag` is two tags). An input the grammar refuses is reported and asked again; empty clears every tag. The change is recorded as one changelog event per tag that actually changed, and `↩️ Undo Last Edit` reverts the whole field edit at once. Copies added with different tags land on their own line rather than folding into an existing one.

## Card Categories

A card entry on **any** list type can carry **categories**: its role in _this_ list (`Ramp`, `Removal`, `Board Wipes`), what Archidekt calls a category and Moxfield a tag. Unlike a tag, a category belongs to the card's **name** rather than to the copy. One assignment covers every line of that name in the list, it is never written on the card line, and it does **not** follow the card to another list. Categories are ordered, and the first is the card's **primary** category, which the site groups by. They live in the list's `<list>.categories.json` file; see [the list format](/list-format/#categories-namecategoriesjson).

`🗂 Edit Categories` in [edit mode](#edit-mode) opens one free-text field prefilled with the card's current categories, **comma-separated** (`Ramp, Artifacts` is two categories, with `Ramp` primary). An input the grammar refuses is reported and asked again; empty clears them. The list's vocabulary (its declared order, then the configured [`defaultCategories`](/configuration/)) is printed above the prompt as a hint.

The edit is recorded as **one** `set-categories` event per card, a whole-list replacement (`Set categories of "Sol Ring" to Ramp, Artifacts`, or `Cleared categories of "Sol Ring"`). It is latest-wins: repeated edits of one card consolidate into the last one, and setting a card back to what it had when the session opened leaves nothing in the changelog. `↩️ Undo Last Edit` reverts it like any other edit.

The list menu carries two list-level rows, on all three list types:

| Row                     | What it does                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `🗂 Rename Category…`    | Pick a category from the list's vocabulary and type its new name — renamed on every card carrying it, each card's own order preserved |
| `🗂 Reorder Categories…` | Retype the vocabulary in the order you want it displayed                                                                              |

Both are recorded in the changelog (`Renamed category "Draw" to "Card Draw"`, `Set category order to Ramp, Draw, Removal`). Neither is on the undo stack, since an undo entry names a card and these name none; `🔖 Edit Deck Tags` and `🏷️ Edit List Labels` follow the same rule.

Nothing is written until the session is saved. The save writes the categories file and its `.sha256` beside the list file, and **prunes** it: a card name the list no longer holds loses its entry, and the save says which names it dropped. A categories file the save cannot read is reported and left as it is, so a hand-broken file is never silently overwritten.

One-shot equivalents outside a session: [`set-card --categories` / `--no-categories`](/commands/set-card/#category-updates) for one card, and [`ritual categories`](/commands/categories/) for the list's vocabulary.

## Custom Art

`🎨 Set Custom Art` gives the selected card a picture of its own (a proxy scan, an altered card, commissioned art), shown in place of the printing's Scryfall image on the site and in the editors. It is available on **every** list type and any card; a proxy label is not required, and neither implies the other. The prompt names what the card wears now and offers:

| Choice                  | What it does                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `🔗 Enter an Image URL` | Type an absolute `http`/`https` URL, used verbatim                            |
| `📁 Pick a Local File`  | Browse the [art directory](/custom-art/#the-art-directory) for an image       |
| `🚫 Clear Custom Art`   | Drop the reference so the real printing shows again (offered when it has one) |

A `← Cancel` row (or Esc) backs out of any step without changing anything.

The file browser walks the art directory one level at a time: `📁` rows descend, the leading `⬆️ ..` row goes back out, and `🖼️` rows pick the image. Typing filters the visible rows. Only the extensions Ritual serves (`.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp`) are listed, and dot-entries are hidden. A missing art directory is reported by name rather than opening an empty picker.

Whichever way you answer, the value is validated by the same parser [`set-card --art`](/commands/set-card/#custom-art) and the admin dialog use, so the editor accepts exactly what they do.

Like every other session edit, an art edit is **deferred**. It is staged in memory and written to the list's `.art.json` [file](/custom-art/#the-sidecar) by the save that writes the card lines, so exiting without saving changes nothing. `↩️ Undo Last Edit` puts the previous reference back, and `📋 View Session Changes` lists it as `custom art on <card>`. The card **line** is untouched. Custom art is list metadata, so it produces no change event and no changelog entry; the only sign a save is pending is the editor's own unsaved-changes state.

Removing a card releases its `&N`, and the art filed under that number goes with it, since the next card added would otherwise inherit the picture. Undoing the removal brings both back, as long as the id has not been reused. If a card added in the meantime took that `&N`, the undo restores the card under a fresh id and the art stays dropped. Art staged for a card and then removed with it is gone for the same reason.

A card with custom art also [carries no price](/custom-art/#custom-art-carries-no-price), the same rule the `proxy` label follows; `custom-art` wins when a card has both.

## Card Language

Every card entry has a [language](/list-format/#card-language) token (`[ja]`), omitted for English. Adding a card never prompts for one: the [session's current language](#the-session-language) is stamped on new cards, and the `🌐 Change Language` edit action changes an individual copy afterwards. Under a non-English session language, the printing picker notes printings that do not exist in that language and records the copy in the language that does exist (English when available).

### The Session Language

A session starts on the configured [`defaultLanguage`](/configuration/#default-language). When the key is absent it starts in English and says so once on startup. Two menu rows move it:

- `🌐 Card Language (English)` sets the language for **every card added from here on**, across every list the session has open. It shows the current language, and the change applies only to this session; use [`ritual config set defaultLanguage <code>`](/configuration/#default-language) to make it stick.
- `🌐 Change Language (Sol Ring)` re-picks the language of the card you **just added**, without re-asking for its printing, finish, or condition the way `✏️ Edit Previous Card` does. It appears only once a card has been added this session.

Adding another copy never re-asks either. `➕ Add Similar Copy` uses the current session language, and `➕ Add Exact Copy` reproduces the copied card's line exactly, language included, even if the session language has moved since. The same language picker is reachable for any card from [Edit Mode](#edit-mode) and from [the session-changes screen](#reviewing-session-changes).

Using `🌐 Change Language` counts as editing the last added card, so the last-added shortcuts reset until you add another card. Change it again from [Edit Mode](#edit-mode) or the session-changes screen.

## Reviewing Session Changes

`📋 View Session Changes` opens a picker listing every change made this session: `➕` adds, `✏️` field edits, `🗑️` removals, and `📤` [moves](#moving-cards-to-another-list). Selecting an entry opens an action menu:

| Action                           | Description                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `✏️ Edit This Card`              | Open the card's own [edit-mode action menu](#edit-mode) — printing, finish, note, and the rest |
| `🌐 Change This Card’s Language` | Go straight to the [language](#card-language) picker for that card                             |
| `🗑️ Discard This Change`         | Take the change back out of the session                                                        |
| `← Back`                         | Return to the change list without doing anything                                               |

The two edit rows appear only while the change's card is **still in the list, under the same name**. A removal, a completed [move](#moving-cards-to-another-list), a list's own [creation](#creating-lists), and a card whose `&N` has since been reissued all leave nothing to edit, so those offer the discard alone. A change that cannot be discarded yet (see below) can still be edited.

Discarding reverts just that change and keeps the rest of the session:

- **Discarding an add** removes the card and frees its `&N` id. The remaining cards added this session keep dense, in-order ids (each later card slides down one, and the highest id returns to the pool). Because this renumbers ids, it also clears the edit-undo history. On a deck, discarding one copy of a multi-copy line just decrements the quantity and keeps its id.
- **Discarding an edit or removal** reverts that operation in place. When several changes touch the **same card**, they must be discarded newest-first; the picker tells you which one blocks an older change.
- **Discarding a list's creation** removes the whole list from the session (see [Creating Lists](#creating-lists)). It is blocked until the list's own card changes are discarded.

Everything already saved is committed and no longer appears in the viewer. The viewer covers the **current list**; switch lists to review another list's changes. In a [multi-list mode](#multi-list-modes) it covers every list in scope, each entry labelled with its list.

## Decks

### Deck Sections

Every deck card is added under a `## Section Name` (H2) header. The **target section** controls where new cards land:

- **Prompt every time** (default): you pick an existing section or create a new one per card.
- **A pinned section**: set with `--section`, the `🗂️ Set Target Section` menu, or the session filters. All later cards go there until you change it.

Adding a card whose **printing already exists anywhere in the deck** increments that entry's quantity instead of creating a new line, matching the admin Deck Editor and [`add-card`](/commands/add-card/). A different printing of the same card gets its own entry.

### Deck Format

Every deck records a format (Commander, Standard, Modern, …) in its `format:` front matter field, which the generated site uses for the deck's cover label and expected size. Creating a deck in the editor prompts for the format, and `🏷️ Change Format` changes it later. The menu item shows the current format, and the change is written on the next save like any other pending edit. It counts as unsaved work but is not a card change, so it appears in neither the changelog nor the session-changes viewer.

`🔖 Edit Deck Tags` edits the deck's `tags:` and `🏷️ Edit List Labels` its [default card labels](/list-format/#default-labels-and-descriptions) the same deferred way. The description and sync-source fields have no session action. Use [`ritual metadata`](/commands/metadata/) (or the admin metadata editor) for either, or [`deck-sync link`](/commands/deck-sync/) to link a sync source interactively.

A deck with no `format:` (an older file, or one imported from a source that reports no format) is read as Commander when it has a `## Commander` section, or Oathbreaker for a `## Oathbreaker` or `## Signature Spell` section. That is what the menu shows and what the site displays, and saving the deck writes the resolved format into the file. See [new](/commands/new/#deck-format) for the full list of formats.

### Deck Files

Cards are written to a markdown deck file in the `decks/` directory under their section headers:

```
---
format: commander
---

# Winota Stax

## Commander

- 1 Winota, Joiner of Forces (IKO:215) &1

## Main

- 1 Sol Ring (LTC:284) &2
- 4 Lightning Bolt (LEA:161) &3
```

The `# Title` heading names the deck, and each card line is a `- ` bullet followed by the quantity. Non-foil finish, `NM` condition, and English are omitted. The full line grammar and the `&N` card IDs are on [List Files](/list-format/#card-lines).

## Collections

### Collection Files

Each card entry is written to a markdown collection file in the `collections/` directory, one line per copy (see [List Files](/list-format/#card-lines) for the grammar). For example:

```
- Sol Ring (C19:221) [foil] &1
- Lightning Bolt (LEA:161) [LP] [keep] #Binder A &2
- Mana Crypt (2XM:270) [foil] [ja] [sale,trade] &3
```

Non-foil finish, `NM` condition, and English are omitted, as on deck lines. A "Don't Care" condition choice is treated as `NM` and not written. The note is optional and can be added after entry via `📝 Add Note`; notes are shown in the card detail modal on the generated site.

The optional `[labels]` token is the card's [label override](/list-format/#card-labels). [`ritual move`](/commands/move/) carries it as far as the destination type can express it: another collection keeps all of it, a deck keeps `proxy` and drops the rest, a wanted list keeps none. The editors' **Move to list…** / `📤 Move to Another List` flow drops it in every case, as it does notes.

## Wanted Lists

### Card States

A wanted card is name-only, pinned to a printing, or fully specified with a finish; see [Wanted-list card states](/list-format/#wanted-list-card-states) for how each is priced. When adding a card to a wanted list, you choose the specificity:

1. **Name only (cheapest printing)** skips printing and finish selection.
2. **Choose specific printing** enters the printing selection flow, then optionally a finish.

### Wanted List Files

Each card entry is written to a markdown file in the `wanted/` directory, one line per copy. For example:

```
- Sol Ring &1
- Lightning Bolt (LEA:161) &2
- Mana Crypt (2XM:270) [foil] &3
- Black Lotus (LEB:233) {birthday present to self} &4
- Fblthp, the Lost (WAR:50) [ja] &5
- Mox Ruby #Budget, Reserved List &6
```

Set/collector number and finish can each be omitted, depending on the [specificity level](#card-states). Wanted lines carry no condition and no labels, but do carry a [language](/list-format/#card-language) token, [tags](/list-format/#card-tags), and an optional note. See [List Files](/list-format/#which-tokens-each-type-accepts).

## Sections

Collections and wanted lists can be split into named **sections** with `## Section Name` (H2) headers beneath the `# Title`; see [Title and sections](/list-format/#title-and-sections).

```
# My Binder

## Trade Binder
- Sol Ring (C19:221) [foil] &1

## Keep
- Lightning Bolt (LEA:161) &2
```

Section order is preserved as written. Cards added in an `edit` session go to the file's **last** section. Sections are managed from the [admin editors](/admin/editors/#sections); pricing commands ignore section headers.

## Examples

Start the editor at the list selection menu:

```bash
ritual edit
```

Jump straight into a list, a deck by file name or any list with a type prefix:

```bash
ritual edit Burn
ritual edit collection:Binder
```

A cataloging session with defaults, hopping between a collection and a wanted list:

```bash
ritual edit --sets "FDN" --finish nonfoil --condition NM
```

Build a deck's sideboard without per-card section prompts:

```bash
ritual edit --section Sideboard
```

Collector-number entry, narrowed to two sets. The `--sets` filter is optional; without it the search covers every printing in the cache:

```bash
ritual edit --collector --sets "FDN, SPG"
```

## Exit Codes

The failure codes apply only to startup: [opening a list directly](#opening-a-list-directly), the interactivity requirement, and an empty card cache. Once open, the editor always exits `0`.

| Code | Meaning                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Editor exited normally                                                                                                                                                            |
| `1`  | Runtime error (the card cache is empty and was not downloaded, or `--sets` filters the card names down to nothing)                                                                |
| `2`  | Usage error (conflicting type flags, a type prefix contradicting a type flag, `[listName]` matched more than one list, or prompts are unavailable — no terminal, or `--no-input`) |
| `3`  | Not found (`[listName]` matched nothing, or no lists exist in the searched scope)                                                                                                 |
