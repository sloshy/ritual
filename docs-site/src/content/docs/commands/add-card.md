---
title: 'add-card'
---

Add a card to a deck, collection, or wanted list by name.

Uses the local card cache for fast autocomplete-based card selection. If the cache is empty or older than 7 days, you will be prompted to update it.

## Usage

```bash
./ritual add-card <targetName> <cardName...> [options]
```

The target list is resolved from `<targetName>` across all three list types (see [List Resolution](/commands/list-resolution/)). Pass a `--deck`, `--collection`, or `--wanted` flag to pin the type — required when the name is ambiguous, and required to **create** a missing collection or wanted list.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `<targetName>`  | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |
| `<cardName...>` | Name of the card to search for                                                            | Yes      |

## Options

| Option                   | Description                                            | Default | Applies To         |
| ------------------------ | ------------------------------------------------------ | ------- | ------------------ |
| `--deck`                 | Resolve the name as a deck                             |         |                    |
| `--collection`           | Resolve the name as a collection (created if missing)  |         |                    |
| `--wanted`               | Resolve the name as a wanted list (created if missing) |         |                    |
| `-q, --quantity <num>`   | Number of copies to add                                | `1`     | Deck only          |
| `-f, --finish <finish>`  | Card finish: `nonfoil`, `foil`, `etched`               |         | Collection, Wanted |
| `-c, --condition <cond>` | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG`          |         | Collection only    |
| `-e, --exact`            | Use exact matching (skip selection if name matches)    | `false` |                    |

`--deck`, `--collection`, and `--wanted` are mutually exclusive.

## Examples

Add a single card to a deck (resolved by name across all types):

```bash
./ritual add-card "My Deck" Sol Ring
```

Pin the type explicitly when a name could be ambiguous:

```bash
./ritual add-card --deck "My Deck" Lightning Bolt -q 4
```

Add a card to a collection (prompts for printing selection and finish/condition):

```bash
./ritual add-card --collection "Main Collection" Black Lotus
```

Pre-fill finish and condition for a collection card:

```bash
./ritual add-card --collection "Main Collection" Force of Will -f foil -c NM
```

Add a card to a wanted list:

```bash
./ritual add-card --wanted "My Wants" Demonic Tutor
```

Add a card with exact matching (no interactive prompt if the name matches):

```bash
./ritual add-card --deck "My Deck" Sol Ring --exact
```

## Behavior

### List Resolution

`<targetName>` is matched case- and accent-insensitively against existing list files — an exact name wins, otherwise a unique substring match is accepted, and any ambiguity is an error. A `--deck`/`--collection`/`--wanted` flag restricts the search to that type. See [List Resolution](/commands/list-resolution/) for the full rules.

A missing **collection** or **wanted list** is created automatically, but only when the type is pinned with a flag (the command can't know which kind of list to create otherwise). Decks are never auto-created — create them first with [`new-deck`](/commands/new-deck/).

### Card Selection

The card name you provide is used to filter the local card cache. An autocomplete prompt lets you type to narrow down the list and select the correct card.

When `--exact` is used, the input name is normalized (case and accents folded, punctuation stripped) and compared against all cached card names. If exactly one card matches, it is selected automatically with a confirmation message. If no exact match is found, the command exits with an error indicating how many cards contain the input as a substring (counted up to 100, reported as "100+" if the limit is reached).

### Cache Freshness

Before displaying the autocomplete prompt, the command checks the card cache:

- If the cache is **empty**, you are prompted to download the card database.
- If the cache is **older than 7 days**, you are prompted to update it.
- If the cache is **fresh**, the command proceeds immediately.

### Change Tracking

Every card added through this command creates a change event that is recorded in a `.changes.md` changelog file alongside the target file. This changelog is displayed in the site's change history view.

### Deck Mode

1. Card is selected via autocomplete from the cache.
2. The card is added under the `## Main` section of the deck file.

Deck entries record only the card name and quantity. Set code, collector number, and condition are all optional when building a deck list.

### Collection Mode

1. Card is selected via autocomplete from the cache.
2. You are prompted to select a specific printing (set + collector number).
3. You are prompted for finish (`nonfoil`, `foil`, `etched`) and condition.
4. The entry is appended to the collection file in `collections/`.

Collection entries always record the specific printing (set code and collector number), since collection cards have monetary value tied to the exact printing. Condition defaults to unknown ("Don't Care") if not specified.

### Wanted List Mode

1. Card is selected via autocomplete from the cache.
2. You are prompted for specificity: **Name only (any copy)** appends just the card name, while **Choose specific printing** enters the printing selection flow followed by a finish prompt.
3. The entry is appended to the wanted list file in `wanted/`.

Wanted list entries require only the card name; the printing and finish are optional (see the [card states](/commands/edit/#card-states)). A default finish can be specified with `-f`.
