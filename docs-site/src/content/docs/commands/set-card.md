---
title: 'set-card'
---

Update a card in place without opening an editor. You can change its printing, finish, condition, language, label, tags, categories, custom art, deck section, or commander status, in a deck, collection, or wanted list.

Only the targeted card's line is rewritten (or moved, for section and commander changes). Everything else in the file stays intact, including prose, comments, unusual headings, and lines the parser cannot read. A `--section`/`--commander` move may also create the destination's `## Section` heading when it does not exist yet.

## Usage

```bash
ritual set-card [listName] [cardName...] [options]
```

`[listName]` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to fix the type or disambiguate.

With no list name, the command prompts you to pick a list and then a card. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), omitting `[listName]` or a card selector (`[cardName...]` or `--card-id`) is a usage error (exit `2`). At least one mutation flag is required.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name to update (fuzzy match)                                                         | No       |

## Options

| Option                      | Description                                                                                                                  | Default |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`                    | Resolve the name as a deck                                                                                                   |         |
| `--collection`              | Resolve the name as a collection                                                                                             |         |
| `--wanted`                  | Resolve the name as a wanted list                                                                                            |         |
| `--card-id <id>`            | Disambiguate by card ID (the `&N` suffix in list files). Required when the name matches several printings.                   |         |
| `--set <code>`              | New set code (requires `--collector-number`)                                                                                 |         |
| `--collector-number <cn>`   | New collector number (requires `--set`)                                                                                      |         |
| `--finish <finish>`         | New finish: `nonfoil`, `foil`, or `etched` (case-insensitive)                                                                |         |
| `--condition <condition>`   | New condition: `NM`, `LP`, `MP`, `HP`, `DMG`, or `NONE` to clear it (case-insensitive; decks and collections only)           |         |
| `--language <code>`         | New language as a Scryfall code (`ja`, `de`, `zhs`, ...); aliases like `jp`/`Japanese` normalize; `en` clears the token      |         |
| `--label <labels>`          | New label override: `sale,trade` (combinable), `keep` or `proxy`, or `none` to clear it (decks take `proxy` only)            |         |
| `--tag <tags>`              | Add these [tags](/list-format/#card-tags) to the card, comma-separated (`"Ramp, Card Draw"`); any list type                  |         |
| `--untag <tags>`            | Remove these tags from the card, comma-separated; any list type                                                              |         |
| `--categories <categories>` | Set the card's [categories](/commands/categories/) in this list, comma-separated (`"Ramp, Artifacts"`); the first is primary |         |
| `--no-categories`           | Clear the card's categories in this list                                                                                     |         |
| `--art <value>`             | Custom art: an image path relative to the art directory, an `http(s)` URL, or `none` to clear it                             |         |
| `--section <name>`          | Move the card to this deck section, creating it if missing (decks only)                                                      |         |
| `--commander`               | Move the card to the deck's Commander section (decks only)                                                                   |         |
| `--no-commander`            | Move the card out of the Commander section back to the main section (decks only)                                             |         |
| `-n, --dry-run`             | Report what would change without writing anything                                                                            | `false` |
| `--output <format>`         | Output format: `text`, `json`, or `ndjson`                                                                                   | `text`  |
| `--quiet`                   | Suppress non-essential output                                                                                                | `false` |

You can combine several mutation flags in one invocation. Each is applied and reported.

## Examples

Change a card's finish:

```bash
ritual set-card --deck "My Deck" Sol Ring --finish foil
```

Switch to a different printing (validated against the Scryfall cache):

```bash
ritual set-card --collection main "Lightning Bolt" --set 2xm --collector-number 157
```

Change the printing and finish together, targeting a specific entry:

```bash
ritual set-card --collection main --card-id 12 --set lea --collector-number 161 --finish nonfoil
```

Downgrade a collection card's condition:

```bash
ritual set-card --collection main "Mana Crypt" --condition LP
```

Mark a copy as Japanese, or back to English (the token is removed, since a bare line means English):

```bash
ritual set-card --collection main "Sol Ring" --language ja
ritual set-card --collection main "Sol Ring" --language en
```

Move a deck card to the sideboard section and capture JSON output:

```bash
ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --section Sideboard --output json
```

The JSON payload is `{ type, list, cardName, cardId, applied, writtenFiles }`, plus `dryRun: true` under `--dry-run`. `applied` holds one entry per change made, such as `"printing → 2XM:157"`, `"finish → foil"`, `"condition → LP"`, `"language → ja (Japanese)"`, `"label → sale, trade"`, `"tags added → Card Draw, Ramp"`, `"tags removed → Ramp"`, `"categories → Ramp, Artifacts"`, `"categories cleared"`, `"custom art → proxies/sol-ring.jpg"`, `"section → Sideboard"`, `"commander"`, or `"not commander"`.

`writtenFiles` lists the absolute paths the run wrote: the list file and its `.sha256` (only when a card line actually changed), the `.changes.md` changelog, and any sidecar file the run touched (`<list>.categories.json` and its `.sha256`, `<list>.art.json`). It is empty on a dry run.

Make a card the deck's commander:

```bash
ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --commander
```

## Behavior

### Card Resolution

Cards are matched the same way as in [`note`](/commands/note/): a fuzzy name match (case-, accent-, and punctuation-insensitive; exact name preferred, then substring), `--card-id` for a precise target, or an interactive picker when neither is given. An ambiguous name match exits with a `usage_error` listing each candidate.

When both a card name and `--card-id` are given they must agree: the ID's entry has to match the name. A disagreement is a usage error naming both (`--card-id 3 is 'Demonic Tutor', which does not match 'Lightning Bolt'.`). This catches a stale ID that was reused for another card after a removal.

### Printing Validation

`--set` and `--collector-number` must be given together. The pair is validated against the card's printings in the local Scryfall cache; an unknown pair is a usage error listing up to 10 available printings. If the printing lookup itself fails (empty or unreachable cache), the command exits with a runtime error; refresh the cache with [`cache`](/commands/cache/).

If the cache has no entry for the card at all, the pinned printing is verified with Scryfall in a single request. Scryfall confirming it is accepted, a printing that belongs to a different card is a usage error (`STA:90 is 'Other Card', not 'This Card'`), and an unreachable Scryfall is a runtime error (exit `1`).

Whenever `--finish` is given, alone or with other flags, the finish is validated against the printing the line will carry: the new one when pinned, otherwise the one the entry already has. A finish the printing doesn't come in is a usage error listing the finishes it does offer.

When you change the printing **without** `--finish`, the card's current finish is carried onto the new printing and validated there too. Repinning a `[foil]` entry to a printing with no foil is a usage error telling you to pass `--finish` to record an available one.

Validating `--finish` against an entry's **existing** printing uses only the cache; no network fetch is made for an in-place edit. When the cache cannot vouch for the printing, the check is skipped with a note on stderr and the edit proceeds. The note names one of two reasons: the cache holds no complete printing list for the card (fixable with `ritual cache preload-all`), or the entry is pinned to a printing the cache does not know at all (no preload will fix that).

### A Finish Belongs To A Printing

`--finish foil` and `--finish etched` require the line to name a printing. On a deck or wanted-list line with no `(SET:CN)`, the edit is a usage error (exit `2`). Pass `--set` and `--collector-number` in the same invocation to pin a printing and record the finish together:

```bash
ritual set-card --deck "My Deck" "Sol Ring" --set c19 --collector-number 221 --finish foil
```

`--finish nonfoil` is always accepted: it clears a finish token rather than asserting one, so a hand-written `[foil]` on a printing-less line can still be removed. On a printing-less line, `--finish foil` combined with `--condition` is also refused: that pairing is recorded as a printing update, but it still writes the finish token.

The rule holds everywhere an **existing** line's finish is edited: the site editors grey out "Set as Foil" until a printing is chosen, `ritual edit` offers the finish action only on a pinned entry, and the [MCP](/commands/mcp/) `apply_changes` and `set_card_printing` tools refuse it too (a `set-printing` earlier in the same batch satisfies it).

**Creating** a line is different. `ritual add-card ... --wanted --name-only --finish foil` still records "any printing, in foil", and deck imports and cross-list moves may likewise carry a finish onto a line they create. Once such a line exists, clearing its finish is one-way: setting it back to `foil` needs a printing.

### Condition Updates

Condition applies to decks and collections only; wanted-list entries never track condition. `--condition NONE` clears a recorded grade, matching [`add-card`](/commands/add-card/).

**`NM` is the default and is never written.** The line format omits a `[NM]` annotation, so `--condition NM` and `--condition NONE` produce the same ungraded line. The success output says so: `condition → NM (written as an ungraded line — NM is the default)` and `condition → none (grade cleared)`.

There is no standalone "set condition" change event. A condition change is recorded as a printing update carrying the card's current set, collector number, and finish, so in the changelog it appears as, for example, `Set "Mana Crypt" printing to 2XM:1 [foil] [LP] &2`.

### Label Updates

`--label` sets the card's [label override](/list-format/#card-labels), and `--label none` clears it so the list's front-matter default applies again. Which labels are accepted depends on the list type:

- **Collection**: the whole vocabulary. `sale` and `trade` combine as `sale,trade`; `keep` and `proxy` each stand alone.
- **Deck**: `proxy` only.
- **Wanted list**: no labels.

A label the type does not carry is a usage error (exit `2`) naming the offending labels and the ones that type supports. It is never silently dropped.

`--label` is also the only edit that can **repair** a line whose existing `[labels]` token the parser refuses (`[sale,keep]`, or a label the type does not carry). It replaces the token outright; every other edit to that line refuses rather than dropping the token.

```bash
ritual set-card --collection main "Sol Ring" --label keep
ritual set-card --collection main "Sol Ring" --label sale,trade
ritual set-card --deck "Winota Stax" "Sol Ring" --label proxy
ritual set-card --deck "Winota Stax" "Sol Ring" --label none
```

A `proxy` card is priced at zero everywhere and is excluded from buylist and sell reports. See [Proxies carry no price](/list-format/#proxies-carry-no-price).

### Tag Updates

`--tag` adds [tags](/list-format/#card-tags) to the card's line and `--untag` removes them, on **every** list type. Either flag takes one or more tags **separated by commas**. Spaces are part of a tag, so `--tag "Card Draw, Ramp"` is two tags, kept in the case you wrote them. A tag cannot contain `#`, `,`, `&`, brackets, braces or parentheses; one that does is rejected at parse time (exit `2`).

