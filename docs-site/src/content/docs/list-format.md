---
title: 'List Files'
description: The markdown format Ritual reads and writes for decks, collections, and wanted lists.
---

Every deck, collection, and wanted list is one markdown file: `decks/<name>.md`, `collections/<name>.md`, or `wanted/<name>.md`. Ritual reads and writes these files, and you can edit them by hand too. This page describes what goes in them.

The rule of thumb is **lenient in, canonical out**. The reader accepts several spellings of a card line, and every write re-emits one canonical form, whether it comes from an editor save, a sync, a card command, or [`cleanup`](/commands/cleanup/). Files converge on that form over time.

## The three list types

|                            | Deck                                                            | Collection                                     | Wanted list            |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | ---------------------- |
| Copies                     | A quantity on the line (`- 4 Lightning Bolt`)                   | One line per copy                              | One line per copy      |
| Printing `(SET:CN)`        | Optional                                                        | **Required**                                   | Optional               |
| `[finish]`                 | Yes                                                             | Yes                                            | Yes                    |
| `[condition]`              | Yes                                                             | Yes                                            | **Never**              |
| `[lang]`                   | Yes                                                             | Yes                                            | Yes                    |
| `[labels]`                 | `proxy` only                                                    | `sale`, `trade`, `keep`, `proxy`               | **Never**              |
| `#tags` (card tags)        | Yes                                                             | Yes                                            | Yes                    |
| `{note}`, `&N`             | Yes                                                             | Yes                                            | Yes                    |
| Sections with a fixed role | Commander, Companion, Oathbreaker, Sideboard…                   | None — every `## Section` is a free-form group | None                   |
| Front-matter keys          | `format`, `tags`, `labels`, `description`, `image`, sync stamps | `labels`, `description`, `image`               | `description`, `image` |

A minimal example of each:

```markdown
---
format: commander
tags: [budget]
---

# Winota Stax

## Commander

- 1 Winota, Joiner of Forces (IKO:216) &1

## Main

- 1 Sol Ring (LTC:284) &2
- 4 Lightning Bolt (LEA:161) [foil] &3
```

```markdown
---
labels: [trade]
---

# Trade Binder

- Black Lotus (LEA:232) [LP] [keep] {first edition} &1
- Mana Crypt (2XM:270) [foil] [ja] &2
- Mana Crypt (2XM:270) [foil] [ja] &3
```

```markdown
# Wants

- Counterspell &1
- Sol Ring (LEA:270) [foil] &2
```

## Front matter

An optional YAML block between `---` fences at the top of the file. Each type has its own keys. Any key not listed here is preserved untouched through every save: a deck's block is re-dumped, and a flat list's block round-trips byte for byte.

