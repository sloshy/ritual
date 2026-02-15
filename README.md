# Ritual

An all-in-one toolkit for Magic: The Gathering for your CLI and self-hosting needs.

## Usage

You can use a precompiled binary from the releases page, or you can run `bun run build` to build your own locally.

You can run commands using `./ritual <command>`.

```bash
./ritual --help
```

## Commands

### `new-deck`

Create a new deck file.

**Usage:**

```bash
./ritual new-deck <name> [options]
```

**Arguments:**

- `<name>`: Name of the deck.

**Options:**

- `-f, --format <format>`: Deck format (e.g., standard, commander). Default: `commander`.

### `import`

Import a deck from a URL (Archidekt, Moxfield, MTGGoldfish) or local text file.

**Usage:**

```bash
./ritual import <source>
```

**Arguments:**

- `<source>`: URL (Archidekt/Moxfield/MTGGoldfish) or local file path to import.

**Options:**

- `-o, --overwrite`: Overwrite existing decks without prompting.
- `--non-interactive`: Disable interactive prompts; fail when input is required.
- `-y, --yes`: Automatically answer yes to prompts (implies overwrite on conflicts).
- `--dry-run`: Preview import actions without writing deck files.

### `import-account`

Import all public decks from an Archidekt user.

**Usage:**

```bash
./ritual import-account [username] [options]
```

**Arguments:**

- `[username]`: Archidekt username to fetch decks for. Optional if already logged in.

**Options:**

- `-a, --all`: Import all decks without interative selection.
- `-o, --overwrite`: Overwrite existing decks without prompting.
- `--non-interactive`: Disable interactive prompts; requires `--all` or `--yes`.
- `-y, --yes`: Automatically answer yes to prompts.
- `--dry-run`: Preview import actions without writing deck files.

### `login`

Login to a supported website to save authentication tokens for future requests.

**Usage:**

```bash
./ritual login <site>
```

**Arguments:**

- `<site>`: The site to login to (`archidekt`).

> [!NOTE]
> Moxfield login is currently not supported due to an explicit lack of support. You can still import decks from Moxfield using the `import` command, but you cannot upload data to your Moxfield account or access private decks.

### `cache`

Manage card cache.

**Usage:**

```bash
./ritual cache preload-set <setCode>
```

**Arguments:**

- `<setCode>`: Set code to preload (e.g. `khm`, `lea`).

### `card`

Look up a single card by name using Scryfall.

**Usage:**

```bash
./ritual card [name] [options]
```

**Arguments:**

- `[name]`: Card name to search for. Optional when using `--stdin` or `--from-file`.

**Options:**

- `--fuzzy`: Use fuzzy matching instead of exact.
- `--set <code>`: Filter by set code.
- `--stdin`: Read card names from stdin (one per line).
- `--from-file <path>`: Read card names from file (one per line).
- `--fields <list>`: Comma-separated fields for `json`/`ndjson` output.
- `--output <format>`: Output format (`json`, `ndjson`, or `text`). Default: `json`.
- `--quiet`: Suppress non-essential output.

### `random`

Fetch a random card from Scryfall.

**Usage:**

```bash
./ritual random [options]
```

**Options:**

- `--filter <query>`: Scryfall search query to filter random selection.
- `--fields <list>`: Comma-separated fields for `json`/`ndjson` output.
- `--output <format>`: Output format (`json`, `ndjson`, or `text`). Default: `json`.
- `--quiet`: Suppress non-essential output.

### `add-card`

Add a card to a deck by name.

**Usage:**

```bash
./ritual add-card <deckName> <cardName...> [options]
```

**Arguments:**

- `<deckName>`: Name of the deck file (without extension).
- `<cardName...>`: Name of the card to search for.

**Options:**

- `-q, --quantity <number>`: Number of copies to add. Default: `1`.

### `collection`

Interactively manage a collection of cards. Alias: `collect`.

**Usage:**

```bash
./ritual collection
```

Launches an interactive session with two entry modes:

