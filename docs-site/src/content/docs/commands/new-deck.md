---
title: 'new-deck'
---

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

## Formats

`--format` accepts any of the formats below. The value is normalized before it is
written, so `EDH`, `Commander / EDH`, and `commander` all store `format: commander`.
An unrecognized format is an error — the deck file is not created.

`commander`, `oathbreaker`, `standard`, `modern`, `pioneer`, `legacy`, `vintage`,
`pauper`, `historic`, `alchemy`, `explorer`, `timeless`, `penny-dreadful`, `brawl`,
`historic-brawl`, `duel-commander`, `pauper-commander`, `pre-dh`, `pre-modern`,
`limited`

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

## Deck format

A deck's format lives in its `format:` front matter, and is the same closed set of
values everywhere it is used — `new-deck`, the editors, `import-csv`, the admin
site, and the MCP `create_deck` tool.

A deck that declares no format is treated as Commander when it has a `## Commander`
section (Oathbreaker for a `## Oathbreaker` or `## Signature Spell` section). That
inference is written into the file the next time the deck is saved, so an imported
or hand-written deck stops being a guess after its first edit.
