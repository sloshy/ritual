---
sidebar_position: 10
---

# add-card

Add a card to a deck, collection, or wanted list by name.

Uses the local card cache for fast autocomplete-based card selection. If the cache is empty or older than 7 days, you will be prompted to update it.

## Usage

```bash
./ritual add-card <type> <targetName> <cardName...> [options]
```

## Arguments

| Argument        | Description                                                         | Required |
| --------------- | ------------------------------------------------------------------- | -------- |
| `<type>`        | Target type: `deck`, `collection`, or `wanted`                      | Yes      |
| `<targetName>`  | Name of the deck, collection, or wanted list (filename without ext) | Yes      |
| `<cardName...>` | Name of the card to search for                                      | Yes      |

## Options

| Option                   | Description                                         | Default | Applies To         |
| ------------------------ | --------------------------------------------------- | ------- | ------------------ |
| `-q, --quantity <num>`   | Number of copies to add                             | `1`     | Deck only          |
| `-f, --finish <finish>`  | Card finish: `nonfoil`, `foil`, `etched`            |         | Collection, Wanted |
| `-c, --condition <cond>` | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG`       |         | Collection only    |
| `-e, --exact`            | Use exact matching (skip selection if name matches) | `false` |                    |

## Examples

Add a single card to a deck:

```bash
./ritual add-card deck "My Deck" Sol Ring
```

Add multiple copies to a deck:

```bash
./ritual add-card deck "My Deck" Lightning Bolt -q 4
```

Add a card to a collection (prompts for printing selection and finish/condition):

```bash
./ritual add-card collection "Main Collection" Black Lotus
```

Pre-fill finish and condition for a collection card:

```bash
./ritual add-card collection "Main Collection" Force of Will -f foil -c NM
```

Add a card to a wanted list:

```bash
./ritual add-card wanted "My Wants" Demonic Tutor
```

Add a card with exact matching (no interactive prompt if the name matches):

```bash
./ritual add-card deck "My Deck" Sol Ring --exact
```

## Behavior

### Card Selection

The card name you provide is used to filter the local card cache. An autocomplete prompt lets you type to narrow down the list and select the correct card.

When `--exact` is used, the input name is normalized (punctuation stripped, lowercased) and compared against all cached card names. If exactly one card matches, it is selected automatically with a confirmation message. If no exact match is found, the command exits with an error indicating how many cards contain the input as a substring (counted up to 100, reported as "100+" if the limit is reached).

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

If the collection file does not exist, it is created automatically.

### Wanted List Mode

1. Card is selected via autocomplete from the cache.
2. The card name is appended to the wanted list file in `wanted/`.

Wanted list entries require only the card name. An optional finish can be specified with `-f`. If the wanted list file does not exist, it is created automatically.
