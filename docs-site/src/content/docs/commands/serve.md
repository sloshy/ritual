---
title: 'serve'
---

Serve the generated static site locally, optionally building it first.

## Usage

```bash
./ritual serve [options]
```

By default, `serve` serves a previously built `dist/` directory (or the directory given by `--out-dir`). A directory with no `index.html` is **refused** rather than answered with bare 404s — see [Exit Codes](#exit-codes) — except under `--api`, which builds the missing site itself. Pass `--build` to build the site first and then serve the result — the one-shot preview that used to require running [`build-site`](/commands/build-site/) and `serve` separately. Pass `--api` to additionally host a live, read-only data API alongside the site — see [Hosting with a live backend](/public-site/hosted/).

## Options

| Option                | Description                                                                                                                                | Default   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `-p, --port <number>` | Port to serve on. Validated at parse time (1–65535); an invalid value exits with code 2.                                                   | `3000`    |
| `--host <address>`    | Host address to bind to. `0.0.0.0` binds all interfaces.                                                                                   | `0.0.0.0` |
| `--build`             | Build the site before serving it                                                                                                           |           |
| `--api`               | Serve a live read-only data API alongside the site (see below)                                                                             |           |
| `--out-dir <path>`    | Serve this directory instead of `dist/` (with `--build`, build into it and serve it)                                                       | `dist`    |
| `--sell-mode`         | Offer [sell mode](/public-site/sell/) for this run. Valid **with `--api`** even without `--build`; a plain `serve` rejects it (see below). |           |

### Live API mode (`--api`)

With `--api`, the server hosts the same static `dist/` **plus** a live, unauthenticated, **read-only** API on the same port:

| Method | Path                                                     | Serves                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/index.json`, `/decks/…`, `/collections/…`, `/wanted/…` | **Live list data**, computed from the markdown files on request (shadowing the baked copies) — edits made via the CLI or admin appear without rebuilding.                                                                 |
| GET    | `/locales/{tag}.json`                                    | One published [locale dictionary](/commands/build-site/#localized-builds) from the built site, served as a plain static file.                                                                                             |
| GET    | `/art/{path}`                                            | One [custom art](/custom-art/) image, read live from the configured art directory at the same path a built site carries it (see below).                                                                                   |
| GET    | `/api/autocomplete`                                      | Card-name autocomplete over the card cache with the **same term matching as the admin editor** (`in tre` finds "In the Trenches").                                                                                        |
| GET    | `/api/card-printings`, `/api/card-price`                 | Cached printings and staleness-gated price lookups (the same endpoints the admin editor uses).                                                                                                                            |
| GET    | `/api/cards?ids=…`                                       | Cache-only card lookup by Scryfall ID (max 200 per request), used to restore a shared [trade link](/commands/build-site/#trade-planner) without Scryfall.                                                                 |
| POST   | `/api/card-prices`                                       | Batch price refresh by card name (used by the site's **Update Prices** button in hosted mode).                                                                                                                            |
| GET    | `/api/buylist/status`                                    | Which buyers this server can quote against and how fresh its cached buylist is. `404` unless [sell mode](/public-site/sell/) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. |
| POST   | `/api/buylist/quotes`                                    | Card Kingdom's current offer for specific printings (max 500 per request). Strictly cache-backed — there is deliberately **no** public refresh route.                                                                     |

The two buylist routes are **not** how the public site prices a list: it gets its buy prices baked into the live list payloads (below). The quotes route is used for one thing the payloads cannot cover — printings the build never saw, which the add-card dialog's search turns up and the [printing pickers](/public-site/price-sources/#the-prices-selector) price under the Card Kingdom store. They are also mounted for other clients (a script, a second front end), and answer `404` when neither sell mode nor the `cardkingdom` [price store](/configuration/#price-stores-pricesources) is on.

The web app detects the backend through the served `index.json` and switches its behavior: list pages refetch live data on navigation, the editor's add-card search uses the cache-backed term matching (the "results may differ" Scryfall note disappears), and price refreshes go through the server. A small **Live** badge appears in the site header.

Details:

- **Sell mode quotes are baked into the live payloads, from a cache refreshed at startup.** [Sell mode](/public-site/sell/) is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on or the run passed `--sell-mode`. When it is on, each served list payload carries that list's Card Kingdom buy prices, computed from the cached feed exactly the way [`build-site`](/commands/build-site/#sell-mode---sell-mode) bakes them — so pricing a list never calls the quotes API, and a served list picks up a newly refreshed feed on its next request without a rebuild. When [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`, the live payloads also carry Card Kingdom's own [printing picks](/public-site/price-sources/#which-printing-a-card-is-priced-at) for name-only lines and a quote for **every printing each list carries**, at every finish, so the card modal's other-printings grid and the printing pickers can price them; only printings outside those lists entirely (an add-card search result) reach `POST /api/buylist/quotes`. The feed itself is never downloaded per request (an unauthenticated wildcard-CORS endpoint must not be able to pull ~70 MB): startup is where that happens, where an already-downloaded feed more than a day old (Card Kingdom regenerates it daily) is redownloaded before the server binds — under the same `--refresh` policy, so `no-bulk`/`never` skip it, and a failed download leaves the older feed in place with a warning rather than failing the start. Startup only ever _updates_ a buylist: a workspace that has never downloaded one is left alone (no prompt, no ~70 MB on a capability this deployment may not use), the buylist routes answer `503` with the remedy, and sell mode shows the "prices unavailable" notice until you download one with `ritual sell --refresh auto` or the admin site.
- **Read-only, no auth.** Only the routes above exist; an unmatched `/api/*` path answers a JSON 404 (never the SPA fallback), and none of the admin server's mutation or auth surface is reachable. Public edits stay client-side (export/import change bundles), exactly as on the static site. One local exception: like every list-writing command, startup runs the [card-ID backfill](/#the-card-id-backfill), persisting any missing `&N` card IDs into the list files on first run (plain `serve`, without `--build` or `--api`, never does).
- **Builds when there is nothing to serve.** With `--api` the data is served live, so an unbuilt served directory (`dist/`, or `--out-dir`) is a missing app shell rather than missing content: the command builds the site itself and then serves it, instead of refusing. (Plain `serve` still refuses — there the build _is_ the content.) An existing build is served as-is; pass `--build` to rebuild it, which is also the only way to give the build any of its flags.
- **Cache warming.** Live payloads are computed from the card cache with **no Scryfall fallback**, so startup applies the same freshness gates [`build-site`](/commands/build-site/#card-cache-refresh) applies, over every card the served lists reference — entries, deck primers, and change history — under the same `--refresh` policy (which is therefore valid with `--api` even without `--build`): a bulk download when the cache has never been downloaded, is more than a week old, or is missing many of those cards; then the offer to redownload day-old prices; then, when a sample of the site's cards carries no oracle/art tags, the offer to download them (skipped entirely on an empty cache). The one gate a build has that this does not is the **per-card refetch** of missing or stale cards — a live server never fetches from Scryfall — so `--refresh no-bulk` warms nothing here, exactly like `--refresh never`, which is what a [cache server](/commands/cache/) deployment wants. Each gate is best-effort: a declined prompt or a cold network leaves the cache as it was and the server still starts. When `--api` builds (or `--build` was given), the build applied these gates already and startup does not ask again.
- **Cache backend.** The server reads the card cache through the standard selection: the local `cache/cache.json` by default, or a [cache server](/commands/cache/) when `--cache-server`/`RITUAL_CACHE_SERVER` is set. A bulk refresh run by a separate CLI process is picked up automatically (the server watches the cache file). **Never expose the cache server itself to browsers** — it has unauthenticated write routes; only the `serve --api` process should talk to it.
- **CORS.** API and JSON routes answer with `Access-Control-Allow-Origin: *`, so a statically deployed site (CDN/GitHub Pages) can point at a separately hosted instance via [`site.apiBaseUrl`](/configuration/#site-config-site-key) — see [Hosting with a live backend](/public-site/hosted/).
- **Freshness.** Live JSON is served with `Cache-Control: no-cache`, content ETags, and `Last-Modified`, so unchanged payloads revalidate as cheap 304s. Every response also carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Images.** Live data always uses Scryfall image URLs; `--cache-images` only affects the statically built assets.
- **Custom art.** Nothing is copied in live mode: `/art/{path}` reads the workspace's [`artDir`](/configuration/#directory-options) on every request, at the exact path the baked value names, so a new image or an edited `.art.json` shows up without a rebuild (the sidecar's modification time is part of each list's freshness stamp, so the list payload re-renders too). Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served — SVG deliberately is not — and any other extension, or any path leaving the art directory, is a JSON `404`. Plain `serve` has no such route; it serves whatever `build-site` copied into `dist/art/`.
- **Card categories.** A list's [`<list>.categories.json`](/commands/categories/) modification time is part of its freshness stamp too, so a category edit re-renders the list payload without the `.md` moving.
- **Interface language.** The live `index.json` reports the current [`uiLocale`](/configuration/#interface-language), so a `ritual config set uiLocale` is picked up on the next index request with no restart and no rebuild — the same way `defaultCurrency`, `searchDebounceMs` and [`defaultCategories`](/configuration/#default-categories) are. Which dictionaries exist is still a build-time decision (`--locales`), and the dictionaries themselves are ordinary static files: **no `Accept-Language` negotiation happens anywhere in this server**, so a CDN-hosted site and a served one stay byte-identical deployments.

### Build options (require `--build`)

With `--build`, `serve` accepts the full [`build-site`](/commands/build-site/) option surface. Passing any of these **without** `--build` is a usage error: the command exits with code 2 and an error naming the offending flag(s). Four exceptions: `--refresh`, which is also meaningful with `--api` (cache warming); `--sell-mode`, likewise, since the live server reads sell mode per request; `--out-dir`, which names the directory to serve whether or not a build runs; and `--locale`, which is a [global flag](/#global-options) every command accepts. The first two are exempt **only under `--api`**.

:::note[`--locale` is shared with the build surface]
`--locale <tag>` is declared twice — once on the root program, where it chooses the language **Ritual's own terminal output** speaks, and once on the build surface, where it chooses the language the **generated site** opens in. Commander routes the value to the root from either position, so one flag drives both, and the effect depends on whether a build runs:

- `ritual serve --build --locale de` — the CLI's progress and error messages are German **and** the built site is stamped `<html lang="de">`.
- `ritual serve --locale de` — only the CLI's own output is German. Nothing is rebuilt, so the served site keeps whatever locale it was built with.

That asymmetry is the intended contract, not a gap: `--locale` without `--build` is accepted precisely because it is a global flag, and a global flag that changed a directory on disk without being asked to build would be a surprise. To change the language a **built** site opens in, rebuild it — `ritual serve --build --locale de`, or `ritual build-site --locale de`. To change the default for every later build without passing a flag, set [`uiLocale`](/configuration/#interface-language).
:::

| Option                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show list of cards being fetched from Scryfall                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--cache-images`                | Download and use local deck card images in `dist/images` instead of URLs                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--decks [names...]`            | Deck names or URLs to include in the site (default: the `site.includeDecks` config selection)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--collections [names...]`      | Collection names to include in the site (default: the `site.includeCollections` config selection)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--wanted-lists [names...]`     | Wanted list names to include in the site (default: the `site.includeWantedLists` config selection)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--currencies <list>`           | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default — bulk-downloads an empty or stale cache **without asking**, prompts for the price and tag refreshes), `auto`, `no-bulk`, or `never` (see [build-site](/commands/build-site/#card-cache-refresh)).                                                                                                                                                                                                                                                                           |
| `--theme <name>`                | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `--theme-file <path...>`        | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--locale <tag>`                | UI locale baked into the built site — the `<html lang>`/`dir` and the language it opens in (default: the [`uiLocale`](/configuration/#interface-language) config value). Ritual's own text, not the card language. Also a **global** flag, so unlike the rest of this table it is accepted without `--build`, where it only changes this command's own output — see the note below. See [Localized builds](/commands/build-site/#localized-builds).                                                                    |
| `--locales <tags...>`           | Which locale dictionaries to publish into `locales/`, which is what the in-app language switcher offers (default: `en`; `all` publishes every one this build has).                                                                                                                                                                                                                                                                                                                                                     |
| `--locale-file <path...>`       | Load one or more locale dictionary JSON files, each named for its tag (`de-AT.json`); their locales become selectable alongside the built-in ones.                                                                                                                                                                                                                                                                                                                                                                     |
| `--moxfield-user-agent <agent>` | User agent for fetching Moxfield deck URLs (see [build-site](/commands/build-site/)).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--out-dir <path>`              | Build into this directory instead of `dist/`, **and serve it**. A relative path resolves against the Ritual directory; a build replaces its output directory wholesale, so the Ritual directory itself (or any ancestor of it) is refused with exit code 2 — including without `--build`, since the flag names one directory for both roles. See [build-site](/commands/build-site/#the-output-directory-is-replaced-never-half-written). Valid without `--build`, where it simply names the built directory to serve. |
| `--sell-mode`                   | Offer [sell mode](/public-site/sell/) for this run even when `site.sellMode` is off: update the Card Kingdom buylist (~70 MB) and serve its buy prices. **Also valid with `--api` and no `--build`** — the live payloads then carry the baked quotes and the buylist routes answer instead of 404ing. Enable-only. See [build-site → Sell mode](/commands/build-site/#sell-mode---sell-mode).                                                                                                                          |

Plain `serve` — no `--build`, no `--api` — is a static file server: nothing in that process ever consults sell mode, so what the served directory shows is whatever the build that produced it baked. `--sell-mode` there would be an inert no-op, and is a usage error (exit code 2) for the same reason every other build-only flag is. Add `--build` to bake the quotes, or `--api` to serve them live.

## Examples

Serve a previously built site on the default port (3000):

```bash
./ritual serve
```

Serve a preview directory built earlier, without rebuilding it:

```bash
./ritual build-site --out-dir preview
./ritual serve --out-dir preview
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

Host the site with the live backend, building it first if it has not been built yet:

```bash
./ritual serve --api
```

Rebuild the static site and then host it:

```bash
./ritual serve --build --api
```

Host with a shared cache server providing the card data:

```bash
./ritual serve --api --refresh never --cache-server cache-host:4000
```

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The server ran (it serves until stopped with `Ctrl+C`).                                                                                                                                                                                                                                                                                                 |
| `1`  | The build failed at runtime (e.g. an unreadable `--theme-file`, or a build error); there is no built site to serve and none was built (no `index.html` in the served directory; under `--api` this means the build it ran failed); or the server could not bind its port (usually because another process already holds it). The server is not started. |
| `2`  | Usage error: invalid `--port`, a build-only flag without `--build`, or an invalid `--currencies`/`--theme` value.                                                                                                                                                                                                                                       |

## Notes

- Files are served from the `dist/` directory, or from `--out-dir` when given — the build and the server always agree on one directory. Without `--build` or `--api`, run [`build-site`](/commands/build-site/) first to generate the content; serving a directory with no `index.html` is refused with exit code 1 and a message naming both remedies.
- With `--build`, the site is built exactly as `build-site` would; if the build fails, the server does not start.
- If the port is already in use, `serve` prints `Failed to start the server on <host>:<port>: <reason>` and exits with code 1 — pick another port with `--port`.
- `--host` defaults to `0.0.0.0` (all interfaces), matching [`admin`](/commands/admin/). The printed URL names the address the server actually bound: a wildcard or loopback bind prints `http://localhost:<port>` (use the machine's address to reach it from another device), and an explicit `--host 192.168.1.5` prints that address.
- Press `Ctrl+C` to stop the server.
- For an auto-restarting workflow that rebuilds when source or data files change, see [Development → Dev Workflow](/development/#dev-workflow). `bun run dev serve` appends `--build` automatically and requires an explicit `--refresh` mode (`auto`, `no-bulk`, or `never`) so the cache refresh prompt can be answered non-interactively.
