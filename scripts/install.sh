#!/bin/zsh
# Installs the latest Roomy on a Mac:
#
#   curl -fsSL https://github.com/KorelUyar/roomy/releases/latest/download/install.sh | zsh
#
# Roomy is not notarised by Apple (that needs a paid developer account).
# Installing it this way skips the "cannot be opened" warning that macOS
# shows for apps downloaded with a browser.

set -e

url="https://github.com/KorelUyar/roomy/releases/latest/download/Roomy-macOS.zip"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Roomy…"
curl -fL --progress-bar "$url" -o "$tmp/Roomy.zip"
ditto -x -k "$tmp/Roomy.zip" "$tmp"

if [ ! -d "$tmp/Roomy.app" ]; then
  echo "The download does not contain Roomy.app." >&2
  exit 1
fi

dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"

osascript -e 'tell application "Roomy" to quit' >/dev/null 2>&1 || true
rm -rf "$dest/Roomy.app"
ditto "$tmp/Roomy.app" "$dest/Roomy.app"
xattr -dr com.apple.quarantine "$dest/Roomy.app" 2>/dev/null || true

echo "Installed in $dest. Opening Roomy…"
open "$dest/Roomy.app"
