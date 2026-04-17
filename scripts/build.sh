#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
BUILD_OUTFILE=${BUILD_OUTFILE:-ritual}

sh scripts/bundle-assets.sh
bun run scripts/generate-licenses.ts
bun build --compile --minify --sourcemap --bytecode \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ${BUILD_TARGET:+--target="$BUILD_TARGET"} \
  ./index.ts --outfile "$BUILD_OUTFILE"
