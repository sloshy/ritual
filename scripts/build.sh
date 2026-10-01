#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
BUILD_OUTFILE=${BUILD_OUTFILE:-ritual}

# `src/generated/` is gitignored, so every build has to mint it — `locales.ts`
# no less than `dep-licenses.ts`. It comes *before* the SPA bundling because the
# admin app imports `src/generated/locales`, so on a fresh clone (the release
# workflow's checkout, or a new machine) bundling cannot even resolve without
# it. `RITUAL_BUNDLED_LOCALES` selects which dictionaries get baked in; the
# default (`en`) bakes nothing extra, since English is inline in the catalog.
bun run scripts/generate-licenses.ts
bun run scripts/generate-locales.ts
sh scripts/bundle-assets.sh
# Only the release workflow sets RITUAL_RELEASE=true: a build it produces may
# record its version as a workspace's `managed.version` (src/config/version.ts).
RELEASE_DEFINE=""
if [ "$RITUAL_RELEASE" = "true" ]; then
  RELEASE_DEFINE="--define RITUAL_RELEASE=true"
fi
# shellcheck disable=SC2086 # RELEASE_DEFINE is deliberately word-split.
bun build --compile --minify --sourcemap --bytecode \
  --define "GIT_VERSION=\"$GIT_REF\"" \
  $RELEASE_DEFINE \
  ${BUILD_TARGET:+--target="$BUILD_TARGET"} \
  ./index.ts --outfile "$BUILD_OUTFILE"