Tags the line already carries are left alone: `--tag` never replaces the set, and `--untag` removes only the tags it names. Only the tags that actually change are recorded; a `--tag` or `--untag` in which nothing changed reports `tags unchanged (…)`. Naming the same tag in both flags is a usage error. Repeating a flag accumulates (`--tag ramp --tag staple` is `--tag ramp,staple`). An empty value (`--tag ""`) is refused at parse time, unlike the editor's tag prompt, where an empty field clears the tags.

Tags are your own vocabulary, unrelated to labels. A `Keep` tag has nothing to do with the `[keep]` label, and a deck's front-matter `tags:` key belongs to the deck, never to its cards.

```bash
ritual set-card --collection main "Sol Ring" --tag "ramp, staple"
ritual set-card --collection main "Sol Ring" --untag ramp
ritual set-card --deck "Winota Stax" "Sol Ring" --tag edh-staple
ritual set-card --wanted needs "Mox Ruby" --tag budget --untag reserved-list
```

The line is rewritten with its tags in canonical order (`- Sol Ring (C21:240) #Card Draw, Ramp &1`). Each tag that changed is its own changelog line (`Added tag "Ramp" to "Sol Ring" &1`, `Removed tag "Staple" from "Sol Ring" &1`).

### Category Updates

`--categories` sets the card's [categories](/commands/categories/) in this list, on **every** list type, and `--no-categories` clears them. A category is neither a tag nor a label. It belongs to the card's **name** in **this one list**: the assignment covers every line of that name whatever its printing, section or quantity, it is never written on the card line, and it does **not** follow the card when it moves to another list.

