#!/usr/bin/env bash
# Installs the "agents-clean" and "new-agent" Herdr mods, the "main-settle"
# layout, and (when keys.json is there) the ctrl-shift-a key that opens the
# New agent dialog.
# Usage: ./install.sh            (HERDR_APP_HOME or ~/.config/herdr-app)
#        HERDR_APP_HOME=/path ./install.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mods="agents-clean new-agent"
layout=main-settle
cache_root=${XDG_CACHE_HOME:-${HOME:-$app_home}/.cache}/herdr-settle-close

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

# --- the mods --------------------------------------------------------------
# Every top-level file is ours: a changed one is backed up before the repo's
# copy replaces it. Herdr's generated files stay out of this.
install_mod() {
  local mod=$1 f name changed saved stamp backup

  if [ -e "$app_home/mods/$mod" ] && [ ! -d "$app_home/mods/$mod" ]; then
    echo "mods/$mod in $app_home is not a directory - move it away first." >&2
    exit 1
  fi

  if [ -d "$app_home/mods/$mod" ]; then
    changed=
    for f in "$here/mods/$mod"/*; do
      name=$(basename "$f")
      case "$name" in gpui-kit.d.ts|jsconfig.json) continue ;; esac
      [ -f "$f" ] || continue
      if [ ! -f "$app_home/mods/$mod/$name" ] || ! cmp -s "$f" "$app_home/mods/$mod/$name"; then
        changed=1
      fi
    done
    if [ -n "$changed" ]; then
      stamp=$(date +%Y%m%d-%H%M%S)
      backup=$cache_root/$mod-$stamp
      saved=
      for f in "$here/mods/$mod"/*; do
        name=$(basename "$f")
        case "$name" in gpui-kit.d.ts|jsconfig.json) continue ;; esac
        [ -f "$f" ] || continue
        [ -f "$app_home/mods/$mod/$name" ] || continue
        mkdir -p "$backup"
        cp "$app_home/mods/$mod/$name" "$backup/"
        saved=1
      done
      if [ -n "$saved" ]; then
        echo "Saved your local $mod files to $backup"
      fi
    else
      echo "mods/$mod is already up to date."
    fi
  fi

  mkdir -p "$app_home/mods/$mod"
  for f in "$here/mods/$mod"/*; do
    case "$(basename "$f")" in
      gpui-kit.d.ts|jsconfig.json) continue ;;
    esac
    cp -R "$f" "$app_home/mods/$mod/"
  done
}

mkdir -p "$app_home/mods" "$app_home/layouts"
for mod in $mods; do
  install_mod "$mod"
done

# --- the layout ------------------------------------------------------------
if [ -e "$app_home/layouts/$layout.json" ]; then
  echo "layouts/$layout.json already exists - kept it."
  if ! grep -Eq "\"mod\"[[:space:]]*:[[:space:]]*\"agents-clean\"" \
    "$app_home/layouts/$layout.json"; then
    echo "Point that layout's agents block at \"agents-clean\" (or remove the file and re-run)."
  fi
else
  cp "$here/layouts/$layout.json" "$app_home/layouts/"
fi

# --- the key ---------------------------------------------------------------
# no keys.json: never create one. The person binds ctrl-shift-a themselves.
keys=$app_home/keys.json
manual="Bind \"ctrl-shift-a\": \"mod.open:new-agent\" in $keys to open New agent."
if [ ! -f "$keys" ]; then
  echo "$manual"
elif grep -q '"ctrl-shift-a"[[:space:]]*:[[:space:]]*"mod\.open:new-agent"' "$keys"; then
  :
elif grep -q '"ctrl-shift-a"[[:space:]]*:' "$keys"; then
  echo "ctrl-shift-a is already taken in $keys - left it untouched."
elif ! grep -Eq '"global"[[:space:]]*:[[:space:]]*\{' "$keys"; then
  echo "No \"global\" section in $keys. $manual"
else
  stamp=$(date +%Y%m%d-%H%M%S)
  backup=$cache_root/keys-$stamp.json
  mkdir -p "$cache_root"
  cp "$keys" "$backup"
  # Beside keys.json, so the final mv is a rename and never a partial file.
  tmp=$(mktemp "$app_home/.keys.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  # Add the line after the "global": { opening, with or without keys already
  # there; "global": {} on one line is opened up. A trailing comma is only
  # written when another key follows.
  awk -v key="ctrl-shift-a" -v action="mod.open:new-agent" '
    function indent_of(s) { match(s, /^[[:space:]]*/); return substr(s, 1, RLENGTH) }
    {
      line = $0
      if (pending) {
        if (line ~ /^[[:space:]]*$/) { print line; next }
        if (line ~ /^[[:space:]]*\}/) print indent "  \"" key "\": \"" action "\""
        else print indent "  \"" key "\": \"" action "\","
        pending = 0
        print line
        next
      }
      if (!done && line ~ /"global"[[:space:]]*:[[:space:]]*\{[[:space:]]*\}/) {
        match(line, /"global"[[:space:]]*:[[:space:]]*\{[[:space:]]*\}/)
        before = substr(line, 1, RSTART - 1)
        after = substr(line, RSTART + RLENGTH)
        indent = indent_of(line)
        print before "\"global\": {"
        print indent "  \"" key "\": \"" action "\""
        print indent "}" after
        done = 1
        next
      }
      if (!done && line ~ /"global"[[:space:]]*:[[:space:]]*\{[[:space:]]*$/) {
        print line
        indent = indent_of(line)
        pending = 1
        done = 1
        next
      }
      print
    }
    END {
      if (pending) {
        print indent "  \"" key "\": \"" action "\""
        print indent "}"
      }
    }
  ' "$keys" > "$tmp"
  # The binding must be there exactly once; otherwise keep the original and say so.
  if [ "$(grep -c '"ctrl-shift-a"[[:space:]]*:' "$tmp" || true)" -eq 1 ]; then
    mv "$tmp" "$keys"
    trap - EXIT
    echo "Bound ctrl-shift-a to mod.open:new-agent in $keys (backup: $backup)."
  else
    rm -f "$tmp"
    trap - EXIT
    echo "Could not add the key automatically. $manual"
  fi
fi

# --- load it ---------------------------------------------------------------
if "$herdr_app" status >/dev/null 2>&1; then
  for mod in $mods; do
    "$herdr_app" check "$app_home/mods/$mod"
  done
  "$herdr_app" do layout.switch --name "$layout"
  echo
  echo "Installed. Now showing layout \"$layout\" (ctrl-shift-l switches layouts)."
else
  echo
  echo "Installed. Herdr is not running: start it and switch to layout \"$layout\" (ctrl-shift-l)."
fi
