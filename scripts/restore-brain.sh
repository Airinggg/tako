#!/usr/bin/env bash
# Restore an encrypted backup made by scripts/backup-brain.sh (P1-12).
#
# Usage:
#   BACKUP_PASSPHRASE='...' ./scripts/restore-brain.sh <backup-file.tar.enc> <restore-dir>
#
# Extracts into <restore-dir>/.aletheia-brain and <restore-dir>/brain-sources
# -- never overwrites a live GBRAIN_HOME directly. Point GBRAIN_HOME at the
# restored copy and run `gbrain doctor` (from packages/brain/) to confirm it
# works before treating a restore as complete.
set -euo pipefail

BACKUP_FILE="${1:?usage: $0 <backup-file.tar.enc> <restore-dir>}"
RESTORE_DIR="${2:?usage: $0 <backup-file.tar.enc> <restore-dir>}"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "error: BACKUP_PASSPHRASE is not set." >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "error: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if [ -e "$RESTORE_DIR" ]; then
  echo "error: $RESTORE_DIR already exists -- restore into a fresh directory, never over one that might hold real data." >&2
  exit 1
fi

mkdir -p "$RESTORE_DIR"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Decrypting ..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass env:BACKUP_PASSPHRASE \
  -in "$BACKUP_FILE" \
  -out "$WORKDIR/backup.tar"

echo "Extracting into $RESTORE_DIR ..."
tar -xf "$WORKDIR/backup.tar" -C "$RESTORE_DIR"

echo "Restored. Verify with:"
echo "  GBRAIN_HOME=\"$RESTORE_DIR/.aletheia-brain\" bun packages/brain/src/cli.ts doctor"
