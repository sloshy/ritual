#!/bin/sh

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
IMAGE=${IMAGE:-ghcr.io/sloshy/ritual}
TAG=${TAG:-$GIT_REF}
PUSH=${PUSH:-false}

# A fork passes RITUAL_SOURCE_URL through, so the image's source offer links to
# the fork (src/config/source-offer.ts).
docker build --build-arg GIT_VERSION="$GIT_REF" \
  ${RITUAL_SOURCE_URL:+--build-arg RITUAL_SOURCE_URL="$RITUAL_SOURCE_URL"} \
  -t "$IMAGE:$TAG" .

if [ "$PUSH" = "true" ]; then
  docker push "$IMAGE:$TAG"
fi
