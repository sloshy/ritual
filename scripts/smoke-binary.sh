#!/usr/bin/env bash
# Smoke-test a compiled Ritual binary on the machine it was built for:
#
#   scripts/smoke-binary.sh <binary> [expected-version]
#
# It must start, report its version (exactly <expected-version> when given),
# create a deck in a fresh workspace, list it back, and pass `ritual doctor`.
# CI runs this on every shipped platform, against the cross-compiled binary
# the release would attach, so a target that cannot even start is caught
# before it ships. Nothing here touches the network: there is no card cache,
# and CI disables the update check.
set -euo pipefail

bin=$1
expected=${2:-}

# Artifact downloads drop the executable bit.
chmod +x "$bin"

# A native path on every OS: on Windows, Git Bash would otherwise hand the
# binary a /tmp path it cannot resolve.
workspace="${RUNNER_TEMP:-$(mktemp -d)}/ritual-smoke-$$"
mkdir -p "$workspace"

version="$("$bin" --version | tr -d '\r')"
echo "version: $version"
if [ -n "$expected" ] && [ "$version" != "$expected" ]; then
  echo "::error::$bin reports version '$version', expected '$expected'" >&2
  exit 1
fi

"$bin" --base-dir "$workspace" --no-input new deck "Smoke Test"
lists="$("$bin" --base-dir "$workspace" --no-input lists)"
echo "$lists"
if ! grep -q "Smoke Test" <<< "$lists"; then
  echo "::error::the deck just created is missing from \`ritual lists\`" >&2
  exit 1
fi
# The diagnostics a bug report asks for must run on every platform too. Read
# only and offline; its card-cache and update checks may warn here (exit 0),
# but no check may fail on a fresh workspace.
"$bin" --base-dir "$workspace" --no-input doctor

echo "smoke test passed: $bin"
