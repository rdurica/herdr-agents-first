#!/usr/bin/env bash
# Installs the "agents-clean" Herdr mod and the "main-settle" layout.
# Usage: ./install.sh            (HERDR_APP_HOME or ~/.config/herdr-app)
#        HERDR_APP_HOME=/path ./install.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mod=agents-clean
layout=main-settle

if [ -n "${HERDR_APP:-}" ]; then
  herdr_app=$HERDR_APP
elif command -v herdr-app >/dev/null 2>&1; then
  herdr_app=herdr-app
elif [ -x "$HOME/.local/bin/herdr-app" ]; then
  herdr_app=$HOME/.local/bin/herdr-app
else
  herdr_app=herdr-app
fi

if [ ! -d "$app_home" ]; then
  echo "No Herdr app home at: $app_home" >&2
  echo "Start Herdr once, or set HERDR_APP_HOME." >&2
  exit 1
fi

# --- the mod ---------------------------------------------------------------
if [ -e "$app_home/mods/$mod" ]; then
  echo "mods/$mod already exists in $app_home - move it away first." >&2
  exit 1
fi
mkdir -p "$app_home/mods" "$app_home/layouts"
cp -R "$here/mods/$mod" "$app_home/mods/"

# --- the layout ------------------------------------------------------------
if [ -e "$app_home/layouts/$layout.json" ]; then
  echo "layouts/$layout.json already exists - kept it, installed the mod only."
  echo "Point that layout's agents block at \"$mod\" (or remove the file and re-run)."
else
  cp "$here/layouts/$layout.json" "$app_home/layouts/"
fi

# --- load it ---------------------------------------------------------------
if "$herdr_app" status >/dev/null 2>&1; then
  "$herdr_app" check "$app_home/mods/$mod"
  "$herdr_app" do layout.switch --name "$layout"
  echo
  echo "Installed. Now showing layout \"$layout\" (ctrl-shift-l switches layouts)."
else
  echo
  echo "Installed. Herdr is not running: start it and switch to layout \"$layout\" (ctrl-shift-l)."
fi
