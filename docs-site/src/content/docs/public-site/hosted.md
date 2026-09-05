---
title: 'Hosting with a Live Backend'
---

The public site is normally a fully static build: [`build-site`](/commands/build-site/) bakes every list's data into `dist/`, and the browser's only network traffic is to Scryfall (card search and price refreshes). That deploys anywhere, but the content is frozen at build time and the editor's card search uses Scryfall's contiguous-string matching rather than the admin editor's term matching.

`ritual serve --api` adds a third option between "fully static" and "run the admin server": host the same public site backed by a **live, unauthenticated, read-only API**. With a backend available:

- **List data is live.** Deck, collection, and wanted-list pages are computed from the markdown files on request — edits made through the CLI or the admin server appear on the next navigation, with no rebuild.
- **Card search matches the admin editor.** The add-card search and trade-page search query the server's card cache with the same term-separation matching (`in tre` finds "In the Trenches"), and the "results may differ" Scryfall note disappears. The [trade page](/public-site/trade/#right-column--their-cards)'s right column drops its "Search Scryfall instead" toggle too: the cache covers every card, so each query searches your wanted lists and the cache together.
- **Shared trade links restore from the cache.** A trade URL pins some rows by Scryfall ID — cards from none of your lists, plus any deck or wanted printing chosen through the picker. Hosted, those IDs are resolved through `/api/cards` instead of Scryfall, and list-less rows are tagged **Cache** rather than **Scryfall**. An ID the server's cache doesn't hold is reported as a missing card rather than fetched externally.
- **Prices refresh server-side.** The **Update Prices** button asks the backend, which refreshes stale prices from Scryfall into its cache — shared by every visitor — instead of each browser fetching from Scryfall itself.
- **Sell mode quotes refresh without a rebuild.** [Sell mode](/public-site/sell/) — Card Kingdom buylist prices beside each card, buylist filters (on-buylist chips and a price threshold), buylist grouping and sorting, and a sell-cart export — works on a static site too, since the buy prices are baked into each list's JSON. What hosting adds is currency and reach: a live server bakes them per request, so a refreshed feed shows up on the next page load rather than at the next build, and it can quote printings no list carries — which is the only way an add-card search result gets a Card Kingdom price. It is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on or the run passed `--sell-mode`. (The feed itself is also downloaded whenever [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`, whose retail prices ride on the same baked quotes.) The server refreshes a day-old feed once, at startup — never on a request — so a long-running deployment restarts into current offers. It never downloads the _first_ feed, though: for that, run `ritual sell --refresh auto` or use the admin site.
- **Sidecars are watched too.** A list's `.categories.json` (and its `.art.json`) is checked alongside the markdown file, so setting a card's [categories](/commands/categories/) refreshes the detail on the next navigation even though the `.md` never moved.
- **Editing stays client-side.** The public editor still exports/imports [change bundles](/commands/import-changes/); the API has no write routes and no auth surface.

A **Live** badge in the site header shows the mode is active.

## Same-origin: one command

The simplest deployment is one process serving both the static assets and the API:

```bash
ritual serve --api
```

There is no separate build step to remember: `--api` builds the site when `dist/` holds none, since the data is live and the build only provides the app shell. Add `--build` to rebuild an existing one (and to pass the build any of its flags).

`serve --api` serves `index.json` and the per-list JSON dynamically (shadowing the baked copies in `dist/`) and marks the index so the web app knows the backend exists. Nothing else to configure — deploying means running this command where your list files live (see the [Docker guide](/docker/) for containerized setups).

## Split deployment: static CDN + hosted API

The static build can also stay on a CDN (e.g. GitHub Pages via [`init-site`](/commands/init-site/)) while a separately reachable `serve --api` instance provides the live backend. Point the build at the API with:

```bash
ritual config set site.apiBaseUrl "https://ritual-api.example.com"
ritual build-site
```

The URL is baked into `index.json`; on load, the site fetches the live index from that base and switches to hosted behavior. The API's routes answer with `Access-Control-Allow-Origin: *`, so the cross-origin fetches work without further setup.

If the API is unreachable (down, or the visitor is offline), the site **degrades gracefully**: it falls back to the baked data and Scryfall search for the rest of the session — behaving exactly like the static site — and the header badge switches to **Offline**. Refreshing the page retries the backend.

If the static site and the API sit behind one reverse proxy on the same origin, set `site.apiBaseUrl` to the empty string instead.

## The card cache

Card search and prices are answered from the server's card cache, so keep it warm:

- Startup applies the same cache freshness gates as [`build-site`](/commands/build-site/#card-cache-refresh), over every card the served lists reference (entries, deck primers, and change history): a bulk download when the cache is empty, over a week old, or missing many of those cards, then the day-old price and oracle/art tag offers. There is no per-card Scryfall fetch — that is a build-only step — so both `--refresh never` and `--refresh no-bulk` warm nothing, which is what a deployment with a pre-populated cache wants. `--refresh` controls all of it, and a build in the same run (including the one `--api` runs for a missing `dist/`) has applied these already, so startup does not ask twice.
- A bulk refresh run by a separate CLI process (`ritual cache preload-all`) is picked up automatically.
- With `--cache-server`/`RITUAL_CACHE_SERVER`, the API reads a shared [cache server](/commands/cache/) instead of the local file. The cache server must stay private to the API process — it has unauthenticated write routes and must never be exposed to browsers.

Cards missing from the cache render without data (and autocomplete simply won't offer them); the live endpoints never fall back to Scryfall for list data, keeping request latency bounded.

## Route reference

See [`serve` → Live API mode](/commands/serve/#live-api-mode---api) for the full route table, caching, and CORS details.
