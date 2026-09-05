---
title: 'add-card'
---

Add a card to a deck, collection, or wanted list by name.

The card is picked from the local card cache with an autocomplete prompt. If the cache is empty or older than 7 days, you are offered a refresh first. The command is fully scriptable: every prompt can be preempted with a flag, and `--output json` emits a machine-readable result.

## Usage

```bash
ritual add-card <targetName> <cardName...> [options]
```

`<targetName>` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` to pin the type. A flag is required when the name is ambiguous, and required to **create** a missing collection or wanted list. A `deck:`/`collection:`/`wanted:` prefix on the name (`collection:Main Binder`) supplies the type when no flag is given. A prefix that **contradicts** the flag is a usage error (exit `2`) naming both, rather than one silently winning.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `<targetName>`  | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |
| `<cardName...>` | Name of the card to search for                                                            | Yes      |

## Options

| Option                     | Description                                                                                                                                                                                    | Default | Applies To               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------ |
| `--deck`                   | Resolve the name as a deck                                                                                                                                                                     |         |                          |
| `--collection`             | Resolve the name as a collection (created if missing)                                                                                                                                          |         |                          |
| `--wanted`                 | Resolve the name as a wanted list (created if missing)                                                                                                                                         |         |                          |
| `-q, --quantity <num>`     | Number of copies to add (must be a positive integer); passing a value other than 1 to a collection or wanted target is a usage error                                                           | `1`     | Deck only                |
| `-f, --finish <finish>`    | Card finish: `nonfoil`, `foil`, `etched`                                                                                                                                                       |         | Deck, Collection, Wanted |
| `-c, --condition <cond>`   | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG`, or `NONE` to record no condition                                                                                                                |         | Deck, Collection         |
| `--language <code>`        | Card language as a Scryfall code (`ja`, `de`, `zhs`, ...; aliases like `jp` or `Japanese` normalize); omitted, the configured [`defaultLanguage`](/configuration/#default-language) is stamped |         | Deck, Collection, Wanted |
| `--label <labels>`         | Label the new card: `sale,trade` (combinable), `keep`, or `proxy` on a collection; `proxy` alone on a deck; omit to inherit the list's default                                                 |         | Deck, Collection         |
| `--tag <tags>`             | [Tag](/list-format/#card-tags) the new card: one or more tags, comma-separated (`"Ramp, Card Draw"`)                                                                                           |         | Deck, Collection, Wanted |
| `--section <name>`         | Deck section to add to, created at the end of the file if missing                                                                                                                              |         | Deck only                |
| `--commander`              | Add the card to the deck's Commander section (created at the top if missing)                                                                                                                   |         | Deck only                |
| `-e, --exact`              | Use exact matching (skip selection if name matches)                                                                                                                                            | `false` |                          |
| `--set <code>`             | Pin an exact printing by set code (requires `--collector-number`)                                                                                                                              |         |                          |
| `--collector-number <num>` | Pin an exact printing by collector number (requires `--set`)                                                                                                                                   |         |                          |
| `--name-only`              | Add the card by name without choosing a printing                                                                                                                                               |         | Wanted only              |
| `--specific`               | Record a specific printing (via `--set`/`--collector-number` or interactive picker)                                                                                                            |         | Wanted only              |
| `--refresh <mode>`         | Card cache refresh policy: `ask` (prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never`                                                                                    | `ask`   |                          |
| `-n, --dry-run`            | Report what would be added without writing anything                                                                                                                                            | `false` |                          |
| `--output <format>`        | Output format: `text`, `json`, or `ndjson`                                                                                                                                                     | `text`  |                          |
| `--quiet`                  | Suppress non-essential output                                                                                                                                                                  | `false` |                          |

`--deck`, `--collection`, and `--wanted` are mutually exclusive, as are `--name-only` and `--specific`. A flag that does not apply to the resolved list type is rejected with a usage error rather than silently ignored: `--condition` on a wanted list, `--section` on a collection, `--label` on a wanted list, `--label sale` on a deck (which carries only `proxy`), or `--name-only` on a deck. Invalid `--finish`, `--condition`, `--label`, `--tag`, and `--quantity` values are rejected at parse time. For `--tag`, an empty value is invalid too. A repeated `--tag` accumulates.

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

`<targetName>` is matched case- and accent-insensitively against existing list files. An exact name wins, otherwise a unique substring match is accepted, and any ambiguity is an error. A `--deck`/`--collection`/`--wanted` flag restricts the search to that type. See [List Names](/list-resolution/) for the full rules.

A missing **collection** or **wanted list** is created automatically, but only when the type is pinned with a flag or a `collection:`/`wanted:` prefix, since the command cannot otherwise know which kind of list to create. This includes the first-run case where the workspace holds no lists of that type at all. Decks are never auto-created; create them first with [`new deck`](/commands/new/).

The file is created **at write time**, after every validation has passed. An add that fails (an empty card cache, an unknown printing pin, a cancelled prompt), or a `--dry-run`, never leaves an empty list file behind.

### Card Selection

The card name you give filters the local card cache, and an autocomplete prompt lets you narrow the list and pick the right card.

What you type is split on whitespace, and **every term must appear in the card name**, in any order. Typing `in tre` finds "In the Trenches", and `bolt light` finds "Lightning Bolt". Case, accents, and punctuation don't have to match (`jaces archivist` finds "Jace's Archivist"). The same rule applies to the name passed on the command line and to whatever you type at the prompt afterwards.

Suggestions are ordered by EDHRec popularity, except that closer matches come first. A card whose **whole name** you have typed leads: typing `The End` puts the card named "The End" at the top rather than burying it below every popular card containing those letters, and typing the front face of a double-faced card counts as its whole name. Then come cards your query prefixes, then the cards whose words your terms begin, which is what keeps "In the Trenches" at the top of `in tre` instead of the 80 cards that merely contain those letters somewhere.

With `--exact`, the input name is normalized (case and accents folded, punctuation stripped) and compared against all cached card names. If exactly one card matches, it is selected automatically with a confirmation message. If no exact match is found, the command exits with an error saying how many cards match the input by term (counted up to 100, reported as "100+" if the limit is reached).

When prompts are unavailable (stdin is **not a terminal**, or `--no-input` / `RITUAL_NO_INPUT` is in force), the autocomplete prompt cannot run. An input that exactly matches a cached card name is accepted as if `--exact` were passed, and anything else is a usage error rather than a silent first-suggestion pick.

### Printing Pins

`--set` and `--collector-number` (always together) pin the add to one exact printing:

- **Deck**: the printing is written onto the deck line (`3 Sol Ring (C21:263) &7`).
- **Collection**: skips the interactive printing picker.
- **Wanted**: skips the printing picker and implies the specific-printing flow.

The pair is validated strictly against the card's known printings. A set/collector-number combination that doesn't exist fails with a usage error listing up to 10 available printings (also carried as `details.available` in JSON error output). There is no fuzzy or fallback matching.

When the local card cache holds no entry for the card at all, there is no printing list to validate against, so the pinned printing is verified directly with Scryfall in a single request. It is accepted when Scryfall confirms it belongs to that card, a usage error when it does not, and a runtime error (exit `1`) when Scryfall cannot be reached.

Without a pin, a run where prompts are unavailable only succeeds when the card has a single paper printing. Several candidates fail with an error instead of guessing.

### Printing and Finish Prices

The interactive printing picker lists each printing's price in your configured [`defaultCurrency`](/configuration/#default-currency) in right-hand columns: one aligned column per finish any of the listed printings comes in, nonfoil first and foil/etched to its right, with non-nonfoil amounts named after the price (`$14.93 foil`). A printing that doesn't come in a column's finish leaves that cell blank, and `N/A` means the card cache carries no price for that printing and finish in that currency. The finish prompt then prices each finish in a single column beside its label. See [`edit`](/commands/edit/#printing-and-finish-prices) for examples.

### Finish and Condition

`--finish` values are validated twice. The flag itself must be `nonfoil`, `foil`, or `etched` (rejected at parse time otherwise). Once a printing is resolved, a finish that printing isn't offered in fails with a usage error listing the finishes that do exist (also `details.availableFinishes` in JSON).

`--condition` accepts the usual grades plus `NONE`, which explicitly records **no** condition and skips the condition prompt. It is the scripting equivalent of answering "Don't Care". It is not optional in a scripted collection run: with no terminal to prompt on, a collection add without `--condition` fails rather than guessing. Deck adds never prompt for either value; both are optional there.

`NM` and `NONE` produce the same line. `NM` is the unrecorded default and is written without a `[NM]` annotation (see [`set-card`](/commands/set-card/#condition-updates)).

### Language

`--language` records the copy's language as a lowercase Scryfall code: `en es fr de it pt ja ko ru zhs zht he la grc ar sa ph`. These are Scryfall's codes, not ISO codes, so Chinese is `zhs`/`zht`. Common aliases normalize (`jp` → `ja`, `kr` → `ko`, `sp` → `es`, `cs` → `zhs`, `ct` → `zht`, and full English names like `Japanese`), so the persisted value is always the canonical code.

Adding **never prompts** for a language. Without the flag, the configured [`defaultLanguage`](/configuration/#default-language) is stamped on the new card. Edit it afterwards with [`set-card --language`](/commands/set-card/) if a single copy differs.

On the line itself the language is a bracket token in canonical position (`- Sol Ring (C21:263) [foil] [LP] [ja] &7`), and the token is **omitted for English**. A bare line always means `en` whatever the configured default, so files stay self-describing. `--language` is recorded exactly as given: only the printing pin is verified, not the language. To change a copy's language with verification against the printing's real languages, use [`set-card --language`](/commands/set-card/#language-updates).

### Cache Freshness

Before displaying the autocomplete prompt, the command checks the card cache. The shared `--refresh <mode>` option decides how it responds:

- If the cache is **empty**, `ask` (the default) prompts to download the card database (default yes) and `auto` downloads it without prompting. If it isn't downloaded, because the prompt is declined or unanswerable or the mode is `no-bulk` / `never`, the command fails with a hint to run `ritual cache preload-all` or re-run with `--refresh auto`.
- If the cache is **older than 7 days**, `ask` prompts to update it (default no) and `auto` updates it without prompting. `no-bulk` / `never` use it as-is.
- If the cache is **fresh**, the command proceeds immediately.

Under `ask`, prompts that can't be answered (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal) are declined, never resolved to their defaults.

### Dry Runs

`-n` / `--dry-run` resolves the list and the card, runs every validation (printing pin, finish availability, flag applicability), and reports the line that _would_ be written, then stops. No list file, changelog, or `.sha256` sidecar is written, no missing list is created, and the card-ID backfill is skipped, so a dry run leaves the workspace byte-for-byte as it found it. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true`.

### Change Tracking

Every card added through this command creates a change event in the `.changes.md` changelog beside the target file, including the `&N` card ID allocated for the new line. Deck adds record **one event per copy**, so `-q 4` writes four `Added` entries. This changelog is what the site's change history view shows.

### Deck Mode

1. The card is selected via autocomplete from the cache (or `--exact`).
2. The card goes through the same change engine the editors and the admin site use, so a CLI add and an editor add produce identical files.
3. `-q N` records **one add change event per copy**, the same per-copy accounting `remove-card` uses, so replaying a changelog reproduces the quantity actually added.

How the card lands in the deck:

- **Copies merge onto an existing line** for the same card when the printing (set, collector number, finish, condition, language), the label override, and the tags all match. Adding 2 more copies of a card the deck already has yields one line with a larger quantity, never a second line. The merged line keeps everything else it carried, including its `&N` ID and any `{note}`. Labels are part of that identity because they are part of what the copies are: `--label proxy` on a card the deck already runs for real adds a second, `[proxy]` line rather than folding the proxies into the real copies.
- **Merging wins over placement.** `--section` and `--commander` place a **new** line. When the deck already runs the printing, the copies join the existing line wherever it lives, and `--commander` then moves that whole line (every copy on it) into the Commander section. A `--section` that names a different section than the merged line sits in does not move it, and the changelog records the section the copies actually landed in.
- **A new line is appended at the end of its section**: the section named by `--section`, the Commander section under `--commander`, otherwise the deck's first non-commander, non-sideboard section. A deck organized as `## Mainboard` therefore keeps one main section instead of gaining a `## Main`. A deck whose body is bare card lines with no headings at all is one implicit Main section: the card joins after its last card line rather than growing a `## Main` heading that would split the deck in two on the next parse. Only a deck with no card lines to join gets a `## Main` created.

Deck entries record the card name and quantity, plus the set code and collector number when pinned, and `[finish]`/`[condition]`/`[labels]`/`#tags` annotations when `--finish`/`--condition`/`--label`/`--tag` are given. `--label proxy` is the only label a deck line takes (see [Card Labels](/list-format/#card-labels)); tags are free-form on every type (see [Card Tags](/list-format/#card-tags)). A `--finish` on a deck add is validated only when `--set`/`--collector-number` pin a printing, since an unpinned deck line records no printing to validate the finish against.

### Collection Mode

1. The card is selected via autocomplete from the cache (or `--exact`).
2. The printing comes from the `--set`/`--collector-number` pin, or you are prompted to select one.
3. Finish and condition come from `--finish`/`--condition`, or you are prompted.
4. The entry is appended to the collection file in `collections/`.

Collection entries always record the specific printing (set code and collector number), since a collection card's value is tied to its exact printing.

There is no implicit condition; pass `--condition NONE` to record none. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), a run missing `--condition`, or missing `--finish` on a printing that comes in more than one finish, is a usage error (exit `2`) naming the flag rather than a silent no-op. An exit `0` always means a line was written.

### Wanted List Mode

1. The card is selected via autocomplete from the cache (or `--exact`).
2. Specificity comes from `--name-only`, `--specific`, or a printing pin. With none of them you are prompted: **Name only (any copy)** appends just the card name, while **Choose specific printing** enters the printing selection flow followed by a finish prompt. When prompts are unavailable, one of the flags is required; instead of prompting, the command exits with code `2`.
3. The entry is appended to the wanted list file in `wanted/`.

As with collection adds, a specific-printing add whose printing comes in more than one finish requires `--finish` when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) (exit `2`). Only the name-only flow is finish-optional.

In the specific flow, a printing that cannot be resolved (no pin and no way to ask) is an **error**. The command never silently degrades a specific request to a name-only entry. Wanted list entries require only the card name; the printing and finish are optional (see the [card states](/list-format/#wanted-list-card-states)). A default finish can be specified with `-f`.

### Fenced Code Blocks

An add is line-preserving. A card-looking line inside a [fenced code block](/list-format/#fenced-code-blocks) is prose, so it is never a merge target, and the block is left byte-for-byte as written. The one refusal is a file that ends inside an **unclosed** fence: an unclosed fence runs to end of file, so the new card line would be appended into it and read back as prose. The command exits `2` and writes nothing; close the fence and retry.

## Output

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

Deck adds include `quantity` (the number of copies added, not the merged line's new total) and `section` (where the card's line ended up). An add made with `--label` includes `labels` (the override the new line carries), and one made with `--tag` includes `tags` (canonical: trimmed, sorted). A non-English add includes `language` (the canonical lowercase code; English is omitted, like the line's token). Wanted adds omit the fields that weren't recorded. A `--dry-run` payload carries `"dryRun": true`, and the text line is prefixed `[dry-run]`. Set codes are lowercase in JSON output (the internal representation).

Errors raised after argument parsing (usage, not-found, and runtime errors) are emitted on stderr as `{ "error": { "code", "message", "details" } }`. Invalid flag _values_ and flag conflicts (such as `--name-only` with `--set`) are rejected by argument parsing itself and printed as plain text on stderr regardless of `--output`; the exit code is still 2. In text mode, `--quiet` suppresses all non-essential output.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Card added (or, under `--dry-run`, the add reported with nothing written)                                                                                                                                                                                                                     |
| `1`  | Runtime error (card cache unavailable, printing unresolvable in the specific flow, file write failure)                                                                                                                                                                                        |
| `2`  | Usage error (invalid or conflicting flags, a type prefix contradicting a type flag, unknown printing pin, unavailable finish, cancelled prompt, or a missing `--finish`/`--condition`/wanted-specificity flag when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)) |
| `3`  | Not found (missing deck, no exact card-name match, no cards matching the search)                                                                                                                                                                                                              |
