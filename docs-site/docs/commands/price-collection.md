---
sidebar_position: 12
---

# price-collection

Get pricing for your card collection. Alias: `pc`.

## Usage

```bash
./ritual price-collection [collectionName] [options]
```

## Arguments

| Argument           | Description                                          | Required |
| ------------------ | ---------------------------------------------------- | -------- |
| `[collectionName]` | Name of a single collection file (without extension) | No       |

When no collection name is given, all `.md` files in the `collections/` directory are priced and a grand total is shown.

## Options

| Option              | Description                      |
| ------------------- | -------------------------------- |
| `--output <format>` | Output format (`json` or `text`) |
| `--quiet`           | Suppress non-essential output    |

## Examples

Price all collections:

```bash
./ritual price-collection
```

Price a single collection:

```bash
./ritual pc "Red Binder"
```

Machine-readable JSON output:

```bash
./ritual pc --output json
```

## Output

For each collection the command displays the total price based on exact printings.

Each card is priced using its specific set and collector number. The finish determines which price is used (`usd`, `usd_foil`, or `usd_etched`). Cards without a finish default to nonfoil.

Cards missing a set code and collector number are skipped with a warning.

Prices are fetched from Scryfall's price data.

:::warning
Prices reflect Near Mint (NM) market values. Card condition (LP, MP, HP, DMG) can significantly decrease actual value.
:::
