#!/bin/sh
# Builds the fictional directory tree the demo GIF is recorded against.
set -eu
D="${1:-/tmp/cdai-demo}"
rm -rf "$D"
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
echo "demo tree ready at $D - record with: vhs docs/demo.tape"
