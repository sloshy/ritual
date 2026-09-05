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
| `labels`                        | deck, collection | The list's default [card labels](#card-labels), inherited by every line without its own `[labels]` token. A deck accepts `[proxy]` alone; a collection the whole vocabulary. Never on a wanted list.                 |
| `description`                   | all              | A prose blurb the [built site](/commands/build-site/) prints above the cards.                                                                                                                                        |
| `image`                         | all              | The list's [cover image](/list-images/) override — a `{card: N}`, `{file: …}` or `{url: …}` mapping.                                                                                                                 |
| `sourceId`, `sourceUrl`         | deck             | The deck's identity on its [sync source](/commands/deck-sync/).                                                                                                                                                      |
| `lastSynced`, `sourceUpdatedAt` | deck             | Stamped by `deck-sync`; never hand-edited.                                                                                                                                                                           |

Older files may carry `name:` or `created:`. Neither is a key today: the list's name is its `# Title` heading. Both are stripped from a deck on save, and [`cleanup`](/commands/cleanup/) moves an old `name:` into the H1.

### Default labels and descriptions

A deck or collection may declare **default labels** in its front matter, and every list type may carry a **description**, the blurb the built site prints above the cards:

```markdown
---
description: Everything I will trade away.
labels: [sale, trade]
---

# Trade Binder
```

Every entry without its own `[labels]` override inherits the default. On a collection, `labels:` takes `sale` and `trade` (together or alone), or `keep` or `proxy` (each alone). On a deck it takes `proxy` alone, the one label a deck line carries:

```markdown
---
format: commander
labels: [proxy]
---
```

Every deck line without its own `[labels]` token then counts as a proxy, which is how you mark a whole playtest deck without touching a single card line. An empty list (or no key) means no default. A value the deck cannot carry is dropped **whole** rather than filtered down: `labels: [sale, proxy]` is a statement about a deck this format cannot make, and keeping half of it would be a different statement. Such a value is also a **parse warning**, exactly like a refused card-line token. The next whole-file save deletes the key, so the warning names it and the whole-file-rewrite gates block until you fix it.

Set the default with [`ritual metadata set <list> labels …`](/commands/metadata/) (the surgical, front-matter-only write), the [`edit`](/commands/edit/) session's `🏷️ Edit List Labels` menu action (deferred to the session's next Save, which, like any session save, rewrites the whole file in canonical form), the admin editor's **Labels** button, by hand-editing the file, or via the MCP `set_list_metadata` tool.

How the block survives edits:

- **Card-line saves round-trip the block byte-for-byte**, unknown hand-authored keys included. A block whose YAML cannot be read is carried verbatim with an advisory rather than rejected.
- **A metadata edit re-dumps the YAML.** [`ritual metadata`](/commands/metadata/), the `edit` session's `🏷️ Edit List Labels` action, the admin **Labels** button, and `set_list_metadata` all rewrite the block: every key and value survives, but comments and quoting style do not.
- **The `edit` session's action refuses to run when the existing block's YAML cannot be read**, since a merge over keys it cannot see would clobber them. Fix the block by hand; every other session edit still carries it verbatim.

`description:` is written the same way, with [`ritual metadata`](/commands/metadata/), the admin/HTTP route, or `set_list_metadata`, and is the one key **every** list type carries. A wanted list carries `description:` and the cover [`image:`](/list-images/) (which [`set-list-image`](/commands/set-list-image/) writes) and nothing else of its own; any other block on one is preserved. A cover written from outside while an `edit` session is open is dropped by that session's next save, since the session re-emits the block it snapshotted when it opened.

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

