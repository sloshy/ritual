#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
bunx @tailwindcss/cli@4.1.18 -i ./src/site/styles.css -o ./src/site/styles.compiled.css --minify
bun build --compile --minify --sourcemap --bytecode \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ./index.ts --outfile ritual
