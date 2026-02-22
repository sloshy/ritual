#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
bun build --compile --minify --sourcemap \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ./index.ts --outfile ritual
