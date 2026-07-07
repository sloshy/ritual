# Stage 1: Build
FROM oven/bun:1.3.14-alpine AS builder

WORKDIR /app

# Copy dependency files (vendor/ holds the local webrtc-polyfill stub referenced by bun.lock)
COPY package.json bun.lock ./
COPY vendor ./vendor

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Accept version from build arg (e.g. --build-arg GIT_VERSION=$(git describe --tags --always))
ARG GIT_VERSION=unknown
ENV GIT_VERSION=$GIT_VERSION

# Build the ritual binary
RUN bun run build

# Stage 2: Runtime
FROM alpine:3.21

WORKDIR /app

# Install dependencies for bun compiled binary
RUN apk add --no-cache libstdc++ libgcc

# Copy the binary from builder
COPY --from=builder /app/ritual /usr/local/bin/ritual

# Create non-root user for security
RUN adduser -D -h /app ritual

# Create necessary directories with correct ownership
RUN mkdir -p /app/dist /app/decks /app/collections /app/cache /app/.logins && \
    chown -R ritual:ritual /app

USER ritual

# Expose port 3000 for the serve command
EXPOSE 3000

# Set the default command
ENTRYPOINT ["ritual"]
