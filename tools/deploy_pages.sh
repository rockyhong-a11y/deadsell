#!/usr/bin/env bash
# Build the game and publish dist/ to the gh-pages branch (GitHub Pages).
#   tools/deploy_pages.sh [git-ref]     default: HEAD
# Site: https://rockyhong-a11y.github.io/deadsell-play/  (build-only public repo; the source repo is private)
PLAY_REPO=${PLAY_REPO:-https://github.com/rockyhong-a11y/deadsell-play}
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${1:-HEAD}
TMP=$(mktemp -d)
trap 'git worktree remove --force "$TMP/src" 2>/dev/null; rm -rf "$TMP"' EXIT
git worktree add -q --detach "$TMP/src" "$REF"
ln -s "$PWD/node_modules" "$TMP/src/node_modules"
(cd "$TMP/src" && npx vite build)
git clone -q --depth 1 --branch gh-pages "$PLAY_REPO" "$TMP/pages"
find "$TMP/pages" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$TMP/src/dist/." "$TMP/pages/"
touch "$TMP/pages/.nojekyll"
cd "$TMP/pages"
git add -A
git commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short "$REF") to GitHub Pages" || { echo "nothing to deploy"; exit 0; }
git push -q origin HEAD:gh-pages
echo "deployed: https://rockyhong-a11y.github.io/deadsell-play/"
