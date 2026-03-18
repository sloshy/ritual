---
sidebar_position: 10
---

# add-card

Add a card to a deck or collection by name.

## Usage

```bash
./ritual add-card <type> <targetName> <cardName...> [options]
```

## Arguments

| Argument        | Description                                            | Required |
| --------------- | ------------------------------------------------------ | -------- |
| `<type>`        | Target type: `deck` or `collection`                    | Yes      |
| `<targetName>`  | Name of the deck or collection (file name without ext) | Yes      |
| `<cardName...>` | Name of the card to search for                         | Yes      |

## Options

| Option                   | Description                                   | Default | Applies To |
| ------------------------ | --------------------------------------------- | ------- | ---------- |
| `-q, --quantity <num>`   | Number of copies to add                       | `1`     | Deck only  |
| `-f, --finish <finish>`  | Card finish: `nonfoil`, `foil`, `etched`      |         | Collection |
| `-c, --condition <cond>` | Card condition: `NM`, `LP`, `MP`, `HP`, `DMG` |         | Collection |

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

## Behavior

### Deck Mode

1. Searches Scryfall for the given card name.
2. If a single match is found, it is added automatically.
3. If multiple matches are found (up to 3), you are prompted to select one.
4. For more than 3 matches, the top results are displayed for selection.
5. The card is added under the `## Main` section of the deck file.

Deck entries record only the card name and quantity. Set code, collector number, and condition are all optional when building a deck list.

### Collection Mode

1. Searches Scryfall for the given card name.
2. If multiple matches are found, you are prompted to select one.
3. You are prompted to select a specific printing (set + collector number).
4. You are prompted for finish (`nonfoil`, `foil`, `etched`) and condition.
5. The entry is appended to the collection file in `collections/`.

Collection entries always record the specific printing (set code and collector number), since collection cards have monetary value tied to the exact printing. Condition defaults to unknown ("Don't Care") if not specified.

If the collection file does not exist, it is created automatically.
