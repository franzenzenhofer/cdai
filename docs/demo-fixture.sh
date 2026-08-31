#!/bin/sh
# Builds the fictional directory tree the demo GIF is recorded against.
set -eu
D="${1:-/tmp/cdai-demo}"
D="${D%/}"
NAME="$(basename "$D")"
PARENT="$(dirname "$D")"
PARENT="$(cd "$PARENT" 2>/dev/null && pwd -P)" || {
  echo "refusing demo path with a missing parent: $D" >&2
  exit 1
}
SYSTEM_TMP="$(cd /tmp && pwd -P)"
SESSION_TMP="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
case "$NAME" in
  cdai-demo|cdai-demo-*) ;;
  *) echo "refusing demo path not named cdai-demo*: $D" >&2; exit 1 ;;
esac
if [ "$PARENT" != "$SYSTEM_TMP" ] && [ "$PARENT" != "$SESSION_TMP" ]; then
  echo "refusing demo path outside a temporary directory: $D" >&2
  exit 1
fi
D="$PARENT/$NAME"
if [ -e "$D" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    TRASH="$HOME/.Trash"
  else
    TRASH="${XDG_DATA_HOME:-$HOME/.local/share}/Trash/files"
  fi
  mkdir -p "$TRASH"
  TRASHED="$TRASH/cdai-demo-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$D" "$TRASHED"
  echo "previous demo moved to trash: $TRASHED"
fi
mkdir -p "$D/dev" "$D/Dropbox/clients" "$D/.config/cdai"
(cd "$D/dev" && mkdir -p squash tabletop-3d tabletop-web almanac blog dotfiles)
(cd "$D/Dropbox/clients" && mkdir -p petalworks/petalworks-2024 petalworks/petalworks-2025 petalworks/petalworks-2026 acme-shop/acme-shop-2025 orbit)
touch -t 202401150800 "$D/Dropbox/clients/petalworks/petalworks-2024"
touch -t 202502100900 "$D/Dropbox/clients/petalworks/petalworks-2025"
touch -t 202608201000 "$D/Dropbox/clients/petalworks/petalworks-2026"
cat > "$D/.config/cdai/config.json" <<CFG
{ "roots": [ { "path": "$D/dev", "depth": 2 }, { "path": "$D/Dropbox/clients", "depth": 3 } ],
  "ignore": ["node_modules", ".git"],
  "ai": { "enabled": false, "command": "claude", "model": "sonnet", "timeoutMs": 45000 } }
CFG
cat > "$D/setup.zsh" <<SETUP
export HOME="$D"
unset CDAI_DATA_DIR
cd "\$HOME"
eval "\$(cdai init zsh)"
PROMPT='%F{blue}~%f %F{green}❯%f '
cdai index --refresh 2>/dev/null
clear
SETUP
mkdir -p "$D/.local/share/cdai"
cat > "$D/.local/share/cdai/aliases.json" <<ALIASES
{ "version": 1, "aliases": [ { "query": "flowers client", "path": "$D/Dropbox/clients/petalworks", "updatedAt": 1788148800000 } ] }
ALIASES
chmod 700 "$D/.config/cdai" "$D/.local/share/cdai"
chmod 600 "$D/.config/cdai/config.json" "$D/.local/share/cdai/aliases.json"
echo "demo tree ready at $D - record with: vhs docs/demo.tape"
