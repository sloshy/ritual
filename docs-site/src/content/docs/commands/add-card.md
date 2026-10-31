---
title: 'add-card'
---

Add a card to a deck, collection, or wanted list by name.

You pick the card from the local card cache with an autocomplete prompt. If the cache is empty or older than 7 days, you are offered a refresh first. Every prompt can be preempted with a flag, and `--output json` emits a machine-readable result, so the command is fully scriptable.

## Usage

```bash
ritual add-card <targetName> <cardName...> [options]
```

`<targetName>` names a list of any type (see [List Names](/list-resolution/)). Pass `--deck`, `--collection`, or `--wanted` to fix the type, or put a `deck:`/`collection:`/`wanted:` prefix on the name (`collection:Main Binder`). A flag or a type prefix is required when the name is ambiguous, and when you want to **create** a missing collection or wanted list (see [List Resolution](#list-resolution)). A prefix that contradicts the flag is a usage error (exit `2`) naming both.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `<targetName>`  | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |
| `<cardName...>` | Name of the card to search for                                                            | Yes      |

## Options

| Option                     | Description                                                                                                          | Default | Applies To               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------ |
| `--deck`                   | Resolve the name as a deck                                                                                           |         |                          |
| `--collection`             | Resolve the name as a collection (your first collection is created if missing)                                       |         |                          |
| `--wanted`                 | Resolve the name as a wanted list (your first wanted list is created if missing)                                     |         |                          |
| `--create`                 | With `--collection` or `--wanted`: create the list if no list of that name exists, even beside existing ones         |         | Collection, Wanted       |
| `-q, --quantity <num>`     | Number of copies to add (positive integer)                                                                           | `1`     | Deck only                |
| `-f, --finish <finish>`    | Card finish: `nonfoil`, `foil`, `etched`                                                                             |         | Deck, Collection, Wanted |
| `-c, --condition <cond>`   | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG`, or `NONE` to record no condition                                      |         | Deck, Collection         |
| `--language <code>`        | Card language as a Scryfall code (`ja`, `de`, `zhs`, ...); see [Language](#language)                                 |         | Deck, Collection, Wanted |
| `--label <labels>`         | Adjust the list default for the new card: `sale,trade`, `keep`, `proxy`, or `no-<label>` (decks: `proxy`/`no-proxy`) |         | Deck, Collection         |
| `--tag <tags>`             | [Tag](/list-format/#card-tags) the new card, comma-separated (`"Ramp, Card Draw"`); repeatable                       |         | Deck, Collection, Wanted |
| `--section <name>`         | Deck section to add to, created at the end of the file if missing                                                    |         | Deck only                |
| `--commander`              | Add the card to the deck's Commander section (created at the top if missing)                                         |         | Deck only                |
| `-e, --exact`              | Use exact matching (skip selection if name matches)                                                                  | `false` |                          |
| `--set <code>`             | Pin an exact printing by set code (requires `--collector-number`)                                                    |         |                          |
| `--collector-number <num>` | Pin an exact printing by collector number (requires `--set`)                                                         |         |                          |
| `--name-only`              | Add the card by name without choosing a printing                                                                     |         | Wanted only              |
| `--specific`               | Record a specific printing (via `--set`/`--collector-number` or interactive picker)                                  |         | Wanted only              |
| `--refresh <mode>`         | Card cache refresh policy: `ask`, `auto`, `no-bulk`, or `never`; see [Cache Freshness](#cache-freshness)             | `ask`   |                          |
| `-n, --dry-run`            | Report what would be added without writing anything                                                                  | `false` |                          |
| `--output <format>`        | Output format: `text`, `json`, or `ndjson`                                                                           | `text`  |                          |
| `--quiet`                  | Suppress non-essential output                                                                                        | `false` |                          |

Rules on combining flags:

- `--deck`, `--collection`, and `--wanted` are mutually exclusive, as are `--name-only` and `--specific`.
- A flag that does not apply to the resolved list type is a usage error, not ignored. Examples: `--condition` on a wanted list, `--section` on a collection, `--label` on a wanted list, `--label sale` on a deck (decks only take `proxy` and `no-proxy`), `--name-only` on a deck, or `--quantity` other than `1` on a collection or wanted list.
- Invalid `--finish`, `--condition`, `--label`, `--tag`, and `--quantity` values are rejected at parse time. An empty `--tag` is invalid.
- Omitting `--label` inherits the list's default labels. A `--label` [adjusts](/list-format/#card-labels) that default: `--label no-proxy` adds a real card to a `proxy`-default deck, `--label trade,no-sale` a for-trade-only card to a `sale` binder.

## Examples

Add a single card to a deck (resolved by name across all types):

```bash
ritual add-card "My Deck" Sol Ring
```

Pin the type explicitly when a name could be ambiguous:

```bash
ritual add-card --deck "My Deck" Lightning Bolt -q 4
```

Pin an exact printing onto a deck line:

```bash
ritual add-card --deck "My Deck" Sol Ring --exact --set C21 --collector-number 263
```

Add a foil straight into a deck's Sideboard, or a commander into its Commander section:

```bash
ritual add-card --deck "My Deck" Lightning Bolt --exact \
  --set STA --collector-number 42 --finish foil --section Sideboard
ritual add-card --deck "My Deck" Kenrith, the Returned King --exact --commander
```

Preview an add without touching a file:

```bash
ritual add-card --deck "My Deck" Sol Ring --exact -q 4 --dry-run
```

Fully scripted collection add, with no prompts and a machine-readable result:

```bash
ritual add-card --collection "Main" Lightning Bolt --exact \
  --set STA --collector-number 42 --finish etched --condition LP --output json
```

Record no condition without being asked for one:

```bash
ritual add-card --collection "Main" Sol Ring --exact \
  --set LEA --collector-number 270 --condition NONE
```

Add a name-only wanted entry with a finish preference:

```bash
ritual add-card --wanted "My Wants" Demonic Tutor --exact --name-only --finish foil
```

Add a wanted entry pinned to a printing (the pin implies `--specific`):

```bash
ritual add-card --wanted "My Wants" Lightning Bolt --exact --set STA --collector-number 42
```

## Behavior

### List Resolution

`<targetName>` follows the rules in [List Names](/list-resolution/). A `--deck`/`--collection`/`--wanted` flag restricts the search to that type.

A missing **collection** or **wanted list** can be created by the add, but only when the type is fixed by a flag or a `collection:`/`wanted:` prefix:

- When the workspace has **no** list of that type yet, the first one is created automatically. This is the first-run case.
- Beside existing lists of that type, a name that matches none of them is **refused** (exit `3`) as a likely typo, naming the closest existing lists. Pass `--create` to create the new list anyway:

  ```text
  $ ritual add-card --collection "Trade Bindr" "Sol Ring"
  No collection named 'Trade Bindr' found. Did you mean 'Trade Binder'? To start a new collection with that name, add --create.
  ```

`--create` needs the type pinned to a collection or wanted list; with `--deck` or no type it is a usage error (exit `2`). Decks are never auto-created: create them first with [`new deck`](/commands/new/). A missing deck's error suggests the closest deck names the same way.

The file is created **at write time**, after every validation has passed. A failed add (empty card cache, unknown printing pin, cancelled prompt) or a `--dry-run` never leaves an empty list file behind.

### Card Selection

The card name filters the local card cache, and an autocomplete prompt lets you narrow the list and pick the card.

Your input is split on whitespace, and **every term must appear in the card name**, in any order. `in tre` finds "In the Trenches", and `bolt light` finds "Lightning Bolt". Case, accents, and punctuation don't have to match (`jaces archivist` finds "Jace's Archivist"). The same rule applies to the name on the command line and to what you type at the prompt.

Suggestions are ordered by EDHRec popularity, with closer matches first:

1. A card whose **whole name** you typed (`The End` puts the card "The End" at the top). The front face of a double-faced card counts as its whole name.
2. Cards whose name starts with your input.
3. Cards whose words your terms begin (this keeps "In the Trenches" above the many cards that merely contain `in tre`).

With `--exact`, the name is normalized (case and accents folded, punctuation stripped) and compared against all cached card names. Exactly one match is selected automatically with a confirmation message. No match is an error that reports how many cards match your terms (counted up to 100, shown as "100+" past that).

When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), the autocomplete prompt cannot run. An input that exactly matches a cached card name is accepted as if `--exact` were passed; anything else is a usage error. The first suggestion is never picked silently.

### Printing Pins

`--set` and `--collector-number` (always together) pin the add to one exact printing:

- **Deck**: the printing is written onto the deck line (`3 Sol Ring (C21:263) &7`).
- **Collection**: skips the interactive printing picker.
- **Wanted**: skips the printing picker and implies the specific-printing flow.

The pair is validated strictly against the card's known printings, with no fuzzy or fallback matching. An unknown combination is a usage error listing up to 10 available printings (also `details.available` in JSON error output).

If the card cache has no entry for the card, the pin is verified with Scryfall in a single request. Scryfall confirming it is accepted, Scryfall rejecting it is a usage error, and an unreachable Scryfall is a runtime error (exit `1`).

Without a pin, a run where prompts are unavailable succeeds only when the card has a single paper printing. Several candidates fail with an error rather than guessing.

### Printing and Finish Prices

The interactive printing picker shows each printing's price in the currency of your configured [`defaultPriceSource`](/configuration/#default-price-store), in one right-hand column per finish (nonfoil first, then foil/etched, with non-nonfoil amounts labelled like `$14.93 foil`). A blank cell means the printing doesn't come in that finish; `N/A` means the card cache has no price for it in that currency. The finish prompt then prices each finish beside its label. See [`edit`](/commands/edit/#printing-and-finish-prices) for examples.

### Finish and Condition

`--finish` is checked twice. The value must be `nonfoil`, `foil`, or `etched` (rejected at parse time otherwise). Once a printing is resolved, a finish that printing doesn't come in is a usage error listing the finishes that do exist (also `details.availableFinishes` in JSON).

`--condition` accepts the usual grades plus `NONE`, which records **no** condition and skips the condition prompt (the scripting equivalent of answering "Don't Care"). With no terminal to prompt on, a collection add without `--condition` fails rather than guessing. Deck adds never prompt for finish or condition; both are optional there.

`NM` and `NONE` produce the same line: an unannotated line reads as `NM`, so `NM` is written without a `[NM]` annotation (see [`set-card`](/commands/set-card/#condition-updates)).

### Language

`--language` records the copy's language as a lowercase Scryfall code: `en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`. These are Scryfall's codes, not ISO codes, so Chinese is `zhs`/`zht`. Common aliases normalize to the canonical code (`jp` → `ja`, `kr` → `ko`, `sp` → `es`, `cs` → `zhs`, `ct` → `zht`, and full English names like `Japanese`).

Adding **never prompts** for a language. Without the flag, the configured [`defaultLanguage`](/configuration/#default-language) is stamped on the new card.

On the line, the language is a bracket token in canonical position (`- Sol Ring (C21:263) [foil] [LP] [ja] &7`) and is **omitted for English**. A bare line always means `en` whatever the configured default, so files stay self-describing. `--language` is recorded as given: only the printing pin is verified, not the language. To change a copy's language with verification against the printing's real languages, use [`set-card --language`](/commands/set-card/#language-updates).

### Cache Freshness

Before the autocomplete prompt, the command checks the card cache. `--refresh <mode>` decides what happens:

- Cache **empty**: `ask` (the default) prompts to download the card database (default yes); `auto` downloads without prompting. If it isn't downloaded (prompt declined or unanswerable, or mode `no-bulk` / `never`), the command fails with a hint to run `ritual cache preload-all` or re-run with `--refresh auto`.
- Cache **older than 7 days**: `ask` prompts to update it (default no); `auto` updates without prompting; `no-bulk` / `never` use it as-is.
- Cache **fresh**: the command proceeds immediately.

Under `ask`, a prompt that can't be answered (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)) is declined, never resolved to its default.

### Dry Runs

`-n` / `--dry-run` resolves the list and card, runs every validation (printing pin, finish availability, flag applicability), reports the line that _would_ be written, then stops. No list file, changelog, or `.sha256` sidecar is written, no missing list is created, and the card-ID backfill is skipped, so the workspace is left byte-for-byte as it was. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true`.

### Change Tracking

Every add records a change event in the `.changes.md` changelog beside the target file, including the `&N` card ID allocated for the new line. Deck adds record **one event per copy**, so `-q 4` writes four `Added` entries. The site's change history view reads this changelog.

### Deck Mode

The card is selected via autocomplete (or `--exact`) and then added through the same change engine the editors and the admin site use, so a CLI add and an editor add produce identical files.

How the card lands in the deck:

- **Copies merge onto an existing line** for the same card when the printing (set, collector number, finish, condition, language), the effective labels (each line's override applied to the deck's default), and the tags all match. The merged line keeps its `&N` ID and any `{note}`. Labels are part of that identity: `--label proxy` on a card the deck already runs for real adds a second, `[proxy]` line rather than folding the proxies into the real copies.
- **Merging and placement.** Without `--section`, copies join the deck's existing line for the same printing wherever it lives, and `--commander` then moves that whole line (every copy) into the Commander section. With `--section`, copies join a line of the same printing **in that section** only; when the section has none, they start a new line there, even if another section already runs the printing. The changelog records the section the copies landed in.
- **Section names resolve to the deck's own sections.** `--section` matches an existing section case-insensitively (`sideboard` is `## Sideboard`). A reserved name means the deck's first section of that role: a main-deck alias (`Main`, `Mainboard`, `Deck`) is the first main-deck section, such as `## Creatures`, or the card lines above the first heading when the deck has any. `Signature Spell` and `Oathbreaker` are kept apart. Any other name is a new section, created at the end of the file. A name that resolves to an existing section never creates a new one: to start a second section under such a name, add the empty section first (the editors' section manager), then place cards in it by that name.
- **A new line is appended at the end of its section**: the section named by `--section`, the Commander section under `--commander`, otherwise the deck's first main-deck section (the card lines above the first heading when there are any, else the first section that is not a commander, oathbreaker, signature spell, companion, sideboard, or extras section). A deck organized as `## Mainboard` keeps that one main section instead of gaining a `## Main`. A deck whose body is bare card lines with no headings is one implicit Main section, and the card joins after its last card line. Only a deck with no card lines at all gets a `## Main` created.

Deck entries record the card name and quantity, plus the set code and collector number when pinned, and `[finish]`/`[condition]`/`[labels]`/`#tags` annotations when the matching flags are given. `proxy` (and `no-proxy`) is the only label a deck line takes (see [Card Labels](/list-format/#card-labels)); tags are free-form on every type (see [Card Tags](/list-format/#card-tags)). A `--finish` on a deck add is validated only when `--set`/`--collector-number` pin a printing, since an unpinned deck line records no printing to check against.

### Collection Mode

1. The card is selected via autocomplete (or `--exact`).
2. The printing comes from the `--set`/`--collector-number` pin, or you are prompted to select one.
3. Finish and condition come from `--finish`/`--condition`, or you are prompted.
4. The entry is appended to the collection file in `collections/`.

Collection entries always record the specific printing (set code and collector number).

There is no implicit condition; pass `--condition NONE` to record none. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), a run missing `--condition`, or missing `--finish` on a printing that comes in more than one finish, is a usage error (exit `2`) naming the flag. Exit `0` always means a line was written.

### Wanted List Mode

1. The card is selected via autocomplete (or `--exact`).
2. Specificity comes from `--name-only`, `--specific`, or a printing pin. With none of them you are prompted: **Name only (any copy)** appends just the card name; **Choose specific printing** runs the printing picker followed by a finish prompt. When prompts are unavailable, one of the flags is required (exit `2` otherwise).
3. The entry is appended to the wanted list file in `wanted/`.

As with collection adds, a specific-printing add whose printing comes in more than one finish requires `--finish` when prompts are unavailable (exit `2`). Only the name-only flow is finish-optional.

In the specific flow, a printing that cannot be resolved (no pin and no way to ask) is an **error**; the command never silently downgrades a specific request to a name-only entry. Wanted entries require only the card name; printing and finish are optional (see the [card states](/list-format/#wanted-list-card-states)). A finish preference can be given with `-f`.

### Fenced Code Blocks

An add preserves existing lines. A card-looking line inside a [fenced code block](/list-format/#fenced-code-blocks) is prose: it is never a merge target, and the block is left byte-for-byte as written. The one refusal is a file that ends inside an **unclosed** fence, because the new card line would be appended into it and read back as prose. The command exits `2` and writes nothing; close the fence and retry.

## Output

In text mode, a successful add names the list by its display name (its `# Title`), not its file:

```text
Added '1 Llanowar Elves' to Pauper Elves (Main)
Added to Trade Binder: - Sol Ring (FDC:286) &12
```

A deck add names the card, the copies added, and the section the line landed in. A collection or wanted-list add shows the line exactly as written to the file.

With `--output json` (or `ndjson`), a successful add prints exactly one machine-readable record. Informational chatter (cache counts, price lines) never appears on stdout:

```json
{
  "type": "collection",
  "list": "main",
  "cardName": "Lightning Bolt",
  "set": "sta",
  "collectorNumber": "42",
  "finish": "etched",
  "condition": "LP",
  "cardId": 7
}
```

Extra fields:

- Deck adds include `quantity` (copies added, not the merged line's new total) and `section` (where the card's line ended up).
- `--label` adds `labels` (the signed override the new line carries); `--tag` adds `tags` (trimmed, sorted).
- A non-English add includes `language` (canonical lowercase code); English is omitted, like the line's token.
- Wanted adds omit the fields that weren't recorded.
- `--dry-run` adds `"dryRun": true`.

Set codes are lowercase in JSON output.

Errors raised after argument parsing (usage, not-found, and runtime errors) go to stderr as `{ "error": { "code", "message", "details" } }`. Invalid flag _values_ and flag conflicts (such as `--name-only` with `--set`) are rejected by argument parsing itself and printed as plain text on stderr regardless of `--output`; the exit code is still `2`. In text mode, `--quiet` suppresses all non-essential output.

## Exit Codes

| Code | Meaning                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Card added (or, under `--dry-run`, the add reported with nothing written)                                                              |
| `1`  | Runtime error (card cache unavailable, printing unresolvable in the specific flow, file write failure)                                 |
| `2`  | Usage error (see below)                                                                                                                |
| `3`  | Not found (missing deck, unknown collection or wanted list without `--create`, no exact card-name match, no cards matching the search) |

Exit `2` covers invalid or conflicting flags, `--create` without `--collection`/`--wanted`, a type prefix contradicting a type flag, an unknown printing pin, an unavailable finish, a cancelled prompt, and a missing `--finish`/`--condition`/wanted-specificity flag when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable).
