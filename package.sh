#!/usr/bin/env bash
# Builds dist/herdr-agents-first-<version>.zip from this folder.
# The archive contains one top-level folder, so `unzip` keeps it tidy.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
# The folder in the archive has the package's name, whatever this clone is called.
name=herdr-agents-first
version=$(tr -d '[:space:]' < "$here/VERSION")
out="$here/dist/$name-$version.zip"

mkdir -p "$here/dist"
rm -f "$out"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ln -s "$here" "$stage/$name"
cd "$stage"
zip -rq "$out" "$name" \
  -x "$name/dist/*" "$name/.git/*" "$name/*.zip" "*/.DS_Store" "$name/tests/*" \
     "$name/mods/*/gpui-kit.d.ts" "$name/mods/*/jsconfig.json"

echo "$out"
