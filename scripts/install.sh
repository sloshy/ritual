#!/usr/bin/env bash

set -euo pipefail

REPO_OWNER="sloshy"
REPO_NAME="ritual"

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
curl --fail --silent --show-error --location "$download_url" --output "$tmp_bin"
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
