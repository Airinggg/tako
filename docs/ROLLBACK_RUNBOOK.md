# Rollback runbook

Honest about the current state: there is no CI/CD pipeline and no staging
environment. "Deploy" today means running `bun scripts/demo.ts` (or
`scripts/console.ts`) as a long-lived process, typically on the operator's own
machine or a single always-on host. "Rollback" means stopping that process,
checking out a known-good commit, and starting it again.

## 1. Find the last known-good point

Known-good points are marked with an annotated/lightweight git tag, not just a
commit message. List them, newest first:

```bash
git tag --sort=-creatordate
```

The first hardening baseline is `pre-p0-hardening-2026-09-14` (tagged just
before the P0 auth/validation/error-sanitization/rate-limit fixes landed).
Pick the newest tag that predates the bad release. If nothing was tagged
around the time of the bad release, fall back to `git log --oneline` and pick
the last commit you have direct evidence was working (e.g. the commit before
the one that introduced the regression).

## 2. Redeploy that point

On the host currently running the process:

```bash
# find and stop the running server
pgrep -fl "bun scripts/demo.ts"       # or scripts/console.ts
kill <pid>                            # SIGTERM is enough; both servers exit cleanly

# move the working tree to the known-good point
git fetch --tags
git checkout <tag-or-commit>

# restart
PORT=4400 bun scripts/demo.ts &       # or: PORT=4321 bun scripts/console.ts &
```

Notes:
- If `ADMIN_TOKEN` was set in the environment for the bad release, set it
  again before restarting — otherwise a new one-time token is generated and
  printed to the log, and anyone with the old token loses admin access.
- There is no process supervisor (systemd, pm2, launchd) configured in this
  repo yet, so "restart" is manual. If you're running this as a background
  process left attached to a terminal, restarting it means re-running the
  `bun` command in a session that will stay alive.
- `git checkout <tag>` leaves the repo in a detached HEAD state. Once you've
  confirmed the rollback is stable, either branch from there
  (`git checkout -b hotfix/rollback-<date>`) or note the detached commit
  somewhere durable — don't leave the deploy host on an anonymous detached
  HEAD with no record of what's running.

## 3. Record a new tag after each release

Before shipping a new release (merging to `main` and restarting the deployed
process), tag the commit you're about to deploy:

```bash
git tag pre-release-$(date +%Y-%m-%d)
git push origin --tags   # only if/when this repo has a shared remote in active use
```

This is the same pattern used for `pre-p0-hardening-2026-09-14`: tag right
before a change goes live, so the tag always points at the last state proven
to work, not at whatever commit happens to be newest.

## What this runbook deliberately does not cover

- No CI/CD pipeline exists, so there is no automated rollback trigger, no
  build artifact to redeploy, and no automated smoke test gate before a
  rollback is considered complete. Verify manually (hit `/` and a couple of
  `/api/*` routes) after restarting.
- No staging environment exists, so a rollback is validated on the same host
  it runs on. There's no environment to rehearse the rollback against first.
- No process supervisor is configured, so a crashed process does not restart
  itself. If the "bad release" was a crash rather than a bad behavior, check
  that the process is actually still up before assuming a rollback fixed
  anything.

When any of the above gets built, update this document to describe the real
mechanism rather than leaving this section stale.
