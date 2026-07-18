---
title: 'serve'
---

Serve the generated static site locally, optionally building it first.

## Usage

```bash
./ritual serve [options]
```

By default, `serve` serves a previously built `dist/` directory. Pass `--build` to build the site first and then serve the result — the one-shot preview that used to require running [`build-site`](/commands/build-site/) and `serve` separately.

## Options

| Option                | Description                                                                              | Default   |
| --------------------- | ---------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>` | Port to serve on. Validated at parse time (1–65535); an invalid value exits with code 2. | `3000`    |
| `--host <address>`    | Host address to bind to. `0.0.0.0` binds all interfaces.                                 | `0.0.0.0` |
| `--build`             | Build the site before serving it                                                         |           |

### Build options (require `--build`)

With `--build`, `serve` accepts the full [`build-site`](/commands/build-site/) option surface. Passing any of these **without** `--build` is a usage error: the command exits with code 2 and an error naming the offending flag(s).

| Option                          | Description                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show list of cards being fetched from Scryfall                                                                                                                                      |
| `--cache-images`                | Download and use local deck card images in `dist/images` instead of URLs                                                                                                            |
| `--decks [names...]`            | Deck names or URLs to include in the site (default: the `site.includeDecks` config selection)                                                                                       |
| `--collections [names...]`      | Collection names to include in the site (default: the `site.includeCollections` config selection)                                                                                   |
| `--wanted-lists [names...]`     | Wanted list names to include in the site (default: the `site.includeWantedLists` config selection)                                                                                  |
| `--currencies <list>`           | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three)                                                                                         |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default — prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never` (see [build-site](/commands/build-site/#card-cache-refresh)). |
| `--theme <name>`                | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`.                                                            |
| `--theme-file <path...>`        | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.                                                                        |
| `--moxfield-user-agent <agent>` | User agent for fetching Moxfield deck URLs (see [build-site](/commands/build-site/)).                                                                                               |

## Examples

Serve a previously built site on the default port (3000):

```bash
./ritual serve
```

Serve on a custom port:

```bash
./ritual serve --port 8080
```

Build everything and serve at http://localhost:3000:

```bash
./ritual serve --build
```

Build only specific decks, then serve:

```bash
./ritual serve --build --decks "Atraxa Superfriends" "Mono Red Aggro"
```

## Exit Codes

| Code | Meaning                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| `0`  | The server ran (it serves until stopped with `Ctrl+C`).                                                           |
| `1`  | The build failed at runtime (e.g. an unreadable `--theme-file`, or a build error). The server is not started.     |
| `2`  | Usage error: invalid `--port`, a build-only flag without `--build`, or an invalid `--currencies`/`--theme` value. |

## Notes

- Files are served from the `dist/` directory. Without `--build`, run [`build-site`](/commands/build-site/) first to generate the content.
- With `--build`, the site is built exactly as `build-site` would; if the build fails, the server does not start.
- `--host` defaults to `0.0.0.0` (all interfaces), matching [`admin`](/commands/admin/). The printed URL always says `http://localhost:<port>`; use the machine's address to reach it from another device.
- Press `Ctrl+C` to stop the server.
- For an auto-restarting workflow that rebuilds when source or data files change, see [Development → Dev Workflow](/development/#dev-workflow). `bun run dev serve` appends `--build` automatically and requires an explicit `--refresh` mode (`auto`, `no-bulk`, or `never`) so the cache refresh prompt can be answered non-interactively.
