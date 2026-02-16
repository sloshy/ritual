# Stage 1: Build
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the ritual binary
RUN bun run build

# Stage 2: Runtime
FROM alpine:3.21

WORKDIR /app

# Install dependencies for bun compiled binary
RUN apk add --no-cache libstdc++ libgcc

# Copy the binary from builder
COPY --from=builder /app/ritual /usr/local/bin/ritual

# Create necessary directories
RUN mkdir -p /app/dist /app/decks /app/collections /app/cache /app/.logins

# Expose port 3000 for the serve command
EXPOSE 3000

# Set the default command
ENTRYPOINT ["ritual"]
