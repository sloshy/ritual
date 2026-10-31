---
title: 'Security and Privacy'
description: 'What Ritual sends to which service and when, what it stores on your computer, and how to report a security problem.'
sidebar:
  order: 3
---

Ritual runs on your computer and works on files you own. It has **no telemetry and no analytics**: it never reports what you do, what your lists hold, or that you ran it. It talks to other services only to do something you asked for. Every request it makes names itself as `Ritual/<version>` and carries nothing about you.

## What Ritual sends where

| Service                                     | When                                                                                                                                              | What it sends                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Scryfall](https://scryfall.com)            | Downloading or refreshing the [card cache](/card-cache/); looking up a card the cache lacks; `ritual scry`; fetching card and mana images         | The card names, set codes and search terms the lookup needs.                                           |
| [Card Kingdom](https://www.cardkingdom.com) | Only when Card Kingdom prices or [sell mode](/public-site/sell/) are turned on                                                                    | A download of its public price list. Nothing about your cards: matching happens on your computer.      |
| [Archidekt](https://archidekt.com)          | [Importing](/commands/import/) an Archidekt deck, [logging in](/commands/login/), and [syncing](/guides/archidekt-sync/) decks or your collection | When you log in, your username and password. When you sync, the cards you chose to sync.               |
| Moxfield, MTGGoldfish                       | Only when you import a deck or primer from them                                                                                                   | The deck address you gave.                                                                             |
| [GitHub](https://github.com/sloshy/ritual)  | `ritual self-update`, and the daily [update check](#the-update-check)                                                                             | A request for the list of Ritual releases.                                                             |
| A cache server or cache feed                | Only when you set one up ([`--cache-server`](/commands/cache/#client-configuration), [`cacheSource: feed`](/configuration/#cache-source))         | Card names and printings to look up (cache server); BitTorrent traffic for the card data (cache feed). |

Nothing else is contacted. Apart from the update check, commands that work on your files alone, such as `edit`, `lists` or `history`, make no network requests once the card cache holds the cards they need. See [Offline use](/card-cache/#offline-use).

### The update check

A release build looks up the newest Ritual release on GitHub at most once a day and prints one line when there is a newer one. The request is a plain `GET` to GitHub's public releases API (`https://api.github.com/repos/sloshy/ritual/releases/latest`, or the list of recent releases if you run a prerelease). It carries no information about you, your workspace, or your lists. If you set `GITHUB_TOKEN`, Ritual sends it with GitHub API requests only, to raise GitHub's rate limit.

To turn the check off:

- everywhere: set the environment variable `RITUAL_NO_UPDATE_CHECK=1`;
- for one workspace: `ritual config set updateCheck false`.

It never runs in CI (when `CI` is set), in the Docker image, in a build you made yourself, or when Ritual's messages are not going to a terminal. The full rules are under [Update notice](/commands/self-update/#update-notice).

### Sites you publish

A site built with [`ritual build-site`](/commands/build-site/) is static files. Your visitors' browsers load card images and run card searches against Scryfall directly, and a deck primer with an embedded video loads it from YouTube. Ritual itself adds no tracking to the site.

## What Ritual stores on your computer

- **Your lists and settings**, in the [workspace](/workspace/): plain files you can read.
- **The card cache**, in a per-user folder (see [Card Cache](/card-cache/#where-it-lives)). It holds only public card data and prices.
- **A small state file** (`state.json`) that remembers when Ritual last checked for updates and last offered to migrate a workspace. See [When Ritual offers to migrate](/commands/migrate/#when-ritual-offers-to-migrate) for where it lives.
- **Sign-ins**, in the workspace's `.logins/` folder:
  - `admin-auth.json`: the [admin site](/commands/admin/) account. The password is stored only as a bcrypt hash; the file also holds the TOTP secret if you turned TOTP on.
  - `admin-audit.log`: admin sign-in attempts, with the address and browser they came from.
  - `archidekt.json`: your Archidekt sign-in tokens. Your Archidekt password is sent to Archidekt to log in and never stored.
  - `collection-sync.json`: when you last synced your collection, and with which Archidekt user.

The files in `.logins/` are readable only by you (mode `0600`, in a `0700` folder), but they are not encrypted. Anyone who can read your workspace can read them. **Never commit `.logins/`**: the `.gitignore` that [`ritual init-site`](/commands/init-site/) writes leaves it out. `ritual login logout` deletes the Archidekt tokens.

## Running servers

`ritual admin`, `ritual serve`, `ritual mcp` and `ritual cache server` start servers. Some listen on every network interface by default, and some have no sign-in at all. Before you open any of them to a network, read [`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md#deployment-assumptions): it lists each server's default address and how it checks who is connecting.

## Checking a download

Every release binary has a `.sha256` checksum and a build provenance record. The install scripts and `ritual self-update` check the checksum before they install. To check a binary yourself, see [Other Methods](/start/install/#other-methods).

## Reporting a security problem

Please report it privately, not in a public issue. [`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md) says how and what is in scope.
