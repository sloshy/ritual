---
title: 'Build, Cache & Settings'
description: The dashboard pages for building the site, refreshing the card cache, signing in to Archidekt, changing settings, and reading the audit log.
---

Besides the editors and the list tools, the admin dashboard has a handful of single-purpose pages, described here. The two Archidekt sync pages have their own pages: [Sync Decks](/admin/sync-decks/) and [Sync Collection](/admin/sync-collection/).

## Build Site

Run a full static site build from the browser. It is the same build as `ritual build-site`, run as a background process so the admin server stays responsive, and the result is published all at once when it finishes.

The page streams the build as it runs: a progress bar over four steps (starting, building, publishing, done) and a live log of the build's own output. If the event stream cannot be opened, the page falls back to a plain request. If the stream drops mid-build, the build keeps running on the server and the page says so instead of starting a second one. See [`POST /api/build-site`](/admin/api/#build-site) and [`GET /api/build-site/stream`](/admin/api/#build-site-stream).

## Refresh Cache

Download and cache all Scryfall card data. This is the Scryfall half of `ritual cache preload-all`; unlike the CLI command it never touches the [Card Kingdom buylist](/commands/sell/), which has its own **Refresh buylist** button below.

While the refresh runs the page shows:

- A **progress bar** with download percentage and a MiB counter
- **Stage indicators**: Downloading & processing → Saving (cards are parsed as the stream downloads, so that is one phase)
- A plain fallback if streaming is unavailable

### Card Kingdom buylist

