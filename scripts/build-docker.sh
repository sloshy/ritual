#!/bin/sh

GIT_REF=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")
docker build --build-arg GIT_VERSION="$GIT_REF" -t sloshy42/ritual .