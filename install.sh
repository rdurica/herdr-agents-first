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
mkdir -p "$app_home/mods" "$app_home/layouts"
if [ -d "$app_home/mods/$mod" ]; then
  changed=
  for f in main.js mod.json; do
    if [ ! -f "$app_home/mods/$mod/$f" ] \
      || ! cmp -s "$here/mods/$mod/$f" "$app_home/mods/$mod/$f"; then
      changed=1
    fi
  done
  if [ -n "$changed" ]; then
    stamp=$(date +%Y%m%d-%H%M%S)
    cache=${XDG_CACHE_HOME:-${HOME:-$app_home}/.cache}
    backup=$cache/herdr-settle-close/$mod-$stamp
    saved=
    for f in main.js mod.json; do
      [ -f "$app_home/mods/$mod/$f" ] || continue
      mkdir -p "$backup"
      cp "$app_home/mods/$mod/$f" "$backup/"
      saved=1
    done
    if [ -n "$saved" ]; then
      echo "Saved your local $mod files to $backup"
    fi
  else
    echo "mods/$mod is already up to date."
  fi
  action=Updated
  past=updated
elif [ -e "$app_home/mods/$mod" ]; then
  echo "mods/$mod in $app_home is not a directory - move it away first." >&2
  exit 1
else
  action=Installed
  past=installed
fi
# Copy the repo's files, but never Herdr's generated ones.
mkdir -p "$app_home/mods/$mod"
for f in "$here/mods/$mod"/*; do
  case "$(basename "$f")" in
    gpui-kit.d.ts|jsconfig.json) continue ;;
  esac
  cp -R "$f" "$app_home/mods/$mod/"
done

# --- the layout ------------------------------------------------------------
if [ -e "$app_home/layouts/$layout.json" ]; then
  echo "layouts/$layout.json already exists - kept it, $past the mod only."
  if ! grep -Eq "\"mod\"[[:space:]]*:[[:space:]]*\"$mod\"" \
    "$app_home/layouts/$layout.json"; then
    echo "Point that layout's agents block at \"$mod\" (or remove the file and re-run)."
  fi
else
  cp "$here/layouts/$layout.json" "$app_home/layouts/"
fi

# --- load it ---------------------------------------------------------------
if "$herdr_app" status >/dev/null 2>&1; then
  "$herdr_app" check "$app_home/mods/$mod"
  "$herdr_app" do layout.switch --name "$layout"
  echo
  echo "$action. Now showing layout \"$layout\" (ctrl-shift-l switches layouts)."
else
  echo
  echo "$action. Herdr is not running: start it and switch to layout \"$layout\" (ctrl-shift-l)."
fi
