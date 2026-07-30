---
title: 'serve'
---

Serve the generated static site locally, optionally building it first.

## Usage

```bash
./ritual serve [options]
```

By default, `serve` serves a previously built `dist/` directory. Pass `--build` to build the site first and then serve the result — the one-shot preview that used to require running [`build-site`](/commands/build-site/) and `serve` separately. Pass `--api` to additionally host a live, read-only data API alongside the site — see [Hosting with a live backend](/public-site/hosted/).

## Options

| Option                | Description                                                                              | Default   |
| --------------------- | ---------------------------------------------------------------------------------------- | --------- |
| `-p, --port <number>` | Port to serve on. Validated at parse time (1–65535); an invalid value exits with code 2. | `3000`    |
| `--host <address>`    | Host address to bind to. `0.0.0.0` binds all interfaces.                                 | `0.0.0.0` |
| `--build`             | Build the site before serving it                                                         |           |
| `--api`               | Serve a live read-only data API alongside the site (see below)                           |           |

### Live API mode (`--api`)

With `--api`, the server hosts the same static `dist/` **plus** a live, unauthenticated, **read-only** API on the same port:

| Method | Path                                                     | Serves                                                                                                                                                    |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/index.json`, `/decks/…`, `/collections/…`, `/wanted/…` | **Live list data**, computed from the markdown files on request (shadowing the baked copies) — edits made via the CLI or admin appear without rebuilding. |
| GET    | `/api/autocomplete`                                      | Card-name autocomplete over the card cache with the **same term matching as the admin editor** (`in tre` finds "In the Trenches").                        |
| GET    | `/api/card-printings`, `/api/card-price`                 | Cached printings and staleness-gated price lookups (the same endpoints the admin editor uses).                                                            |
| GET    | `/api/cards?ids=…`                                       | Cache-only card lookup by Scryfall ID (max 200 per request), used to restore a shared [trade link](/commands/build-site/#trade-planner) without Scryfall. |
| POST   | `/api/card-prices`                                       | Batch price refresh by card name (used by the site's **Update Prices** button in hosted mode).                                                            |

The web app detects the backend through the served `index.json` and switches its behavior: list pages refetch live data on navigation, the editor's add-card search uses the cache-backed term matching (the "results may differ" Scryfall note disappears), and price refreshes go through the server. A small **Live** badge appears in the site header.

Details:

- **Read-only, no auth.** Only the routes above exist; an unmatched `/api/*` path answers a JSON 404 (never the SPA fallback), and none of the admin server's mutation or auth surface is reachable. Public edits stay client-side (export/import change bundles), exactly as on the static site. One local exception: like every list-writing command, startup runs the [card-ID backfill](/#the-card-id-backfill), persisting any missing `&N` card IDs into the list files on first run (plain `serve`, without `--build` or `--api`, never does).
- **Cache warming.** Startup runs the same card-cache freshness check as [`admin`](/commands/admin/); `--refresh` controls it (and is therefore valid with `--api` even without `--build`).
- **Cache backend.** The server reads the card cache through the standard selection: the local `cache/cache.json` by default, or a [cache server](/commands/cache/) when `--cache-server`/`RITUAL_CACHE_SERVER` is set. A bulk refresh run by a separate CLI process is picked up automatically (the server watches the cache file). **Never expose the cache server itself to browsers** — it has unauthenticated write routes; only the `serve --api` process should talk to it.
- **CORS.** API and JSON routes answer with `Access-Control-Allow-Origin: *`, so a statically deployed site (CDN/GitHub Pages) can point at a separately hosted instance via [`site.apiBaseUrl`](/configuration/#site-config-site-key) — see [Hosting with a live backend](/public-site/hosted/).
- **Freshness.** Live JSON is served with `Cache-Control: no-cache`, content ETags, and `Last-Modified`, so unchanged payloads revalidate as cheap 304s. Every response also carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Images.** Live data always uses Scryfall image URLs; `--cache-images` only affects the statically built assets.

### Build options (require `--build`)

With `--build`, `serve` accepts the full [`build-site`](/commands/build-site/) option surface. Passing any of these **without** `--build` is a usage error: the command exits with code 2 and an error naming the offending flag(s). The exception is `--refresh`, which is also meaningful with `--api` (cache warming).

| Option                          | Description                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-v, --verbose`                 | Show list of cards being fetched from Scryfall                                                                                                                                                                                                                                                                                       |
| `--cache-images`                | Download and use local deck card images in `dist/images` instead of URLs                                                                                                                                                                                                                                                             |
| `--decks [names...]`            | Deck names or URLs to include in the site (default: the `site.includeDecks` config selection)                                                                                                                                                                                                                                        |
| `--collections [names...]`      | Collection names to include in the site (default: the `site.includeCollections` config selection)                                                                                                                                                                                                                                    |
| `--wanted-lists [names...]`     | Wanted list names to include in the site (default: the `site.includeWantedLists` config selection)                                                                                                                                                                                                                                   |
| `--currencies <list>`           | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three)                                                                                                                                                                                                                                          |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default — prompt; skip when prompts are unavailable), `auto`, `no-bulk`, or `never` (see [build-site](/commands/build-site/#card-cache-refresh)).                                                                                                                                                  |
| `--theme <name>`                | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`.                                                                                                                                                                                                             |
| `--theme-file <path...>`        | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.                                                                                                                                                                                                                         |
| `--moxfield-user-agent <agent>` | User agent for fetching Moxfield deck URLs (see [build-site](/commands/build-site/)).                                                                                                                                                                                                                                                |
| `--out-dir <path>`              | Build into this directory instead of `dist/`, **and serve it**. A relative path resolves against the Ritual directory; the directory is cleared before the build, so the Ritual directory itself (or any ancestor of it) is refused with exit code 2. See [build-site](/commands/build-site/#the-output-directory-is-cleared-first). |

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

Build once, then host the site with the live backend:

```bash
./ritual serve --build --api
```

Host with a shared cache server providing the card data:

```bash
./ritual serve --api --refresh never --cache-server cache-host:4000
```

## Exit Codes

| Code | Meaning                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The server ran (it serves until stopped with `Ctrl+C`).                                                                                            |
| `1`  | The build failed at runtime (e.g. an unreadable `--theme-file`, or a build error). The server is not started.                                      |
| `2`  | Usage error: invalid `--port`, a build-only flag without `--build`, an invalid `--currencies`/`--theme` value, or `--api` without a built `dist/`. |

## Notes

- Files are served from the `dist/` directory, or from `--out-dir` when `--build --out-dir <path>` is given — the build and the server always agree on one directory. Without `--build`, run [`build-site`](/commands/build-site/) first to generate the content.
- With `--build`, the site is built exactly as `build-site` would; if the build fails, the server does not start.
- `--host` defaults to `0.0.0.0` (all interfaces), matching [`admin`](/commands/admin/). The printed URL always says `http://localhost:<port>`; use the machine's address to reach it from another device.
- Press `Ctrl+C` to stop the server.
- For an auto-restarting workflow that rebuilds when source or data files change, see [Development → Dev Workflow](/development/#dev-workflow). `bun run dev serve` appends `--build` automatically and requires an explicit `--refresh` mode (`auto`, `no-bulk`, or `never`) so the cache refresh prompt can be answered non-interactively.
