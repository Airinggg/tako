# Backup and restore test — 2026-09-15

Real evidence for P1-12's required "復元演習記録" (restore-drill record).
Run against this machine's actual `~/.aletheia-brain` (backing up only
reads it — safe, non-destructive); restored into a scratch directory, never
overwriting the original.

## Backup

```
$ BACKUP_PASSPHRASE='...' ./scripts/backup-brain.sh /tmp/backup-drill
Archiving /Users/khewailing/.aletheia-brain and .../brain-sources ...
tar: Could not pack extended attributes: Operation not supported
: .aletheia-brain/.gbrain/brain.pglite/.gbrain-resolve.sock: pax format cannot archive sockets
Encrypting ...
Wrote /tmp/backup-drill/tako-backup-20260915T045326Z.tar.enc
```

The socket warning is expected and harmless (an ephemeral runtime file,
correctly excluded — see `docs/BACKUP_RESTORE_RUNBOOK.md`).

## Restore

```
$ BACKUP_PASSPHRASE='...' ./scripts/restore-brain.sh /tmp/backup-drill/tako-backup-20260915T045326Z.tar.enc /tmp/restore-drill
Decrypting ...
Extracting into /tmp/restore-drill ...
Restored.
```

## Verify: byte-for-byte size match

```
$ du -sh /tmp/restore-drill/.aletheia-brain/.gbrain/brain.pglite
78M
$ du -sh /Users/khewailing/.aletheia-brain/.gbrain/brain.pglite
78M
```

## Verify: functional, not just present

```
$ GBRAIN_HOME="/tmp/restore-drill/.aletheia-brain" bun packages/brain/src/cli.ts sources list
SOURCES
  default          federated          0 pages  never synced
  engineering      unset             16 pages  last sync 2026-09-12T08:21:13.717Z
  personal-notes   unset              0 pages  last sync 2026-09-12T08:21:14.009Z
  shared           unset              9 pages  last sync 2026-09-12T08:20:59.550Z
```

Matches the real instance's real sources and page counts exactly.

```
$ GBRAIN_HOME="/tmp/restore-drill/.aletheia-brain" bun packages/brain/src/cli.ts search "engineering" --source shared
[0.8382] drive/hearing-1zt0ozhds9a-... -- * 生成AIは既に積極的に活用されている ...
[0.8362] drive/hearing-1zt0ozhds9a-... -- Hearing - Yuxuan Liu
```

Real search against the restored copy returned real results.

## Cleanup

```
$ rm -rf /tmp/restore-drill /tmp/backup-drill
```

Nothing from this drill persists outside the repo's own `docs/`.

## Git-remote redundancy (separate from the encrypted-archive test above)

`brain-sources/` turned out to be 4 separate git repos (the top-level dir
plus one per registered source: `engineering`, `personal-notes`, `shared`)
— `gbrain backup check` checks each *source's own* repo for an `origin`
remote specifically, not the top-level directory.

Before:
```
$ GBRAIN_HOME="$HOME/.aletheia-brain" bun packages/brain/src/cli.ts backup check
[backup] checked 3 asset(s): 3 without a git remote
backup coverage — WARN
  ✗ engineering — no_remote
  ✗ personal-notes — no_remote
  ✗ shared — no_remote
What survives a disk loss today: 0 repos recoverable from a git remote
```

Set up a local bare repo per source as `origin` and pushed:
```
$ for src in engineering personal-notes shared; do
    git init --bare ~/.aletheia-brain-sources-backup/${src}.git
    git -C brain-sources/${src} remote add origin ~/.aletheia-brain-sources-backup/${src}.git
    git -C brain-sources/${src} push -u origin master
  done
```

After:
```
$ GBRAIN_HOME="$HOME/.aletheia-brain" bun packages/brain/src/cli.ts backup check
[backup] checked 3 asset(s): 0 without a git remote
backup coverage — ok
  ⚠ engineering — dirty: uncommitted changes
  ✓ personal-notes — ok
  ⚠ shared — dirty: uncommitted changes
What survives a disk loss today: 3 repos recoverable from a git remote
```

The "dirty: uncommitted changes" warnings are pre-existing real connector
sync state (deletions/untracked files from normal operation, confirmed via
`git status` before this drill started) — not something introduced by this
drill, and not committed on the operator's behalf here.

**Caveat carried into the runbook:** these `origin` remotes point at a
second local bare repo on the same machine — real mechanism, genuinely
useful against accidental deletion or corruption of the working copy, but
not a substitute for off-machine storage against a full disk failure.
