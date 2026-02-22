---
sidebar_position: 1
slug: /
---

# Getting Started

An all-in-one toolkit for Magic: The Gathering decks, collections, and self-hosting.

## Installation

### Using a Pre-built Binary

Download the latest binary from the [releases page](https://github.com/sloshy/ritual/releases) and run it directly:

```bash
./ritual --help
```

### Building from Source

This project uses [Bun](https://bun.sh) as its runtime. First, install dependencies:

```bash
bun install
```

Then build the binary:

```bash
bun run build
```

## Quick Start

### Create Your First Deck

```bash
./ritual new-deck "My Commander Deck" --format commander
```

### Import a Deck from a Website

Import decks from Archidekt, Moxfield, or MTGGoldfish:

```bash
./ritual import https://archidekt.com/decks/12345
```

### Get Pricing Information

```bash
./ritual price "My Commander Deck"
```

### Generate a Static Website (Experimental)

Ritual supports building static websites to showcase your decks (and soon, your collection). This is an experimental feature, so expect some rough edges. To build and serve the site locally:

```bash
./ritual build-site
./ritual serve
```

Then open http://localhost:3000 to view your deck collection.

## Features

- **Deck Management**: Create and organize your MTG decks
- **Multi-source Import**: Import from Archidekt, Moxfield, MTGGoldfish, or local files
- **Scryfall Integration**: Full card search powered by Scryfall
- **Pricing**: Get min, max, and latest prices for your decks
- **Static Site Generation**: Create a self-hosted website to showcase your decks or collection
- **Caching**: Smart caching for fast card lookups

## Scripting quickstart

Use structured output for automation:

```bash
./ritual price "My Commander Deck" --output json | jq '.totals'
```

Stream multiple card lookups as NDJSON:

```bash
./ritual card --from-file cards.txt --output ndjson --fields name,set,prices.usd
```

Avoid interactive prompts in CI:

```bash
./ritual import-account johndoe --all --non-interactive --dry-run
```

## Migration notes

- Prefer `--output json` or `--output ndjson` for script parsing.
- Use `--fields` to project stable subsets of data.
- Add `--non-interactive` (and `--yes` when needed) in headless environments.
