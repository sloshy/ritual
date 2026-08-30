---
title: 'List File Format'
---

Every deck, collection, and wanted list is one markdown file — `decks/<name>.md`, `collections/<name>.md`, `wanted/<name>.md` — that Ritual reads and writes and that you may also edit by hand. This page is the single reference for that format: the front matter each type carries, the `# Title` / `## Section` structure, the card-line grammar with its per-type token table, what the parser tolerates on read versus what it writes, and the `.changes.md` changelog that lives beside each list.

The one-line summary is **lenient in, canonical out**: the reader accepts several spellings of a card line, and every write — a save from an editor, a sync, a card command, [`cleanup`](/commands/cleanup/) — re-emits the one canonical form, so files converge on it.

## The three list types

|                            | Deck                                                            | Collection                                     | Wanted list            |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | ---------------------- |
| Copies                     | A quantity on the line (`- 4 Lightning Bolt`)                   | One line per copy                              | One line per copy      |
| Printing `(SET:CN)`        | Optional                                                        | **Required**                                   | Optional               |
| `[finish]`                 | Yes                                                             | Yes                                            | Yes                    |
| `[condition]`              | Yes                                                             | Yes                                            | **Never**              |
| `[lang]`                   | Yes                                                             | Yes                                            | Yes                    |
| `[labels]`                 | `proxy` only                                                    | `sale`, `trade`, `keep`, `proxy`               | **Never**              |
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

An optional YAML block between `---` fences at the top of the file. Keys are per type; any key not listed is preserved untouched through every save (a deck's is re-dumped, a flat list's block round-trips byte for byte).

