#!/bin/sh

GIT_REF=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")
IMAGE=${IMAGE:-ghcr.io/sloshy/ritual}
TAG=${TAG:-$GIT_REF}
PUSH=${PUSH:-false}

docker build --build-arg GIT_VERSION="$GIT_REF" -t "$IMAGE:$TAG" .

if [ "$PUSH" = "true" ]; then
  docker push "$IMAGE:$TAG"
fi
