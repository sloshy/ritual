---
title: 'Card Cache'
description: "The local copy of Scryfall's card data Ritual keeps, where it lives, how big it is, how it is refreshed, and how to use Ritual offline."
---

Ritual does not ask Scryfall about every card each time it needs one. It keeps a local copy of Scryfall's card data, the **card cache**: card names, printings, Oracle text, images and prices. Lookups, pricing, autocomplete and site builds all read from it.

## What is in it

- **Card data and prices** from Scryfall's daily **bulk data** file, one entry per printing. Most prices (TCGplayer, Cardmarket, Cardhoarder) come with it, so prices are as fresh as the last download.
- **Oracle and art tags**, used by the sites' tag filters.
- **Card and mana symbol images**, saved as they are first needed.
- **Card Kingdom's price list**, when you use Card Kingdom prices or [sell mode](/public-site/sell/).

Tokens, Arena-only cards and Art Series cards are left out, so they never show up in searches.

## Where it lives

The cache is one folder per user, shared by every workspace on the computer:

| Platform               | Folder                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| Linux and other Unixes | `~/.cache/ritual` (or `$XDG_CACHE_HOME/ritual` when that is set) |
| macOS                  | `~/Library/Caches/ritual`                                        |
| Windows                | `%LOCALAPPDATA%\ritual\cache`                                    |

Ritual picks the folder in this order:

1. the `RITUAL_CACHE_DIR` environment variable,
2. the workspace's [`cacheDir`](/configuration/#cache-directory-cachedir) setting,
3. the workspace's own old `cache/` folder, if it has one that [`ritual migrate`](/commands/migrate/#migration-3-the-shared-card-cache) has not moved yet (older Ritual versions kept one cache per workspace),
4. the per-user folder above.

A relative path in the first two is read from the workspace, so `cacheDir: "cache"` gives a workspace a cache of its own in its `cache/` folder. [`ritual cache status`](/commands/cache/#status) shows the folder in use and which of these chose it. The [Docker image](/docker/) sets `RITUAL_CACHE_DIR=/app/cache`, so the cache is a folder you mount.

Several workspaces, and several Ritual programs at once, can share one cache safely. The details are under [Sharing the cache between workspaces](/commands/cache/#sharing-the-cache-between-workspaces).

## Size

The English card data is about 80 MB to download and about 450 MB on disk. If you set a non-English [`defaultLanguage`](/configuration/#default-language), Ritual needs Scryfall's every-language data instead: about 400 MB to download and several times larger on disk. Card Kingdom's price list adds about 70 MB.

The first command that needs the card data says where it will go and how big it is, and asks before downloading.

## Keeping it fresh

Prices change every day, so commands that show prices check the cache's age. You choose what happens with `--refresh <mode>` on commands such as [`price`](/commands/price/#price-freshness), [`build-site`](/commands/build-site/#the---refresh-mode) and [`serve`](/commands/serve/):

| Mode            | What it does                                                                         |
| --------------- | ------------------------------------------------------------------------------------ |
| `ask` (default) | Asks before a download. Without a terminal to answer, the answer is no.              |
| `auto`          | Downloads whatever is out of date, without asking. Use it in CI.                     |
| `no-bulk`       | Never downloads the full card data; refreshes old prices one card at a time instead. |
| `never`         | Uses the cache as it is.                                                             |

To refresh by hand, run [`ritual cache preload-all`](/commands/cache/#preload-all). It replaces the whole cache, which also repairs a damaged one.

## Offline use

Once the cache is downloaded, most of Ritual works without a network connection: editing lists, looking cards up, pricing with the prices you have, and building the site. Pass `--refresh never` so nothing tries to download, for example `ritual price "My Deck" --refresh never`. A card that is not in the cache at all cannot be looked up until you are back online.

Signing in to and syncing with Archidekt, importing from a website, and checking for updates need the network.

## Other ways to fill it

- A **cache server** ([`ritual cache server`](/commands/cache/#server)) lets several machines share one cache over the network: point Ritual at it with `--cache-server` or `RITUAL_CACHE_SERVER`.
- A **cache feed** (experimental, [`cacheSource: feed`](/configuration/#cache-source)) downloads the card data from other Ritual users over BitTorrent instead of from Scryfall.

Every option is on the [`cache` command](/commands/cache/) page.
