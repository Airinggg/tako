# Backup and restore

## What's backed up, and how

Two things hold this instance's real data:

1. **`~/.aletheia-brain`** (or wherever `GBRAIN_HOME` points) — the pglite
   database: pages, chunks, embeddings.
2. **`brain-sources/`** — the raw synced markdown, itself made of separate
   git repos, one per registered source (`engineering`, `personal-notes`,
   `shared`, etc.).

### Encrypted archive backup

```bash
BACKUP_PASSPHRASE='...' ./scripts/backup-brain.sh [destination-dir]
```

Tars both `GBRAIN_HOME` and `brain-sources/`, encrypts with `openssl`
(AES-256, PBKDF2) using a passphrase from `BACKUP_PASSPHRASE` — never
written to disk or logged. Defaults to writing into `./backups/`
(gitignored). **For a real customer instance, point `destination-dir` at
storage that isn't the same disk as `GBRAIN_HOME`** — a backup sitting next
to the thing it backs up doesn't protect against a disk failure.

Known-harmless warning: `tar` may warn about being unable to pack a Unix
domain socket (`.gbrain-resolve.sock`) inside the pglite directory — that's
an ephemeral runtime file, correctly excluded, not a real backup gap.

Restore:

```bash
BACKUP_PASSPHRASE='...' ./scripts/restore-brain.sh <backup-file.tar.enc> <restore-dir>
GBRAIN_HOME="<restore-dir>/.aletheia-brain" bun packages/brain/src/cli.ts doctor
```

Never restores over an existing directory — always extracts into a fresh
path, so a restore can't accidentally clobber live data.

### Git-remote redundancy for `brain-sources/`

Each source under `brain-sources/` is its own git repo — `gbrain backup
check` specifically looks for each one having an `origin` remote (not just
any remote name) to know whether "a disk loss loses it." Point each at
real off-machine storage:

```bash
cd brain-sources/<source-name>
git remote add origin <your-real-remote-url>
git push -u origin master
```

Then confirm: `GBRAIN_HOME="$HOME/.aletheia-brain" bun packages/brain/src/cli.ts backup check`
should report `ok` with every source's git remote row showing `✓`.

## Verified 2026-09-15

Full evidence in `docs/audit/2026-09-15-backup-restore-test.md`. Summary:
a real encrypted backup of this machine's actual `~/.aletheia-brain` was
taken, restored into a scratch directory (never touching the original),
confirmed byte-identical in size, and confirmed *functional* — `gbrain
sources list` against the restored copy showed the same real sources and
page counts, and a real search against it returned real results.
Separately, each of the three real source repos under `brain-sources/`
(`engineering`, `personal-notes`, `shared`) was given a real `origin`
remote and pushed; `gbrain backup check` went from "3 assets without a git
remote" to "3 repos recoverable from a git remote."

**Honest caveat:** the `origin` remotes set up for this verification point
at a second local bare repo on the same machine
(`~/.aletheia-brain-sources-backup/`) — this demonstrates the mechanism
and genuinely protects against an accidental `rm -rf brain-sources/` or a
corrupted working copy, but it does **not** protect against a full disk
failure, since both copies are on the same disk. Before relying on this
for real disaster recovery, repoint each source's `origin` at real
off-machine storage (a private git host, a second physical machine, cloud
storage the customer controls) using the commands above.

## What this doesn't cover

- No automated backup schedule exists yet (no cron/launchd job calling
  `backup-brain.sh`) — running it is a manual step today.
- No retention policy for old backup archives — they accumulate in
  `destination-dir` until manually cleaned up.
- `config/*.json` app state (reviews, connectors, retention policy itself)
  is not included in the archive — it's operational configuration, not
  customer content, and is small enough to recreate via `omnibrain setup`
  plus re-entering connector credentials if truly lost.
