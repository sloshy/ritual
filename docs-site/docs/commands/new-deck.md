---
sidebar_position: 1
---

# new-deck

Create a new deck file.

## Usage

```bash
./ritual new-deck <name> [options]
```

## Arguments

| Argument | Description      | Required |
| -------- | ---------------- | -------- |
| `<name>` | Name of the deck | Yes      |

## Options

| Option                  | Description                             | Default     |
| ----------------------- | --------------------------------------- | ----------- |
| `-f, --format <format>` | Deck format (e.g., standard, commander) | `commander` |

## Examples

Create a new Commander deck:

```bash
./ritual new-deck "Atraxa Superfriends"
```

Create a Standard deck:

```bash
./ritual new-deck "Mono Red Aggro" --format standard
```

## Output

Creates a new Markdown file in the `decks/` directory with the deck name as the filename.
