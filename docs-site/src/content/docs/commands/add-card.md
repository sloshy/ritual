---
title: 'add-card'
---

Add a card to a deck, collection, or wanted list by name.

Uses the local card cache for fast autocomplete-based card selection. If the cache is empty or older than 7 days, you will be prompted to update it. Fully scriptable: every prompt can be preempted with a flag, and `--output json` emits a machine-readable result.

## Usage

```bash
./ritual add-card <targetName> <cardName...> [options]
```

The target list is resolved from `<targetName>` across all three list types (see [List Resolution](/commands/list-resolution/)). Pass a `--deck`, `--collection`, or `--wanted` flag to pin the type — required when the name is ambiguous, and required to **create** a missing collection or wanted list. A `deck:`/`collection:`/`wanted:` prefix on the name (e.g. `collection:Main Binder`) works too and overrides the type flag.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `<targetName>`  | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |
| `<cardName...>` | Name of the card to search for                                                            | Yes      |

## Options

| Option                     | Description                                                                                                                          | Default | Applies To         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------ |
| `--deck`                   | Resolve the name as a deck                                                                                                           |         |                    |
| `--collection`             | Resolve the name as a collection (created if missing)                                                                                |         |                    |
| `--wanted`                 | Resolve the name as a wanted list (created if missing)                                                                               |         |                    |
| `-q, --quantity <num>`     | Number of copies to add (must be a positive integer); passing a value other than 1 to a collection or wanted target is a usage error | `1`     | Deck only          |
| `-f, --finish <finish>`    | Card finish: `nonfoil`, `foil`, `etched`                                                                                             |         | Collection, Wanted |
| `-c, --condition <cond>`   | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG`, or `NONE` to record no condition                                                      |         | Collection only    |
| `-e, --exact`              | Use exact matching (skip selection if name matches)                                                                                  | `false` |                    |
| `--set <code>`             | Pin an exact printing by set code (requires `--collector-number`)                                                                    |         |                    |
| `--collector-number <num>` | Pin an exact printing by collector number (requires `--set`)                                                                         |         |                    |
| `--name-only`              | Add the card by name without choosing a printing                                                                                     |         | Wanted only        |
| `--specific`               | Record a specific printing (via `--set`/`--collector-number` or interactive picker)                                                  |         | Wanted only        |
| `--refresh <mode>`         | Card cache refresh policy: `ask` (prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never`                          | `ask`   |                    |
| `--output <format>`        | Output format: `text`, `json`, or `ndjson`                                                                                           | `text`  |                    |
| `--quiet`                  | Suppress non-essential output                                                                                                        | `false` |                    |

`--deck`, `--collection`, and `--wanted` are mutually exclusive, as are `--name-only` and `--specific`. Flags that don't apply to the resolved target type (for example `--condition` on a wanted list, or `--name-only` on a deck) are rejected with a usage error rather than silently ignored. Invalid `--finish`, `--condition`, and `--quantity` values are rejected at parse time.

## Examples

Add a single card to a deck (resolved by name across all types):

```bash
./ritual add-card "My Deck" Sol Ring
```

Pin the type explicitly when a name could be ambiguous:

```bash
./ritual add-card --deck "My Deck" Lightning Bolt -q 4
```

Pin an exact printing onto a deck line:

```bash
./ritual add-card --deck "My Deck" Sol Ring --exact --set C21 --collector-number 263
```

Fully scripted collection add — no prompts, machine-readable result:

```bash
./ritual add-card --collection "Main" Lightning Bolt --exact \
  --set STA --collector-number 42 --finish etched --condition LP --output json
```

Record no condition without being asked for one:

```bash
./ritual add-card --collection "Main" Sol Ring --exact \
  --set LEA --collector-number 270 --condition NONE
```

Add a name-only wanted entry with a finish preference:

```bash
./ritual add-card --wanted "My Wants" Demonic Tutor --exact --name-only --finish foil
```

Add a wanted entry pinned to a printing (the pin implies `--specific`):

