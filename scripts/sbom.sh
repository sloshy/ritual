#!/usr/bin/env bash
# Write the software bill of materials a release publishes, as CycloneDX JSON:
#
#   scripts/sbom.sh <out.json> [version]
#
# It lists every package bun.lock resolves, development dependencies included:
# the compiled binary bundles most of them (Solid, Commander, prompts, ...), so
# leaving them out would leave out code that ships. It is a superset — the
# linters and test tools are listed too. Licenses come from node_modules, so
# run `bun install --frozen-lockfile` first. docs-site/ has its own lockfile
# for the docs build, which ships nothing, and is left out. `version` defaults
# to package.json's.
#
# syft, at the version scripts/tools.sh pins, does the scanning.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out=$1
version=${2:-$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/package.json")}

if [ ! -d "$root/node_modules" ]; then
  echo "sbom.sh: no node_modules; run 'bun install --frozen-lockfile' first" >&2
  exit 1
fi

"$root/scripts/tools.sh" install syft > /dev/null
syft="$("$root/scripts/tools.sh" path)/syft"

SYFT_CHECK_FOR_APP_UPDATE=false \
  SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=true \
  "$syft" scan "dir:$root" \
  --override-default-catalogers javascript-lock-cataloger \
  --exclude './docs-site/**' \
  --exclude './node_modules/**/node_modules/**' \
  --source-name ritual \
  --source-version "$version" \
  --output "cyclonedx-json=$out" \
  --quiet

# An empty SBOM means the scan found no lockfile, not that Ritual has no dependencies.
count="$(jq '.components | length' "$out")"
if [ "$count" -eq 0 ]; then
  echo "sbom.sh: $out lists no packages" >&2
  exit 1
fi
echo "$out: $count packages"
