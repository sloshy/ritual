---
sidebar_position: 9
---

# price

Get pricing information for a deck.

## Usage

```bash
./ritual price <deckName> [options]
```

## Arguments

| Argument     | Description                               | Required |
| ------------ | ----------------------------------------- | -------- |
| `<deckName>` | Name of the deck file (without extension) | Yes      |

## Options

| Option              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--all`             | Include all sections (Sideboard, Maybeboard, etc.) |
| `--with-sideboard`  | Include Sideboard cards in pricing                 |
| `--with-maybeboard` | Include Maybeboard cards in pricing                |
| `--output <format>` | Output format (`json` or `text`)                   |
| `--quiet`           | Suppress non-essential output                      |

## Examples

Get pricing for main deck only:

```bash
./ritual price "Atraxa Superfriends"
```

Include sideboard cards:

```bash
./ritual price "Mono Red Aggro" --with-sideboard
```

Include all sections:

```bash
./ritual price "Atraxa Superfriends" --all
```

Output machine-readable JSON:

```bash
./ritual price "Atraxa Superfriends" --output json
```

## Output

The command displays:

- **Latest Price**: Most recent market price
- **Min Price**: Lowest recorded price
- **Max Price**: Highest recorded price

Prices are fetched from Scryfall's price data.

If Scryfall returns any missing cards in collection pricing (`not_found`), the command fails and reports the missing names without updating the local price cache.
