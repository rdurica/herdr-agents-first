#!/usr/bin/env bash
# Builds dist/herdr-settle-close-<version>.zip from this folder.
# The archive contains one top-level folder, so `unzip` keeps it tidy.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$here")
version=$(tr -d '[:space:]' < "$here/VERSION")
out="$here/dist/herdr-settle-close-$version.zip"

mkdir -p "$here/dist"
rm -f "$out"
cd "$here/.."
zip -rq "$out" "$name" \
  -x "$name/dist/*" "$name/.git/*" "$name/*.zip" "*/.DS_Store" \
     "$name/mods/*/gpui-kit.d.ts" "$name/mods/*/jsconfig.json"

echo "$out"
