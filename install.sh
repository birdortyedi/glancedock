#!/usr/bin/env bash
# Installs Glance Dock for the current user.
set -euo pipefail
UUID=glancedock@local
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC"/metadata.json "$SRC"/extension.js "$SRC"/prefs.js "$SRC"/stylesheet.css \
      "$SRC"/lib "$SRC"/widgets "$SRC"/helpers "$SRC"/schemas "$SRC"/terminal "$DEST"/
glib-compile-schemas "$DEST/schemas"
chmod +x "$DEST/helpers/ai_usage.py"

echo "Installed to $DEST"
echo "Log out and back in, then run: gnome-extensions enable $UUID"
