---
sidebar_position: 14
---

# serve-site

Build the static site and serve it in one step, with an optional `--dev` watcher that rebuilds when files change.

Use this instead of running [`build-site`](./build-site) and [`serve`](./serve) separately when you want a one-shot preview, or when iterating on the SPA source / your deck and collection markdown.

## Usage

```bash
./ritual serve-site [options]
```

## Options

The build options mirror [`build-site`](./build-site); two additional options control the serving side.

| Option                      | Description                                                                                                              | Default   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| `-p, --port <number>`       | Port to serve on                                                                                                         | `3000`    |
| `--host <address>`          | Host address to bind to                                                                                                  | `0.0.0.0` |
| `--dev`                     | Rebuild when files under `src/`, `decks/`, `collections/`, or `wanted/` change                                           |           |
| `-v, --verbose`             | Show list of cards being fetched from Scryfall                                                                           |           |
| `--cache-images`            | Download and use local deck card images in `dist/images` instead of URLs                                                 |           |
| `--decks [names...]`        | Deck names or URLs to include in the site (default: all in `decks/`)                                                     |           |
| `--collections [names...]`  | Collection names to include in the site (default: all in `collections/`)                                                 |           |
| `--wanted-lists [names...]` | Wanted list names to include in the site (default: all in `wanted/`)                                                     |           |
| `--collection-sort <field>` | Default sort order for collection pages (`file-order`, `name`, `price`, `set-code`, `type`, `cmc`, `color-identity`)     |           |
| `--deck-sort <field>`       | Default sort order for deck pages (`name`, `cmc`, `price`, `type`, `edhrec`, `color-identity`)                           |           |
| `--currencies <list>`       | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three; first listed is default)     |           |
| `-y, --yes`                 | Skip confirmation prompts and auto-accept (e.g. bulk cache redownload). Implied when `--dev` is set.                     |           |
| `--theme <name>`            | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`. |           |
| `--theme-file <path...>`    | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.             |           |

## Examples

Build everything and serve at http://localhost:3000:

```bash
./ritual serve-site
```

Serve on a custom port:

```bash
./ritual serve-site --port 8080
```

Build only specific decks:

```bash
./ritual serve-site --decks "Atraxa Superfriends" "Mono Red Aggro"
```

Iterate on SPA source or deck markdown — the site rebuilds whenever a watched file changes, and refreshing the browser shows the latest output:

```bash
./ritual serve-site --dev
```

## Dev Mode

When `--dev` is passed:

- The SPA's JS and CSS are rebuilt **from source** (`src/site/`) rather than read from the binary's bundled assets, so source-code edits show up after a rebuild.
- A file watcher monitors `src/` (TypeScript/TSX/CSS/SVG), `decks/`, `collections/`, and `wanted/` (Markdown). Changes there trigger a debounced rebuild.
- The HTTP server keeps running across rebuilds — refresh the browser to pick up the new output.
- The Scryfall bulk-cache prompt is auto-accepted (`--yes` is implied) so watch-triggered rebuilds never block waiting for input.

Press `Ctrl+C` to stop the server and watcher.

## Notes

- Output is written to the `dist/` directory, the same as `build-site`.
- Without `--dev`, the SPA assets bundled into the binary are used (same as `build-site`); this is faster than rebuilding from source.
- For details on individual build options (themes, currencies, output format, trade planner, etc.), see [`build-site`](./build-site).
- To serve a previously built `dist/` without rebuilding, use [`serve`](./serve).
