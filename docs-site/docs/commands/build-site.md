---
sidebar_position: 12
---

# build-site

Generate a static website for your decks.

## Usage

```bash
./ritual build-site [decks...] [options]
```

## Arguments

| Argument     | Description                                  | Required |
| ------------ | -------------------------------------------- | -------- |
| `[decks...]` | Optional list of deck names or URLs to build | No       |

If no decks are specified, builds all imported decks found in the `decks/` directory.

## Options

| Option          | Description                                    |
| --------------- | ---------------------------------------------- |
| `-v, --verbose` | Show list of cards being fetched from Scryfall |

## Examples

Build site for all decks:

```bash
./ritual build-site
```

Build site for specific decks:

```bash
./ritual build-site "Atraxa Superfriends" "Mono Red Aggro"
```

Build with verbose output:

```bash
./ritual build-site --verbose
```

Build directly from a URL:

```bash
./ritual build-site https://archidekt.com/decks/12345
```

## Output

Generates a static website in the `dist/` directory containing:

- Index page with deck listing
- Individual deck pages with card images
- Responsive design for desktop and mobile
- Dark mode support

## Serving the Site

After building, use the [`serve`](./serve) command to preview locally:

```bash
./ritual serve
```