| Key                             | Types            | Meaning                                                                                                                                                                                                              |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                        | deck             | The [deck format key](/commands/new/#deck-format) (`commander`, `modern`, …). A deck without one is inferred from its sections (a `## Commander` section means Commander) and the value is written on the next save. |
| `tags`                          | deck             | A list of free-text tags describing **the list** (`aggro`, `budget`) — not its cards. Edited with [`metadata`](/commands/metadata/); shown on the published site.                                                    |
| `labels`                        | deck, collection | The list's default [card labels](/commands/edit/#card-labels), inherited by every line without its own `[labels]` token. A deck accepts `[proxy]` alone; a collection the whole vocabulary. Never on a wanted list.  |
| `description`                   | all              | A prose blurb the [built site](/commands/build-site/) prints above the cards.                                                                                                                                        |
| `image`                         | all              | The list's [cover image](/list-images/) override — a `{card: N}`, `{file: …}` or `{url: …}` mapping.                                                                                                                 |
| `sourceId`, `sourceUrl`         | deck             | The deck's identity on its [sync source](/commands/deck-sync/).                                                                                                                                                      |
| `lastSynced`, `sourceUpdatedAt` | deck             | Stamped by `deck-sync`; never hand-edited.                                                                                                                                                                           |

`name:` and `created:` are no longer keys. The list's name is its `# Title` heading, and `created:` was dropped. Both are stripped from a deck on save, and [`cleanup`](/commands/cleanup/) migrates an old `name:` into the H1.

## Title and sections

The first `# Title` line outside any fenced code block names the list, on all three types. It is the display name the sites and pickers show, and what `new` and `rename` write. Commands address a list by its **file name** (see [List Names](/list-resolution/)), which `cleanup` keeps equal to the title. A file with no H1 is named after its file name.

`## Section` headings are the only other structural marker. Cards before the first heading belong to an implicit `Main` section. Collections and wanted lists may use sections freely as groupings. In a deck, a section's **role** is decided by an exact match (case-insensitive, trimmed) against this table:

| Role          | Section names                                          | Behavior                                                                                                                                        |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `commander`   | `Commander`, `Commanders`, `Command Zone`              | The command zone; excluded from the main-deck count, exported as the `Commander` board.                                                         |
| `companion`   | `Companion`                                            | Exported as the `Companion` board.                                                                                                              |
| `oathbreaker` | `Oathbreaker`, `Signature Spell`                       | The Oathbreaker command zone.                                                                                                                   |
| `sideboard`   | `Sideboard`                                            | Exported as the `Sideboard` board; excluded from the main-deck count.                                                                           |
| `maybeboard`  | `Maybeboard`                                           | An extra: counts toward no total, is left out of every decklist export and the site's `.txt` download, and an **empty** one is dropped on save. |
| `tokens`      | `Tokens`, `Token`                                      | Same as maybeboard.                                                                                                                             |
| `main`        | `Main`, `Mainboard`, `Deck` — and **every other name** | Part of the main deck, exported to the `Deck` board.                                                                                            |

Matching is exact, never by substring or word: `## Token Generators`, `## Commander Damage Notes`, and `## Sideboard (post-board)` are ordinary main-deck sections.

Empty sections are handled by role:

- An empty `## Main` / `## Mainboard` / `## Deck` or `## Sideboard` heading in a deck that has cards elsewhere is kept and written back bare, without a warning.
- An empty `## Maybeboard` / `## Tokens` heading is the one thing a whole-file rewrite deletes on purpose. It is reported as `Dropped empty section`.
- Any other empty heading is content a rewrite would lose, so it is reported as a warning and blocks whole-file writes, like an unreadable line does.

## Card lines

### Canonical form

This is what every writer emits, in this order, with one space between tokens and with defaults omitted:

```
- [qty] Name (SET:CN) [finish] [cond] [lang] [labels] #tag, tag {note} &N
```

| Token      | Spelling                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `- `       | the bullet                                    | Written on every line of every type.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `qty`      | an integer, decks only on write               | Decks always write one (`- 1 Sol Ring`). Flat lists never write one — one line per copy.                                                                                                                                                                                                                                                                                                                                                                               |
| `Name`     | the card name, trimmed                        | Free text; tokens are peeled off the right-hand end, so a parenthesized word that is not a `SET:CN` pair (`Very Cryptic Command (Untap)`) stays in the name. A bracket token at the end of the line must be one the grammar knows — `[Alpha]` is `Unrecognized token [Alpha]` and refuses the line.                                                                                                                                                                    |
| `(SET:CN)` | `(LEA:161)`                                   | Set code **uppercase in the file**, lowercase everywhere in memory; the collector number verbatim (`★`, `†`, letters allowed). Always a pair — a set without a collector number is not a printing.                                                                                                                                                                                                                                                                     |
| `[finish]` | `[foil]`, `[etched]`                          | `nonfoil` is the default and is not written.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `[cond]`   | `[LP]`, `[MP]`, `[HP]`, `[DMG]`               | `NM` is the default and is not written.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `[lang]`   | `[ja]`, `[zhs]`, …                            | A lowercase [Scryfall language code](/commands/edit/#card-language); English is the default and is not written.                                                                                                                                                                                                                                                                                                                                                        |
| `[labels]` | `[sale]`, `[sale,trade]`, `[keep]`, `[proxy]` | The line's label override. `sale` and `trade` combine; `keep` and `proxy` each stand alone.                                                                                                                                                                                                                                                                                                                                                                            |
| `#tags`    | `#Ramp`, `#Card Draw, Ramp`, `#Binder: Trade` | The card's [tags](/commands/edit/#card-tags): one `#`, then the tags **comma-separated** — a tag may hold spaces and keeps its case (`Card Draw`), and cannot contain `#`, `,`, `&`, brackets, braces or parentheses. Written deduplicated in sorted order; a line written with one `#` per tag (`#ramp #staple`) reads too. Allowed on every list type. The `#` is file punctuation only — no UI shows it. Not a label: a `Keep` tag has nothing to do with `[keep]`. |
| `{note}`   | `{any text}`                                  | A free-text note. Greedy to the **last** `}` on the line, so a note may contain braces; an empty `{}` is dropped.                                                                                                                                                                                                                                                                                                                                                      |
| `&N`       | `&12`                                         | The persistent card ID, always last.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The `- ` bullet is always written, on all three types, so a list file renders as a list wherever markdown is rendered.

### Which tokens each type accepts

| Token     | Deck         | Collection   | Wanted      |
| --------- | ------------ | ------------ | ----------- |
| quantity  | yes          | read only\*  | read only\* |
| printing  | yes          | **required** | yes         |
| finish    | yes          | yes          | yes         |
| condition | yes          | yes          | no          |
| language  | yes          | yes          | yes         |
| labels    | `proxy` only | all four     | no          |
| tags      | yes          | yes          | yes         |
| note      | yes          | yes          | yes         |
| id        | yes          | yes          | yes         |

\* Accepted when reading and expanded on save — see [Read tolerances](#read-tolerances).

The parser **refuses** a line, naming the offending token and its column, when it finds:

- an unrecognized bracket token;
- a token written twice (tags excepted: a line may carry more than one tag token, and a repeated tag simply folds away);
- a malformed tag token: a `#` with nothing after it, or a tag holding a forbidden character such as `#R&D`;
- a known token stuck inside the name, or written without whitespace around it;
- a well-formed token the type does not carry. The message says so plainly, such as `[NM] is not a wanted list token — wanted lists never carry a condition.`, rather than reporting a mystery elsewhere on the line;
- a collection line with no `(SET:CN)` (`missing-printing`), since a stored copy is a specific physical card.

One exception: a deck line carrying a label a deck cannot hold (`[keep]`, `[sale,trade]`) keeps the card and drops the labels, with a warning.

A refused line is reported as a **warning** naming the file and line. Because a whole-file rewrite would delete it, it blocks every whole-file write of that file until it is fixed: editor saves, syncs, `cleanup`'s rewrite, and `move` with a deck on either side. Line-preserving commands (`add-card`, `remove-card`, `set-card`, `note`) leave such lines untouched.

### Read tolerances

The reader accepts all of the following. The next save rewrites them into the canonical form.

- **Any bracket-token order.** `[NM] [foil]` and `[foil] [NM]` mean the same thing; tokens are recognized by their value, not their position.
- **Any run of whitespace** between tokens, and around the name (which is trimmed).
- **The bullet is optional on a deck line.** A deck line is recognized by its leading quantity (`4 Lightning Bolt`, `- 4 Lightning Bolt`). A flat-list line is recognized by its bullet, so a bulletless line in a collection or wanted list is prose, not a card.
- **`Nx` quantities.** `4x Lightning Bolt` reads as four. A run of four or more digits with no `x` is part of the name (`1996 World Champion`).
- **A quantity on a flat-list line.** `- 4 Lightning Bolt (LEA:161)` in a collection or wanted list reads as four copies and is expanded into four lines on the next save. This is reported as an advisory, never a warning, since nothing is lost. The first copy keeps the line's `&N`; the others are allocated fresh ids.
- **The Arena / MTGO export form** `Name (SET) CN`, with a trailing `*F*` / `*E*` finish marker, and **Moxfield's bulk-edit form** `Name (SET) *F* CN`. Both become `(SET:CN)` plus `[foil]` / `[etched]`. A parenthesized set with **no collector number** stays part of the name (`Very Cryptic Command (Untap)` is a real card) and raises an advisory.
- **Repeated tags, or one `#` per tag.** `#ramp #staple #ramp` reads as the two tags `ramp` and `staple`, and is written back as one token, `#ramp, staple`, deduplicated and sorted. Case is kept: `Ramp` and `ramp` are two tags.
- **`//` comment lines** are skipped on read and dropped on write.
- **`_` in set codes** (`PLST_X`).

### Card IDs (`&N`)

Every card line ends in a persistent numeric id. Ids are sequential from 1 within each file. An id is stable across every edit that keeps the line, and is released to a reuse pool only when the line is removed outright (decrementing a deck quantity keeps the id). New lines take the smallest free id.

**Never hand-author or renumber them.** Commands that write card lines backfill missing ids on startup and stamp them into the file; see [the card-ID backfill](/cli-conventions/#the-card-id-backfill). The ids are an internal handle for change tracking, the admin editors, custom art, and cover images. No UI shows them.

### Fenced code blocks are opaque

Anything between ` ``` ` or `~~~` fences in a list file is ignored. A card-looking line there is not a card, a `## Heading` there is not a section, an `&N` there is not an id in use, and none of it warns. Fenced lines are never edited or stamped. An unclosed fence extends to the end of the file.

Whole-file rewrites cannot re-emit a fence, so they refuse such a file. See [Fenced code blocks](/commands/edit/#fenced-code-blocks).

### Card tags vs. list tags

A `#tags` token on a card line holds **card** tags: your own free-form words for that copy (`Signed`, `Trade Binder`). They follow the card when it moves to another list. Edit them with [`set-card --tag`/`--untag`](/commands/set-card/#tag-updates), [`add-card --tag`](/commands/add-card/), or the editors' `🔖 Edit Tags` action. The changelog records one event per tag (`Added tag "Ramp" to "Sol Ring" &1`).

Tags are the open-vocabulary counterpart of the closed `[labels]` vocabulary. A label instructs Ritual (`[proxy]` changes pricing); a tag means whatever its author meant and only drives [grouping, sorting and filtering](/public-site/filtering/#grouping-sorting-and-filtering-by-tags).

A deck's front-matter `tags:` key is a different thing: it describes the **list itself** and never applies to any card on it.

## Categories (`<name>.categories.json`)

A **category** is a card's role in **one list**: `Ramp`, `Removal`, `Board Wipes`. It is what Archidekt calls a category and Moxfield a tag. It is the third of Ritual's three ways to say something about a card, and the three are different kinds of thing:

| Kind         | Belongs to                  | Vocabulary                       | Ordered?                     | Follows a move?                       | Where it lives                   |
| ------------ | --------------------------- | -------------------------------- | ---------------------------- | ------------------------------------- | -------------------------------- |
| **Label**    | a card line (`&N`)          | closed (`sale trade keep proxy`) | no                           | as far as the destination type allows | `[…]` token on the line          |
| **Tag**      | a card line — the _copy_    | open                             | no                           | **always**                            | `#a, b` token on the line        |
| **Category** | a card **name** in one list | open, per list + config defaults | yes — the first is _primary_ | **never**                             | `<name>.categories.json` sidecar |

Categories are edited with [`set-card --categories`/`--no-categories`](/commands/set-card/#category-updates), the [`ritual categories`](/commands/categories/) subcommands (`list`/`rename`/`order`/`remove`), and the editors' `🗂 Edit Categories` action plus the list menu's `Rename Category…` / `Reorder Categories…` rows ([`ritual edit`](/commands/edit/#card-categories)).

Categories are never written on a card line. They live in a JSON sidecar beside the list:

```json
{
  "order": ["Ramp", "Draw", "Removal", "Artifacts"],
  "cards": {
    "Rhystic Study": ["Draw"],
    "Sol Ring": ["Ramp", "Artifacts"]
  }
}
```

- **Keyed by card name.** One assignment covers every line of that name in the list, whatever its printing, section or quantity. Lookups fold case and whitespace; the stored key is the name as the card line spells it, including the `A // B` spelling of a double-faced card.
- **`cards` is ordered per card, and the first entry is the card's primary category.** Reordering is a real edit.
- **`order` is the display order** of the list's vocabulary. Categories a card uses but `order` does not name are appended when Ritual next writes the file: the [`defaultCategories`](/configuration/#default-categories) config vocabulary first, in its configured order, then the rest alphabetically. The file therefore describes itself.
- **A category name follows the tag shape rule**: non-empty plain text that cannot contain `#`, `,`, `&`, `*`, double quotes, brackets, braces or parentheses. Case is kept exactly as written; `Ramp` and `ramp` are one category with two spellings.
- **Stale names are kept, with a warning.** A `cards` key naming a card the list no longer holds loads with a warning rather than being dropped on read. It is pruned by the list's own save (an editor session, an admin save), by a cross-list [`move`](/commands/move/) that rewrites the list (only when the move could read every card line in it), and by [`ritual cleanup`](/commands/cleanup/). [`ritual categories`](/commands/categories/) reports stale entries and never prunes them, because a read does not write.
- **A malformed sidecar is refused as a whole.** It is never partially loaded and never silently overwritten, so a list with an unreadable sidecar still saves.
- **Empty means gone.** A sidecar with no vocabulary and no cards is deleted rather than written as `{}`.
- **It carries its own `.sha256`.** Unlike `<name>.art.json`, this sidecar is part of the list's recorded history. Hand edits to it are detected by [`detect-changes`](/commands/detect-changes/) and recorded as `Set categories of "Sol Ring" to Ramp, Artifacts` / `Set category order to …` / `Renamed category "Draw" to "Card Draw"` entries in the **list's** `.changes.md`. A sidecar Ritual did not itself last write keeps its stale hash, so the edit is not silently declared recorded.

The sidecar is what the sites read. The built site bakes it into each list's detail JSON, and the pages offer the [Category groupings, the Category sort and the Categories filter](/public-site/filtering/#grouping-sorting-and-filtering-by-category). The admin and public editors write it through their [Edit Categories… and Manage categories dialogs](/admin/editors/#card-categories). [`ritual export`](/commands/export/#properties)'s `categories`/`primaryCategory` columns read it, and a CSV import's [`categories` column](/commands/import/#value-normalization) writes it.

## The `.changes.md` changelog

Every list has an append-only `<name>.changes.md` sidecar recording its card changes. Each entry is a `## <ISO timestamp>` heading, one prose `- ` line per change, and then a fenced `ritual-changes` block holding the same changes as JSON Lines, one event per line in the same order:

````markdown
# Changelog for Winota Stax

## 2026-03-07T22:01:21.452Z

- Added "Demonic Tutor" (UMA:75) [foil] &3
- Removed "Misty Rainforest" &4

```ritual-changes
{"action":"add","cardName":"Demonic Tutor","cardId":3,"set":"uma","collectorNumber":"75","finish":"foil"}
{"action":"remove","cardName":"Misty Rainforest","cardId":4}
```
````

- **The block is authoritative.** Ritual reads only the `ritual-changes` block. The prose lines are rendered for people (and translated for display on the sites) and are never parsed.
- **Hand-written text is preserved.** Prose you add after an entry's block travels with that entry through the [`history`](/commands/history/) editor and is written back verbatim.
- **It is a data format.** The prose is always English whatever the UI locale, and the file is a git-diffable record. Edit it with `history` or the admin [Change History](/admin/history/) page rather than by hand.
- **Legacy entries** written before the block existed are never converted. They keep their prose, yield zero events, and are named by an advisory. Nothing in Ritual parses that prose.

## What `cleanup` normalizes

[`ritual cleanup`](/commands/cleanup/) is the migration for everything above. One pass rewrites every list in canonical form: bullets on deck lines, canonical token order and spacing, uppercase set codes, defaults omitted, flat-list quantities expanded to one line per copy, a legacy `name:` turned into the `# Title` H1 with `name:` and `created:` dropped (`tags:` and every other key kept), and `&N` on every line. It renames each file after its title. It also prunes stale names from the list's `.categories.json` and re-serializes it canonically; `--dry-run` previews both without writing. It never touches a `.changes.md`. It is idempotent: a second run writes nothing.
