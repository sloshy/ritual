---
title: 'serve'
---

Serve the generated static site locally, optionally building it first.

## Usage

```bash
ritual serve [options]
```

By default, `serve` serves a previously built `dist/` directory (or the directory given by `--out-dir`). A directory with no `index.html` is **refused** with exit code 1 (see [Exit Codes](#exit-codes)); `--api` instead builds the missing site itself. Pass `--build` to build and then serve in one step. Pass `--api` to also host a live, read-only data API beside the site; see [Hosting with a live backend](/public-site/hosted/).

## Options

| Option                | Description                                                                                                                    | Default   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `-p, --port <number>` | Port to serve on (1–65535; an invalid value exits with code 2)                                                                 | `3000`    |
| `--host <address>`    | Host address to bind to. `0.0.0.0` binds all interfaces.                                                                       | `0.0.0.0` |
| `--build`             | Build the site before serving it                                                                                               |           |
| `--api`               | Serve a live read-only data API alongside the site (see below)                                                                 |           |
| `--out-dir <path>`    | Serve this directory instead of `dist/` (with `--build`, build into it and serve it)                                           | `dist`    |
| `--sell-mode`         | Offer [sell mode](/public-site/sell/) for this run. Valid **with `--api`** even without `--build`; a plain `serve` rejects it. |           |

### Live API mode (`--api`)

With `--api`, the server hosts the static `dist/` **plus** a live, unauthenticated, **read-only** API on the same port:

| Method | Path                                                     | Serves                                                                                                                                                                                                            |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/index.json`, `/decks/…`, `/collections/…`, `/wanted/…` | **Live list data**, computed from the markdown files on request instead of the built copies. Edits made via the CLI or admin appear without rebuilding.                                                           |
| GET    | `/locales/{tag}.json`                                    | One published [locale dictionary](/commands/build-site/#localized-builds) from the built site, as a static file.                                                                                                  |
| GET    | `/art/{path}`                                            | One [custom art](/custom-art/) image, read live from the configured art directory (see below).                                                                                                                    |
| GET    | `/api/autocomplete`                                      | Card-name autocomplete over the card cache, with the **same term matching as the admin editor** (`in tre` finds "In the Trenches").                                                                               |
| GET    | `/api/card-printings`, `/api/card-price`                 | Cached printings and staleness-gated price lookups (the same endpoints the admin editor uses).                                                                                                                    |
| GET    | `/api/cards?ids=…`                                       | Cache-only card lookup by Scryfall ID (max 200 per request). Restores a shared [trade link](/public-site/trade/) without Scryfall.                                                                                |
| POST   | `/api/card-prices`                                       | Batch price refresh by card name (the site's **Update Prices** button in hosted mode).                                                                                                                            |
| GET    | `/api/buylist/status`                                    | Which buyers this server can quote and how fresh its cached buylist is. `404` unless [sell mode](/public-site/sell/) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. |
| POST   | `/api/buylist/quotes`                                    | Card Kingdom's current offer for specific printings (max 500 per request). Cache-only; there is deliberately **no** public refresh route. `404` under the same condition as `/api/buylist/status`.                |

The public site does not price lists through the buylist routes; buy prices come inside the live list payloads (below). The quotes route covers printings the lists do not carry: add-card search results, which the [printing pickers](/public-site/prices/#the-prices-selector) price under the Card Kingdom store. Other clients (a script, a second front end) may use both routes too.

The web app detects the backend through the served `index.json` and switches behavior: list pages refetch live data on navigation, the editor's add-card search uses the cache-backed term matching (the "results may differ" Scryfall note disappears), and price refreshes go through the server. A **Live** badge appears in the site header.

Details:

- **Sell mode quotes come inside the live payloads.** [Sell mode](/public-site/sell/) is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on or the run passed `--sell-mode`. When on, each served list payload carries that list's Card Kingdom buy prices, computed from the cached feed exactly as [`build-site`](/commands/build-site/#sell-mode---sell-mode) does. A newly refreshed feed shows on the next request without a rebuild. When [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`, the payloads also carry Card Kingdom's [printing picks](/public-site/prices/#which-printing-a-card-is-priced-at) for name-only lines and a quote for **every printing each list carries**, at every finish, for the card modal's other-printings grid and the printing pickers.
- **The buylist feed refreshes only at startup.** No request can trigger the ~70 MB download. Before the server binds, a cached feed more than a day old is redownloaded under the run's `--refresh` policy (`no-bulk`/`never` skip it). A failed download keeps the older feed with a warning. Startup only ever _updates_ a feed: a workspace that has never downloaded one is left alone, the buylist routes answer `503` with the remedy, and sell mode shows a "prices unavailable" notice until you download one with `ritual sell --refresh auto` or the admin site.
- **Read-only, no auth.** Only the routes above exist. An unmatched `/api/*` path answers a JSON 404 (never the SPA fallback), and none of the admin server's write or auth routes are reachable. Public edits stay client-side (export/import change bundles), as on the static site. One local exception: like every list-writing command, startup runs the [card-ID backfill](/cli-conventions/#the-card-id-backfill), which writes any missing `&N` card IDs into the list files. Plain `serve`, without `--build` or `--api`, never does.
- **Builds when there is nothing to serve.** Under `--api` the data is live, so an unbuilt directory is only a missing app shell. The command builds the site and then serves it. (Plain `serve` refuses, since there the build is the content.) An existing build is served as-is. Pass `--build` to rebuild it, which is also the only way to pass the build any of its flags.
- **Cache warming.** Live payloads come from the card cache with **no Scryfall fallback**, so startup applies the same freshness gates as [`build-site`](/commands/build-site/#card-cache-refresh) over every card the served lists reference (entries, deck primers, and change history), under the same `--refresh` policy. `--refresh` is therefore valid with `--api` even without `--build`. The gates, in order:

  1. A bulk download when the cache has never been downloaded, is more than a week old, or is missing many of those cards.
  2. The offer to redownload day-old prices.
  3. The offer to download oracle/art tags when a sample of the site's cards carries none. Skipped on an empty cache.

  The **per-card refetch** of missing or stale cards never runs. `--refresh no-bulk` therefore warms nothing here, exactly like `--refresh never`, which is what a [cache server](/commands/cache/) deployment wants. Each gate is best-effort: a declined prompt or a cold network leaves the cache as it was and the server still starts. When a build ran in the same command (`--build`, or `--api` building a missing site), startup does not ask again.

- **Cache backend.** The server reads the local `cache/cache.json` by default, or a [cache server](/commands/cache/) when `--cache-server`/`RITUAL_CACHE_SERVER` is set. A bulk refresh run by a separate CLI process is picked up automatically, since the server watches the cache file. **Never expose the cache server itself to browsers.** It has unauthenticated write routes; only the `serve --api` process should talk to it.
- **CORS.** API and JSON routes answer with `Access-Control-Allow-Origin: *`, so a statically deployed site (CDN/GitHub Pages) can point at a separately hosted instance via [`site.apiBaseUrl`](/configuration/#site-config-site-key). See [Hosting with a live backend](/public-site/hosted/).
- **Freshness.** Live JSON is served with `Cache-Control: no-cache`, content ETags, and `Last-Modified`, so unchanged payloads revalidate as 304s. Every response also carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Images.** Live data always uses Scryfall image URLs. `--cache-images` only affects the statically built assets.
- **Custom art.** Nothing is copied in live mode. `/art/{path}` reads the workspace's [`artDir`](/configuration/#directory-options) on every request, so a new image or an edited `.art.json` shows up without a rebuild (the `.art.json` modification time is part of each list's freshness stamp, so the list payload re-renders too). Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served (not SVG). Any other extension, or a path leaving the art directory, is a JSON `404`. Plain `serve` has no such route; it serves whatever `build-site` copied into `dist/art/`.
- **Card categories.** A list's [`<list>.categories.json`](/commands/categories/) modification time is also part of its freshness stamp, so a category edit re-renders the list payload without the `.md` changing.
- **Interface language.** The live `index.json` reports the current [`uiLocale`](/configuration/#interface-language), so `ritual config set uiLocale` takes effect on the next index request with no restart and no rebuild, like `defaultCurrency`, `searchDebounceMs`, and [`defaultCategories`](/configuration/#default-categories). Which dictionaries exist is still a build-time decision (`--locales`). **No `Accept-Language` negotiation happens in this server**, so a CDN-hosted site and a served one behave identically.

### Build options (require `--build`)

With `--build`, `serve` accepts every [`build-site`](/commands/build-site/) option. Passing one **without** `--build` is a usage error: exit code 2 and an error naming the flag(s). Four exceptions:

- `--refresh` and `--sell-mode`: also valid with `--api` (cache warming and live sell mode). Exempt **only under `--api`**.
- `--out-dir`: names the directory to serve whether or not a build runs.
- `--locale`: a [global flag](/cli-conventions/#global-options) every command accepts.

:::note[`--locale` is shared with the build surface]
`--locale <tag>` exists both as a global flag, where it sets the language of **Ritual's own terminal output**, and as a build flag, where it sets the language the **generated site** opens in. One flag drives both, and the effect depends on whether a build runs:

- `ritual serve --build --locale de`: the CLI's messages are German **and** the built site is stamped `<html lang="de">`.
- `ritual serve --locale de`: only the CLI's own output is German. Nothing is rebuilt, so the served site keeps the locale it was built with.

To change the language a **built** site opens in, rebuild it: `ritual serve --build --locale de` or `ritual build-site --locale de`. To change the default for every later build, set [`uiLocale`](/configuration/#interface-language).
:::

| Option                          | Description                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show the cards being fetched from Scryfall                                                                                                                                                                                                                                                                                                                                         |
| `--cache-images`                | Download deck card images into `images/` under the output directory (`dist/` by default, or `--out-dir`) and use them instead of Scryfall URLs                                                                                                                                                                                                                                     |
| `--decks [names...]`            | Decks or deck URLs to include (default: the `site.includeDecks` config selection)                                                                                                                                                                                                                                                                                                  |
| `--collections [names...]`      | Collections to include (default: the `site.includeCollections` config selection)                                                                                                                                                                                                                                                                                                   |
| `--wanted-lists [names...]`     | Wanted lists to include (default: the `site.includeWantedLists` config selection)                                                                                                                                                                                                                                                                                                  |
| `--currencies <list>`           | Comma-separated currencies to offer: `usd`, `eur`, `tix` (default: the currencies of the enabled [`priceSources`](/configuration/#price-stores-pricesources); narrows that set, never adds to it). Refused under `--api`.                                                                                                                                                          |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never`. See [build-site](/commands/build-site/#card-cache-refresh).                                                                                                                                                                                                                                             |
| `--theme <name>`                | Initial theme for first-time visitors: a built-in name or a custom name from `--theme-file`. Default: `default`.                                                                                                                                                                                                                                                                   |
| `--theme-file <path...>`        | Load custom theme JSON files. Each is added to the theme list under its declared `name`.                                                                                                                                                                                                                                                                                           |
| `--locale <tag>`                | Interface language the built site opens in (default: the [`uiLocale`](/configuration/#interface-language) config value). Ritual's own text, not the card language. Also a **global** flag, so it is accepted without `--build`, where it only changes this command's own output (see the note above). See [Localized builds](/commands/build-site/#localized-builds).              |
| `--locales <tags...>`           | Locale dictionaries to publish into `locales/` for the in-app language switcher (default: `en`; `all` publishes every one this build has).                                                                                                                                                                                                                                         |
| `--locale-file <path...>`       | Load locale dictionary JSON files, each named for its tag (`de-AT.json`). Their locales become selectable alongside the built-in ones.                                                                                                                                                                                                                                             |
| `--moxfield-user-agent <agent>` | User agent for fetching Moxfield deck URLs (see [build-site](/commands/build-site/)).                                                                                                                                                                                                                                                                                              |
| `--out-dir <path>`              | Build into this directory instead of `dist/`, **and serve it**. Valid without `--build`, where it names the built directory to serve. The Ritual directory itself or any ancestor is refused with exit code 2, with or without `--build`. See [build-site](/commands/build-site/#the-output-directory-is-replaced-never-half-written).                                             |
| `--sell-mode`                   | Offer [sell mode](/public-site/sell/) for this run even when `site.sellMode` is off: update the Card Kingdom buylist (~70 MB) and serve its buy prices. **Also valid with `--api` and no `--build`**: the live payloads then carry quotes and the buylist routes answer instead of 404ing. Enable-only. See [build-site → Sell mode](/commands/build-site/#sell-mode---sell-mode). |

Plain `serve`, with no `--build` and no `--api`, is a static file server. It never consults sell mode; the served directory shows whatever its build produced. `--sell-mode` there is a usage error (exit code 2) like every other build-only flag. Add `--build` to bake the quotes, or `--api` to serve them live.

## Examples

Serve a previously built site on the default port (3000):

```bash
ritual serve
```

Serve a preview directory built earlier, without rebuilding it:

```bash
ritual build-site --out-dir preview
ritual serve --out-dir preview
```

Serve on a custom port:

```bash
ritual serve --port 8080
```

Build everything and serve at http://localhost:3000:

```bash
ritual serve --build
```

Build only specific decks, then serve:

```bash
ritual serve --build --decks "Atraxa Superfriends" "Mono Red Aggro"
```

Host the site with the live backend, building it first if it has not been built yet:

```bash
ritual serve --api
```

Rebuild the static site and then host it:

```bash
ritual serve --build --api
```

Host with a shared cache server providing the card data:

```bash
ritual serve --api --refresh never --cache-server cache-host:4000
```

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | The server ran (it serves until stopped with `Ctrl+C`).                                                                                                                                                                                                                  |
| `1`  | The build failed (e.g. an unreadable `--theme-file`); there is no built site to serve (no `index.html` in the served directory, or under `--api` the build it ran failed); or the port could not be bound (usually another process holds it). The server is not started. |
| `2`  | Usage error: invalid `--port`, a build-only flag without `--build`, an invalid `--currencies`/`--theme` value, `--currencies` naming no store-backed currency, or `--currencies` under `--api`.                                                                          |

## Notes

- Files are served from `dist/`, or from `--out-dir` when given. The build and the server always use the same directory. Without `--build` or `--api`, run [`build-site`](/commands/build-site/) first. A directory with no `index.html` is refused with exit code 1 and a message naming both remedies.
- With `--build`, the site is built exactly as `build-site` would build it. If the build fails, the server does not start.
- If the port is in use, `serve` prints `Failed to start the server on <host>:<port>: <reason>` and exits with code 1. Pick another port with `--port`.
- `--host` defaults to `0.0.0.0` (all interfaces), matching [`admin`](/commands/admin/). The printed URL names the bound address: a wildcard or loopback bind prints `http://localhost:<port>` (use the machine's address from another device), and an explicit `--host 192.168.1.5` prints that address.
- Press `Ctrl+C` to stop the server.
- For an auto-restarting workflow that rebuilds when source or data files change, see [Development → Dev Workflow](/development/#dev-workflow). `bun run dev serve` adds `--build` automatically and requires an explicit `--refresh` mode (`auto`, `no-bulk`, or `never`).
