# The Bun that builds the binary: the one .bun-version names, which CI uses
# (test/unit/release-contract.test.ts keeps them equal).
ARG BUN_VERSION=1.4.5

# Stage 1: Build
# A glibc (Debian) builder, though the runtime stage is Alpine: building the
# SPAs runs Solid's native JSX compiler (@solidjs/compiler), which publishes no
# musl binary, so the binary is cross-compiled for musl below instead. On the
# build machine's own platform: the compile step targets the image's.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-slim AS builder

WORKDIR /app

# Copy dependency files (vendor/ holds the local webrtc-polyfill stub referenced by bun.lock)
COPY package.json bun.lock ./
COPY vendor ./vendor

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# The version the binary reports, from a build arg: the release tag in the
# release workflow, `git describe --tags --always` in scripts/build-docker.sh.
ARG GIT_VERSION=unknown
ENV GIT_VERSION=$GIT_VERSION
# `true` only from the release workflow, for a build at a release tag: such a
# binary may record its version as a workspace's `managed.version`
# (src/config/version.ts).
ARG RITUAL_RELEASE=false
ENV RITUAL_RELEASE=$RITUAL_RELEASE
# A fork's repository, which the binary's source offer links to; empty means
# upstream (src/config/source-offer.ts).
ARG RITUAL_SOURCE_URL=
ENV RITUAL_SOURCE_URL=$RITUAL_SOURCE_URL

# Build the ritual binary for the Alpine (musl) runtime stage, on the image's
# own architecture (BuildKit's TARGETARCH, or the builder's when unset).
ARG TARGETARCH
RUN arch="${TARGETARCH:-$(uname -m)}" && \
    case "$arch" in \
      amd64 | x86_64) arch=x64 ;; \
      arm64 | aarch64) arch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac && \
    BUILD_TARGET="bun-linux-$arch-musl" bun run build

# Stage 2: Runtime
FROM alpine:3.24

WORKDIR /app

# Install dependencies for bun compiled binary
RUN apk add --no-cache libstdc++ libgcc

# Copy the binary from builder
COPY --from=builder /app/ritual /usr/local/bin/ritual

# The health check (scripts/docker-healthcheck.sh): probes the server the
# container runs — `serve`, `admin`, `cache server` or `cache feed host`, on
# the port its command line gives — and passes for any other command.
COPY --chmod=755 scripts/docker-healthcheck.sh /usr/local/bin/ritual-healthcheck

# The image, not the binary inside it, is the unit of update: `ritual
# self-update` sees this and tells the user to pull a newer image instead.
ENV RITUAL_INSTALL=docker

# The card cache lives in /app/cache (the volume the docs mount), rather than
# the per-user cache under the container user's home, which a fresh container
# would start without. Override it with `-e RITUAL_CACHE_DIR=...`.
ENV RITUAL_CACHE_DIR=/app/cache

# Create non-root user for security
RUN adduser -D -h /app ritual

# Create necessary directories with correct ownership
RUN mkdir -p /app/dist /app/decks /app/collections /app/wanted /app/cache /app/.logins && \
    chmod 700 /app/.logins && \
    chown -R ritual:ritual /app

USER ritual

# The default ports of `serve` (3000), `cache server` (4000) and `admin` (8080).
EXPOSE 3000 4000 8080

# `serve --api` may build the site before it listens, hence the long start
# period; it is checked every 5 seconds until then, so a ready server turns
# healthy quickly. Override with `--health-cmd` or Compose's `healthcheck:`.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5m --start-interval=5s --retries=3 \
  CMD ["ritual-healthcheck"]

# Set the default command
ENTRYPOINT ["ritual"]
