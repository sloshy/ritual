# The Bun that builds the binary: the one .bun-version names, which CI uses
# (test/unit/release-contract.test.ts keeps them equal).
ARG BUN_VERSION=1.4.4

# Stage 1: Build
FROM oven/bun:${BUN_VERSION}-alpine AS builder

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

# Build the ritual binary
RUN bun run build

# Stage 2: Runtime
FROM alpine:3.24

WORKDIR /app

# Install dependencies for bun compiled binary
RUN apk add --no-cache libstdc++ libgcc

# Copy the binary from builder
COPY --from=builder /app/ritual /usr/local/bin/ritual

# The image, not the binary inside it, is the unit of update: `ritual
# self-update` sees this and tells the user to pull a newer image instead.
ENV RITUAL_INSTALL=docker

# Create non-root user for security
RUN adduser -D -h /app ritual

# Create necessary directories with correct ownership
RUN mkdir -p /app/dist /app/decks /app/collections /app/wanted /app/cache /app/.logins && \
    chmod 700 /app/.logins && \
    chown -R ritual:ritual /app

USER ritual

# The default ports of `serve` (3000), `cache server` (4000) and `admin` (8080).
EXPOSE 3000 4000 8080

# Set the default command
ENTRYPOINT ["ritual"]
