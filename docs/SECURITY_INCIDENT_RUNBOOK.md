# Security incident runbook

This covers security incidents specifically — a suspected data leak, an
accidental hosted-API send, a wrongly-recorded approval, or a leaked
connector credential. For a bad code release, see
[`docs/ROLLBACK_RUNBOOK.md`](ROLLBACK_RUNBOOK.md) instead; that is a
different scenario with a different fix.

Honest about the current state: this is a single-operator instance with no
formal on-call rotation. "Who to tell" below means the person(s) actually
running this instance for the customer — name them before this instance
goes live with real data, and keep this file updated when that changes.

## 1. Suspected data leak (a customer document appears somewhere it shouldn't)

**Contain first, investigate after.**

1. Stop the demo server (`pgrep -fl "bun scripts/demo.ts"`, then `kill <pid>`)
   so nothing more can be retrieved or answered from the index while you work.
2. Identify what leaked and where: check `config/sync-log.jsonl` for every
   page synced from the source in question (`source`, `path`, `hash`,
   `syncedAt`) to know exactly what was indexed and when. This log only
   covers syncs since it was added (2026-09-15) — if the leak may predate
   that, or the file doesn't exist yet, fall back to `brain-sources/`'s own
   git history (`git log --follow -- <path>`) for older provenance.
3. If the leak is external (e.g. a page appeared in a channel/tool it wasn't
   meant to reach), notify the customer contact and the person running this
   instance immediately — do not wait until the investigation is complete.
4. Purge the offending content: delete the page from `brain-sources/<subdir>/`,
   commit the removal, then re-run `gbrain sync --source <subdir> --working-tree`
   to drop it from the index. Confirm it's gone with a search for its slug.
5. Record what happened, what leaked, and what was done in a dated note
   under `docs/audit/` (matching this project's existing pattern for security
   records) — this is the incident's own audit trail.

## 2. Accidental hosted-API send (customer content reached an external AI API)

This should be structurally impossible per `docs/LOCAL_LLM_PLAN.md` — all
model calls are local Ollama, the one documented exception
(`scripts/seo-audit.mjs`) only reads already-public web content. If this
happens anyway, treat it as the most serious incident this runbook covers.

1. Stop the process that made the call immediately.
2. Identify exactly what was sent and to which provider — check the code
   path that made the call (grep for `fetch(` to any non-`localhost`/
   non-Ollama host) and any request logs.
3. Notify the customer contact — this is a promise the product makes that
   was broken; they need to know regardless of how the investigation
   concludes.
4. Fix the code path that allowed it before restarting anything. Add a
   regression test asserting that path never sends customer content externally
   again.
5. Record the incident under `docs/audit/` as in scenario 1.

## 3. Wrongly-recorded approval (something was approved that shouldn't have been)

1. Do not attempt to "undo" an `approved` or `rejected` verdict by editing
   `config/reviews.json` by hand — `allowedVerdicts()` in
   `lib/review/model.ts` deliberately makes terminal states immutable
   *through the app*, and hand-editing the file bypasses that guarantee
   entirely rather than fixing the mistake. This is a process rule, not a
   technical restriction: there is no file integrity check stopping a
   direct edit, so this instruction is the actual safeguard.
2. Instead: if whatever was approved was about to be sent/published/acted on
   outside Tako, stop that external action first — Tako itself never sends
   anything (see `docs/PROTOTYPE_SECURITY_CHECKLIST.md`'s governed-path
   description), so the actual external send/publish is always a separate,
   human step you can still halt.
3. Record a new review item documenting the correction (what was wrong, who
   caught it, what should have happened) rather than erasing the mistaken
   one — `config/reviews.json`'s decision history
   (`ReviewItem.decisions`, plural, append-only) is designed to keep every
   decision, including ones later found to be wrong.
4. Tell whoever would have acted on the approval before they do.

## 4. Leaked connector credential (Notion/Slack/Drive/Discord token exposed)

1. Revoke the specific token immediately, in that provider's own console —
   this is always faster and more certain than anything done on this side:
   - **Notion:** Developer portal → the connection → delete/reset the
     integration token (see
     [`docs/connectors/notion-credentials.md`](connectors/notion-credentials.md)).
   - **Slack:** App settings → OAuth & Permissions → reinstall the app (this
     rotates the Bot User OAuth Token) or delete the app entirely (see
     [`docs/connectors/slack-credentials.md`](connectors/slack-credentials.md)).
   - **Google Drive:** revoke the OAuth grant from the Google Account's
     connected-apps settings, or delete the OAuth client in Google Cloud
     Console (see
     [`docs/connectors/drive-credentials.md`](connectors/drive-credentials.md)).
   - **Discord:** Developer Portal → Bot → Reset Token (see
     [`docs/connectors/discord-credentials.md`](connectors/discord-credentials.md)).
2. Remove the leaked value from wherever it was exposed (a chat message, a
   screenshot, a committed file — if it reached Git history, treat the repo
   itself as compromised for that token and rotate it regardless of whether
   you can also scrub history).
3. Generate a new credential following the relevant guide above, set it as
   the environment variable (`NOTION_TOKEN`, `SLACK_BOT_TOKEN`,
   `GOOGLE_DRIVE_ACCESS_TOKEN`, or `DISCORD_BOT_TOKEN`), and confirm it
   works with `./bin/omnibrain doctor` then a connector test/sync.
4. If the leaked token had already been used for something unintended
   (an attacker read data with it before you revoked it), treat that as
   scenario 1 (data leak) as well — a leaked read-only token still exposed
   whatever it could read.

## Also revoke the admin token if it may have leaked

The `ADMIN_TOKEN` environment variable gates every mutating route (see
`lib/util/http-security.ts`). If it leaks, anyone who has it can save/sync
connectors, submit or decide reviews, or create automations on this
instance until you change it. Set a new `ADMIN_TOKEN` value and restart the
server — there is no separate revoke step, since it's a single compared
value, not a database of issued tokens.
