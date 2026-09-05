---
title: 'Build, Cache & Settings'
description: The dashboard pages for building the site, refreshing the card cache, signing in to Archidekt, changing settings, and reading the audit log.
---

Besides the editors and the list tools, the admin dashboard has a handful of single-purpose pages. This page describes each of them.

## Build Site

Trigger a full static site build from the browser. This runs the same build as `ritual build-site`, as a background child process, so the admin server stays responsive for its duration, and the build publishes atomically. The page streams the build as it runs: a progress bar over the build's four structural steps (starting, building, publishing, done) and a live log box showing the build's own output lines, so a multi-minute build never looks stuck. If the event stream cannot be opened the page falls back to the plain request. If it drops mid-build the build keeps running on the server and the page says so rather than starting a second one. See [`POST /api/build-site`](/admin/api/#build-site) and [`GET /api/build-site/stream`](/admin/api/#build-site-stream) for the details.

## Refresh Cache

Download and cache all Scryfall card data, the Scryfall half of `ritual cache preload-all`. Unlike the CLI command, it never touches the [Card Kingdom buylist](/commands/sell/). This page has its own button for that, below.

The Refresh Cache page shows real-time progress during the operation:

- A **progress bar** with download percentage and MiB counter
- **Stage indicators** tracking each phase: Downloading & processing → Saving (cards are parsed and processed as the stream downloads, so they are one phase)
- A graceful fallback if streaming is unavailable

When [sell mode](/commands/admin/#sell-mode) is on, the page also carries a **Card Kingdom buylist** card, backing sell mode and the [`sell`](/commands/sell/) command. With sell mode off and no `cardkingdom` price source the card is not shown at all, and its routes answer `404`. It shows when the feed was last downloaded, Card Kingdom's own generation stamp, and the product count, with a **Refresh buylist** button. Once the server is up, that ~70 MB download only ever happens on an explicit click. No page load triggers it, and the button forces a redownload even when the cached copy is still fresh. (Server _startup_ refreshes a day-old feed on its own, so the button is for forcing one mid-session.) A workspace that has never downloaded it shows an empty state offering the button rather than an error. If a download fails but a stale copy exists, the card reports "The buylist was not updated." instead of claiming success.

When the refresh actually brings down a new feed, the admin also discards the quotes it has already resolved in this browser session, so an editor opened afterwards prices every card against the feed you just downloaded. A refresh that changed nothing (a copy that was still fresh, or a failed download that fell back to the stale one) leaves them alone, since they already quote that feed.

## Archidekt Login

Sign in to your Archidekt account through the web interface. Credentials are sent to the Ritual server, which handles authentication server-side.

The page also shows the status of the stored login:

- **Current login (access token)**: how long the active session token remains valid. When it expires it is refreshed automatically.
- **Refresh token**: how long the longer-lived refresh token remains valid. Once it expires too, a fresh login is required.

When both the access token and refresh token have expired, the page reports that a login is required to use Archidekt account features.

## Sync Decks

Pull or push Archidekt-linked decks, with per-deck progress streaming into the page as the run proceeds. Toggle which decks to sync (all by default), pick a direction, and optionally preview without writing. Each deck shows when it last synced, and the page signs in to Archidekt inline when the stored token has expired.

Same engine as [`deck-sync`](/commands/deck-sync/). See [Sync Decks](/admin/sync-decks/) for the full page.

## Sync Collection

Pull or push the signed-in Archidekt account's collection, with per-list progress streaming into the page as the run proceeds. Choose a direction, a scope (the whole collection or selected lists), a change filter (all changes, additions only, removals only), the list a pull adds new cards to, an ordered removal priority (which binders may give copies up when a removal is ambiguous; without it such a run stops without writing anything), whether a push uploads its new cards as one CSV import (on by default; with it off a push adding more than 25 of them stops without pushing anything), and optionally preview without writing. A finished push reports what that import did, including any row Archidekt refused. An account has one collection, so the page shows a single account-level "last synced".

Same engine as [`collection-sync`](/commands/collection-sync/). See [Sync Collection](/admin/sync-collection/) for the full page.

## Settings

Configure admin settings including:

- **Decks Directory**: path to the decks folder (default: `./decks`)
- **Collections Directory**: path to the collections folder (default: `./collections`)
- **Wanted List Directory**: path to the wanted-lists folder (default: `./wanted`)
- **Custom Art Directory**: path to the folder holding [custom card art](/custom-art/) images, the directory a card's `file` reference is relative to. Never created by Ritual; a missing directory just means the workspace has no local art (default: `./art`; see [Configuration](/configuration/#directory-options))
- **Default Price Currency**: the currency price-touching surfaces default to (default: `usd`; see [Configuration](/configuration/#default-currency))
- **Price Stores**: which [price stores](/public-site/prices/) the app quotes, in canonical order however the boxes are ticked (default: TCGplayer; see [Configuration](/configuration/#price-stores-pricesources))
- **Default Categories**: the global [category](/commands/categories/) vocabulary, meaning the suggestions offered wherever a category is typed, and the fallback heading order for a list whose sidecar declares none. Comma-separated, and spaces are part of a name (`Ramp, Board Wipes`); default: the shipped fourteen (see [Configuration](/configuration/#default-categories)). A name that breaks the [category shape rule](/commands/categories/) is refused as you type. The field keeps your text, the refusal is explained under it, and the last valid vocabulary is what a save stores. Saving applies at once, with no reload. Already-open editors offer the new vocabulary as soon as the save returns
- **Default Language**: the Scryfall language code stamped on newly added cards. A non-English value switches cache downloads to the much larger `all_cards` bulk (default: `en`; see [Configuration](/configuration/#default-language))
- **Interface Language**: the language the admin and CLI **speak**, a BCP-47 tag, listing every locale this build ships, each named in its own language (default: `en`; see [Configuration](/configuration/#interface-language)). It sits below Default Language and is worded against it: **this is not the card language**. Saving it relabels the admin immediately, with no rebuild. The public site picks it up on its next [build-site](/commands/build-site/#localized-builds). The header also carries a language switcher that changes the language for this browser only, without touching the config; see [Localization](/localization/#admin-site)
- **Cache Lock Timeout**: seconds a cache refresh waits for another process's cache-write lock before failing (default: `300`; see [Configuration](/configuration/#cache-lock-timeout))
- **Cache Source**: where cache refreshes download from, Scryfall directly or a peer-to-peer cache feed (default: `scryfall`; see [Configuration](/configuration/#cache-source))
- **Cache Feed URL**: the feed URL used when the cache source is the feed (empty = the built-in default)
- **Card Search Debounce**: milliseconds the editors' add-card search waits after a keystroke before querying autocomplete; `0` disables the debounce (default: `500`; see [Configuration](/configuration/#search-debounce))
- **Offer sell mode**: whether the sites, the published one and this admin, offer [sell mode](/commands/admin/#sell-mode) (default: off; `site.sellMode`). Unchecking removes the key rather than storing `false`. Saving applies at once, with no reload. The sell surfaces appear or disappear as soon as the save returns. See [Sell mode](/commands/admin/#sell-mode) for what it costs and how `--sell-mode` overrides it
- **Git Integration**: enable/disable git auto-commit
- **Two-Factor Authentication (TOTP)**: set up or disable TOTP 2FA
- **Rate Limiting**: configure failed login attempt limits and lockout duration
- **IP Filtering**: allow/deny lists for IP addresses
- **User-Agent Filtering**: allow/deny lists for browser user agents

## Audit Log

View a chronological log of all login attempts, including timestamp, IP address, username, success/failure status, and user agent. It is useful for monitoring unauthorized access attempts.
