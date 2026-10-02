#!/usr/bin/env bash
# The repository lints CI's `lint` job runs, at the versions scripts/tools.sh
# pins: shellcheck over the scripts, actionlint over the workflows (which also
# runs shellcheck over their `run:` blocks), hadolint over the Dockerfile, and
# typos over everything (_typos.toml lists the deliberate words). TypeScript, YAML
# and Markdown formatting are `bun run verify`'s, not this script's.
#
# Every lint runs even when an earlier one fails; the failures are listed at
# the end.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 1

if ! scripts/tools.sh install > /dev/null; then
  echo "could not install the linters (scripts/tools.sh install)" >&2
  exit 1
fi
PATH="$(scripts/tools.sh path):$PATH"
export PATH

failed=()
step() {
  local name=$1
  shift
  printf '\033[1m==> %s\033[0m\n' "$name"
  if ! "$@"; then
    failed+=("$name")
  fi
}

step shellcheck shellcheck scripts/*.sh
step actionlint actionlint
step hadolint hadolint Dockerfile
step typos typos

if [ ${#failed[@]} -gt 0 ]; then
  printf '\nfailed: %s\n' "${failed[*]}"
  exit 1
fi
echo 'all repository lints passed'