| Key                             | Types            | Meaning                                                                                                                                                                                                              |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                        | deck             | The [deck format key](/commands/new/#deck-format) (`commander`, `modern`, …). A deck without one is inferred from its sections (a `## Commander` section means Commander) and the value is written on the next save. |
| `tags`                          | deck             | A list of free-text tags describing **the list** (`aggro`, `budget`) — not its cards. Edited with [`metadata`](/commands/metadata/); shown on the published site.                                                    |
| `labels`                        | deck, collection | The list's default [card labels](/commands/edit/#card-labels), inherited by every line without its own `[labels]` token. A deck accepts `[proxy]` alone; a collection the whole vocabulary. Never on a wanted list.  |
| `description`                   | all              | A prose blurb the [built site](/commands/build-site/) prints above the cards.                                                                                                                                        |
| `image`                         | all              | The list's [cover image](/list-images/) override — a `{card: N}`, `{file: …}` or `{url: …}` mapping.                                                                                                                 |
| `sourceId`, `sourceUrl`         | deck             | The deck's identity on its [sync source](/commands/deck-sync/).                                                                                                                                                      |
| `lastSynced`, `sourceUpdatedAt` | deck             | Stamped by `deck-sync`; never hand-edited.                                                                                                                                                                           |

`name:` and `created:` are **not** keys any more: the list's name is its `# Title` heading, and `created:` was dropped. Both are stripped from a deck on save, and [`cleanup`](/commands/cleanup/) migrates an old `name:` into the H1.

## Title and sections

The first `# Title` line (outside any fenced code block) names the list, on all three types: it is the display name the sites and pickers show and what `new` and `rename` write. Commands address a list by its **file name** (see [List Resolution](/commands/list-resolution/)), which `cleanup` keeps equal to the title. A file with no H1 is named after its file name.

`## Section` headings are the only structural marker. Cards before the first heading belong to an implicit `Main` section. Collections and wanted lists may use sections freely as groupings; in a deck, a section's **role** is decided by an exact (case-insensitive, trimmed) match against a closed alias table:

| Role          | Section names                                          | Behavior                                                                                                                                        |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `commander`   | `Commander`, `Commanders`, `Command Zone`              | The command zone; excluded from the main-deck count, exported as the `Commander` board.                                                         |
| `companion`   | `Companion`                                            | Exported as the `Companion` board.                                                                                                              |
| `oathbreaker` | `Oathbreaker`, `Signature Spell`                       | The Oathbreaker command zone.                                                                                                                   |
| `sideboard`   | `Sideboard`                                            | Exported as the `Sideboard` board; excluded from the main-deck count.                                                                           |
| `maybeboard`  | `Maybeboard`                                           | An extra: counts toward no total, is left out of every decklist export and the site's `.txt` download, and an **empty** one is dropped on save. |
| `tokens`      | `Tokens`, `Token`                                      | Same as maybeboard.                                                                                                                             |
| `main`        | `Main`, `Mainboard`, `Deck` — and **every other name** | Part of the main deck, exported to the `Deck` board.                                                                                            |

Matching is exact, never by substring or word: `## Token Generators`, `## Commander Damage Notes`, and `## Sideboard (post-board)` are ordinary main-deck sections. Empty sections are handled by role: an empty `## Main` / `## Mainboard` / `## Deck` or `## Sideboard` heading in a deck that has cards elsewhere is kept and written back bare, without a warning; an empty `## Maybeboard` / `## Tokens` heading is the one thing a whole-file rewrite deletes on purpose (reported as `Dropped empty section`); and any other empty heading is content a rewrite would lose, so it is reported as a warning and blocks whole-file writes like an unreadable line.

## Card lines

### Canonical form

This is what every writer emits, in this order, with one space between tokens and with defaults omitted:

```
- [qty] Name (SET:CN) [finish] [cond] [lang] [labels] {note} &N
```

| Token      | Spelling                                      | Notes                                                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `- `       | the bullet                                    | Written on every line of every type.                                                                                                                                                                                                                                                                |
| `qty`      | an integer, decks only on write               | Decks always write one (`- 1 Sol Ring`). Flat lists never write one — one line per copy.                                                                                                                                                                                                            |
| `Name`     | the card name, trimmed                        | Free text; tokens are peeled off the right-hand end, so a parenthesized word that is not a `SET:CN` pair (`Very Cryptic Command (Untap)`) stays in the name. A bracket token at the end of the line must be one the grammar knows — `[Alpha]` is `Unrecognized token [Alpha]` and refuses the line. |
| `(SET:CN)` | `(LEA:161)`                                   | Set code **uppercase in the file**, lowercase everywhere in memory; the collector number verbatim (`★`, `†`, letters allowed). Always a pair — a set without a collector number is not a printing.                                                                                                  |
| `[finish]` | `[foil]`, `[etched]`                          | `nonfoil` is the default and is not written.                                                                                                                                                                                                                                                        |
| `[cond]`   | `[LP]`, `[MP]`, `[HP]`, `[DMG]`               | `NM` is the default and is not written.                                                                                                                                                                                                                                                             |
| `[lang]`   | `[ja]`, `[zhs]`, …                            | A lowercase [Scryfall language code](/commands/edit/#card-language); English is the default and is not written.                                                                                                                                                                                     |
| `[labels]` | `[sale]`, `[sale,trade]`, `[keep]`, `[proxy]` | The line's label override. `sale` and `trade` combine; `keep` and `proxy` each stand alone.                                                                                                                                                                                                         |
| `{note}`   | `{any text}`                                  | A free-text note. Greedy to the **last** `}` on the line, so a note may contain braces; an empty `{}` is dropped.                                                                                                                                                                                   |
| `&N`       | `&12`                                         | The persistent card ID, always last.                                                                                                                                                                                                                                                                |

The `- ` bullet is mandatory on write for all three types, so a list file renders as a list wherever markdown is rendered.

### Which tokens each type accepts

| Token     | Deck         | Collection   | Wanted      |
| --------- | ------------ | ------------ | ----------- |
| quantity  | yes          | read only\*  | read only\* |
| printing  | yes          | **required** | yes         |
| finish    | yes          | yes          | yes         |
| condition | yes          | yes          | no          |
| language  | yes          | yes          | yes         |
| labels    | `proxy` only | all four     | no          |
| note      | yes          | yes          | yes         |
| id        | yes          | yes          | yes         |

\* Accepted when reading and expanded on save — see [Read tolerances](#read-tolerances).

An unrecognized bracket token, a token written twice, a known token stuck inside the name or written without whitespace around it, and a well-formed token the type does not carry are each a **named refusal** of that line, naming the token and its column — the last of these reads `[NM] is not a wanted list token — wanted lists never carry a condition.`, not a mystery about a "missing set code" elsewhere on the line. A deck line carrying a label a deck cannot hold (`[keep]`, `[sale,trade]`) is the one exception: the card is kept and the labels are dropped, with a warning. A collection line with no `(SET:CN)` is refused (`missing-printing`), since a stored copy is a specific physical card.

Any line the parser refuses is reported as a **warning** naming the file and line, and — because a whole-file rewrite would delete it — blocks every whole-file write of that file (editor saves, syncs, `cleanup`'s rewrite, `move` with a deck on either side) until it is fixed. Line-preserving commands (`add-card`, `remove-card`, `set-card`, `note`) leave such lines untouched.

### Read tolerances

The reader accepts all of the following and the next save rewrites them into the canonical form:

- **Any bracket-token order.** `[NM] [foil]` and `[foil] [NM]` mean the same thing; tokens are recognized by their value, not their position.
- **Any run of whitespace** between tokens, and around the name (which is trimmed).
- **The bullet is optional on a deck line.** A deck line is recognized by its leading quantity (`4 Lightning Bolt`, `- 4 Lightning Bolt`); a flat-list line is recognized by its bullet, and a bulletless line in a collection or wanted list is prose, not a card.
- **`Nx` quantities** — `4x Lightning Bolt` reads as four. A run of four or more digits with no `x` is part of the name (`1996 World Champion`).
- **A quantity on a flat-list line.** `- 4 Lightning Bolt (LEA:161)` in a collection or wanted list reads as four copies and is expanded into four lines on the next save. This is reported as an advisory, never a warning: nothing is lost. The first copy keeps the line's `&N`; the others are allocated fresh ids.
- **The Arena / MTGO export form** `Name (SET) CN`, with a trailing `*F*` / `*E*` finish marker, and **Moxfield's bulk-edit form** `Name (SET) *F* CN` — both become `(SET:CN)` plus `[foil]` / `[etched]`. A parenthesized set with **no collector number** stays part of the name (`Very Cryptic Command (Untap)` is a real card) and raises an advisory.
- **`//` comment lines** are skipped on read and dropped on write.
- **`_` in set codes** (`PLST_X`).

### Card IDs (`&N`)

Every card line ends in a persistent numeric id. Ids are sequential from 1 within each file, stable across every edit that keeps the line, and released to a reuse pool only when the line is removed outright (decrementing a deck quantity keeps the id). New lines take the smallest free id. **Never hand-author or renumber them** — commands that write card lines backfill missing ids on startup and stamp them into the file (see [the card-ID backfill](/#the-card-id-backfill)); they are an internal handle for change tracking, the admin editors, custom art, and cover images, and are not shown in the UI.

### Fenced code blocks are opaque

Anything between ` ``` ` or `~~~` fences in a list file is ignored: a card-looking line there is not a card, a `## Heading` there is not a section, an `&N` there is not an id in use, and none of it warns. Fenced lines are never edited or stamped. An unclosed fence extends to the end of the file. Whole-file rewrites cannot re-emit a fence, so they refuse such a file — see [Fenced code blocks](/commands/edit/#fenced-code-blocks).

### Reserved: tags

A per-card `#tag` token is planned and its slot in the canonical order (between `[labels]` and `{note}`) is reserved. It is **not implemented**: a `#word` on a card line today is part of the name.

## The `.changes.md` changelog

Every list has an append-only `<name>.changes.md` sidecar recording its card changes. Each entry is a `## <ISO timestamp>` heading followed by one prose `- ` line per change, then a fenced `ritual-changes` block holding the same changes as JSON Lines — one event per line, in the same order:

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

- **The block is authoritative.** Ritual reads only the `ritual-changes` block: the prose lines are rendered for people (and translated for display on the sites) and are never parsed. An entry with prose but no block is a **legacy** entry: it yields zero events and an advisory, never a silent nothing.
- **Hand-written text is preserved.** Prose you add after an entry's block travels with that entry through the [`history`](/commands/history/) editor and is written back verbatim.
- **It is a data format.** The prose is always English whatever the UI locale, and the file is a git-diffable record; edit it with `history` (or the admin [Change History](/admin/history/) page) rather than by hand.
- **Legacy entries** written before the block existed are converted once by [`cleanup`](/commands/cleanup/), which reads each prose line back into its event and appends the block; an entry it cannot fully read is left exactly as it was and reported.

## What `cleanup` normalizes

[`ritual cleanup`](/commands/cleanup/) is the migration for everything above. One pass rewrites every list in canonical form — bullets on deck lines, canonical token order and spacing, uppercase set codes, defaults omitted, flat-list quantities expanded to one line per copy, a legacy `name:` turned into the `# Title` H1 with `name:` and `created:` dropped (`tags:` and every other key kept), `&N` on every line — renames each file after its title, and converts legacy changelog entries to the block form. It is idempotent: a second run writes nothing.
