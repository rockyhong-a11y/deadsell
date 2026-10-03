#!/usr/bin/env bash
# Rebuild every game asset from source (Blender scripts + Python post-processing).
#   tools/build_assets.sh            build everything
#   tools/build_assets.sh heroine    only tools/blender/asset_heroine.py (+ pack + post)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/frames build/preview
if [ $# -gt 0 ]; then
  scripts=$(for n in "$@"; do echo "tools/blender/asset_$n.py"; done)
else
  scripts=$(ls tools/blender/asset_*.py)
fi
echo "$scripts" | xargs -P "${JOBS:-4}" -I{} sh -c \
  'echo "[blender] {}"; blender -b --factory-startup -P {} > "build/$(basename {} .py).log" 2>&1 || { echo "FAILED {} (see build/$(basename {} .py).log)"; exit 255; }'
python3 tools/pack/pack_all.py
for p in tools/pack/post_*.py; do [ -e "$p" ] && { echo "[post] $p"; python3 "$p"; }; done
echo "assets built"
