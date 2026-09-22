#!/usr/bin/env bash
# Builds dist/tako-installer.dmg (or $1/tako-installer.dmg if given) from
# the current git HEAD's tracked files plus Install.command. Using `git
# archive` rather than a hand-maintained exclude list means a gitignored
# file -- real connector credentials, local sync state -- can never
# accidentally end up in a customer's .dmg: git itself is the single
# source of truth for what ships.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist}"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

DEST="$STAGING/tako"
mkdir -p "$DEST"
git -C "$REPO_ROOT" archive HEAD | tar -x -C "$DEST"

chmod +x "$DEST/Install.command"

# Prune internal-only directories from the STAGED copy (never the real
# repo) -- planning docs, taskboard notes, evals, and the test suite have
# no business on a customer's machine.
rm -rf "$DEST/cowork" "$DEST/docs/superpowers" "$DEST/evals" "$DEST/tests"

mkdir -p "$OUT_DIR"
OUT_PATH="$OUT_DIR/tako-installer.dmg"
rm -f "$OUT_PATH"

hdiutil create -volname "tako installer" -srcfolder "$DEST" -ov -format UDZO "$OUT_PATH"

echo "Built $OUT_PATH"