When [sell mode](/commands/admin/#sell-mode) is on, the page also shows a **Card Kingdom buylist** panel. It backs sell mode and the [`sell`](/commands/sell/) command. The panel is shown only while sell mode is on. Its routes answer `404` unless sell mode or the `cardkingdom` [price store](/public-site/prices/) is enabled.

The panel shows when the feed was last downloaded, Card Kingdom's own generation stamp, and the product count, with a **Refresh buylist** button.

- The download (about 70 MB) only happens when you click the button. No page load triggers it. The button forces a redownload even when the cached copy is still fresh. Server startup refreshes a day-old feed on its own (whenever sell mode or the `cardkingdom` price store is enabled), so the button is for forcing one mid-session.
- A workspace that has never downloaded the feed shows an empty state with the button, not an error.
- If a download fails but a stale copy exists, the panel reports "The buylist was not updated." instead of claiming success.
- When a refresh brings down a new feed, the admin discards the buylist quotes already resolved in this browser session, so an editor opened afterwards prices against the new feed. A refresh that changed nothing (still fresh, or a failed download that kept the stale copy) leaves them alone.

## Archidekt Login

Sign in to your Archidekt account. Credentials are sent to the Ritual server, which handles authentication server-side.

The page also shows the status of the stored login:

- **Current login (access token)**: how long the active session token remains valid. It is refreshed automatically when it expires.
- **Refresh token**: how long the longer-lived refresh token remains valid. Once it expires too, you must log in again.

When both tokens have expired, the page says a login is required to use Archidekt account features.

## Settings

Change admin settings. Each maps to a key on the [Configuration](/configuration/) page. The top of the page holds the workspace fields:

- **Decks Directory**: path to the decks folder (default `./decks`)
- **Collections Directory**: path to the collections folder (default `./collections`)
- **Wanted List Directory**: path to the wanted-lists folder (default `./wanted`)
- **Custom Art Directory**: folder holding [custom card art](/custom-art/) images; a card's `file` reference is relative to it. Ritual never creates it, and a missing directory just means the workspace has no local art (default `./art`; see [Configuration](/configuration/#directory-options))
- **Default Price Currency**: the currency price displays default to (default `usd`; see [Configuration](/configuration/#default-currency))
- **Price Stores**: which [price stores](/public-site/prices/) the app quotes. Stored in canonical order however you tick the boxes (default TCGplayer; see [Configuration](/configuration/#price-stores-pricesources))
- **Default Categories**: the global [category](/commands/categories/) vocabulary. These are the suggestions offered wherever you type a category, and the fallback heading order for a list whose categories file declares none. Comma-separated; spaces are part of a name (`Ramp, Board Wipes`). Default: the shipped fourteen (see [Configuration](/configuration/#default-categories)). A name that breaks the [category shape rule](/commands/categories/) is refused as you type: the field keeps your text, the refusal is explained under it, and a save stores the last valid vocabulary. Saving applies at once, and already-open editors offer the new vocabulary as soon as the save returns
- **Default Language**: the Scryfall language code stamped on newly added cards. A non-English value switches cache downloads to the much larger `all_cards` bulk (default `en`; see [Configuration](/configuration/#default-language))
- **Interface Language**: the language the admin and CLI **speak**, as a BCP-47 tag. This is not the card language. The list offers every locale this build ships, each named in its own language (default `en`; see [Configuration](/configuration/#interface-language)). Saving relabels the admin immediately with no rebuild; the public site picks it up on its next [build-site](/commands/build-site/#localized-builds). The header also has a language switcher that changes the language for this browser only, without touching the config; see [Localization](/localization/#admin-site)
- **Cache Source**: where cache refreshes download from, Scryfall directly or a peer-to-peer cache feed (default `scryfall`; see [Configuration](/configuration/#cache-source))
- **Cache Feed URL**: the feed URL used when the cache source is the feed (empty = the built-in default)
- **Cache Lock Timeout**: seconds a cache refresh waits for another process's cache-write lock before failing (default `300`; see [Configuration](/configuration/#cache-lock-timeout))
- **Card Search Debounce (ms)**: how long the editors' add-card search waits after a keystroke before querying autocomplete; `0` disables the wait (default `500`; see [Configuration](/configuration/#search-debounce)). Applies to the public site the next time it is built

The headed groups below them:

**Git Integration**

- **Enable Git integration**, **Auto-commit changes**, **Auto-push after commit**: when enabled, file changes from admin actions are committed to git and pushed to the remote

**Network Security**

- **Trust reverse proxy headers**: parse `X-Forwarded-For` when running behind a reverse proxy (nginx, Caddy, etc.). Leave off for direct connections
- **Secure cookies (HTTPS only)**: set the `Secure` flag on session cookies. Enable when using TLS or a TLS-terminating reverse proxy

**Two-Factor Authentication (TOTP)**

- Set up or disable TOTP 2FA

**Rate Limiting**

- **Enable rate limiting**, **Max failed attempts**, **Lockout (minutes)**: failed login attempt limits and lockout duration
- **Failed auth delay (ms)**: delay before responding to an invalid login attempt, to slow brute-force attempts

**IP Filtering**

- **IP Allow List** / **IP Deny List**: one entry per line, wildcards (`*`) supported. Leave empty to allow all. If the allow list is set, only listed IPs can connect

**User-Agent Filtering**

- **User-Agent Allow List** / **User-Agent Deny List**: one entry per line, wildcards (`*`) supported. Leave empty to allow all

**Public Site**

- **Decks to publish** / **Collections to publish** / **Wanted lists to publish**: which lists `build-site` publishes. Enter `*` for every list of that type (the default), list display names one per line to publish only those, or leave empty to publish none
- **Decks to exclude** / **Collections to exclude** / **Wanted lists to exclude**: display names to leave out even when the publish list includes them. The visibility toggles on [Manage Lists](/admin/manage-lists/#publishing-visibility) edit these. See [Configuration](/configuration/#choosing-which-lists-to-publish)
- **API base URL**: optional live backend for a split deployment. A statically deployed site fetches live list data and card search from a separately hosted `ritual serve --api` instance at this URL, baked in by the next site build. Leave empty for a fully static site
- **Offer sell mode**: whether the published site and this admin offer [sell mode](/commands/admin/#sell-mode) (default off; `site.sellMode`). Unchecking removes the key rather than storing `false`. Saving applies at once with no reload: the sell surfaces appear or disappear as soon as the save returns. See [Sell mode](/commands/admin/#sell-mode) for what it costs and how `--sell-mode` overrides it

**Default Printings**

- **Banned default printings**: printings that may never be auto-selected as a card's default (featured) printing, one per line as `SET:COLLECTOR` (e.g. `SLD:123`). When a banned printing would be chosen, the next eligible printing is featured instead. Banned printings can still be viewed and entered manually

## Audit Log

A chronological log of every login attempt: timestamp, IP address, username, success or failure, and user agent. Use it to spot unauthorized access attempts.