The value is one or more categories **separated by commas**. Spaces and case are part of a name, so `--categories "Board Wipes, Ramp"` is two categories. The **first one is the card's primary category**, which the site groups by. A name cannot contain `#`, `,`, `&`, `*`, quotes, brackets, braces or parentheses; one that does is rejected at parse time (exit `2`). Repeating the flag appends (`--categories Ramp --categories Draw` is `--categories "Ramp, Draw"`), because order matters.

Unlike `--tag`, the flag is a **whole-list replacement**: whatever the card had is replaced by what you pass. An empty value (`--categories ""`) is a usage error, not a clear; `--no-categories` is the clear. If both flags appear on one command line, the last one wins.

```bash
ritual set-card --deck "Winota Stax" "Sol Ring" --categories "Ramp, Artifacts"
ritual set-card --collection main "Rhystic Study" --categories Draw
ritual set-card --wanted needs "Mana Crypt" --no-categories
```

The card line is byte-identical afterwards. When `--categories`/`--no-categories` is the run's **only** change, the list `.md` is not rewritten, so neither it nor its `.sha256` appears in `writtenFiles`. The assignment is written to the list's `<list>.categories.json` sidecar file and its `.sha256`, both reported in `writtenFiles`. The hash is refreshed only when it matched the sidecar before the write, so a hand-edited sidecar keeps its stale hash. The changelog records `Set categories of "Sol Ring" to Ramp, Artifacts` or `Cleared categories of "Sol Ring"`, even when the new list equals the old.

