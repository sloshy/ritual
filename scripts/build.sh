#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
BUILD_OUTFILE=${BUILD_OUTFILE:-ritual}

bun build --entrypoints ./src/site/styles.css --outfile ./src/site/styles.compiled.css --minify
bun build --entrypoints ./src/admin/site/styles.css --outfile ./src/admin/site/styles.compiled.css --minify
bun run scripts/bundle-apps.ts
bun run scripts/generate-licenses.ts
bun build --compile --minify --sourcemap --bytecode \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ${BUILD_TARGET:+--target="$BUILD_TARGET"} \
  ./index.ts --outfile "$BUILD_OUTFILE"
