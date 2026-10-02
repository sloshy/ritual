#!/bin/sh
set -e

GIT_REF=${GIT_VERSION:-$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
BUILD_OUTFILE=${BUILD_OUTFILE:-ritual}

# A fork names the repository holding its source, which every network surface
# links to (src/config/source-offer.ts); unset means upstream. It is baked in
# as a JavaScript string literal, hence the characters refused below.
if [ -n "$RITUAL_SOURCE_URL" ]; then
  case "$RITUAL_SOURCE_URL" in
    http://* | https://*) ;;
    *)
      echo "RITUAL_SOURCE_URL must be an http(s) URL, got: $RITUAL_SOURCE_URL" >&2
      exit 1
      ;;
  esac
  case "$RITUAL_SOURCE_URL" in
    *[\"\\]* | *[[:cntrl:]]*)
      echo "RITUAL_SOURCE_URL must not contain quotes, backslashes or control characters" >&2
      exit 1
      ;;
  esac
fi

sh scripts/build-assets.sh
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
  ${RITUAL_SOURCE_URL:+--define "RITUAL_SOURCE_URL=\"$RITUAL_SOURCE_URL\""} \
  ${BUILD_TARGET:+--target="$BUILD_TARGET"} \
  ./index.ts --outfile "$BUILD_OUTFILE"