- **Name Mode**: Autocomplete-driven card name entry with session filters for set, finish, and condition.
- **Collector Number Mode**: Look up cards by collector number within one or more loaded sets.

Append `!` to a card name in name mode to force finish/condition prompts regardless of session filters.

### `scry`

Run a raw Scryfall card search.

**Usage:**

```bash
./ritual scry <query> [options]
```

**Arguments:**

- `<query>`: Scryfall search query.

**Options:**

- `--csv`: Output as CSV.
- `--pages <number>`: Number of pages to output (default: 1 for non-TTY).
- `--fields <list>`: Comma-separated fields for `json`/`ndjson` output.
- `--output <format>`: Output format (`json`, `ndjson`, or `text`). Default: `json`.
- `--quiet`: Suppress non-essential output and default to one page in TTY mode.
- `--non-interactive`: Disable interactive pagination prompts.
- `-y, --yes`: Automatically fetch additional pages in TTY mode.

### `price`

Get pricing for a deck (Latest, Min, Max).

**Usage:**

```bash
./ritual price <deckName> [options]
```

**Arguments:**

- `<deckName>`: Name of the deck file (without extension).

**Options:**

- `--all`: Include all sections (Sideboard, Maybeboard, etc).
- `--with-sideboard`: Include Sideboard.
- `--with-maybeboard`: Include Maybeboard.
- `--output <format>`: Output format (`json` or `text`). Default: `text`.
- `--quiet`: Suppress per-section breakdowns and other non-essential output.

### `build-site`

Generate a static website for decks.

**Usage:**

```bash
./ritual build-site [decks...]
```

**Arguments:**

- `[decks...]`: Optional list of deck names (files in `decks/` without extension) or URLs to build. If omitted, builds all imported decks found in `decks/`.

**Options:**

- `-v, --verbose`: Show list of cards to be fetched from Scryfall.

### `serve`

Serve the generated static site.

**Usage:**

```bash
./ritual serve [options]
```

**Options:**

- `-p, --port <number>`: Port to serve on. Default: `3000`.

## Scripting quickstart

Get price totals as JSON:

```bash
./ritual price "My Commander Deck" --output json | jq '.totals'
```

Stream multiple card lookups from a file:

```bash
./ritual card --from-file cards.txt --output ndjson --fields name,set,prices.usd
```

Run non-interactive imports in CI:

```bash
./ritual import-account johndoe --all --non-interactive --dry-run
```

## Scripting and exit codes

For automation and CI use-cases, these commands support `--output <format>` and `--quiet`:

- `card`
- `random`
- `scry`
- `price`

Prompt-heavy commands also support explicit non-interactive controls:

- `import`: `--non-interactive`, `--yes`, `--dry-run`
- `import-account`: `--non-interactive`, `--yes`, `--dry-run`
- `scry`: `--non-interactive`, `--yes`

Batch/stream oriented options:

- `card`: `--stdin`, `--from-file`, `--output ndjson`
- `card`, `random`, `scry`: `--fields` for deterministic JSON projection

Exit codes for these scripting-aware flows:

- `0`: Success
- `1`: Runtime failure
- `2`: Usage/validation error
- `3`: Not found (e.g. missing deck file or card/search result)

## Migration notes (scripting-focused)

- Use `--output json` or `--output ndjson` when scripts parse command output.
- Use `--fields` to keep payloads stable and minimal for downstream tooling.
- For CI, add `--non-interactive` (and optionally `--yes`) to prevent prompt hangs.
- `card` now supports batch input via `--stdin` and `--from-file`; in batch mode, prefer `--output ndjson`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for rules and guidelines.

## Development

This project uses [Bun](https://bun.sh) as its runtime.
You can install dependencies for development with:

```bash
bun install
```

## Testing

This project uses `bun test` for testing.

**Unit Tests** (Run these for quick feedback):

```bash
bun run test
```

**Integration Tests** (Run these to verify local side-effects):

```bash
bun run test:it
```
