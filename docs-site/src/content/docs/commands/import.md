---
title: 'import'
---

Import a deck from a URL, or a deck, collection, or wanted list from a local text file.

## Usage

```bash
./ritual import <source>
```

When the source is a text file, `import` asks whether the cards are a deck, a
collection, or a wanted list (pass `--type` to skip the prompt). URL imports
always create decks — importing a collection or wanted list from a URL is not
supported.

## Arguments

| Argument   | Description                                             | Required |
| ---------- | ------------------------------------------------------- | -------- |
| `<source>` | URL (Archidekt/Moxfield/MTGGoldfish) or local file path | Yes      |

## Options

| Option                          | Description                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --type <type>`             | List type for a text file import: `deck`, `collection`, or `wanted`. Skips the interactive prompt. URLs always import decks.            |
| `-o, --overwrite`               | Overwrite existing lists without prompting                                                                                              |
| `--non-interactive`             | Disable interactive prompts; fail when user input is required. Without `--type`, a text file import defaults to a deck.                 |
| `-y, --yes`                     | Automatically answer yes to prompts (implies overwrite on conflicts and, like `--non-interactive`, defaults to a deck without `--type`) |
| `--dry-run`                     | Preview actions without writing files                                                                                                   |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield imports unless env is set)                                            |

## Supported Sources

| Source      | Example URL                              |
| ----------- | ---------------------------------------- |
| Archidekt   | `https://archidekt.com/decks/12345`      |
| Moxfield    | `https://moxfield.com/decks/abc123`      |
| MTGGoldfish | `https://www.mtggoldfish.com/deck/12345` |
| Local File  | `./my-deck.txt`                          |

## Examples

Import a deck from Archidekt:

```bash
./ritual import https://archidekt.com/decks/12345
```

Import a deck from Moxfield:

```bash
./ritual import https://moxfield.com/decks/abc123
```

Import from Moxfield with an explicit user agent:

```bash
./ritual import https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Import/1.0"
```

Import from a local text file (prompts for the list type):

```bash
./ritual import ./decklist.txt
```

Import a text file into a collection:

```bash
./ritual import ./binder.txt --type collection
```

Import a text file into a wanted list without prompts:

```bash
./ritual import ./wants.txt --type wanted --non-interactive
```

Preview an import without writing files:

```bash
./ritual import ./decklist.txt --dry-run --non-interactive
```

## Moxfield User-Agent Requirement

Moxfield imports require a unique Moxfield-approved user agent string.

- Set `MOXFIELD_USER_AGENT`, or
- Pass `--moxfield-user-agent <agent>`

If you need a unique user agent string, contact Moxfield support.

## Local File Format

When importing from a local file, use the standard decklist format. `## Section`
headers split the cards into sections:

```
4 Lightning Bolt
4 Monastery Swiftspear
2 Mountain

## Sideboard
2 Pyroblast
```

Lines may also carry a printing, finish, condition, and note, e.g.
`1 Sol Ring (C19:221) [foil] [NM] {trade binder}`.

When importing into a collection or wanted list, each line expands to one
bullet line per copy (`4 Lightning Bolt` becomes four `- Lightning Bolt` lines),
matching how those lists track individual physical cards.

Collection imports require a printing (`(SET:123)`) on every line, since
collection entries always reference a specific physical printing. Wanted list
entries may be name-only.
