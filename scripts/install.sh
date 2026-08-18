#!/usr/bin/env bash

set -euo pipefail

REPO_OWNER="sloshy"
REPO_NAME="ritual"

prerelease="${RITUAL_PRERELEASE:-0}"

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --prerelease        Install the newest release, including prereleases.
  --version <tag>     Install a specific release tag (e.g. v0.3.0).
  -h, --help          Show this help.

Environment variables:
  RITUAL_PRERELEASE=1        Same as --prerelease.
  RITUAL_VERSION=<tag>       Same as --version. Use "prerelease" for the newest prerelease.
  RITUAL_INSTALL_DIR=<dir>   Where to install the binary (default: $HOME/.local/bin).

When piping the script, pass options after `--`:
  curl -fsSL <url> | bash -s -- --prerelease
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
  --prerelease)
    prerelease=1
    shift
    ;;
  --version)
    if [ $# -lt 2 ]; then
      echo "--version requires a release tag" >&2
      exit 1
    fi
    RITUAL_VERSION="$2"
    shift 2
    ;;
  --version=*)
    RITUAL_VERSION="${1#--version=}"
    shift
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage >&2
    exit 1
    ;;
  esac
done

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
Linux)
  platform="linux"
  install_dir="${RITUAL_INSTALL_DIR:-$HOME/.local/bin}"
  ;;
Darwin)
  platform="macos"
  install_dir="${RITUAL_INSTALL_DIR:-$HOME/.local/bin}"
  ;;
*)
  echo "Unsupported operating system: $os" >&2
  exit 1
  ;;
esac

case "$arch" in
x86_64|amd64)
  target_arch="x86_64"
  ;;
arm64|aarch64)
  target_arch="arm64"
  ;;
*)
  echo "Unsupported architecture: $arch" >&2
  exit 1
  ;;
esac

version="${RITUAL_VERSION:-latest}"
asset_name="ritual-${platform}-${target_arch}"

if [ "$version" = "prerelease" ]; then
  prerelease=1
  version="latest"
fi

# Resolve the newest release tag, prereleases included. The unauthenticated
# releases API omits drafts and lists newest first.
resolve_latest_tag() {
  curl --fail --silent --show-error --location \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20" |
    grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' |
    head -n 1 |
    sed 's/.*"\([^"]*\)"$/\1/'
}

if [ "$prerelease" = "1" ] && [ "$version" = "latest" ]; then
  echo "Resolving the newest release (prereleases included)..."
  version="$(resolve_latest_tag)"
  if [ -z "$version" ]; then
    echo "No releases found for ${REPO_OWNER}/${REPO_NAME}." >&2
    exit 1
  fi
  echo "Using release ${version}."
fi

if [ "$version" = "latest" ]; then
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download"
else
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}"
fi

download_url="${base_url}/${asset_name}"
checksum_url="${base_url}/${asset_name}.sha256"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
tmp_bin="${tmp_dir}/${asset_name}"
tmp_checksum="${tmp_dir}/${asset_name}.sha256"

echo "Downloading ${asset_name}..."
if ! curl --fail --silent --show-error --location "$download_url" --output "$tmp_bin"; then
  echo "Failed to download ${download_url}" >&2
  if [ "$version" = "latest" ]; then
    echo "If ${REPO_OWNER}/${REPO_NAME} has only prereleases so far, re-run with --prerelease." >&2
  fi
  exit 1
fi
curl --fail --silent --show-error --location "$checksum_url" --output "$tmp_checksum"

echo "Verifying checksum..."
expected_hash="$(cut -d ' ' -f 1 "$tmp_checksum")"
if command -v sha256sum >/dev/null 2>&1; then
  actual_hash="$(sha256sum "$tmp_bin" | cut -d ' ' -f 1)"
elif command -v shasum >/dev/null 2>&1; then
  actual_hash="$(shasum -a 256 "$tmp_bin" | cut -d ' ' -f 1)"
else
  echo "Warning: no sha256sum or shasum found; skipping checksum verification." >&2
  actual_hash="$expected_hash"
fi

if [ "$actual_hash" != "$expected_hash" ]; then
  echo "Checksum mismatch!" >&2
  echo "  expected: ${expected_hash}" >&2
  echo "  actual:   ${actual_hash}" >&2
  exit 1
fi

mkdir -p "$install_dir"
install_path="${install_dir}/ritual"

install -m 755 "$tmp_bin" "$install_path"

echo "Installed ritual to ${install_path}"

case ":$PATH:" in
*":$install_dir:"*)
  ;;
*)
  shell_name="${SHELL##*/}"
  case "$shell_name" in
  zsh)
    profile_path="${HOME}/.zshrc"
    ;;
  bash)
    if [ "$platform" = "macos" ]; then
      profile_path="${HOME}/.bash_profile"
    else
      profile_path="${HOME}/.bashrc"
    fi
    ;;
  *)
    profile_path="${HOME}/.profile"
    ;;
  esac

  if [ ! -f "$profile_path" ]; then
    touch "$profile_path"
  fi

  path_line="export PATH=\"${install_dir}:\$PATH\""
  if grep -Fq "$path_line" "$profile_path"; then
    echo "${install_dir} is not in your current PATH, but ${profile_path} already configures it."
  else
    {
      printf "\n# Added by ritual installer\n"
      printf "%s\n" "$path_line"
    } >> "$profile_path"
    echo "Added PATH update to ${profile_path}."
  fi
  echo "Open a new shell or run: source \"${profile_path}\""
  ;;
esac
