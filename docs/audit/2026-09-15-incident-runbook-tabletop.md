# Incident runbook tabletop exercise — 2026-09-15

A tabletop walkthrough of `docs/SECURITY_INCIDENT_RUNBOOK.md`'s 4
scenarios: verify every command and claim the runbook makes actually works,
without executing anything destructive against real live systems (no real
connector token was revoked, no real indexed content was deleted).

## Scenario 1 — Suspected data leak

- **Step 1 (`pgrep -fl "bun scripts/demo.ts"` then `kill <pid>`):** verified
  accurate, and genuinely useful — this exercise caught 3 real leftover
  `bun scripts/demo.ts` processes from earlier manual verification work
  (ports 4408–4410) that had not actually been killed. Confirms the pattern
  correctly matches and the step is not just theoretical.
- **Step 2 (check `config/sync-log.jsonl`):** `config/sync-log.jsonl` does
  **not exist yet** on this real machine — no connector sync has run
  through `syncConnector()`'s new logging path since it was added
  (2026-09-15). **Finding:** the log only covers syncs from when this
  feature was deployed onward, not retroactively. If a leak predates this
  feature, this step will come up empty and the runbook should say so
  rather than implying the trail always exists. Added below.
- **Step 4 (`gbrain sync --source <subdir> --working-tree`):** verified
  both flags exist via `bun src/cli.ts sync --help` in `packages/brain/`
  — `--source <id>` and `--working-tree` are real, current options.

## Scenario 2 — Accidental hosted-API send

Not live-testable without deliberately breaking the on-premise guarantee
(the whole point is this should be structurally impossible). Verified by
re-confirming the P0-03 audit's code trace still holds: the only outbound
`fetch(` calls are provider auth-check endpoints and the local Ollama
endpoint (`lib/eval/qa.ts`). No new finding; this scenario stays
inspection-verified, not drill-verified, which is appropriate for a
scenario the design should prevent rather than detect-and-contain.

## Scenario 3 — Wrongly-recorded approval

Verified programmatically against the real `lib/review/model.ts` functions
(not a mock): built a review item, approved it, then attempted to record a
second, contradictory decision (`"rejected"`) against the already-approved
item. `recordDecision` correctly threw `verdict "rejected" not allowed from
state "approved"` — `allowedVerdicts()` returns `[]` once terminal, exactly
as documented.

**Finding (not new, but worth stating explicitly in the runbook):** this
immutability is enforced by the app's code path only. A direct hand-edit of
`config/reviews.json` bypasses it entirely, since there is no file
integrity/tamper-evidence mechanism (consistent with the already-documented
single-operator, no-login architecture — see P1-09 in
`docs/PROTOTYPE_SECURITY_CHECKLIST.md`). The runbook's "don't hand-edit the
file" instruction is the actual safeguard here, not a technical
restriction — worth being explicit about that in the runbook so a future
reader doesn't assume the file itself is protected.

## Scenario 4 — Leaked connector or admin credential

**ADMIN_TOKEN rotation — verified live**, correctly, after an initial
false result caused by a mistake in the drill script itself (used
`pgrep -f "PORT=4411"` to find the process to kill, which doesn't work
since environment variable assignments aren't visible in a process's
argv — `pgrep -f` matches command-line arguments, not env vars). Once
corrected to match the runbook's own `pgrep -fl "bun scripts/demo.ts"`
pattern: started a server with `ADMIN_TOKEN=old-token`, confirmed it
authenticates a gated route (400, i.e. passed auth, failed only on a
made-up id), killed it, restarted with `ADMIN_TOKEN=new-token-after-rotation`,
confirmed the old token now gets 401 and the new token gets 400 (passed
auth). Rotation via restart works exactly as the runbook describes.

**Connector token revocation (Notion/Slack/Drive/Discord) — not live-tested
by design.** Actually revoking one of this machine's real, live connector
tokens as a "drill" would disrupt a working connection for no operational
benefit and isn't reversible without redoing that connector's whole setup
flow. Verified instead by re-reading each credential guide
(`docs/connectors/*-credentials.md`) for accuracy — already done when those
guides were reviewed on landing — and confirming each guide's revoke/reset
step exists in that provider's actual current console (per the guides'
own citations). This is the correct scope for a tabletop exercise: prove
the mechanism where it's safe to (admin token), verify the instructions
where executing them would be destructive (connector tokens).

## Runbook updates made as a result

Added a caveat to Scenario 1 about `config/sync-log.jsonl` only covering
syncs since the logging feature was added, and made Scenario 3's file
hand-edit protection explicit about being process, not access control.
