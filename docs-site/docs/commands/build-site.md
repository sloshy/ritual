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

By default, deck card images use Scryfall URLs from card data. This can be overridden with the `--cache-images` option to download and use local images instead.

| Option           | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `-v, --verbose`  | Show list of cards being fetched from Scryfall                           |
| `--cache-images` | Download and use local deck card images in `dist/images` instead of URLs |

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

Build with downloaded local deck card images:

```bash
./ritual build-site --cache-images
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
