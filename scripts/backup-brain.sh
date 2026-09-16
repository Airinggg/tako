#!/usr/bin/env bash
# Encrypted backup of this instance's brain data (P1-12).
#
# Backs up two things: GBRAIN_HOME (the pglite database -- pages, chunks,
# embeddings) and brain-sources/ (the raw synced markdown, itself a git
# repo). Encrypted with openssl (AES-256, PBKDF2) since gpg/age aren't
# assumed to be installed -- openssl ships with macOS and virtually every
# Linux distro. The passphrase is never written to disk or logged; it must
# be supplied via BACKUP_PASSPHRASE.
#
# Usage:
#   BACKUP_PASSPHRASE='...' ./scripts/backup-brain.sh [destination-dir]
#
# destination-dir defaults to ./backups/ (gitignored) -- for a real
# customer instance, point this at storage that isn't the same disk as
# GBRAIN_HOME, or this backup doesn't protect against a disk failure.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GBRAIN_HOME="${GBRAIN_HOME:-$HOME/.aletheia-brain}"
DEST_DIR="${1:-$REPO_DIR/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="tako-backup-${TIMESTAMP}.tar"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "error: BACKUP_PASSPHRASE is not set -- refusing to write an unencrypted backup." >&2
  echo "usage: BACKUP_PASSPHRASE='...' $0 [destination-dir]" >&2
  exit 1
fi

if [ ! -d "$GBRAIN_HOME" ]; then
  echo "error: GBRAIN_HOME ($GBRAIN_HOME) does not exist -- nothing to back up." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Archiving $GBRAIN_HOME and $REPO_DIR/brain-sources ..."
tar -cf "$WORKDIR/$ARCHIVE_NAME" \
  -C "$(dirname "$GBRAIN_HOME")" "$(basename "$GBRAIN_HOME")" \
  -C "$REPO_DIR" brain-sources

echo "Encrypting ..."
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -pass env:BACKUP_PASSPHRASE \
  -in "$WORKDIR/$ARCHIVE_NAME" \
  -out "$DEST_DIR/${ARCHIVE_NAME}.enc"

echo "Wrote $DEST_DIR/${ARCHIVE_NAME}.enc"
echo "Restore with: BACKUP_PASSPHRASE='...' ./scripts/restore-brain.sh $DEST_DIR/${ARCHIVE_NAME}.enc <restore-dir>"
