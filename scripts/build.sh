#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
bun build --entrypoints ./src/site/styles.css --outfile ./src/site/styles.compiled.css --minify
bun build --entrypoints ./src/admin/site/styles.css --outfile ./src/admin/site/styles.compiled.css --minify
bun run scripts/generate-licenses.ts
bun build --compile --minify --sourcemap --bytecode \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ./index.ts --outfile ritual
