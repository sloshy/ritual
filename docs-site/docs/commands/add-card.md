---
sidebar_position: 10
---

# add-card

Add a card to a deck by name.

## Usage

```bash
./ritual add-card <deckName> <cardName...> [options]
```

## Arguments

| Argument        | Description                              | Required |
| --------------- | ---------------------------------------- | -------- |
| `<deckName>`    | Name of the deck (file name without ext) | Yes      |
| `<cardName...>` | Name of the card to search for           | Yes      |

## Options

| Option                 | Description             | Default |
| ---------------------- | ----------------------- | ------- |
| `-q, --quantity <num>` | Number of copies to add | `1`     |

## Examples

Add a single card to a deck:

```bash
./ritual add-card "My Deck" Sol Ring
```

Add multiple copies:

```bash
./ritual add-card "My Deck" Lightning Bolt -q 4
```

## Behavior

1. Searches Scryfall for the given card name.
2. If a single match is found, it is added automatically.
3. If multiple matches are found (up to 3), you are prompted to select one.
4. For more than 3 matches, the top results are displayed for selection.
5. The card is added under the `## Main` section of the deck file.
