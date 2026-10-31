---
title: 'Security and Privacy'
description: 'What Ritual sends to which service and when, what it stores on your computer, and how to report a security problem.'
sidebar:
  order: 3
---

Ritual runs on your computer and works on files you own. It has **no telemetry and no analytics**: it never reports what you do, what your lists hold, or that you ran it. It talks to other services only to do something you asked for. Its requests name themselves as `Ritual/<version>` (Moxfield requests use the user agent you set in `MOXFIELD_USER_AGENT`) and carry only what the request needs.

## What Ritual sends where

| Service                                     | When                                                                                                                                                            | What it sends                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Scryfall](https://scryfall.com)            | Downloading or refreshing the [card cache](/card-cache/); looking up a card the cache lacks; `ritual scry`; fetching card and mana images                       | The card names, set codes and search terms the lookup needs.                                           |
| [Card Kingdom](https://www.cardkingdom.com) | When you run [`ritual sell`](/commands/sell/), or when Card Kingdom prices or [sell mode](/public-site/sell/) are turned on                                     | A download of its public price list. Nothing about your cards: matching happens on your computer.      |
| [Archidekt](https://archidekt.com)          | [Importing](/commands/import/) an Archidekt deck, [logging in](/commands/login/), and [syncing](/guides/archidekt-sync/) decks or your collection               | When you log in, your username and password. When you sync, the cards you chose to sync.               |
| Moxfield, MTGGoldfish                       | When you import a deck or primer from them, or build a site that lists a deck by its URL                                                                        | The deck address you gave.                                                                             |
| [GitHub](https://github.com/sloshy/ritual)  | `ritual self-update`, and the daily [update check](#the-update-check)                                                                                           | A request for the list of Ritual releases.                                                             |
| A cache server or cache feed                | Only when you set one up ([`--cache-server`](/commands/cache/#client-configuration), [`cacheSource: feed`](/configuration/#cache-source) with a `cacheFeedUrl`) | Card names and printings to look up (cache server); BitTorrent traffic for the card data (cache feed). |

Nothing else is contacted. Apart from the update check, commands that work on your files alone, such as `edit`, `lists` or `history`, make no network requests without asking you first once the card cache holds the cards they need. See [Offline use](/card-cache/#offline-use).

### The update check

A release build looks up the newest Ritual release on GitHub about once a day (sooner if a check failed or did not finish) and prints one line when there is a newer one. The request is a plain `GET` to GitHub's public releases API (`https://api.github.com/repos/sloshy/ritual/releases/latest`, or the list of recent releases if you run a prerelease). It carries no information about you, your workspace, or your lists. If you set `GITHUB_TOKEN`, Ritual sends it with GitHub API requests only, to raise GitHub's rate limit.

To turn the check off:

- everywhere: set the environment variable `RITUAL_NO_UPDATE_CHECK=1`;
- for one workspace: `ritual config set updateCheck false`.

It never runs in CI (when `CI` is set), in the Docker image, in a build you made yourself, or when Ritual's messages are not going to a terminal. The full rules are under [Update notice](/commands/self-update/#update-notice).

### Sites you publish

A site built with [`ritual build-site`](/commands/build-site/) is static files. Your visitors' browsers load card images and run card searches against Scryfall directly, and a deck primer with an embedded video loads it from YouTube. Ritual itself adds no tracking to the site.

## What Ritual stores on your computer

- **Your lists and settings**, in the [workspace](/workspace/): plain files you can read.
- **The card cache**, in a per-user folder (see [Card Cache](/card-cache/#where-it-lives)). It holds only public card data and prices.
- **A small state file** (`state.json`) that remembers when Ritual last checked for updates, and which workspaces (by folder path) it offered to migrate in the last day. See [When Ritual offers to migrate](/commands/migrate/#when-ritual-offers-to-migrate) for where it lives.
- **Sign-ins**, in the workspace's `.logins/` folder:
  - `admin-auth.json`: the [admin site](/commands/admin/) account. The password is stored only as a bcrypt hash; the file also holds the TOTP secret if you turned TOTP on.
  - `admin-audit.log`: admin sign-in attempts, with the address and browser they came from.
  - `archidekt.json`: your Archidekt sign-in tokens. Your Archidekt password is sent to Archidekt to log in and never stored.
  - `collection-sync.json`: when you last synced your collection, and with which Archidekt user.

The files in `.logins/` are readable only by you (mode `0600`, in a `0700` folder), but they are not encrypted. Anyone who can read your workspace can read them. **Never commit `.logins/`**. Ritual keeps it out of git for you: whenever it writes into the folder, it also writes a `.logins/.gitignore` that ignores everything in it, so this holds even in a workspace [`ritual init-site`](/commands/init-site/) never set up. The file keeps git from adding the folder; if you already committed it, `git rm -r --cached .logins` stops tracking it, and the sign-ins in your history stay there until you change them. `ritual login logout` deletes the Archidekt tokens.

## Running servers

`ritual admin`, `ritual serve`, `ritual mcp` and `ritual cache server` start servers. Some listen on every network interface by default, and some have no sign-in at all. Before you open any of them to a network, read [`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md#deployment-assumptions): it lists each server's default address and how it checks who is connecting.

A few protections apply whatever you expose:

- **Every server caps the size of a request.** An oversized one is refused before it can fill the server's memory.
- **The admin site refuses requests sent from other websites.** A page on another site, even another port of the same computer, cannot make your browser save, delete, sync, sign in or create the admin account, even while you are signed in: the admin refuses any API request a browser sends from another site, on top of its `SameSite` sign-in cookie.
- **The cache server and the cache feed host do not reveal their errors.** When something goes wrong, the reply says only that it did; the details go to the server's own console.
- **`serve --api` has no sign-in and no write routes**, so there is nothing for another site to forge. Its `POST` routes only look up prices and buylist quotes.

## Checking a download

Every release binary, and the compressed archive each is also published in, has a `.sha256` checksum of that file and a build provenance record. The install scripts, `ritual self-update` and the deploy workflow [`init-site`](/commands/init-site/) generates check the checksum of what they download before they unpack or install it. To check a binary yourself, see [Other Methods](/start/install/#other-methods).

## Software Bill of Materials

Each release publishes `ritual-sbom.cdx.json`, a [CycloneDX](https://cyclonedx.org/) JSON software bill of materials: every package in Ritual's lockfile, with its version, license and package URL. It includes the development dependencies, because the binary bundles many of them (the site's UI framework, the command-line parser), so it lists a little more than ships (the test and lint tools too). The release attests it against every binary and archive, so you can check it belongs to the file you downloaded:

```sh
gh attestation verify ritual-linux-x86_64.tar.gz --repo sloshy/ritual \
  --predicate-type https://cyclonedx.org/bom
```

The [Docker image](/docker/) carries its own SBOM and build provenance as registry attestations, covering its Alpine packages; `docker buildx imagetools inspect ghcr.io/sloshy/ritual --format '{{ json .SBOM }}'` prints it.

## Reporting a security problem

Please report it privately, not in a public issue. [`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md) says how and what is in scope.
