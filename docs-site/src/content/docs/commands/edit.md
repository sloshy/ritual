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
ritual edit [listName] [options]
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
| `--deck`                      | Resolve the name as a deck                                                                                            |
| `--collection`                | Resolve the name as a collection                                                                                      |
| `--wanted`                    | Resolve the name as a wanted list                                                                                     |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)                                                             |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`                                                                        |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`                                                                   |
| `--section <name>`            | Add deck cards to this section (otherwise you are prompted)                                                           |
| `--collector`                 | Start in collector number mode (search printings by `SET:CN`)                                                         |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results                                                                  |
| `--refresh <mode>`            | Card cache refresh policy: `ask` (default — prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never` |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper
printings. Options can be combined; `--collector` needs no sets of its own, since
[collector number mode](#collector-number-mode) searches every printing in the card cache — pass
`--sets` alongside it only to narrow that pool. The type flags only matter together with
`[listName]`; without it they are ignored, since the selection menu already covers every type.

## Opening a List Directly

`ritual edit <listName>` opens that list's editing session immediately, skipping the selection
menu. The name is resolved across all three list types with the shared
[list resolution](/list-resolution/) rules (case- and accent-insensitive, exact match
first, then a unique substring). Narrow the search with a type flag, or with a
`deck:` / `collection:` / `wanted:` prefix on the name itself. The prefix supplies the type when no
flag is given; a prefix that **contradicts** the flag is a usage error (exit `2`) naming both:

```bash
ritual edit Burn                # any list named Burn
ritual edit "To Buy" --wanted   # only wanted lists are searched
ritual edit collection:Binder   # prefix form of the same idea
```

Once open, the session behaves exactly as if you had picked the list from the menu: the same
session filters apply, and `🔀 Switch List` (or <kbd>Esc</kbd>) backs out to the normal selection
menu rather than quitting, so a direct open can still grow into a multi-list session.

A name that matches nothing (or more than one list) fails with an error before the editor starts —
see [Exit Codes](#exit-codes).

:::note
The name is matched against the list's **file name** (without `.md`), like every other command. The
selection menu, by contrast, shows decks by their **display name** (the `# Title` heading) — so a deck whose title differs from its file name is addressed here by the file name. A
deck at `decks/old-burn.md` titled `Modern Burn` opens with `ritual edit old-burn`, not
`ritual edit "Modern Burn"`.
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

When the cache is **empty** the session cannot start at all, so the same policy decides the one-off
download that fills it: `ask` offers it (default yes; naming the English-only `default_cards` bulk,
or the every-language `all_cards` bulk when `defaultLanguage` is not `en`), `auto` downloads it
without asking, and `no-bulk` / `never` skip the offer — the session then fails with the
`ritual cache preload-all` advice.

## The List Selection Menu

On startup (and whenever you back out of a list) you pick what to edit next:

- `🗃️ All Lists`, `🎴 All Decks`, `📦 All Collections`, `🎯 All Wanted Lists` — edit several lists at
  once, without switching between them (see [Multi-List Modes](#multi-list-modes)). Each is offered
  only when it spans at least two lists, and `All Lists` is skipped when every list is of the same
  type (it would open the same session as that type's own entry).
- Every **deck** (`🎴`, by display name), **collection** (`📦`), and **wanted list** (`🎯`) on disk,
  plus any list created this session. Lists with unsaved changes show a `— N unsaved change(s)`
  badge, and a list that does not exist on disk yet is badged `— new`. Decks are listed by their
  display name (the `# Title` heading), which is what an older or hand-renamed deck's
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
? 2 changes this session — select one:
❯   🎯 Scratch: ➕ Added - Black Lotus &1
    🎯 Scratch: Created this wanted list
    ← Back
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
[collide with an existing list](/list-resolution/#names-that-would-collide-are-refused-at-creation)
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
`🌐 Change Language`, `↩️ Undo Last Add`) all act on the list that card went into, so you are never
asked twice.

**Edit mode spans every list in scope.** `🛠️ Switch to Edit Mode` autocompletes over the entries of
those lists at once, each labelled with the list it belongs to, and each entry offers the action menu
of its own list type. Searching matches the list name too, so typing `binder` narrows to one list:

```text
? Select a card to edit (type to search) › o
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

Unlike the other type-specific extra rows, the two `🗂️` category rows appear on decks, collections
and wanted lists alike — every list type carries categories.

The `↩️ Undo Last Add` option appears only after you have added at least one card this session, and
`📋 View Session Changes` once the session has any change to show (see
[Reviewing Session Changes](#reviewing-session-changes)). `🌐 Change Language` likewise needs a card
to have been added — it retargets that one card.

While you are **adding** cards — in either [name](#name-mode-default) or
[collector number](#collector-number-mode) mode — typing narrows the menu along with the cards, but
only briefly: once your input passes three characters, or contains a `:`, the menu rows step out of
the suggestions entirely and leave the list to the card matches.

Neither language row appears in [edit mode](#edit-mode): the session default only governs adds, and
editing an existing entry's language is one of that entry's own actions there.

[Edit mode](#edit-mode) pares this down: the undo shortcuts lead, followed by `➕ Switch to Add Mode`,
then the review, save, and exit items. Its menu rows are narrowed by what you type but never step
aside — the entry lines it searches are full card lines with colons in them, so no input length means
"stop offering the menu" there. And with nothing typed the entries follow the menu rows rather than
being held back, so the list can be scrolled.

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
  lists' changes in memory — except that any list receiving cards from its pending
  [moves](#moving-cards-to-another-list) is saved in the same step (unrelated pending changes
  included).

The save-current item appears only when the list you are editing has anything unsaved **and** at
least one other open list does too. When just one list has anything unsaved, saving all and saving
the current list are the same thing, so a single `💾 Save N change(s) (keep editing)` item is
shown — even when that one dirty list is not the one you are currently in. In
a [multi-list mode](#multi-list-modes) there is no current list to single out, so the save-current item
is never shown.

The counts track card changes. Pending work that is not a card change — a changed
[deck format](#deck-format), edited deck tags, or an edited list
[default-labels block](#card-labels) — still surfaces the save items, but is left out
of the counts: a list whose only pending work is such an edit shows count-less labels instead
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
- **Menu Rows Step Aside** — The menu shortcuts lead the suggestions while you have typed at most
  three characters (or nothing at all); past that — or as soon as the input contains a `:` — they
  drop out and the list is card matches only. Menu rows are still reachable by their first few
  letters (`sav`, `exi`), though two rows sharing a three-letter prefix (both `💾 Save…` items) can
  only be told apart with the arrow keys. The same rule applies in
  [collector number mode](#collector-number-mode).
- **Force Prompts** — Append `!` to a card name to override the finish/condition session filters
  for that entry, forcing the prompts to appear regardless of filter settings.
- **Edit Previous Card** — Re-enter the most recently added card with forced prompts, useful for
  correcting mistakes.

If no printings can be found for a chosen card, decks and wanted lists fall back to a name-only
entry rather than dropping the card; collections skip it (a collection entry requires a printing).

### Collector Number Mode

Look up printings by **set code and collector number**, across every printing in your local card
cache. `🔢 Switch to Collector Number Mode` switches straight into it — there are no set codes to
choose first — and `--collector` starts a session there. Rows read `MKM:123 — Card Name`, ordered by
set code and then by collector number.

The search only ever matches the set code and the collector number; **card names are not matched in
this mode** (`🔤 Switch to Name Mode` is one row away when you want them). Type either half, in
either order:

| You type  | Matches                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `mkm:123` | set codes containing `mkm`, collector numbers starting with `123`                   |
| `mkm 123` | nearly the same — a space separates the terms, but `123` may still match a set code |
| `123 mkm` | the same again — terms are searched independently, so order never matters           |
| `mkm:`    | every printing in a set code containing `mkm`                                       |
| `:123`    | collector number `123` (and `1230`…) in every set                                   |
| `se 456`  | `456`… in **every** set code containing `se` — a half-typed code still works        |
| `123`     | one bare token: set codes containing it, or numbers starting with it                |

Each whitespace-separated term is classified on its own and all of them must match, so a third term
narrows further rather than being ignored. An **all-letter** term searches set codes only — a
collector number effectively always carries a digit somewhere. Any other term searches both halves,
since numeric set codes (`2XM`, `40K`, `10E`) and letter-bearing collector numbers (`123a`,
`M10-146`) are equally routine. A colon overrides the guess for the
terms it joins: `:2xm` searches collector numbers and nothing else, `284:` searches set codes only,
and a term further out keeps its own classification — `123 mkm:12` narrows a `123` already typed.

Set codes match on **substring** (so a half-typed code still finds its sets) and collector numbers on
**prefix**, or exactly once leading zeros are trimmed from both sides (`012` finds `12`). The same query
grammar filters the sites' printing pickers: the
[add-card grid](/admin/editors/#step-2-select-printing) in both editors, the
[Swap Printings wizard](/admin/editors/#swap-printings), and the
[Trade Planner picker](/public-site/trade/).

- **Narrowing the pool** — The ordinary `⚙️ Configure Session Filters` set filter is what restricts
  collector mode to particular sets; changing it rebuilds the printing pool.
- **Building the pool** — The first collector-mode prompt of a session pauses to build the row list
  (`Loading printings for collector number search...`, then `Loaded N printings.`). With no set
  filter that is every printing in the cache, so expect a moment's wait the first time. The pool is
  then reused for the rest of the session across every open list, and only a change to the set
  filter rebuilds it — a printing that enters the cache mid-session will not appear until then.
- **Printings** — A collector-number row already identifies one printing, so the add flow skips the
  printing picker entirely. That also skips the picker's language-availability check: under a
  non-English [session language](#the-session-language) the entry is stamped with that language
  whether or not the printing exists in it. Add through [Name Mode](#name-mode-default)
  when you want the fallback-to-English confirmation.

### Printing and Finish Prices

Once a card is chosen in [Name Mode](#name-mode-default), the `Select Printing:` list shows each
printing's price in your configured [`defaultCurrency`](/configuration/#default-currency), aligned in
right-hand columns. (Collector-number entry already identifies one printing, so it goes straight to
the finish prompt.)

```
? Select Printing: ›
❯   Marvel Super Heroes Commander (MSC) #211 [uncommon]  $1.85  $4.20 foil
    Secrets of Strixhaven Commander (SOC) #427 [mythic]         $14.93 foil  $22.00 etched
    Secret Lair Drop (SLD) #2683 [rare]                  N/A
```

Each printing is quoted in **every finish it comes in**, one aligned column per finish: nonfoil
first, then foil and etched to its right. The columns only appear when some printing in the list has
that finish, so a card with no foil or etched variants keeps a single price column. Non-nonfoil
prices are named after the amount (`$14.93 foil`) so a foil or etched quote never reads as a nonfoil
one, and a printing that doesn't come in a column's finish leaves that cell blank. `N/A` (or
`N/A foil`) means the card cache carries no price for that printing and finish in that currency.

Which columns can appear depends on the currency: `tix` collapses to one untagged column, since
MTGO prices a printing the same in every finish, and an `eur` etched column frequently reads `N/A` —
Scryfall publishes `eur_etched` only for the few etched printings Cardmarket actually quotes (see
[How Cards Are Priced](/commands/price/#how-cards-are-priced)).

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
row is frequently `N/A` when your currency is `eur` — Scryfall publishes an etched euro price only
for the few printings Cardmarket quotes (see
[How Cards Are Priced](/commands/price/#how-cards-are-priced)).

Prices come from the local card cache, so they are as fresh as your last
[cache refresh](#cache-freshness).

## Edit Mode

`🛠️ Switch to Edit Mode` repurposes the search prompt: instead of the card database, it
autocompletes over the list's **existing entries** (rendered as their canonical lines). With nothing
typed, the whole list is listed below the menu rows, so you can scroll it with the arrow keys instead
of searching; typing narrows it. Selecting an entry opens an action menu that depends on the list
type.

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

Every edit is undoable with `↩️ Undo Last Edit` (a linear stack, newest first); undoing a removal
restores the entry with its original `&N` id when the id has not been reused. Edits are folded into
the session changelog with "latest wins" semantics — changing a card and then changing it back
leaves no changelog entry. Removing a card that was added this session simply cancels the add.
`➕ Switch to Add Mode` returns to the regular add flow; you can toggle between the two modes
freely within one session.

## Moving Cards to Another List

`📤 Move to Another List` sends a card from the list being edited to any other list — deck,
collection, or wanted list, including a list created earlier in the same session. A deck line
moves with **all of its copies**; each copy arrives as one physical card at the destination
(deck destinations merge copies onto an existing matching line). A **name-only** card headed
into a collection first runs the printing picker, since every collection line pins a printing;
cancelling the picker cancels the move.

Like every session edit, the move is **deferred until you save**: the card leaves the in-memory
list immediately (recorded as a `Moved … to …` changelog entry), and the destination receives it
when the source list is saved — so `↩️ Undo Last Edit` or discarding the change from
`📋 View Session Changes` takes the whole move back, and exiting without saving moves nothing.
On save, a destination that is open in the editor receives the card in memory and is saved in the
same step (along with any other pending changes it had — and its _own_ pending moves commit too,
so a chain of moves resolves in one save); any other destination's file is written directly,
exactly like [`ritual move`](/commands/move/) writes it, with a matching `Moved … from …` entry in
its changelog. The destination line gets a fresh `&N` id of its own, and the source id is released.

A new line at a deck destination lands in that deck's default section (the first non-Commander,
non-Sideboard section, creating `Main` if there is none) — the move never prompts for a section.
The action refuses up front when the edited list is the only list, or when a name-only card is
headed into a collection and the printing picker finds nothing to pin it to.

If a destination cannot be written at save time — its file was deleted, a deck destination has
unreadable lines, or a printing-less card cannot enter a collection — the save is refused and the
source list is left unsaved with its session intact; saving from the exit menu then keeps the
editor open rather than discarding the unsaved changes.

Two things do not follow a moved card: its **note** (notes never move across lists — the CLI
warns when one is left behind) and its **[label override](#card-labels)**. (The one-shot
[`ritual move`](/commands/move/) carries the override as far as the destination type can express
it.) Its **[tags](#card-tags)** _do_ follow, on every path — every list type carries them, so the
arriving line has exactly the tags the departed one had — and so does its
**[custom art](/custom-art/#art-follows-the-card)**: the entry
leaves the source list's `.art.json` and is re-filed under the destination line's new `&N` —
unless the copy merged onto a line the destination already had, which keeps its own art.

**[Categories](#card-categories)** are the fourth, and they do **not** follow a move: a category
belongs to a card _name in one list_, so the destination inherits nothing. The save that writes the
move also prunes the source list's `<list>.categories.json` for a name the source no longer holds —
except when a list holds a bullet the card-line grammar could not read, in which case nothing is
pruned for that file and every entry is kept.

## Card Labels

A card entry can carry **labels** — a bracket token on its line (`[sale,trade]`, `[keep]`,
`[proxy]`) declaring what you intend to do with that copy. Which labels a list type carries
differs, because the vocabulary describes two different things:

| List type   | Labels it carries                |
| ----------- | -------------------------------- |
| Collection  | `sale`, `trade`, `keep`, `proxy` |
| Deck        | `proxy` only                     |
| Wanted list | none                             |

- **`sale`** ("For sale") and **`trade`** ("For trade") are the only two that combine, as
  `[sale,trade]`.
- **`keep`** ("To keep") and **`proxy`** ("Proxy") are each **exclusive** — neither combines with
  any other label, including each other. A token like `[sale,keep]` or `[keep,proxy]` is a parse
  warning, as is one naming a label the list's type does not carry; the entry is kept and its
  labels dropped, and the warning blocks whole-file rewrites until it is fixed.
- **`proxy`** marks a copy that is not a real card, which is why it is the one label a deck
  carries: proxied decks are normal, proxied collections are a matter of bookkeeping, and a wanted
  list is a list of cards you do not have yet. It has [pricing consequences](#proxies-carry-no-price).

A list can also declare a **default** in its front matter (`labels:`), which every entry without
its own token inherits — see [Collection Front Matter](#collection-front-matter) and
[Deck Front Matter Labels](#deck-front-matter-labels). A card's _effective_ labels are its own
token when present, else the list default; an override **replaces** the default, it never merges
with it.

Set an override with [`set-card --label`](/commands/set-card/), the CLI editor's
`🏷️ Change Label` [edit-mode action](#edit-mode), or — on a collection — the web editors'
**Set Label…** menu item; `--label none` (or "Use list default") clears it. Every picker offers
only what its list type carries, so on a deck the choice is **Proxy** or "use the list default" —
and asking for `sale` on a deck is a usage error naming the labels that type supports, never a
silent drop. `set-card --label` is also the way to **repair** a line whose token the parser
refuses: it replaces the token outright, so it is the one edit that is not blocked by it (every
other edit to that line refuses rather than dropping the token silently — including a
[`remove-card`](/commands/remove-card/) that would decrement the line's quantity).

Labels are part of a deck line's **identity** for merging purposes: copies added by
[`add-card`](/commands/add-card/), by the editors, or by a [`ritual move`](/commands/move/) join
an existing line only when its label override matches theirs, so a proxy never disappears into
the line holding the real copies, and never confers `[proxy]` on a real card added beside it.

### Proxies carry no price

A card whose effective labels include `proxy` is not a real card, so Ritual prices it at **zero**
everywhere rather than looking a price up:

- [`price`](/commands/price/) reports it at `0` with the unpriced reason `proxy`, shows **PROXY**
  in its price cell instead of `N/A`, and counts it as a card but **not** as unpriced — a deck of
  proxies is fully priced at nothing, not a deck of price-lookup failures.
- The generated site bakes `0` in every currency, leaves proxies out of list totals and out of the
  missing-price counts, and never asks a buyer for a quote on one.
- [`sell`](/commands/sell/) drops proxy entries before matching, so they are never quoted, never
  counted, and never merged into an identical real copy.

[Custom art](/custom-art/#custom-art-carries-no-price) carries the very same rule on its own — one
rule, custom art or proxy ⇒ no price, no quotes, no sale. A card with both reports the unpriced
reason `custom-art` and shows **CUSTOM**: custom art wins.

## Card Tags

A card entry on **any** list type can carry **tags** — your own words for the card as a copy
(`Signed`, `Trade Binder`, `Gift from Dad`), which follow the card wherever it moves. A card's
role within one list (what Archidekt calls a category) is a separate, per-list thing, not a
tag — see [Card Categories](#card-categories) and [`ritual categories`](/commands/categories/). On the line they are one `#` token after the
labels and before the note, the tags **comma-separated**, as many as you like:

```
- 1 Sol Ring (LTC:284) [proxy] #Ramp, Staple &2
- Mox Ruby #Budget, Reserved List {any copy} &3
```

Tags are the open-vocabulary counterpart of [labels](#card-labels). A label is an instruction
to Ritual drawn from a closed list (`[proxy]` changes pricing); a tag is your own word for the
card and means whatever you meant — it drives
[grouping, sorting and filtering](/public-site/filtering/#grouping-sorting-and-filtering-by-tags)
on the generated site and selects cards for [`export --tags`](/commands/export/#filters). The two are different token kinds on purpose: a `Keep` tag is a perfectly legal
tag with no connection to the `[keep]` label. A tag is plain text: spaces are fine
(`Card Draw`) and its case is kept exactly as you wrote it (`Ramp` and `ramp` are two tags), but
it cannot contain `#`, `,`, `&`, brackets, braces or parentheses — the line's own punctuation.
A line's tags are written deduplicated and sorted. The `#` is file punctuation that marks where
the tags start; the editors, the site and the changelog never show it.

A deck's front-matter `tags:` key is a different thing entirely: it describes the **deck**
(`ritual metadata set <deck> tags edh,budget`, or the session's `🔖 Edit Deck Tags` menu row)
and never applies to any card. Only the `#tags` token on a card line holds card tags.

Edit a card's tags with the `🔖 Edit Tags` [edit-mode action](#edit-mode) — one free-text
field prefilled with the line's current tags, **comma-separated** (`My Tag, My Other Tag` is
two tags; an input the grammar refuses is reported and asked again; empty clears every tag) —
or with
[`set-card --tag` / `--untag`](/commands/set-card/#tag-updates) and
[`add-card --tag`](/commands/add-card/). However the set is edited, the change is recorded
**one changelog event per tag** that actually changed (`Added tag "Ramp" to "Sol Ring" &2`,
`Removed tag "Staple" from "Sol Ring" &2`), never as a whole-set replacement, and an add and a
remove of the same tag on the same card cancel out: re-adding a tag you removed earlier in
the session leaves no trace in the changelog. `↩️ Undo Last Edit` reverts the whole field
edit at once.

Like labels, tags are part of a deck line's **identity** for merging: copies added with
different tags land on their own line rather than folding into an existing one.

## Card Categories

A card entry on **any** list type can also carry **categories** — its role in _this_ list
(`Ramp`, `Removal`, `Board Wipes`), the thing Archidekt calls a category and Moxfield a tag.
Unlike a tag, a category belongs to the card's **name** rather than to the copy: one assignment
covers every line of that name in the list, it is never written on the card line, and it does
**not** follow the card when it moves to another list. Categories are ordered and the first one
is the card's **primary** category, which is what the site groups by. They live in the list's
`<list>.categories.json` sidecar — see [the list format](/list-format/#categories-namecategoriesjson).

`🗂 Edit Categories` is the per-card [edit-mode action](#edit-mode): one free-text field
prefilled with the card's current categories, **comma-separated** (`Ramp, Artifacts` is two
categories, and `Ramp` is the primary one; an input the grammar refuses is reported and asked
again; empty clears them). The list's own vocabulary — its declared order followed by the
configured [`defaultCategories`](/configuration/) — is printed above the prompt as a hint.

The edit is recorded as **one** `set-categories` event per card, a whole-list replacement rather
than a per-category delta (`Set categories of "Sol Ring" to Ramp, Artifacts`, or
`Cleared categories of "Sol Ring"`). It is latest-wins: repeated edits of one card consolidate
into the last one, and setting a card's categories back to what they were when the session opened
leaves nothing in the changelog at all. `↩️ Undo Last Edit` reverts it like any other edit.

The list menu carries two list-level rows, on all three list types:

| Row                      | What it does                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `🗂 Rename Category…`    | Pick a category from the list's vocabulary and type its new name — renamed on every card carrying it, each card's own order preserved |
| `🗂 Reorder Categories…` | Retype the vocabulary in the order you want it displayed                                                                              |

Both are recorded in the changelog (`Renamed category "Draw" to "Card Draw"`,
`Set category order to Ramp, Draw, Removal`), and neither is on the undo stack: an undo entry
names a card, and these name none — the same rule the `🔖 Edit Deck Tags` and
`🏷️ Edit List Labels` rows already follow.

Nothing is written until the session is saved. The save writes the sidecar and its `.sha256`
alongside the list file, and it **prunes**: a card name the list no longer holds loses its
category entry, and the save says which names it dropped. A sidecar the save cannot read is
reported and left exactly as it is, so a hand-broken file is never silently overwritten.

One-shot equivalents outside a session:
[`set-card --categories` / `--no-categories`](/commands/set-card/#category-updates) for one card,
and [`ritual categories`](/commands/categories/) for the list's vocabulary.

## Custom Art

`🎨 Set Custom Art` gives the selected card a picture of its own — a proxy scan, an altered card,
a piece of commissioned art — shown in place of the printing's Scryfall image on the site and in
the editors. It is available on **every** list type, and on any card (a proxy label is not
required, and neither implies the other). The prompt names what the card wears now and offers:

| Choice                  | What it does                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `🔗 Enter an Image URL` | Type an absolute `http`/`https` URL, used verbatim                            |
| `📁 Pick a Local File`  | Browse the [art directory](/custom-art/#the-art-directory) for an image       |
| `🚫 Clear Custom Art`   | Drop the reference so the real printing shows again (offered when it has one) |

A `← Cancel` row (or Esc) backs out of any step without changing anything.

The file browser walks the art directory one level at a time: `📁` rows descend, the leading
`⬆️ ..` row goes back out, and `🖼️` rows pick the image. Typing filters the visible rows, exactly
as it does everywhere else in the editor. Only the extensions Ritual serves (`.avif`, `.gif`,
`.jpeg`, `.jpg`, `.png`, `.webp`) are listed — a file it would only ever `404` on is not offered —
and dot-entries are hidden. A missing art directory says so and names it, rather than opening an
empty picker.

Whichever way you answer, the value is validated by the same parser
[`set-card --art`](/commands/set-card/#custom-art), the admin dialog, and the sidecar itself use,
so the editor accepts exactly what they do.

Like every other session edit, an art edit is **deferred**: it is staged in memory and written to
the list's `.art.json` [sidecar](/custom-art/#the-sidecar) by the save that writes the card lines,
so exiting without saving changes nothing. `↩️ Undo Last Edit` puts the previous reference back,
and `📋 View Session Changes` lists it as `custom art on <card>`. The card **line** is untouched:
custom art is list metadata, so it produces no change event and no changelog entry — the only sign
a save is pending is the editor's own unsaved-changes state.

Removing a card releases its `&N`, and the art filed under that number goes with it, since the
next card added would otherwise inherit the picture; undoing the removal brings both back — as
long as the id has not been reused. If something added in the meantime took that `&N`, the undo
restores the card under a fresh one, and the art stays dropped: it belonged to a number that is
now somebody else's. Art staged for a card and then removed with it is gone for the same reason.

A card with custom art also [carries no price](/custom-art/#custom-art-carries-no-price) — the
same rule the `proxy` label carries, and it is `custom-art` that wins when a card has both.

## Card Language

Every card entry has a **language**, written as a lowercase bracket token in canonical position on
the line — after the finish and condition, before labels and the note:

```
- Mana Crypt (2XM:270) [foil] [ja] [sale,trade] &3
- 3 Counterspell (LEA:55) [de] &12
- Sol Ring (C21:263) [zhs] &4
```

The vocabulary is **Scryfall's language codes** (`en es fr de it pt ja ko ru zhs zht he la grc ar
sa ph` — not ISO codes: Chinese is `zhs`/`zht`), and the token is **omitted for English**: a bare
line always means `en`, whatever the configured default, so a list file stays self-describing.

Adding a card **never prompts** for a language — the [session's current language](#the-session-language)
is stamped on new cards, and the `🌐 Change Language` edit action (or
[`set-card --language`](/commands/set-card/)) changes an individual copy afterwards. Under a
non-English session language, the printing picker notes printings that do not exist in that
language — picking one records it in the language that does exist (English when available), rather
than writing a language token Scryfall has no card object for. Language availability is checked
against the card cache (which holds every language's objects when
[`defaultLanguage`](/configuration/#default-language) is non-English), falling back to a direct
Scryfall lookup when the cache cannot vouch for the printing.

### The Session Language

A session starts on the configured [`defaultLanguage`](/configuration/#default-language) (English
when the key is absent — which the session says once on startup, since every card you add is about
to be stamped English). Two menu rows move it, kept apart from the printing options because a
language is chosen far less often than a set, finish, or condition:

- `🌐 Card Language (English)` sets the language for **every card added from here on**, across every
  list the session has open. It shows the current language, and changing it applies only to this
  session — `ritual.config.json` is untouched, so use
  [`ritual config set defaultLanguage <code>`](/configuration/#default-language) to make it stick.
- `🌐 Change Language (Sol Ring)` re-picks the language of the card you **just added**, without
  re-asking for its printing, finish, or condition the way `✏️ Edit Previous Card` does. It appears
  only once a card has been added this session.

Adding another copy never re-asks either: `➕ Add Similar Copy` uses the current session language,
and `➕ Add Exact Copy` reproduces the copied card's line exactly — language included — even if the
session language has moved since. The same language picker is reachable for any card from
[Edit Mode](#edit-mode) and from [the session-changes screen](#reviewing-session-changes).

Using `🌐 Change Language` counts as editing the last added card, so — like any other edit-mode
change to it — the last-added shortcuts reset until you add another card. Change it again from
[Edit Mode](#edit-mode) or the session-changes screen.

## Reviewing Session Changes

`📋 View Session Changes` opens a picker listing every change made this session — `➕` adds,
`✏️` field edits, `🗑️` removals, and `📤` [moves](#moving-cards-to-another-list). Selecting an
entry opens an action menu for it:

| Action                           | Description                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `✏️ Edit This Card`              | Open the card's own [edit-mode action menu](#edit-mode) — printing, finish, note, and the rest |
| `🌐 Change This Card’s Language` | Go straight to the [language](#card-language) picker for that card                             |
| `🗑️ Discard This Change`         | Take the change back out of the session                                                        |
| `← Back`                         | Return to the change list without doing anything                                               |

The two edit rows appear only while the change's card is **still in the list, under the same name** —
a removal, a completed [move](#moving-cards-to-another-list), a list's own
[creation](#creating-lists), and a card whose `&N` has since been reissued to a different card all
leave nothing to edit, so those rows offer the discard alone. A change that cannot be discarded yet
(see below) can still be edited; only the discard is refused.

Discarding reverts just that change while keeping the rest of the session intact:

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
changelog or the session-changes viewer). `🔖 Edit Deck Tags` edits the deck's `tags:` and
`🏷️ Edit List Labels` its [default card labels](#deck-front-matter-labels) the same
deferred way; the description and sync-source fields have no session action — a single-line
prompt would mangle a multi-line description, and linking is [`deck-sync link`](/commands/deck-sync/)'s
job — so use [`ritual metadata`](/commands/metadata/) (or the admin metadata editor) for those.

A deck with no `format:` — an older file, or one imported from a source that reports no format —
is not formatless: it is read as Commander when it has a `## Commander` section (Oathbreaker for a
`## Oathbreaker` or `## Signature Spell` section), which is what the menu shows and what the site
displays. Saving the deck writes that resolved format into the file, so the guess only has to be
made once. See [new](/commands/new/#deck-format) for the full list of formats.

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

The `# Title` heading names the deck, and each card line is a `- ` bullet followed by the card
quantity. Non-foil finish, `NM` condition, and the English language are omitted for brevity (a
non-English copy carries a `[ja]`-style token after the condition — see
[Card Language](#card-language)). The `&N` suffix is a persistent card ID used internally for
change tracking and is auto-assigned. Decrementing a quantity keeps the ID; only removing the whole
line releases it.

The full line grammar is:

```
- <quantity> Card Name (SET:CN) [finish] [condition] [lang] [labels] #tags {note} &N
```

Everything after the quantity and name is optional, and `&N` is always last:

```
- 1 Sol Ring (LTC:284) [proxy] #Ramp &2
- 4 Lightning Bolt (LEA:161) [foil] [LP] [ja] {playtest copies} &3
```

This is the canonical form every save writes. The reader is more lenient — bracket tokens in any
order, an optional bullet, `4x` quantities, Arena/Moxfield `(SET) CN` printings — and the next
save rewrites what it read into the form above. See [List File Format](/list-format/) for the
full grammar and the per-type token table.

`[labels]` on a deck line is the card's [label override](#card-labels), and the only label a deck
carries is `proxy`. A hand-written token a deck cannot carry (`[keep]`, `[sale,trade]`) — or an
illegal combination — is a parse warning: the card is kept, the labels are dropped. `#tags` are
the card's [tags](#card-tags), any number of them.

### Deck Front Matter Labels

A deck's front matter can declare a `labels:` default the same way a collection's can, and with
the same one-label vocabulary as its lines:

```markdown
---
format: commander
labels: [proxy]
---
```

Every line without its own `[labels]` token then counts as a proxy — which is how you mark a whole
playtest deck without touching a single card line. An empty list (or no key) means no default, and
a value the deck cannot carry is dropped **whole** rather than filtered down — `labels: [sale, proxy]`
is a statement about a deck this format cannot make, and keeping half of it would be a different
statement. Such a value is also a **parse warning**, exactly like a refused card-line token: the
next whole-file save deletes the key, so the warning names it and the whole-file-rewrite gates
block until you fix it. Set it with
[`ritual metadata set <deck> labels proxy`](/commands/metadata/), the editor's
`🏷️ Edit List Labels` action, the admin deck editor's **Labels** button, or the MCP
`set_list_metadata` tool.

## Collections

### Collection Files

Each card entry is written to a markdown collection file in the `collections/` directory:

```
- Card Name (SET:CN) [finish] [condition] [lang] [labels] #tags {note} &N
```

For example:

```
- Sol Ring (C19:221) [foil] &1
- Lightning Bolt (LEA:161) [LP] [keep] #Binder A &2
- Mana Crypt (2XM:270) [foil] [ja] [sale,trade] &3
```

Non-foil finish, the default `NM` condition, and the English language are omitted for brevity,
matching deck lines (a "Don't Care" condition choice is treated as `NM` and therefore not written;
a bare line always means English — see [Card Language](#card-language)). The note is optional and can be added
after entry via the `📝 Add Note` menu option. Notes are displayed in the card detail modal on the
generated site. The `&N` suffix is a persistent card ID used internally for change tracking and is
auto-assigned.

The optional `[labels]` token is the card's **label override**. Collections carry the whole
vocabulary — `sale` and `trade` combine as `[sale,trade]`, while `keep` and `proxy` each stand
alone — and the rules are shared with decks: see [Card Labels](#card-labels). A
[`ritual move`](/commands/move/) carries the override as far as the destination type can express
it: another collection keeps all of it, a deck keeps `proxy` and drops the rest, a wanted list
keeps none. The editors' **Move to list…** / `📤 Move to Another List` flow drops it in every case
(like notes, the editor move events don't carry it). The optional `#tags` are the card's
[tags](#card-tags) — free-form, any number, on every list type.

### Collection Front Matter

A collection file may open with a YAML front-matter block declaring the list's **default labels**
and its **description**, the blurb the built site prints above the cards:

```markdown
---
description: Everything I will trade away.
labels: [sale, trade]
---

# Trade Binder
```

Every entry without its own `[labels]` override inherits the default. `labels:` takes `sale` and
`trade` (together or alone), or `keep` or `proxy` (each alone); an empty list means no default. Card-line saves
round-trip the block byte-for-byte — unknown hand-authored keys included — and a block whose YAML
cannot be read is carried verbatim with an advisory rather than rejected. (A _metadata_ edit —
[`ritual metadata`](/commands/metadata/), the editor's `🏷️ Edit List Labels` action, the admin
**Labels** button, or `set_list_metadata` — re-dumps the YAML: every key and value survives, but
comments and quoting style do not.) Set the default with
[`ritual metadata set <list> labels …`](/commands/metadata/) (the surgical, front-matter-only
write), the editor's `🏷️ Edit List Labels` menu action (deferred to the session's next Save —
which, like any session save, rewrites the whole file in canonical form), the admin editor's
**Labels** button, by hand-editing the file, or via the MCP `set_list_metadata` tool.
The editor action refuses to run when the existing block's YAML cannot be read — a merge over
keys it cannot see would clobber them; fix the block by hand (every other session edit still
carries it verbatim). `description:` is written the same way — with
[`ritual metadata`](/commands/metadata/), the admin/HTTP route or `set_list_metadata` — and is the
one key **every** list type carries. A wanted list carries `description:` and the cover
[`image:`](/list-images/) (which [`set-list-image`](/commands/set-list-image/) writes) and nothing
else of its own; any other block on one is preserved. Note that a cover written from outside while a session is open is
dropped by that session's next save, since the session re-emits the block it snapshotted when it
opened.

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
- Card Name (SET:CN) [finish] [lang] #tags {note} &N
```

For example:

```
- Sol Ring &1
- Lightning Bolt (LEA:161) &2
- Mana Crypt (2XM:270) [foil] &3
- Black Lotus (LEB:233) {birthday present to self} &4
- Fblthp, the Lost (WAR:50) [ja] &5
- Mox Ruby #Budget, Reserved List &6
```

Any combination of set/collector number and finish can be omitted depending on the desired
specificity level (wanted lines carry no condition; a `[ja]`-style token records a wanted
non-English copy — see [Card Language](#card-language)). Wanted lines carry no labels, but
they do carry [`#tags`](#card-tags). The note is optional. The `&N` suffix
is a persistent card ID used internally for change tracking and is auto-assigned.

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
ritual edit
```

Jump straight into a list — a deck by file name, or any list with a type prefix:

```bash
ritual edit Burn
ritual edit collection:Binder
```

Cataloging session with defaults, hopping between a collection and a wanted list:

```bash
ritual edit --sets "FDN" --finish nonfoil --condition NM
```

Build a deck's sideboard without per-card section prompts:

```bash
ritual edit --section Sideboard
```

Collector-number entry, narrowed to two sets (the `--sets` filter is optional — without it the
search covers every printing in the cache):

```bash
ritual edit --collector --sets "FDN, SPG"
```

## Exit Codes

The failure codes apply only to startup — [opening a list directly](#opening-a-list-directly) and
the interactivity requirement; once open, the interactive editor itself always exits `0`.

| Code | Meaning                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Editor exited normally                                                                                                                                                            |
| `2`  | Usage error (conflicting type flags, a type prefix contradicting a type flag, `[listName]` matched more than one list, or prompts are unavailable — no terminal, or `--no-input`) |
| `3`  | Not found (`[listName]` matched nothing, or no lists exist in the searched scope)                                                                                                 |
