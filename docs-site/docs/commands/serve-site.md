---
sidebar_position: 14
---

# serve-site

Build the static site and serve it in one step.

Use this instead of running [`build-site`](./build-site) and [`serve`](./serve) separately when you want a one-shot preview.

## Usage

```bash
./ritual serve-site [options]
```

## Options

The build options mirror [`build-site`](./build-site); two additional options control the serving side.

| Option                      | Description                                                                                                                  | Default   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>`       | Port to serve on                                                                                                             | `3000`    |
| `--host <address>`          | Host address to bind to                                                                                                      | `0.0.0.0` |
| `-v, --verbose`             | Show list of cards being fetched from Scryfall                                                                               |           |
| `--cache-images`            | Download and use local deck card images in `dist/images` instead of URLs                                                     |           |
| `--decks [names...]`        | Deck names or URLs to include in the site (default: all in `decks/`)                                                         |           |
| `--collections [names...]`  | Collection names to include in the site (default: all in `collections/`)                                                     |           |
| `--wanted-lists [names...]` | Wanted list names to include in the site (default: all in `wanted/`)                                                         |           |
| `--collection-sort <field>` | Default sort order for collection pages (`file-order`, `name`, `price`, `set-code`, `type`, `cmc`, `color-identity`)         |           |
| `--deck-sort <field>`       | Default sort order for deck pages (`name`, `cmc`, `price`, `type`, `edhrec`, `color-identity`)                               |           |
| `--currencies <list>`       | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three; first listed is default)         |           |
| `--allow-refresh`           | Refresh the card cache when stale, including the Scryfall bulk download (see [build-site](./build-site#card-cache-refresh)). |           |
| `--allow-refresh-no-bulk`   | Refresh stale prices per-card but never trigger a bulk download.                                                             |           |
| `--no-refresh`              | Never refresh the card cache; build from cached data as-is.                                                                  |           |
| `--theme <name>`            | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`.     |           |
| `--theme-file <path...>`    | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.                 |           |

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

## Notes

- Output is written to the `dist/` directory, the same as `build-site`.
- For details on individual build options (themes, currencies, output format, trade planner, etc.), see [`build-site`](./build-site).
- To serve a previously built `dist/` without rebuilding, use [`serve`](./serve).
- For an auto-restarting workflow that rebuilds when source or data files change, see [Development → Dev Workflow](../development.md#dev-workflow). Note that `bun run dev serve-site` requires one of `--allow-refresh`, `--allow-refresh-no-bulk`, or `--no-refresh` so the cache refresh prompt can be answered non-interactively.