| Token      | Spelling                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `- `       | the bullet                                    | Written on every line of every type.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `qty`      | an integer, decks only on write               | Decks always write one (`- 1 Sol Ring`). Flat lists never write one — one line per copy.                                                                                                                                                                                                                                                                                                                                                                |
| `Name`     | the card name, trimmed                        | Free text; tokens are peeled off the right-hand end, so a parenthesized word that is not a `SET:CN` pair (`Very Cryptic Command (Untap)`) stays in the name. A bracket token at the end of the line must be one the grammar knows — `[Alpha]` is `Unrecognized token [Alpha]` and refuses the line.                                                                                                                                                     |
| `(SET:CN)` | `(LEA:161)`                                   | Set code **uppercase in the file**, lowercase everywhere in memory; the collector number verbatim (`★`, `†`, letters allowed). Always a pair — a set without a collector number is not a printing.                                                                                                                                                                                                                                                      |
| `[finish]` | `[foil]`, `[etched]`                          | `nonfoil` is the default and is not written.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `[cond]`   | `[LP]`, `[MP]`, `[HP]`, `[DMG]`               | `NM` is the default and is not written.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `[lang]`   | `[ja]`, `[zhs]`, …                            | A lowercase [Scryfall language code](#card-language); English is the default and is not written.                                                                                                                                                                                                                                                                                                                                                        |
| `[labels]` | `[sale]`, `[sale,trade]`, `[keep]`, `[proxy]` | The line's label override. `sale` and `trade` combine; `keep` and `proxy` each stand alone.                                                                                                                                                                                                                                                                                                                                                             |
| `#tags`    | `#Ramp`, `#Card Draw, Ramp`, `#Binder: Trade` | The card's [tags](#card-tags): one `#`, then the tags **comma-separated** — a tag may hold spaces and keeps its case (`Card Draw`), and cannot contain `#`, `,`, `&`, brackets, braces or parentheses. Written deduplicated in sorted order; a line written with one `#` per tag (`#ramp #staple`) reads too. Allowed on every list type. The `#` is file punctuation only — no UI shows it. Not a label: a `Keep` tag has nothing to do with `[keep]`. |
| `{note}`   | `{any text}`                                  | A free-text note. Greedy to the **last** `}` on the line, so a note may contain braces; an empty `{}` is dropped.                                                                                                                                                                                                                                                                                                                                       |
| `&N`       | `&12`                                         | The persistent card ID, always last.                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
- a well-formed token the type does not carry. The message says so plainly, such as `[NM] is not a wanted list token — wanted lists never carry a condition.`, rather than reporting a mystery elsewhere on the line.

A collection line with no `(SET:CN)` is refused too (`missing-printing`), since a stored copy is a specific physical card.

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

## Card labels

A card entry can carry **labels**: a bracket token on its line (`[sale,trade]`, `[keep]`, `[proxy]`) declaring what you intend to do with that copy. Which labels a list type carries differs, because the vocabulary describes two different things:

| List type   | Labels it carries                |
| ----------- | -------------------------------- |
| Collection  | `sale`, `trade`, `keep`, `proxy` |
| Deck        | `proxy` only                     |
| Wanted list | none                             |

- **`sale`** ("For sale") and **`trade`** ("For trade") are the only two that combine, as `[sale,trade]`.
- **`keep`** ("To keep") and **`proxy`** ("Proxy") are each **exclusive**. Neither combines with any other label, including each other. A token like `[sale,keep]` or `[keep,proxy]` is a parse warning, as is one naming a label the list's type does not carry. The entry is kept and its labels dropped, and the warning blocks whole-file rewrites until it is fixed.
- **`proxy`** marks a copy that is not a real card, which is why it is the one label a deck carries. Proxied decks are normal, proxied collections are a matter of bookkeeping, and a wanted list is a list of cards you do not have yet. It has [pricing consequences](#proxies-carry-no-price).

A list can also declare a **default** in its front matter (`labels:`), which every entry without its own token inherits. See [Default labels and descriptions](#default-labels-and-descriptions). A card's _effective_ labels are its own token when present, else the list default. An override **replaces** the default; it never merges with it.

Set an override with [`set-card --label`](/commands/set-card/), the [`edit`](/commands/edit/#card-labels) session's `🏷️ Change Label` action, or, on a collection, the web editors' **Set Label…** menu item. `--label none` (or "Use list default") clears it. Every picker offers only what its list type carries, so on a deck the choice is **Proxy** or "use the list default", and asking for `sale` on a deck is a usage error naming the labels that type supports, never a silent drop. `set-card --label` is also the way to **repair** a line whose token the parser refuses. It replaces the token outright, so it is the one edit that is not blocked by it; every other edit to that line refuses rather than dropping the token silently, including a [`remove-card`](/commands/remove-card/) that would decrement the line's quantity.

Labels are part of a deck line's **identity** for merging purposes. Copies added by [`add-card`](/commands/add-card/), by the editors, or by a [`ritual move`](/commands/move/) join an existing line only when its label override matches theirs, so a proxy never disappears into the line holding the real copies, and never confers `[proxy]` on a real card added beside it.

### Proxies carry no price

A card whose effective labels include `proxy` is not a real card, so Ritual prices it at **zero** everywhere rather than looking a price up:

- [`price`](/commands/price/) reports it at `0` with the unpriced reason `proxy`, shows **PROXY** in its price cell instead of `N/A`, and counts it as a card but **not** as unpriced. A deck of proxies is fully priced at nothing, not a deck of price-lookup failures.
- The generated site bakes `0` in every currency, leaves proxies out of list totals and out of the missing-price counts, and never asks a buyer for a quote on one.
- [`sell`](/commands/sell/) drops proxy entries before matching, so they are never quoted, never counted, and never merged into an identical real copy.

[Custom art](/custom-art/#custom-art-carries-no-price) carries the very same rule on its own. One rule: custom art or proxy means no price, no quotes, no sale. A card with both reports the unpriced reason `custom-art` and shows **CUSTOM**. Custom art wins.

## Card tags

A card entry on **any** list type can carry **tags**: your own words for the card as a copy (`Signed`, `Trade Binder`, `Gift from Dad`), which follow the card wherever it moves. A card's role within one list (what Archidekt calls a category) is a separate, per-list thing, not a tag; see [Categories](#categories-namecategoriesjson) and [`ritual categories`](/commands/categories/). On the line, tags are one `#` token after the labels and before the note, **comma-separated**, as many as you like:

```
- 1 Sol Ring (LTC:284) [proxy] #Ramp, Staple &2
- Mox Ruby #Budget, Reserved List {any copy} &3
```

Tags are the open-vocabulary counterpart of [labels](#card-labels). A label is an instruction to Ritual drawn from a closed list (`[proxy]` changes pricing). A tag is your own word for the card and means whatever you meant. It drives [grouping, sorting and filtering](/public-site/filtering/#grouping-sorting-and-filtering-by-tags) on the generated site and selects cards for [`export --tags`](/commands/export/#filters). The two are different token kinds on purpose: a `Keep` tag is a perfectly legal tag with no connection to the `[keep]` label.

A tag is plain text. Spaces are fine (`Card Draw`) and its case is kept exactly as you wrote it (`Ramp` and `ramp` are two tags), but it cannot contain `#`, `,`, `&`, brackets, braces or parentheses, the line's own punctuation. A line's tags are written deduplicated and sorted. The `#` is file punctuation that marks where the tags start; the editors, the site and the changelog never show it.

A deck's front-matter `tags:` key is a different thing entirely. It describes the **deck** (`ritual metadata set <deck> tags edh,budget`, or the [`edit`](/commands/edit/#deck-format) session's `🔖 Edit Deck Tags` row) and never applies to any card. Only the `#tags` token on a card line holds card tags.

Edit a card's tags with [`set-card --tag` / `--untag`](/commands/set-card/#tag-updates), [`add-card --tag`](/commands/add-card/), or the editors' tag dialogs ([`ritual edit`](/commands/edit/#card-tags), the [admin editors](/admin/editors/#card-tags)). However the set is edited, the change is recorded **one changelog event per tag** that actually changed (`Added tag "Ramp" to "Sol Ring" &2`, `Removed tag "Staple" from "Sol Ring" &2`), never as a whole-set replacement. An add and a remove of the same tag on the same card cancel out, so re-adding a tag you removed earlier in a session leaves no trace in the changelog.

Like labels, tags are part of a deck line's **identity** for merging. Copies added with different tags land on their own line rather than folding into an existing one.

## Card language

Every card entry has a **language**, written as a lowercase bracket token in canonical position on the line: after the finish and condition, before labels and the note.

```
- Mana Crypt (2XM:270) [foil] [ja] [sale,trade] &3
- 3 Counterspell (LEA:55) [de] &12
- Sol Ring (C21:263) [zhs] &4
```

The vocabulary is **Scryfall's language codes** (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`), not ISO codes: Chinese is `zhs`/`zht`. The token is **omitted for English**. A bare line always means `en`, whatever the configured default, so a list file stays self-describing.

Adding a card **never prompts** for a language. New cards are stamped with the configured [`defaultLanguage`](/configuration/#default-language) (an [`edit` session](/commands/edit/#the-session-language) can override it for its own adds), and [`set-card --language`](/commands/set-card/) or an editor's language action changes an individual copy afterwards. Under a non-English default, the printing pickers note printings that do not exist in that language. Picking one records it in the language that does exist (English when available), rather than writing a language token Scryfall has no card object for. Language availability is checked against the card cache (which holds every language's objects when `defaultLanguage` is non-English), falling back to a direct Scryfall lookup when the cache cannot vouch for the printing.

## Wanted-list card states

Each card on a wanted list exists in one of three states, which determines how pricing works:

| State               | Format                          | Pricing Behavior                              |
| ------------------- | ------------------------------- | --------------------------------------------- |
| **Name only**       | `- Card Name`                   | Uses cheapest printing across all sets        |
| **Printing**        | `- Card Name (SET:CN)`          | Uses cheapest _finish_ of that exact printing |
| **Fully specified** | `- Card Name (SET:CN) [finish]` | Uses the exact printing and finish specified  |

## Fenced code blocks

List files are hand-authored markdown, so a deck, collection, or wanted list may carry a fenced code block: an example line, a template, a snippet of output. **Everything inside a fence is prose.** Card parsing ignores it completely: a card-looking line inside a fence is not a card, a `## Heading` inside a fence is not a section, an `&N` inside a fence is not a card ID, and none of it is reported as an unreadable line.

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

That file holds two cards. The `- Black Lotus (LEA:232) &99` line is an example: it is not counted, not priced, not exported, never offered by a picker, and never the target of `add-card`, `set-card`, `remove-card`, `note`, or `move`. `&99` is not "in use", so a future card may be assigned that ID. The `&N` backfill leaves fenced lines unstamped, and every line-preserving edit leaves the block byte-for-byte as you wrote it.

Both fence styles are recognized: three or more backticks or three or more tildes, indented by up to three spaces, with an optional info string (` ```markdown `). The closing fence uses the same character, is at least as long, and carries nothing after it. Fences do not nest; tildes inside a backtick fence are ordinary content, and vice versa. **An unclosed fence runs to the end of the file** (the CommonMark rule), so a stray ` ``` ` hides every card line below it. If cards go missing from a list, check for an unbalanced fence.

Inline code spans (`` `like this` ``) and four-space indented blocks are _not_ treated as code. Only fenced blocks are. A four-space indent is indistinguishable from a nested list item, so an indented block's card lines are read as real cards and its ` ``` ` delimiters as unreadable lines. Use a fenced block whenever a list file needs to hold prose card lines.

### Whole-file rewrites

The surfaces that rewrite a whole file from its parsed cards cannot re-emit a fenced block, so they treat one exactly as they treat an unreadable line:

| Surface                                                                               | Behavior with a fenced block                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The admin editors' save (and the MCP tools that reuse it)                             | Refuses with a `400` and writes nothing                                                         |
| [`cleanup`](/commands/cleanup/)                                                       | Reports the block and skips the content rewrite; a drifted file name is still corrected         |
| [`deck-sync`](/commands/deck-sync/) / [`collection-sync`](/commands/collection-sync/) | Held back by the unreadable-lines gate (`-y/--yes` accepts the loss)                            |
| [`import --append`](/commands/import/)                                                | Refuses and writes nothing                                                                      |
| A deck on either side of [`move`](/commands/move/)                                    | Refuses and writes nothing                                                                      |
| `ritual edit` sessions                                                                | **Warns on load and drops the block on the next save** — check the session output before saving |

The one-shot card commands (`add-card`, `set-card`, `remove-card`, `note`) are line-preserving and work normally, as does a `move` between two collections or wanted lists. The one exception is an **append into an unclosed fence**. Because an unclosed fence runs to end of file, a new card line appended at the end would be prose, so `add-card` and `move` refuse rather than write a line no later parse can see.

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
