---
title: 'new'
---

Create a new deck, collection, or wanted list.

## Usage

```bash
ritual new <type> <name...> [options]
```

## Arguments

| Argument    | Description                               | Required |
| ----------- | ----------------------------------------- | -------- |
| `<type>`    | List type: `deck`, `collection`, `wanted` | Yes      |
| `<name...>` | Name of the list                          | Yes      |

## Options

| Option                  | Description                                                                                     | Default     |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| `-f, --format <format>` | Deck format (decks only); see [Formats](#formats). An invalid value lists every accepted format | `commander` |
| `--output <format>`     | Output format: `text`, `json`, or `ndjson`                                                      | `text`      |
| `--quiet`               | Suppress non-essential output                                                                   | `false`     |

Passing `--format` for a collection or wanted list is a usage error. Omitting it on a deck creates a **Commander** deck.

## Formats

`--format` accepts any of the formats below. The value is normalized before it is written, so `EDH`, `Commander / EDH`, and `commander` all store `format: commander`. An unrecognized format is an error, and no deck file is created.

`commander`, `oathbreaker`, `standard`, `modern`, `pioneer`, `legacy`, `vintage`, `pauper`, `historic`, `alchemy`, `explorer`, `timeless`, `penny-dreadful`, `brawl`, `historic-brawl`, `duel-commander`, `pauper-commander`, `pre-dh`, `pre-modern`, `limited`

## Examples

Create a new Commander deck:

```bash
ritual new deck "Atraxa Superfriends"
```

Create a Standard deck:

```bash
ritual new deck "Mono Red Aggro" --format standard
```

Create a collection and a wanted list:

```bash
ritual new collection "Trade Binder"
ritual new wanted "Grail Cards"
```

Capture the created list as JSON:

```bash
ritual new deck "Burn" --output json
```

The JSON payload is `{ type, slug, name, filePath }`.

## Output

Creates a markdown file in the type's directory (`decks/`, `collections/`, or `wanted/`), named after the list, plus its `.sha256` content-hash file. Decks start with front matter and an empty `## Main` section. Collections and wanted lists start as a bare `# Name` heading.

## List file names

A list's file is named exactly as you name the list: `ritual new deck "Winota Stax"` writes `decks/Winota Stax.md`. Case, spaces, and punctuation are preserved. The name is not lowercased or hyphenated.

Only characters file systems reject are removed: `/ \ : * ? " < > |`, the null byte, and leading, trailing, or repeated dots. So `Atraxa: Praetors' Voice` is stored as `decks/Atraxa Praetors' Voice.md`, while the `# Title` heading keeps the colon. A name with nothing usable left (`"???"`) is an error, and no file is written.

A name is also how you address a list later, so `new` refuses a name that would [resolve](/list-resolution/#names-that-would-collide-are-refused-at-creation) to an existing list of the same type, not just one that lands on the same file name. Creating `atraxa superfriends` beside an existing `Atraxa Superfriends.md` is refused with `A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends' under list-name folding)`.

Every surface that creates a list (the CLI, the editors, imports, and the admin site) names files this way.

## Deck format

A deck's format lives in its `format:` front matter. It is the same closed set of values everywhere: `ritual new`, the editors, [`import`](/commands/import/#deck-format), the admin site, and the MCP `create_list` tool.

A deck that declares no format is treated as Commander when it has a `## Commander` section, and as Oathbreaker when it has a `## Oathbreaker` or `## Signature Spell` section. That inference is written into the file the next time the deck is saved.

## Exit Codes

| Code | Meaning                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                               |
| `2`  | Usage error (unknown type, unknown format, `--format` on a non-deck, unusable name, a name that already resolves to an existing list) |
| `1`  | Runtime error                                                                                                                         |
