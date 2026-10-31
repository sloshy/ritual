---
title: 'Docker'
description: Run Ritual in a container, for a cache server or a hosted public site.
---

Ritual is published as a Docker image. It is most useful for self-hosting the [cache server](/commands/cache/#server) or the [public site with a live backend](/public-site/hosted/), but any command works. The image's entry point is `ritual`, so whatever you put after the image name is the command.

## Quick Start

Pull the image:

```sh
docker pull ghcr.io/sloshy/ritual
```

Run a command against the [workspace](/workspace/) in the current folder by mounting it at `/app`, the container's working folder:

```sh
docker run --rm -it -v "$PWD:/app" ghcr.io/sloshy/ritual lists
```

The container runs as a user named `ritual`, not as root. If it cannot write to your folder, add `-u "$(id -u):$(id -g)"` so it runs as you. In the container the card cache is `/app/cache`, so with the whole workspace mounted it lands in the workspace's `cache/` folder (see [Directory Mounts](#directory-mounts)).

To serve a built site on port 3000:

```sh
docker run --rm -p 3000:3000 -v "$PWD:/app" ghcr.io/sloshy/ritual serve
```

## Image Tags

Each release publishes an image for `linux/amd64` and `linux/arm64` to the GitHub Container Registry, `ghcr.io/sloshy/ritual`:

- `latest` is the newest stable release. Prereleases never move it.
- Every release is also tagged with its version (`0.1.0`, or `0.2.0-rc1` for a prerelease).
- A stable release is also tagged with its minor line (`0.1`), and from 1.0 on its major line (`1`), so you can pin as tightly as you like. There is no bare `0` tag, because a 0.x minor release may break things (see [Upgrading](/reference/upgrading/#what-0x-means)).

## Updating

The image, not the binary inside it, is what you update: pull a newer image (`docker pull ghcr.io/sloshy/ritual`). The image sets `RITUAL_INSTALL=docker`, so [`ritual self-update`](/commands/self-update/) refuses inside a container (`--check` included) and says so, and no [update notice](/commands/self-update/#update-notice) is ever shown. The [releases page](https://github.com/sloshy/ritual/releases) lists what is available. After pulling a newer image, run [`ritual migrate`](/commands/migrate/) in it if your workspace has pending updates.

## Docker Compose

### Example `docker-compose.yml`

This example runs the [cache server](/commands/cache/#server) with common options. The cache server has unauthenticated write routes, so the port is published on the host's loopback address only; reach it from other containers on the same Compose network, or widen the mapping only on a network you trust:

```yaml
services:
  ritual:
    image: ghcr.io/sloshy/ritual
    ports:
      - '127.0.0.1:4000:4000'
    volumes:
      - ./dist:/app/dist
      - ./decks:/app/decks
      - ./collections:/app/collections
      - ./cache:/app/cache
      - ./.logins:/app/.logins
    command: cache server --host 0.0.0.0 --port 4000 --verbose --cards-refresh weekly --prices-refresh weekly
```

### Hosting the public site with a live backend

:::caution[Beta]
Hosting with a live backend is in beta and may change in any release. See [Hosting with a Live Backend](/public-site/hosted/).
:::

To self-host the [hosted public site](/public-site/hosted/) (live list data plus card search from the cache), run [`serve --api`](/commands/serve/#live-api-mode---api) instead. Mount the list directories and a pre-populated cache:

```yaml
services:
  ritual:
    image: ghcr.io/sloshy/ritual
    ports:
      - '3000:3000'
    volumes:
      - ./dist:/app/dist
      - ./decks:/app/decks
      - ./collections:/app/collections
      - ./wanted:/app/wanted
      - ./cache:/app/cache
    command: serve --api --host 0.0.0.0 --port 3000 --refresh never
```

`--refresh never` stops the container from downloading anything on startup. The default `ask` would offer the bulk download an empty or week-old cache needs, and a container has no terminal to answer it, so it is declined. Populate the cache first with `ritual cache preload-all`, point the container at a shared cache server with `--cache-server`, or pass `--refresh auto` to let the container download what it needs on startup.

An empty `dist/` mount is fine: `--api` builds the site on startup when there is none. That build needs card data, so with `--refresh never` **and** an empty cache it fails and the container exits 1. Add `--build` to rebuild the site on every start.

`--refresh never` also skips the startup [buylist](/commands/sell/) refresh, which runs only when [sell mode](/public-site/sell/) is enabled. A long-lived container then quotes the feed it started with until you refresh it from the admin site or a CLI run.

## Directory Mounts

Mount these directories to keep your data and work with the files Ritual uses:

| Host Directory  | Container Directory | Purpose                                                                                     |
| :-------------- | :------------------ | :------------------------------------------------------------------------------------------ |
| `./dist`        | `/app/dist`         | The generated static website files.                                                         |
| `./decks`       | `/app/decks`        | Your Magic: The Gathering deck files (`.md`).                                               |
| `./collections` | `/app/collections`  | Your card collection files.                                                                 |
| `./wanted`      | `/app/wanted`       | Your wanted-list files.                                                                     |
| `./art`         | `/app/art`          | [Custom card art](/custom-art/) (optional).                                                 |
| `./cache`       | `/app/cache`        | Cached card data and images from Scryfall (the image sets `RITUAL_CACHE_DIR=/app/cache`).   |
| `./.logins`     | `/app/.logins`      | Authentication tokens for sites like Archidekt.                                             |
| `./.trash`      | `/app/.trash`       | Lists you [delete](/commands/delete/#restoring-a-deleted-list), kept for restoring.         |
| `./.backups`    | `/app/.backups`     | Copies [`ritual migrate`](/commands/migrate/#numbered-migrations) takes before a migration. |

Outside a container, the [card cache](/card-cache/) lives in one per-user folder every workspace shares. The image instead sets `RITUAL_CACHE_DIR=/app/cache`, so the cache is the `/app/cache` mount and survives the container being recreated; a `cacheDir` in a mounted `ritual.config.json` does not move it, because the variable outranks the key. Set `RITUAL_CACHE_DIR` (`-e` or `environment:`) to keep it somewhere else. Several containers can mount the same cache directory: cache refreshes take a lock in it, so they wait for one another.

Without the last two mounts, deleted lists and migration backups live in the container's own filesystem and are lost when the container is recreated. Mount directories rather than single files: Ritual saves a file by writing a new copy and renaming it into place, which a single-file bind mount does not allow, so such a file is written in place instead, without that protection.

## Building the Image

To build your own image from a checkout, for example for a fork, use the provided script so the image build injects `GIT_VERSION` from the current git ref:

```sh
sh scripts/build-docker.sh
```

By default it builds `ghcr.io/sloshy/ritual:<git-ref>`. You can override the image and tag, and optionally push:

```sh
IMAGE=ghcr.io/<owner>/ritual TAG=v1.2.3 PUSH=true sh scripts/build-docker.sh
```

If git metadata is unavailable, the script falls back to a short commit SHA, then `unknown`. A fork sets `RITUAL_SOURCE_URL` to its repository so the image's [source offer](/attribution/#source-code) links to it, and `GIT_VERSION` pins the version it reports:

```sh
RITUAL_SOURCE_URL=https://github.com/you/ritual sh scripts/build-docker.sh
```

To use your own image in the Compose examples above, replace the `image:` line with `build: .` (run from the checkout) or with your image's name.
