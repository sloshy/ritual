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

Creates a new Markdown file in the `decks/` directory, named as the deck is named.

## List file names

A list's file is named exactly as you name the list — `ritual new-deck "Winota Stax"` writes
`decks/Winota Stax.md`. Case, spaces, and punctuation are preserved; the name is not
lowercased or hyphenated.

Only the characters that file systems reject are removed: `/ \ : * ? " < > |`, the null
byte, and leading, trailing, or repeated dots (which would otherwise hide the file or
escape the directory). So `Atraxa: Praetors' Voice` is stored as
`decks/Atraxa Praetors' Voice.md`, while the `name:` front matter keeps the colon. A name
left with nothing usable (`"???"`) is an error, and no file is written.

Decks, collections, and wanted lists are all named this way, by every surface that creates
one — the CLI, the editors, imports, and the admin site.

## Deck format

A deck's format lives in its `format:` front matter, and is the same closed set of
values everywhere it is used — `new-deck`, the editors, `import-csv`, the admin
site, and the MCP `create_deck` tool.

A deck that declares no format is treated as Commander when it has a `## Commander`
section (Oathbreaker for a `## Oathbreaker` or `## Signature Spell` section). That
inference is written into the file the next time the deck is saved, so an imported
or hand-written deck stops being a guess after its first edit.
