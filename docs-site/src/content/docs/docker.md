---
title: 'Docker'
description: Run Ritual in a container, for a cache server or a hosted public site.
---

Ritual can run inside a Docker container. This is most useful for self-hosting the [cache server](/commands/cache/#server) or the [public site with a live backend](/public-site/hosted/). The provided Dockerfile uses Alpine Linux and uses the CLI as its entrypoint, so you can run any command directly by passing it to `docker run` or in your `docker-compose.yml`.

## Building and Publishing the Image

Use the provided script so the image build always injects `GIT_VERSION` from the current git ref:

```sh
sh scripts/build-docker.sh
```

By default it builds `ghcr.io/sloshy/ritual:<git-ref>`. You can override image/tag, and optionally push:

```sh
IMAGE=ghcr.io/<owner>/ritual TAG=v1.2.3 PUSH=true sh scripts/build-docker.sh
```

If git metadata is unavailable, the script falls back to a short commit SHA, then `unknown`.

## Docker Compose

### Example `docker-compose.yml`

This example runs the [cache server](/commands/cache/#server) with some common options:

```yaml
services:
  ritual:
    image: ritual
    build: .
    ports:
      - '3000:3000'
    volumes:
      - ./dist:/app/dist
      - ./decks:/app/decks
      - ./collections:/app/collections
      - ./cache:/app/cache
      - ./.logins:/app/.logins
    command: cache server --host 0.0.0.0 --port 4000 --verbose --cards-refresh weekly --prices-refresh weekly
```

### Hosting the public site with a live backend

To self-host the [hosted public site](/public-site/hosted/) (live list data plus cache-backed card search), run [`serve --api`](/commands/serve/#live-api-mode---api) instead, mounting the list directories and a pre-populated cache:

```yaml
services:
  ritual:
    image: ritual
    build: .
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

`--refresh never` stops the container from downloading Scryfall's bulk data on startup. Under the default `ask`, an empty or week-old cache is bulk-downloaded without prompting. So populate the cache first with `ritual cache preload-all`, or point the container at a shared cache server with `--cache-server`. An empty `dist/` mount is fine: `--api` builds the site on startup when there is none. That build needs card data, though, so with `--refresh never` **and** an empty cache it fails and the container exits 1. Add `--build` to rebuild the site on every start.

`--refresh never` also opts out of the startup [buylist](/commands/sell/) refresh (which only runs when [sell mode](/public-site/sell/) is enabled at all), so a long-lived container's sell mode quotes the feed it started with until you refresh it from the admin site or a CLI run.

## Directory Mounts

To keep your data and let you work with the files Ritual uses, mount these directories:

| Host Directory  | Container Directory | Purpose                                         |
| :-------------- | :------------------ | :---------------------------------------------- |
| `./dist`        | `/app/dist`         | The generated static website files.             |
| `./decks`       | `/app/decks`        | Your Magic: The Gathering deck files (`.md`).   |
| `./collections` | `/app/collections`  | Your card collection files.                     |
| `./cache`       | `/app/cache`        | Cached card data and images from Scryfall.      |
| `./.logins`     | `/app/.logins`      | Authentication tokens for sites like Archidekt. |
