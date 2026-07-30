---
title: 'set-card'
---

Update a card in place — its printing, finish, condition, deck section, or commander status — in a deck, collection, or wanted list, without opening an editor.

The edit is line-preserving: only the targeted card's line is rewritten (or moved, for section and commander changes). Everything else in the file — prose, comments, unusual headings, even lines the parser cannot read — stays intact. (A `--section`/`--commander` move may additionally create the destination's `## Section` heading when it does not exist yet.)

## Usage

```bash
./ritual set-card [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list and then a card. Both prompts require a terminal — without one, omitting `[listName]` or a card selector (`[cardName...]`/`--card-id`) exits with a usage error (code `2`) instead of prompting. At least one mutation flag is required.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name to update (fuzzy match)                                                         | No       |

## Options

| Option                    | Description                                                                                                 | Default |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`                  | Resolve the name as a deck                                                                                  |         |
| `--collection`            | Resolve the name as a collection                                                                            |         |
| `--wanted`                | Resolve the name as a wanted list                                                                           |         |
| `--card-id <id>`          | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings. |         |
| `--set <code>`            | New set code — must be given together with `--collector-number`                                             |         |
| `--collector-number <cn>` | New collector number — must be given together with `--set`                                                  |         |
| `--finish <finish>`       | New finish: `nonfoil`, `foil`, or `etched` (case-insensitive)                                               |         |
| `--condition <condition>` | New condition: `NM`, `LP`, `MP`, `HP`, or `DMG` (case-insensitive; decks and collections only)              |         |
| `--section <name>`        | Move the card to this deck section, creating the section if it does not exist (decks only)                  |         |
| `--commander`             | Move the card to the deck's Commander section (decks only)                                                  |         |
| `--no-commander`          | Move the card out of the Commander section back to the main section (decks only)                            |         |
| `--output <format>`       | Output format: `text`, `json`, or `ndjson`                                                                  | `text`  |
| `--quiet`                 | Suppress non-essential output                                                                               | `false` |

Multiple mutation flags can be combined in one invocation; each is applied and reported.

## Examples

Change a card's finish:

```bash
./ritual set-card --deck "My Deck" Sol Ring --finish foil
```

Switch to a different printing (validated against the Scryfall cache):

```bash
./ritual set-card --collection main "Lightning Bolt" --set 2xm --collector-number 157
```

Change the printing and finish together, targeting a specific entry:

```bash
./ritual set-card --collection main --card-id 12 --set lea --collector-number 161 --finish nonfoil
```

Downgrade a collection card's condition:

```bash
./ritual set-card --collection main "Mana Crypt" --condition LP
```

Move a deck card to the sideboard section and capture JSON output:

```bash
./ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --section Sideboard --output json
```

The JSON payload is `{ type, list, cardName, cardId, applied }`, where `applied` is one entry per change made (e.g. `"printing → 2XM:157"`, `"finish → foil"`, `"condition → LP"`, `"section → Sideboard"`, `"commander"`, `"not commander"`).

Make a card the deck's commander:

```bash
./ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --commander
```

## Behavior

### Card Resolution

Cards are matched the same way as [`note`](/commands/note/): fuzzy name match (case-, accent-, and punctuation-insensitive; exact name preferred, then substring), `--card-id` for a precise target, or an interactive picker when neither is given. An ambiguous name match exits with a `usage_error` listing each candidate.

### Printing Validation

`--set` and `--collector-number` must be given together, and the pair is validated against the card's printings in the local Scryfall cache: an unknown pair is a usage error listing the available printings (up to 10). When `--finish` accompanies a printing change, the chosen printing must actually offer that finish (per Scryfall's finish data), otherwise the command lists the finishes it does offer. If the printing lookup itself fails (empty or unreachable cache), the command exits with a runtime error — refresh the cache with [`cache`](/commands/cache/).

When you change the printing **without** `--finish`, the card's current finish is preserved. The current finish is _not_ re-validated against the new printing.

### Condition Updates

Condition applies to decks and collections only (wanted-list entries never track condition). Internally there is no standalone "set condition" change event — a condition change rides on the same printing-update event the editors use, carrying the card's current set/collector number/finish, so only the condition (and finish, if also given) actually changes. In the changelog this therefore appears as a printing update, e.g. `Set "Mana Crypt" printing to 2XM:1 [foil] [LP] &2`.

### Sections and Commander

`--section` moves the card to the named deck section; a section that does not exist yet is created at the end of the deck. `--commander` moves the card into the deck's `Commander` section (created at the top if missing); `--no-commander` moves it back out to the first regular section. The two are opposites of one flag — if both appear on one command line, the last one wins.

### Change Tracking

Every applied change is recorded in the list's `.changes.md` changelog in a single block per invocation (`Set ... finish to foil`, `Set ... printing to 2XM:157`, `Moved ... to section "Sideboard"`, `Set ... as commander`, etc.).

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                                                                            |
| `2`  | Usage error (no mutation flags, `--set` without `--collector-number`, unknown printing or unavailable finish, flag not valid for the list type, ambiguous list or card, no terminal available for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                                                                                                                                       |
| `1`  | Runtime error (Scryfall printing lookup failed, etc.)                                                                                                                                                                              |
