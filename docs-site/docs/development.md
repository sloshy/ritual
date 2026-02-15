---
sidebar_position: 10
---

# Development

This guide covers how to set up the project for local development and contribute to the codebase.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or higher)
- Node.js 18+ (for Docusaurus docs site)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/sloshy/ritual.git
cd ritual
bun install
```

## Running Locally

You can run commands directly without building:

```bash
bun run index.ts --help
bun run index.ts new-deck "Test Deck"
```

## Building

Create a compiled binary:

```bash
bun run build
```

This produces a `ritual` executable in the project root.

## Testing

This project uses `bun test` for testing.

### Unit Tests

Run unit tests for quick feedback:

```bash
bun run test
```

### Integration Tests

Run integration tests that interact with external services:

```bash
bun run test:it
```

## Project Structure

```
ritual-cli/
├── index.ts              # CLI entry point
├── src/
│   ├── commands/         # CLI command implementations
│   ├── auth/             # Authentication modules
│   ├── clients/          # API clients
│   ├── importers/        # Deck importers
│   ├── site/             # Static site components
│   ├── scryfall.ts       # Scryfall API integration
│   ├── prices.ts         # Price fetching logic
│   ├── cache.ts          # Caching system
│   └── types.ts          # TypeScript types
├── test/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── decks/                # Deck files (Markdown)
├── cache/                # Card cache
└── dist/                 # Generated static site
```

## Code Style

This project uses Prettier for code formatting:

```bash
bun run format        # Format all files
bun run check-format  # Check formatting
```
