# Ritual

<img src="app.svg" alt="Ritual icon" width="96" />

An all-in-one toolkit for Magic: The Gathering for your CLI and self-hosting needs.

## Usage

Download the latest binary from the [releases page](https://github.com/sloshy/ritual/releases), or build from source with `bun run build`.

```bash
./ritual --help
```

📖 **Full documentation at [ritual.rpeters.dev](https://ritual.rpeters.dev)**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for rules and guidelines.

## Development

This project uses [Bun](https://bun.sh) as its runtime. Install dependencies with:

```bash
bun install
```

Run commands locally without building:

```bash
bun run index.ts --help
```

Build a compiled binary:

```bash
bun run build
```

## Testing

**Unit Tests:**

```bash
bun run test
```

**Integration Tests:**

```bash
bun run test:it
```
