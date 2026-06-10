---
title: 'price-deck'
---

Get pricing information for a deck.

## Usage

```bash
./ritual price-deck <deckName> [options]
```

## Arguments

| Argument     | Description                               | Required |
| ------------ | ----------------------------------------- | -------- |
| `<deckName>` | Name of the deck file (without extension) | Yes      |

The name is matched case-insensitively, with a unique-substring fallback; an ambiguous name is rejected. See [List Resolution](/commands/list-resolution/).

## Options

| Option                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `--all`               | Include all sections (Sideboard, Maybeboard, etc.)      |
| `--with-sideboard`    | Include Sideboard cards in pricing                      |
| `--with-maybeboard`   | Include Maybeboard cards in pricing                     |
| `--prices <currency>` | Price currency: `usd`, `eur`, or `tix` (default: `usd`) |
| `--output <format>`   | Output format (`json` or `text`)                        |
| `--quiet`             | Suppress non-essential output                           |

## Examples

Get pricing for main deck only:

```bash
./ritual price-deck "Atraxa Superfriends"
```

Include sideboard cards:

```bash
./ritual price-deck "Mono Red Aggro" --with-sideboard
```

Include all sections:

```bash
./ritual price-deck "Atraxa Superfriends" --all
```

Output machine-readable JSON:

```bash
./ritual price-deck "Atraxa Superfriends" --output json
```

Show EUR (Cardmarket) prices:

```bash
./ritual price-deck "Atraxa Superfriends" --prices eur
```

Show MTGO tix prices:

```bash
./ritual price-deck "Mono Red Aggro" --prices tix
```

## Output

The command displays:

- **Latest Price**: Most recent market price
- **Min Price**: Lowest recorded price
- **Max Price**: Highest recorded price

Prices are fetched from Scryfall's price data. By default, prices are shown in USD (TCGPlayer). Use `--prices eur` for EUR (Cardmarket) prices or `--prices tix` for MTGO ticket prices. The flag is case insensitive.

If Scryfall returns any missing cards in collection pricing (`not_found`), the command fails and reports the missing names without updating the local price cache.

## Missing Card Warnings

Cards that are not available in the selected currency's game format are omitted from totals with a warning. For example, a paper-only card will have no TIX price, and an MTGO-only card will have no USD/EUR price. The command lists any cards with missing prices and notes the count of omitted cards. In JSON output mode, a `missingCards` array is included in the result.
