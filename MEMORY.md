# Tako handoff

## Current goal

Preserve the complete local Tako prototype history on GitHub before removing
the local checkout to recover disk space.

## Verified status — 2026-11-19

- The active source branch is `feature/connector-credentials-and-categorization`.
- All named local feature, design, distribution, meeting, Gemini-demo, and
  experiment branches have been pushed to `Airinggg/tako`.
- Previously unreachable local commits have been preserved under
  `archive/local-recovery-2026-11-19/*`; they are recovery snapshots, not
  reviewed release branches.
- `main` remains the existing GitHub mainline and has not been force-merged or
  overwritten by unfinished branches.

## Key decisions

- Preserve unfinished work as branches rather than merging it into `main`.
- Keep connector tokens, synced customer data, local databases, generated
  credentials, recordings, and model caches out of Git.

## Next concrete action

After verifying the remote refs, remove the local checkout only when a local
copy is no longer needed; reclone from `https://github.com/Airinggg/tako.git`
when development resumes.
