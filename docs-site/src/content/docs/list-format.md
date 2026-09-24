---
title: 'List Files'
description: The markdown format Ritual reads and writes for decks, collections, and wanted lists.
---

Every deck, collection, and wanted list is one markdown file: `decks/<name>.md`, `collections/<name>.md`, or `wanted/<name>.md`. Ritual reads and writes these files, and you can edit them by hand. This page describes what goes in them.

The rule is **lenient in, canonical out**. The reader accepts several spellings of a card line. Every write (an editor save, a sync, a card command, or [`cleanup`](/commands/cleanup/)) emits one canonical form, so files converge on it over time.

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

An optional YAML block between `---` fences at the top of the file. Each type has its own keys. Any key not listed here survives every save: a deck's block is re-dumped, and a collection's or wanted list's block is kept byte for byte.

| Key                             | Types            | Meaning                                                                                                                                      |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                        | deck             | The [deck format key](/commands/new/#deck-format) (`commander`, `modern`, …). Missing: inferred from the sections and written on next save.  |
| `tags`                          | deck             | Free-text tags describing **the list** (`aggro`, `budget`), not its cards. Edited with [`metadata`](/commands/metadata/); shown on the site. |
| `labels`                        | deck, collection | The list's default [card labels](#card-labels), inherited by every line without its own `[labels]` token. Never on a wanted list.            |
| `description`                   | all              | A prose blurb the [built site](/commands/build-site/) prints above the cards.                                                                |
| `image`                         | all              | The list's [cover image](/list-images/): a `{card: N}`, `{file: …}` or `{url: …}` mapping.                                                   |
| `sourceId`, `sourceUrl`         | deck             | The deck's identity on its [sync source](/commands/deck-sync/).                                                                              |
| `lastSynced`, `sourceUpdatedAt` | deck             | Stamped by `deck-sync`; never hand-edited.                                                                                                   |

A deck with no `format` and a `## Commander` section is inferred as Commander.

Older files may carry `name:` or `created:`. Neither is a key today; the list's name is its `# Title` heading. A deck save strips both, and [`cleanup`](/commands/cleanup/) moves an old `name:` into the H1.

### Default labels and descriptions

A deck or collection can declare **default labels** in its front matter. Every list type can carry a **description**:

```markdown
---
description: Everything I will trade away.
labels: [sale, trade]
---

# Trade Binder
```

Every entry without its own `[labels]` token inherits the default. The values a list can carry:

- **Collection:** `sale` and `trade` (together or alone), or `keep` or `proxy` (each alone).
- **Deck:** `proxy` alone. Every deck line without its own token then counts as a proxy, which marks a whole playtest deck at once.

```markdown
---
format: commander
labels: [proxy]
---
```

An empty list, or no key, means no default. On a deck, a value it cannot carry (`labels: [sale, proxy]`) is dropped **whole**, not filtered down to the allowed part. It is also a **parse warning**, like a refused card-line token: the next whole-file save would delete the key, so the warning names it and whole-file writes are blocked until you fix it. On a collection, an unreadable `labels:` value is ignored with an advisory, and the block is kept as written.

Set the default with:

- [`ritual metadata set <list> labels …`](/commands/metadata/), which writes only the front matter;
- the [`edit`](/commands/edit/) session's `🏷️ Edit List Labels` action, applied on the session's next Save (which rewrites the whole file in canonical form);
- the admin editor's **Labels** button;
- the MCP `set_list_metadata` tool;
- a hand edit.

How the block survives edits:

- **Card-line saves keep the block byte for byte**, including unknown hand-authored keys. A block whose YAML cannot be read is carried verbatim with an advisory.
- **A metadata edit re-dumps the YAML.** `ritual metadata`, the `edit` session's `🏷️ Edit List Labels` action, the admin **Labels** button, and `set_list_metadata` all rewrite the block. Every key and value survives; comments and quoting style do not.
- **The `edit` session's action refuses to run when the block's YAML cannot be read**, since it cannot merge over keys it cannot see. Fix the block by hand. Every other session edit still carries it verbatim.

`description:` is written the same way (`ritual metadata`, the admin/HTTP route, or `set_list_metadata`) and is the one key **every** list type carries. A wanted list's own keys are `description:` and the cover [`image:`](/list-images/), which [`set-list-image`](/commands/set-list-image/) writes; any other block on one is preserved.

A cover written from outside while an `edit` session is open is dropped by that session's next save, because the session re-emits the block it read when it opened. See [the known gap](/list-images/#known-gap-the-cli-edit-session).

## Title and sections

The first `# Title` line outside any fenced code block names the list, on all three types. The sites and pickers display it, and `new` and `rename` write it. Commands address a list by its **file name** (see [List Names](/list-resolution/)), which `cleanup` keeps equal to the title. A file with no H1 is named after its file name.

`## Section` headings are the only other structural marker. Cards before the first heading belong to an implicit `Main` section. Collections and wanted lists use sections as free groupings. In a deck, a section's **role** comes from an exact match (case-insensitive, trimmed) against this table:

| Role          | Section names                                          | Behavior                                                                                  |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `commander`   | `Commander`, `Commanders`, `Command Zone`              | The command zone; excluded from the main-deck count, exported as the `Commander` board.   |
| `companion`   | `Companion`                                            | Exported as the `Companion` board.                                                        |
| `oathbreaker` | `Oathbreaker`, `Signature Spell`                       | The Oathbreaker command zone.                                                             |
| `sideboard`   | `Sideboard`                                            | Exported as the `Sideboard` board; excluded from the main-deck count.                     |
| `maybeboard`  | `Maybeboard`                                           | Counts toward no total; left out of every decklist export and the site's `.txt` download. |
| `tokens`      | `Tokens`, `Token`                                      | Same as maybeboard.                                                                       |
| `main`        | `Main`, `Mainboard`, `Deck` — and **every other name** | Part of the main deck, exported to the `Deck` board.                                      |

Matching is exact, never by substring or word: `## Token Generators`, `## Commander Damage Notes`, and `## Sideboard (post-board)` are ordinary main-deck sections.

Empty sections are handled by role:

- An empty `## Main` / `## Mainboard` / `## Deck` or `## Sideboard` heading, in a deck that has cards elsewhere, is kept and written back bare, without a warning.
- An empty `## Maybeboard` / `## Tokens` heading is deleted on purpose by a whole-file rewrite and reported as `Dropped empty section`.
- Any other empty heading is content a rewrite would lose. It is reported as a warning and blocks whole-file writes, like an unreadable line does.

## Card lines

### Canonical form

Every writer emits this, in this order, with one space between tokens and defaults omitted:

```
- [qty] Name (SET:CN) [finish] [cond] [lang] [labels] #tag, tag {note} &N
```

| Token      | Spelling                                      | Notes                                                                                                                                                         |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `- `       | the bullet                                    | Written on every line of every type, so the file renders as a list anywhere markdown is rendered.                                                             |
| `qty`      | an integer, decks only on write               | Decks always write one (`- 1 Sol Ring`). Collections and wanted lists never do: one line per copy.                                                            |
| `Name`     | the card name, trimmed                        | Free text. Tokens are peeled off the right-hand end, so a parenthesized word that is not a `SET:CN` pair (`Very Cryptic Command (Untap)`) stays in the name.  |
| `(SET:CN)` | `(LEA:161)`                                   | Set code **uppercase in the file**, lowercase in memory. Collector number verbatim (`★`, `†`, letters allowed). Always a pair; a set alone is not a printing. |
| `[finish]` | `[foil]`, `[etched]`                          | `nonfoil` is the default and is not written.                                                                                                                  |
| `[cond]`   | `[LP]`, `[MP]`, `[HP]`, `[DMG]`               | `NM` is the default and is not written.                                                                                                                       |
| `[lang]`   | `[ja]`, `[zhs]`, …                            | A lowercase [Scryfall language code](#card-language). English is the default and is not written.                                                              |
| `[labels]` | `[sale]`, `[sale,trade]`, `[keep]`, `[proxy]` | The line's label override. `sale` and `trade` combine; `keep` and `proxy` each stand alone.                                                                   |
| `#tags`    | `#Ramp`, `#Card Draw, Ramp`, `#Binder: Trade` | The card's [tags](#card-tags): one `#`, then the tags comma-separated. Written deduplicated and sorted.                                                       |
| `{note}`   | `{any text}`                                  | A free-text note. Runs to the **last** `}` on the line, so a note may contain braces. An empty `{}` is dropped.                                               |
| `&N`       | `&12`                                         | The persistent card ID, always last.                                                                                                                          |

A line with a `(SET:CN)` is **pinned** to that printing. A line without one is **name-only** and stands for any printing of the card.

A bracket token at the end of the line must be one the grammar knows. `[Alpha]` is `Unrecognized token [Alpha]` and refuses the line.

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
- a token written twice (tags excepted: a line may carry several tag tokens, and a repeated tag folds away);
- a malformed tag token: a `#` with nothing after it, or a tag holding a forbidden character such as `#R&D`;
- a known token stuck inside the name, or written without whitespace around it;
- a well-formed token the type does not carry. The message says so plainly: `[NM] is not a wanted list token — wanted lists never carry a condition.`

A collection line with no `(SET:CN)` is refused too (`missing-printing`), since a stored copy is a specific physical card.

One exception: a deck line carrying a label a deck cannot hold (`[keep]`, `[sale,trade]`) keeps the card and drops the labels, with a warning.

A refused line is reported as a **warning** naming the file and line. A whole-file rewrite would delete it, so it blocks every whole-file write of that file until fixed: editor saves, syncs, `cleanup`'s rewrite, and `move` with a deck on either side. Line-preserving commands (`add-card`, `remove-card`, `set-card`, `note`) leave such lines untouched.

### Read tolerances

The reader accepts all of the following. The next save rewrites them into the canonical form.

- **Any bracket-token order.** `[NM] [foil]` and `[foil] [NM]` mean the same thing. Tokens are recognized by value, not position.
- **Any run of whitespace** between tokens and around the name.
- **The bullet is optional on a deck line.** A deck line is recognized by its leading quantity (`4 Lightning Bolt`, `- 4 Lightning Bolt`). A collection or wanted-list line is recognized by its bullet, so a bulletless line there is prose, not a card.
- **`Nx` quantities.** `4x Lightning Bolt` reads as four. A run of four or more digits with no `x` is part of the name (`1996 World Champion`).
- **A quantity on a collection or wanted-list line.** `- 4 Lightning Bolt (LEA:161)` reads as four copies and is expanded into four lines on the next save. This is an advisory, not a warning, since nothing is lost. The first copy keeps the line's `&N`; the others get fresh ids.
- **The Arena / MTGO export form** `Name (SET) CN`, with a trailing `*F*` / `*E*` finish marker, and **Moxfield's bulk-edit form** `Name (SET) *F* CN`. Both become `(SET:CN)` plus `[foil]` / `[etched]`. A parenthesized set with **no collector number** stays part of the name (`Very Cryptic Command (Untap)` is a real card) and raises an advisory.
- **Repeated tags, or one `#` per tag.** `#ramp #staple #ramp` reads as the tags `ramp` and `staple` and is written back as one token, `#ramp, staple`. Case is kept: `Ramp` and `ramp` are two tags.
- **`//` comment lines** are skipped on read and dropped on write.
- **`_` in set codes** (`PLST_X`).

### Card IDs (`&N`)

Every card line ends in a persistent numeric id. Ids are sequential from 1 within each file. An id is stable across every edit that keeps the line. It is released to a reuse pool only when the line is removed outright; decrementing a deck quantity keeps it. New lines take the smallest free id.

**Never hand-author or renumber them.** Commands that write card lines, or that rely on every line having an id, fill in missing ids before they run and save them to the file; see [the card-ID backfill](/cli-conventions/#the-card-id-backfill). The ids are an internal handle for change tracking, the admin editors, custom art, and cover images. No UI shows them.

## Card labels

A card entry can carry **labels**, a bracket token on its line (`[sale,trade]`, `[keep]`, `[proxy]`) declaring what you intend to do with that copy. Each list type carries a different set:

| List type   | Labels it carries                |
| ----------- | -------------------------------- |
| Collection  | `sale`, `trade`, `keep`, `proxy` |
| Deck        | `proxy` only                     |
| Wanted list | none                             |

- **`sale`** ("For sale") and **`trade`** ("For trade") are the only two that combine, as `[sale,trade]`.
- **`keep`** ("To keep") and **`proxy`** ("Proxy") are each **exclusive**. Neither combines with any other label. `[sale,keep]` or `[keep,proxy]` is a parse warning, as is a label the list's type does not carry. The entry is kept and its labels dropped, and the warning blocks whole-file rewrites until it is fixed.
- **`proxy`** marks a copy that is not a real card, which is why it is the one label a deck carries. It has [pricing consequences](#proxies-carry-no-price).

A list can also declare a **default** in its front matter (`labels:`); see [Default labels and descriptions](#default-labels-and-descriptions). A card's _effective_ labels are its own token when present, else the list default. An override **replaces** the default; it never merges with it.

Set an override with:

- [`set-card --label`](/commands/set-card/); `--label none` clears it;
- the [`edit`](/commands/edit/#card-labels) session's `🏷️ Change Label` action;
- on a collection, the web editors' **Set Label…** menu item ("Use list default" clears it).

Every picker offers only what its list type carries. On a deck the choice is **Proxy** or the list default, and asking for `sale` on a deck is a usage error naming the supported labels.

`set-card --label` is also how you **repair** a line whose token the parser refuses. It replaces the token outright, so it is the one edit the refusal does not block. Every other edit to that line refuses rather than drop the token silently, including a [`remove-card`](/commands/remove-card/) that would decrement the line's quantity.

Labels are part of a deck line's **identity** for merging. Copies added by [`add-card`](/commands/add-card/), the editors, or [`ritual move`](/commands/move/) join an existing line only when its label override matches theirs. A proxy never merges into the line holding the real copies, and a real card never inherits `[proxy]` from a line it lands beside.

### Proxies carry no price

A card whose effective labels include `proxy` is not a real card, so Ritual prices it at **zero** everywhere rather than looking a price up:

- [`price`](/commands/price/) reports it at `0` with the unpriced reason `proxy`, shows **PROXY** in its price cell instead of `N/A`, and counts it as a card but **not** as unpriced.
- The generated site records `0` in every currency, leaves proxies out of list totals and missing-price counts, and never asks a buyer for a quote on one.
- [`sell`](/commands/sell/) drops proxy entries before matching, so they are never quoted, counted, or merged into an identical real copy.

[Custom art](/custom-art/#custom-art-carries-no-price) follows the same rule. A card with both reports the unpriced reason `custom-art` and shows **CUSTOM**; custom art wins.

## Card tags

A card entry on **any** list type can carry **tags**: your own words for the card as a copy (`Signed`, `Trade Binder`, `Gift from Dad`). Tags follow the card wherever it moves. A card's role within one list (what Archidekt calls a category) is a separate, per-list thing; see [Categories](#categories-namecategoriesjson) and [`ritual categories`](/commands/categories/). On the line, tags are one `#` token after the labels and before the note, comma-separated:

```
- 1 Sol Ring (LTC:284) [proxy] #Ramp, Staple &2
- Mox Ruby #Budget, Reserved List {any copy} &3
```

A [label](#card-labels) is an instruction to Ritual from a closed list (`[proxy]` changes pricing); a tag means whatever you meant. A `Keep` tag has no connection to the `[keep]` label. Tags drive [grouping, sorting and filtering](/public-site/filtering/#grouping-sorting-and-filtering-by-tags) on the generated site and select cards for [`export --tags`](/commands/export/#filters).

A tag is plain text. Spaces are fine (`Card Draw`) and case is kept (`Ramp` and `ramp` are two tags). A tag cannot contain `#`, `,`, `&`, brackets, braces or parentheses. A line's tags are written deduplicated and sorted. The `#` is file punctuation only; the editors, the site and the changelog never show it.

A deck's front-matter `tags:` key describes the **deck** (`ritual metadata set <deck> tags edh,budget`, or the [`edit`](/commands/edit/#deck-format) session's `🔖 Edit Deck Tags` row). It never applies to a card. Only the `#tags` token on a card line holds card tags.

Edit a card's tags with [`set-card --tag` / `--untag`](/commands/set-card/#tag-updates), [`add-card --tag`](/commands/add-card/), or the editors' tag dialogs ([`ritual edit`](/commands/edit/#card-tags), the [admin editors](/admin/editors/#card-tags)). Every change is recorded as **one changelog event per tag** that actually changed (`Added tag "Ramp" to "Sol Ring" &2`, `Removed tag "Staple" from "Sol Ring" &2`), never as a whole-set replacement. An add and a remove of the same tag on the same card cancel out, so re-adding a tag you removed earlier in a session leaves no changelog trace.

Like labels, tags are part of a deck line's **identity** for merging. Copies added with different tags land on their own line.

## Card language

Every card entry has a **language**, written as a lowercase bracket token after the finish and condition and before labels and the note.

```
- Mana Crypt (2XM:270) [foil] [ja] [sale,trade] &3
- 3 Counterspell (LEA:55) [de] &12
- Sol Ring (C21:263) [zhs] &4
```

The vocabulary is **Scryfall's language codes** (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`), not ISO codes: Chinese is `zhs`/`zht`. The token is **omitted for English**. A bare line always means `en`, whatever the configured default, so a list file stays self-describing.

Adding a card **never prompts** for a language. New cards get the configured [`defaultLanguage`](/configuration/#default-language); an [`edit` session](/commands/edit/#the-session-language) can override it for its own adds. Change one copy afterwards with [`set-card --language`](/commands/set-card/) or an editor's language action.

Under a non-English default, the printing pickers mark printings that do not exist in that language. Picking one records the language that does exist (English when available) rather than a language Scryfall has no card object for. Availability is checked against the card cache, which holds every language when `defaultLanguage` is non-English, with a direct Scryfall lookup when the cache cannot answer.

## Wanted-list card states

Each card on a wanted list is in one of three states, which decides how it is priced:

| State               | Format                          | Pricing Behavior                              |
| ------------------- | ------------------------------- | --------------------------------------------- |
| **Name only**       | `- Card Name`                   | Uses cheapest printing across all sets        |
| **Printing**        | `- Card Name (SET:CN)`          | Uses cheapest _finish_ of that exact printing |
| **Fully specified** | `- Card Name (SET:CN) [finish]` | Uses the exact printing and finish specified  |

## Fenced code blocks

A list file may carry a fenced code block: an example line, a template, a snippet of output. **Everything inside a fence is prose.** A card-looking line inside a fence is not a card, a `## Heading` is not a section, an `&N` is not a card ID, and none of it is reported as unreadable.

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

That file holds two cards. The `- Black Lotus (LEA:232) &99` line is not counted, priced, exported, offered by a picker, or targeted by `add-card`, `set-card`, `remove-card`, `note`, or `move`. `&99` is not in use, so a future card may take that ID. The `&N` backfill leaves fenced lines unstamped, and every line-preserving edit keeps the block byte for byte.

Fence rules:

- Three or more backticks or three or more tildes, indented by up to three spaces, with an optional info string (` ```markdown `).
- The closing fence uses the same character, is at least as long, and carries nothing after it.
- Fences do not nest. Tildes inside a backtick fence are ordinary content, and vice versa.
- **An unclosed fence runs to the end of the file** (the CommonMark rule), so a stray ` ``` ` hides every card line below it. If cards go missing from a list, check for an unbalanced fence.

Inline code spans (`` `like this` ``) and four-space indented blocks are _not_ code. A four-space indent looks like a nested list item, so an indented block's card lines are read as real cards and its ` ``` ` delimiters as unreadable lines. Use a fenced block whenever a list file needs prose card lines.

### Whole-file rewrites

Surfaces that rewrite a whole file from its parsed cards cannot re-emit a fenced block, so they treat one like an unreadable line:

| Surface                                                                               | Behavior with a fenced block                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The admin editors' save (and the MCP tools that reuse it)                             | Refuses with a `400` and writes nothing                                                         |
| [`cleanup`](/commands/cleanup/)                                                       | Reports the block and skips the content rewrite; a drifted file name is still corrected         |
| [`deck-sync`](/commands/deck-sync/) / [`collection-sync`](/commands/collection-sync/) | Held back by the unreadable-lines gate (`-y/--yes` accepts the loss)                            |
| [`import --append`](/commands/import/)                                                | Refuses and writes nothing                                                                      |
| A deck on either side of [`move`](/commands/move/)                                    | Refuses and writes nothing                                                                      |
| `ritual edit` sessions                                                                | **Warns on load and drops the block on the next save** — check the session output before saving |

The one-shot card commands (`add-card`, `set-card`, `remove-card`, `note`) preserve lines and work normally, as does a `move` between two collections or wanted lists. The exception is an **append into an unclosed fence**: a card line appended after it would be prose, so `add-card` and `move` refuse rather than write a line no later parse can see.

## Categories (`<name>.categories.json`)

A **category** is a card's role in **one list**: `Ramp`, `Removal`, `Board Wipes`. Archidekt calls it a category and Moxfield a tag. Ritual has three ways to say something about a card, and they are different kinds of thing:

| Kind         | Belongs to                  | Vocabulary                       | Ordered?                     | Follows a move?                       | Where it lives                   |
| ------------ | --------------------------- | -------------------------------- | ---------------------------- | ------------------------------------- | -------------------------------- |
| **Label**    | a card line (`&N`)          | closed (`sale trade keep proxy`) | no                           | as far as the destination type allows | `[…]` token on the line          |
| **Tag**      | a card line — the _copy_    | open                             | no                           | **always**                            | `#a, b` token on the line        |
| **Category** | a card **name** in one list | open, per list + config defaults | yes — the first is _primary_ | **never**                             | `<name>.categories.json` sidecar |

Edit categories with [`set-card --categories`/`--no-categories`](/commands/set-card/#category-updates), the [`ritual categories`](/commands/categories/) subcommands (`list`/`rename`/`order`/`remove`), or the editors' `🗂 Edit Categories` action and the list menu's `Rename Category…` / `Reorder Categories…` rows ([`ritual edit`](/commands/edit/#card-categories)).

Categories are never written on a card line. They live in a JSON file beside the list (a "sidecar"):

```json
{
  "order": ["Ramp", "Draw", "Removal", "Artifacts"],
  "cards": {
    "Rhystic Study": ["Draw"],
    "Sol Ring": ["Ramp", "Artifacts"]
  }
}
```

- **Keyed by card name.** One assignment covers every line of that name in the list, whatever its printing, section or quantity. Lookups fold case and whitespace. The stored key is the name as the card line spells it, including the `A // B` spelling of a double-faced card.
- **`cards` is ordered per card; the first entry is the primary category.** Reordering is a real edit.
- **`order` is the display order** of the list's vocabulary. Categories a card uses but `order` does not name are appended when Ritual next writes the file: the [`defaultCategories`](/configuration/#default-categories) config vocabulary first, in its configured order, then the rest alphabetically.
- **A category name follows the tag shape rule**: non-empty plain text that cannot contain `#`, `,`, `&`, `*`, double quotes, brackets, braces or parentheses. Case is kept; `Ramp` and `ramp` are one category with two spellings.
- **Stale names are kept, with a warning.** A `cards` key naming a card the list no longer holds loads with a warning. It is pruned by the list's own save (an editor session, an admin save), by a cross-list [`move`](/commands/move/) that rewrites the list (only when the move could read every card line in it), and by [`ritual cleanup`](/commands/cleanup/). [`ritual categories`](/commands/categories/) reports stale entries and never prunes them.
- **A malformed sidecar is refused as a whole.** It is never partially loaded and never silently overwritten. A list with an unreadable sidecar still saves.
- **Empty means gone.** A sidecar with no vocabulary and no cards is deleted rather than written as `{}`.
- **It has its own `.sha256`.** Unlike `<name>.art.json`, this sidecar is part of the list's recorded history. [`detect-changes`](/commands/detect-changes/) detects hand edits and records them in the **list's** `.changes.md` as `Set categories of "Sol Ring" to Ramp, Artifacts`, `Set category order to …`, or `Renamed category "Draw" to "Card Draw"`. A sidecar Ritual did not itself last write keeps its stale hash, so a hand edit is never silently declared recorded.

The sites read this file. The built site includes it in each list's detail JSON and offers the [Category groupings, sort and filter](/public-site/filtering/#grouping-sorting-and-filtering-by-category). The admin and public editors write it through their [Edit Categories… and Manage categories dialogs](/admin/editors/#card-categories). [`ritual export`](/commands/export/#properties)'s `categories`/`primaryCategory` columns read it, and a CSV import's [`categories` column](/commands/import/#value-normalization) writes it.

## The `.changes.md` changelog

Every list has an append-only `<name>.changes.md` file recording its card changes. Each entry is a `## <ISO timestamp>` heading, one prose `- ` line per change, then a fenced `ritual-changes` block holding the same changes as JSON Lines in the same order:

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

- **The block is authoritative.** Ritual reads only the `ritual-changes` block. The prose lines are for people (and translated for display on the sites) and are never parsed.
- **Hand-written text is preserved.** Prose you add after an entry's block travels with that entry through the [`history`](/commands/history/) editor and is written back verbatim.
- **It is a data format.** The prose is always English whatever the UI locale, and the file is git-diffable. Edit it with `history` or the admin [Change History](/admin/history/) page rather than by hand.
- **Legacy entries** written before the block existed are never converted. They keep their prose, yield zero events, and are named by an advisory.

## What `cleanup` normalizes

[`ritual cleanup`](/commands/cleanup/) is the migration for everything above. One pass rewrites every list in canonical form:

- bullets on deck lines, canonical token order and spacing, uppercase set codes, defaults omitted;
- flat-list quantities expanded to one line per copy;
- a legacy `name:` turned into the `# Title` H1, with `name:` and `created:` dropped (`tags:` and every other key kept);
- `&N` on every line;
- a card spelled with a repeated face (`Steam Vents // Steam Vents`, Scryfall's name for a reversible printing) renamed to the card's own name, with its category assignments moved along;
- each file renamed after its title;
- stale names pruned from the list's `.categories.json`, which is re-serialized canonically.

`--dry-run` previews all of it without writing. `cleanup` never touches a `.changes.md`. It is idempotent: a second run writes nothing.
