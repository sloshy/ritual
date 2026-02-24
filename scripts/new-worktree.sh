#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <worktree-name>" >&2
  exit 2
fi

worktree_name="$1"
dest="../ritual.worktrees/${worktree_name}"
git worktree add "$dest"

copy_dir() {
  local src=$1 destdir=$2
  if [ ! -e "$src" ]; then
    echo "Warning: '$src' not found; skipping." >&2
    return 0
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$src" "$destdir/"
  else
    cp -a "$src" "$destdir/"
  fi
}

copy_dir "decks" "$dest"
copy_dir "cache" "$dest"

bun install --cwd "$dest"