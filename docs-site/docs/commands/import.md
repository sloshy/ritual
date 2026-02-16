---
sidebar_position: 2
---

# import

Import a deck from a URL or local text file.

## Usage

```bash
./ritual import <source>
```

## Arguments

| Argument   | Description                                             | Required |
| ---------- | ------------------------------------------------------- | -------- |
| `<source>` | URL (Archidekt/Moxfield/MTGGoldfish) or local file path | Yes      |

## Options

| Option                          | Description                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `-o, --overwrite`               | Overwrite existing decks without prompting                                                   |
| `--non-interactive`             | Disable interactive prompts; fail when user input is required                                |
| `-y, --yes`                     | Automatically answer yes to prompts (implies overwrite conflicts)                            |
| `--dry-run`                     | Preview actions without writing deck files                                                   |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield imports unless env is set) |

## Supported Sources

| Source      | Example URL                              |
| ----------- | ---------------------------------------- |
| Archidekt   | `https://archidekt.com/decks/12345`      |
| Moxfield    | `https://moxfield.com/decks/abc123`      |
| MTGGoldfish | `https://www.mtggoldfish.com/deck/12345` |
| Local File  | `./my-deck.txt`                          |

## Examples

Import from Archidekt:

```bash
./ritual import https://archidekt.com/decks/12345
```

Import from Moxfield:

```bash
./ritual import https://moxfield.com/decks/abc123
```

Import from Moxfield with an explicit user agent:

```bash
./ritual import https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Import/1.0"
```

Import from a local text file:

```bash
./ritual import ./decklist.txt
```

Preview import without writing files:

```bash
./ritual import ./decklist.txt --dry-run --non-interactive
```

## Moxfield User-Agent Requirement

Moxfield imports require a unique Moxfield-approved user agent string.

- Set `MOXFIELD_USER_AGENT`, or
- Pass `--moxfield-user-agent <agent>`

If you need a unique user agent string, contact Moxfield support.

## Local File Format

When importing from a local file, use the standard decklist format:

```
4 Lightning Bolt
4 Monastery Swiftspear
2 Mountain

// Sideboard
2 Pyroblast
```
