# Docker

Ritual can be run inside a Docker container. This is particularly useful for self-hosting the static site generator and cache server.
The provided Dockerfile uses Alpine Linux and uses the CLI as its entrypoint, so you can run any command directly by passing it to `docker run` or in your `docker-compose.yml`.

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

This `docker-compose.yml` example shows an example of running the `cache-server` command, which starts the [cache server](/commands/cache-server.md) with some common options:

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
    command: cache-server --host 0.0.0.0 --port 4000 --verbose --cards-refresh weekly --prices-refresh weekly
```

## Directory Mounts

To ensure persistence and allow you to interact with the files Ritual uses, you should mount the following directories:

| Host Directory  | Container Directory | Purpose                                         |
| :-------------- | :------------------ | :---------------------------------------------- |
| `./dist`        | `/app/dist`         | The generated static website files.             |
| `./decks`       | `/app/decks`        | Your Magic: The Gathering deck files (`.md`).   |
| `./collections` | `/app/collections`  | Your card collection files.                     |
| `./cache`       | `/app/cache`        | Cached card data and images from Scryfall.      |
| `./.logins`     | `/app/.logins`      | Authentication tokens for sites like Archidekt. |
