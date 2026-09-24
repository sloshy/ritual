---
title: 'Hosting with a Live Backend'
description: Serve the public site with live list data and cache-backed card search, on one origin or split across a CDN and an API host.
---

The public site is normally a fully static build. [`build-site`](/commands/build-site/) writes every list's data into `dist/`, and the browser's only network traffic is to Scryfall (card search and price refreshes). That deploys anywhere, but the content is frozen at build time, and the editor's card search uses Scryfall's matching rather than the admin editor's term matching.

`ritual serve --api` is a middle option between "fully static" and "run the admin server": the same public site backed by a **live, unauthenticated, read-only API**. With a backend:

- **List data is live.** Deck, collection, and wanted-list pages are computed from the markdown files on request. Edits made through the CLI or the admin server appear on the next navigation, with no rebuild.
- **Card search matches the admin editor.** The add-card search and trade-page search query the server's card cache with the same term matching (`in tre` finds "In the Trenches"), and the "results may differ" Scryfall note disappears. The [trade page](/public-site/trade/#right-column--their-cards)'s right column drops its "Search Scryfall instead" toggle. Each query searches your wanted lists and the cache together.
- **Shared trade links restore from the cache.** A trade URL identifies some rows by Scryfall ID: cards from none of your lists, plus any deck or wanted printing chosen through the picker. Hosted, those IDs are resolved through `/api/cards` instead of Scryfall, and list-less rows are tagged **Cache** rather than **Scryfall**. An ID the server's cache does not hold is reported as a missing card, not fetched externally.
- **Prices refresh server-side.** The **Update Prices** button asks the backend, which refreshes stale prices from Scryfall into its cache, shared by every visitor.
- **Sell mode quotes refresh without a rebuild.** [Sell mode](/public-site/sell/) (Card Kingdom buylist prices, buylist filters, grouping and sorting, and a sell-cart export) also works on a static site, since the buy prices are written into each list's JSON. A live server computes them per request, so a refreshed feed shows on the next page load rather than at the next build. It can also quote printings no list carries, which is the only way an add-card search result gets a Card Kingdom price. Sell mode is off unless [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is on or the run passed `--sell-mode`. The feed is also used, and refreshed at startup, whenever [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`, whose retail prices come from the same feed. The server refreshes a day-old feed once, at startup, never on a request. It never downloads the _first_ feed; for that, run `ritual sell --refresh auto` or use the admin site.
- **Category and art files are watched too.** A list's `.categories.json` and `.art.json` are checked alongside the markdown file, so setting a card's [categories](/commands/categories/) refreshes the detail on the next navigation even though the `.md` did not change.
- **Editing stays client-side.** The public editor still exports and imports [change bundles](/commands/import-changes/). The API has no write routes and no auth.

A **Live** badge in the site header shows the mode is active.

## Same-origin: one command

The simplest deployment is one process serving both the static assets and the API:

```bash
ritual serve --api
```

There is no separate build step. `--api` builds the site when `dist/` holds none, since the data is live and the build only provides the app shell. Add `--build` to rebuild an existing one (and to pass the build any of its flags).

`serve --api` serves `index.json` and the per-list JSON dynamically in place of the built copies, and marks the index so the web app knows the backend exists. Nothing else needs configuring. Deploying means running this command where your list files live (see the [Docker guide](/docker/) for containers).

## Split deployment: static CDN + hosted API

The static build can also stay on a CDN (GitHub Pages via [`init-site`](/commands/init-site/), say) while a separately reachable `serve --api` instance provides the live backend. Point the build at the API:

```bash
ritual config set site.apiBaseUrl "https://ritual-api.example.com"
ritual build-site
```

The URL is written into `index.json`. On load, the site fetches the live index from that base and switches to hosted behavior. The API's routes answer with `Access-Control-Allow-Origin: *`, so the cross-origin fetches need no further setup.

If the API is unreachable (down, or the visitor is offline), the site **degrades gracefully**: it falls back to the built data and Scryfall search for the rest of the session, exactly like the static site, and the header badge switches to **Offline**. Refreshing the page retries the backend.

If the static site and the API sit behind one reverse proxy on the same origin, set `site.apiBaseUrl` to the empty string instead.

## The card cache

Card search and prices are answered from the server's card cache, so keep it warm:

- Startup applies the same cache freshness gates as [`build-site`](/commands/build-site/#card-cache-refresh) over every card the served lists reference, under the run's `--refresh` mode. There is no per-card Scryfall fetch, so `--refresh never` and `--refresh no-bulk` both warm nothing, which suits a deployment with a pre-populated cache. See the **Cache warming** bullet under [`serve` → Live API mode](/commands/serve/#live-api-mode---api) for the gates.
- A bulk refresh run by a separate CLI process (`ritual cache preload-all`) is picked up automatically.
- With `--cache-server`/`RITUAL_CACHE_SERVER`, the API reads a shared [cache server](/commands/cache/) instead of the local file. The cache server has unauthenticated write routes and must never be exposed to browsers; only the API process should reach it.

Cards missing from the cache render without data, and autocomplete does not offer them. The live endpoints never fall back to Scryfall for list data.

## Route reference

See [`serve` → Live API mode](/commands/serve/#live-api-mode---api) for the full route table, caching, and CORS details.