```bash
./ritual add-card --wanted "My Wants" Lightning Bolt --exact --set STA --collector-number 42
```

## Behavior

### List Resolution

`<targetName>` is matched case- and accent-insensitively against existing list files — an exact name wins, otherwise a unique substring match is accepted, and any ambiguity is an error. A `--deck`/`--collection`/`--wanted` flag restricts the search to that type. See [List Resolution](/commands/list-resolution/) for the full rules.

A missing **collection** or **wanted list** is created automatically, but only when the type is pinned with a flag (the command can't know which kind of list to create otherwise). Decks are never auto-created — create them first with [`new deck`](/commands/new/).

### Card Selection

The card name you provide is used to filter the local card cache. An autocomplete prompt lets you type to narrow down the list and select the correct card.

What you type is split on whitespace and **every term must appear in the card name**, in any order — typing `in tre` finds "In the Trenches", and `bolt light` finds "Lightning Bolt". Case, accents, and punctuation don't have to match (`jaces archivist` finds "Jace's Archivist"). The same rule applies to the name passed on the command line and to whatever you type at the prompt afterwards.

Suggestions are ordered by EDHRec popularity, except that closer matches come first: a card whose **whole name** you have typed leads (typing `The End` puts the card named "The End" at the top rather than burying it below every popular card containing those letters, and typing the front face of a double-faced card counts as its whole name), then cards your query prefixes, then the cards whose words your terms begin — which is what keeps "In the Trenches" at the top of `in tre` instead of the 80 cards that merely contain those letters somewhere.

When `--exact` is used, the input name is normalized (case and accents folded, punctuation stripped) and compared against all cached card names. If exactly one card matches, it is selected automatically with a confirmation message. If no exact match is found, the command exits with an error indicating how many cards match the input by term (counted up to 100, reported as "100+" if the limit is reached).

When prompts are unavailable (stdin is **not a terminal**, or `--no-input` / `RITUAL_NO_INPUT` is in force), the autocomplete prompt cannot run — an input that exactly matches a cached card name is accepted as if `--exact` were passed, and anything else is a usage error rather than a silent first-suggestion pick.

### Printing Pins

`--set` and `--collector-number` (always together) pin the add to one exact printing:

- **Deck**: the printing is written onto the deck line (`3 Sol Ring (C21:263) &7`).
- **Collection**: skips the interactive printing picker.
- **Wanted**: skips the printing picker and implies the specific-printing flow.

The pair is validated strictly against the card's known printings — a set/collector-number combination that doesn't exist fails with a usage error listing up to 10 available printings (also carried as `details.available` in JSON error output). There is no fuzzy or fallback matching.

Without a pin, a run where prompts are unavailable (stdin is **not a terminal**, or `--no-input` / `RITUAL_NO_INPUT` is in force) only succeeds when the card has a single paper printing; several candidates fail with an error instead of guessing.

### Printing and Finish Prices

The interactive printing picker lists each printing's price in your configured [`defaultCurrency`](/configuration/#default-currency) in a right-hand column, quoted at that printing's default finish — nonfoil where it has one, otherwise the finish it comes in, named after the price (`$14.93 foil`). `N/A` means the card cache carries no price for that printing in that currency. The finish prompt prices each finish the same way. See [`edit`](/commands/edit/#printing-and-finish-prices) for examples.

### Finish and Condition

`--finish` values are validated twice: the flag itself must be `nonfoil`, `foil`, or `etched` (rejected at parse time otherwise), and once a printing is resolved, a finish that printing isn't offered in fails with a usage error listing the finishes that do exist (also `details.availableFinishes` in JSON).

`--condition` accepts the usual grades plus `NONE`, which explicitly records **no** condition and skips the condition prompt — the scripting equivalent of answering "Don't Care". It is not optional in a scripted run: with no terminal to prompt on, a collection add without `--condition` fails rather than guessing.

### Cache Freshness

Before displaying the autocomplete prompt, the command checks the card cache; the shared `--refresh <mode>` option decides how it responds:

- If the cache is **empty**, `ask` (the default) prompts to download the card database (default yes) and `auto` downloads it without prompting. If it isn't downloaded — the prompt is declined or unanswerable, or the mode is `no-bulk` / `never` — the command fails with a hint to run `ritual cache preload-all` or re-run with `--refresh auto`.
- If the cache is **older than 7 days**, `ask` prompts to update it (default no) and `auto` updates it without prompting; `no-bulk` / `never` use it as-is.
- If the cache is **fresh**, the command proceeds immediately.

Under `ask`, prompts that can't be answered (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal) are declined, never resolved to their defaults.

### Change Tracking

Every card added through this command creates a change event that is recorded in a `.changes.md` changelog file alongside the target file, including the `&N` card ID allocated for the new line. This changelog is displayed in the site's change history view.

### Deck Mode

1. Card is selected via autocomplete from the cache (or `--exact`).
2. The card is added under the `## Main` section of the deck file, with the pinned printing when `--set`/`--collector-number` are given.

Deck entries record the card name and quantity, plus the set code and collector number when pinned.

### Collection Mode

1. Card is selected via autocomplete from the cache (or `--exact`).
2. The printing comes from the `--set`/`--collector-number` pin, or you are prompted to select one.
3. Finish and condition come from `--finish`/`--condition`, or you are prompted.
4. The entry is appended to the collection file in `collections/`.

Collection entries always record the specific printing (set code and collector number), since collection cards have monetary value tied to the exact printing.

There is no implicit condition — pass `--condition NONE` to record none. When [prompts are unavailable](/#when-prompts-are-unavailable), a run missing `--condition`, or missing `--finish` on a printing that comes in more than one finish, is a usage error (exit `2`) naming the flag rather than a silent no-op: an exit `0` always means a line was written.

### Wanted List Mode

1. Card is selected via autocomplete from the cache (or `--exact`).
2. Specificity comes from `--name-only`, `--specific`, or a printing pin; with none of them you are prompted: **Name only (any copy)** appends just the card name, while **Choose specific printing** enters the printing selection flow followed by a finish prompt. When prompts are unavailable (stdin is not a terminal, or `--no-input` / `RITUAL_NO_INPUT`), one of the flags is required — instead of prompting, the command exits with code `2`.
3. The entry is appended to the wanted list file in `wanted/`.

As with collection adds, a specific-printing add whose printing comes in more than one finish requires `--finish` when [prompts are unavailable](/#when-prompts-are-unavailable) (exit `2`). Only the name-only flow is finish-optional.

In the specific flow, a printing that cannot be resolved (no pin and no way to ask) is an **error** — the command never silently degrades a specific request to a name-only entry. Wanted list entries require only the card name; the printing and finish are optional (see the [card states](/commands/edit/#card-states)). A default finish can be specified with `-f`.

## Output

With `--output json` (or `ndjson`), a successful add prints exactly one machine-readable record — informational chatter (cache counts, price lines) never appears on stdout:

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

Deck adds include `quantity`; wanted adds omit the fields that weren't recorded. Set codes are lowercase in JSON output (the internal representation). Errors raised after argument parsing (usage, not-found, and runtime errors) are emitted on stderr as `{ "error": { "code", "message", "details" } }`. Invalid flag _values_ and flag conflicts (e.g. `--name-only` with `--set`) are rejected by argument parsing itself and printed as plain text on stderr regardless of `--output` — the exit code is still 2. In text mode, `--quiet` suppresses all non-essential output.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Card added                                                                                                                                                                                                                           |
| `1`  | Runtime error (card cache unavailable, printing unresolvable in the specific flow, file write failure)                                                                                                                               |
| `2`  | Usage error (invalid or conflicting flags, unknown printing pin, unavailable finish, cancelled prompt, or a missing `--finish`/`--condition`/wanted-specificity flag when [prompts are unavailable](/#when-prompts-are-unavailable)) |
| `3`  | Not found (missing deck, no exact card-name match, no cards matching the search)                                                                                                                                                     |
