---
title: 'price-wanted-list'
---

Get pricing for your wanted list. Alias: `pwl`.

## Usage

```bash
./ritual price-wanted-list [listName] [options]
```

## Arguments

| Argument     | Description                                           | Required |
| ------------ | ----------------------------------------------------- | -------- |
| `[listName]` | Name of a single wanted list file (without extension) | No       |

When no list name is given, all `.md` files in the `wanted/` directory are priced and a grand total is shown. A given name is matched case-insensitively, with a unique-substring fallback; an ambiguous name is rejected. See [List Resolution](/commands/list-resolution/).

## Options

| Option                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `--sort <field>`      | Sort cards by `name` or `price` (default: listed order) |
| `--descending`        | Reverse the sort direction                              |
| `--prices <currency>` | Price currency: `usd`, `eur`, or `tix` (default: `usd`) |
| `--output <format>`   | Output format (`json` or `text`)                        |
| `--quiet`             | Suppress non-essential output                           |

## Card State Pricing

Pricing behavior depends on each card's specificity state:

| State               | Latest                                   | Min                                       | Max                                             |
| ------------------- | ---------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| **Name only**       | Cheapest printing across all sets        | Same as Latest                            | Most expensive printing across all sets         |
| **Printing**        | Default finish of the specified printing | Cheapest finish of the specified printing | Most expensive finish of the specified printing |
| **Fully specified** | Exact printing and finish                | Same as Latest                            | Same as Latest                                  |

Name-only entries (`- Card Name` with no set code) always use the cheapest available printing across all sets and finishes.

## Examples

Price all wanted lists:

```bash
./ritual price-wanted-list
```

Sort by price, most expensive first:

```bash
./ritual pwl --sort price --descending
```

Price a single wanted list:

```bash
./ritual pwl "High Priority"
```

Machine-readable JSON output:

```bash
./ritual pwl --output json
```

Show EUR (Cardmarket) prices:

```bash
./ritual pwl --prices eur
```

## Output

For each wanted list the command displays three price columns matching the deck `price` command:

- **Latest** — the cheapest printing for name-only entries, or default finish for pinned entries
- **Min** — the cheapest option (same as Latest for name-only, cheapest finish for printing-state)
- **Max** — the most expensive option (most expensive printing for name-only, most expensive finish for printing-state)

Cards in the **printing** or **fully-specified** states are priced using their specific set and collector number, with the finish determining which price field is used (`usd`, `usd_foil`, or `usd_etched` for USD; `eur` or `eur_foil` for EUR; `tix` for MTGO).

Prices are fetched from Scryfall's price data. Use `--prices eur` for Cardmarket EUR prices or `--prices tix` for MTGO ticket prices.
