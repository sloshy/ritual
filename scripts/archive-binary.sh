#!/usr/bin/env bash
# Pack a release binary into its compressed release asset, with a `.sha256`:
#
#   scripts/archive-binary.sh <asset>
#
# `ritual-linux-x86_64` becomes `ritual-linux-x86_64.tar.gz` holding `ritual`;
# `ritual-windows-x86_64.exe` becomes `ritual-windows-x86_64.zip` holding
# `ritual.exe` (src/update/release-source.ts's archiveFor names them). The
# archive holds that one file and nothing else, which is what `ritual
# self-update` (src/update/archive.ts) insists on: a ustar tarball with no pax
# headers, or a zip of one deflated entry. Ownership and timestamps are fixed,
# so the same binary always packs to the same bytes. The `.sha256` hashes the
# archive itself, as the bare binary's hashes the binary.
# Run on Linux (the build job), with GNU tar, gzip, zip and sha256sum.
set -euo pipefail

asset=$1
case "$asset" in
  *.exe)
    archive="${asset%.exe}.zip"
    member=ritual.exe
    ;;
  *)
    archive="$asset.tar.gz"
    member=ritual
    ;;
esac

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
install -m 755 "$asset" "$stage/$member"
# A zip cannot record a time before 1980, so not the epoch.
touch -d '2000-01-01T00:00:00Z' "$stage/$member"

rm -f "$archive"
case "$archive" in
  *.zip)
    # -X: no extra fields (uid/gid, extended timestamps); -j: no directory part.
    zip -q -X -j -9 "$archive" "$stage/$member"
    ;;
  *)
    tar --format=ustar --owner=0 --group=0 --numeric-owner -C "$stage" -cf - "$member" |
      gzip -9 -n > "$archive"
    ;;
esac

sha256sum "$archive" > "$archive.sha256"
echo "$archive"