If `<list>.categories.json` cannot be parsed, `set-card` does **not** fail. It writes the card line and changelog entry as usual and leaves the sidecar untouched, so nothing on disk is destroyed, but the assignment is not stored. Run [`ritual categories list`](/commands/categories/), which exits `1` with the parse error, to see why.

This command never **prunes** the sidecar. An entry naming a card the list no longer holds survives until the list's own save, a cross-list `move` that rewrites the list, or [`ritual cleanup`](/commands/cleanup/).

### Custom Art

`--art` records [custom art](/custom-art/) for the card on every list type. The value is one of:

- an image path **relative to the [art directory](/configuration/#directory-options)** (`proxies/sol-ring.jpg`): forward slashes only, never escaping that directory, and ending in `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, or `.webp` (the extensions the art route serves);
- an absolute `http(s)` URL (`https://example.com/bolt.png`), stored verbatim, with no extension rule;
- `none`, which removes whatever art the card carried.

```bash
ritual set-card --deck "Winota Stax" "Sol Ring" --art proxies/sol-ring.jpg
ritual set-card --collection main "Lightning Bolt" --art https://example.com/bolt.png
ritual set-card --wanted "My Wants" "Mana Crypt" --art none
```

A path is checked against the configured art directory **before** anything is written. A missing file is a `not_found` (exit `3`) naming the absolute path checked and the art directory; an unreadable file is a runtime error (exit `1`); a directory is a usage error. A malformed value (a backslash, an absolute path, a `..` escape, a non-image extension, a non-`http(s)` URL) is rejected by argument parsing, exit `2`.

The reference is filed under the card's `&N` id in the list's `<list>.art.json` sidecar, so a line with no id yet is refused rather than guessed at. Art is list **metadata**: it is written straight to the sidecar with no change event, no changelog entry, and no `.sha256` refresh. `--art` counts as a change, so it can be the only flag, and an `--art`-only run does not rewrite the list file at all.

Applied output reads `custom art → proxies/sol-ring.jpg` (or `custom art → none (cleared)`).

A card with custom art is priced at zero everywhere and excluded from buylist and sell reports, exactly like a `proxy`. See [Custom art carries no price](/custom-art/#custom-art-carries-no-price).

### Language Updates

`--language` works on all three list types and takes a Scryfall language code: `en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`. Note `zhs`/`zht` for Chinese, not ISO codes. Common aliases (`jp`, `kr`, `sp`, `cs`, `ct`, full English names like `Japanese`) normalize to the canonical code before anything is written.

The token is written in canonical position on the line (`- Sol Ring (C21:263) [foil] [LP] [ja] &7`) and **omitted for English**. `--language en` removes the token, because a bare line always means `en`. The success output says what was written: `language → ja (Japanese)`, or `language → en (token cleared — a bare line means English)`.

Unlike `--finish`, a non-English value may be checked online. The check is cache-first: the cached printing list can prove the language is available, and, when the cache is complete and was built from the `all_cards` bulk data, prove it is not. Otherwise the printing is verified directly with Scryfall (`GET /cards/{set}/{cn}/{lang}`). A printing with no object in that language is a usage error (exit `2`). Only an unreachable API downgrades the check to a note (`Note: could not verify that C21:263 exists in Japanese (ja) — Scryfall could not be reached. Recording it as asserted.`) and lets the edit proceed. An entry with no `(SET:CN)` printing goes unchecked, since there is nothing to verify against.

In the changelog the change appears as `Set language of "Sol Ring" to Japanese &7`.

### Sections and Commander

`--section` moves the card to the named deck section, creating it at the end of the deck if missing. `--commander` moves the card into the deck's `Commander` section (created at the top if missing), and `--no-commander` moves it back out to the first regular section. If both appear on one command line, the last one wins.

### Dry Runs

`-n` / `--dry-run` resolves the list and the card and runs every validation, including the ones raised by the apply itself (performed in memory and discarded), so a preview never reports an edit the real run would refuse. It then reports the change it _would_ apply and stops. Nothing is written: no list file, changelog, `.sha256`, `.art.json`, or `.categories.json`, and the card-ID backfill is skipped too. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true` alongside the usual fields. Because the backfill is skipped, a dry-run `--art` against a list whose lines have no `&N` ids yet reports the missing id rather than inventing one.

### Change Tracking

Every applied change is recorded in the list's `.changes.md` changelog in a single block per invocation (`Set ... finish to foil`, `Set ... printing to 2XM:157`, `Set labels on ... to [proxy]`, `Added tag "Ramp" to ...`, `Moved ... to section "Sideboard"`, `Set ... as commander`, and so on). A `--tag`/`--untag` whose every tag was already in its requested state records nothing.

`--categories` is recorded as `Set categories of "Sol Ring" to Ramp, Artifacts` (or `Cleared categories of "Sol Ring"`) even when the value is unchanged, because it is a whole-list event rather than a per-category delta.

`--art` is the exception: [custom art](/custom-art/) is list metadata, written to the `.art.json` sidecar with no changelog entry at all.

## Exit Codes

| Code | Meaning                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                 |
| `1`  | Runtime error (Scryfall printing lookup failed, an unreadable `--art` file or `.art.json` sidecar, a card line with no `&N` id to file art under, etc.) |
| `2`  | Usage error (see below)                                                                                                                                 |
| `3`  | Not found (missing list file, missing card, missing card ID, an `--art` file that is not in the art directory)                                          |

Exit `2` covers: no mutation flags; a `--card-id` that disagrees with the card name; `--set` without `--collector-number`; an unknown printing; an unavailable finish; a foil/etched finish on a line that names no printing; a language the printing has no Scryfall object in; a label the list type does not carry; a malformed tag, or the same tag given to both `--tag` and `--untag`; a malformed category name or an empty `--categories` value; a malformed `--art` value or one naming a directory; a flag not valid for the list type; an ambiguous list or card; and prompts unavailable for interactive list/card selection.
