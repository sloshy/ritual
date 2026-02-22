#!/bin/sh
set -e

GIT_REF=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)
bun build --compile --minify --sourcemap \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  ./index.ts --outfile ritual
