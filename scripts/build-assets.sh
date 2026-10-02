#!/bin/sh
# Everything the binary embeds besides the code: `bun run build:assets` runs
# this alone (the checks, the Playwright suite), and scripts/build.sh runs it
# before compiling.
set -e

# `src/generated/` is gitignored, so every build has to mint it — `locales.ts`
# no less than `dep-licenses.ts`. It comes *before* the SPA bundling because the
# admin app imports `src/generated/locales`, so on a fresh clone (the release
# workflow's checkout, or a new machine) bundling cannot even resolve without
# it. `RITUAL_BUNDLED_LOCALES` selects which dictionaries get baked in; the
# default (`en`) bakes nothing extra, since English is inline in the catalog.
bun run scripts/generate-licenses.ts
bun run scripts/generate-locales.ts
sh scripts/bundle-assets.sh
