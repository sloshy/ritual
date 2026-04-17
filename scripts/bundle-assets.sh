#!/bin/sh
set -e

bun build --entrypoints ./src/site/styles.css --outfile ./src/site/styles.compiled.css --minify
bun build --entrypoints ./src/admin/site/styles.css --outfile ./src/admin/site/styles.compiled.css --minify
bun run scripts/bundle-apps.ts
