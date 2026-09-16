You are Codex, continuing a build on branch `feat/brain-foundation`. Claude has
handed off. Do ONLY tasks 1 and 2 from the queue, then STOP.

## Read first (in order)
1. `AGENTS.md`
2. `cowork/HANDOFF.md`  — full context and the task queue
3. `cowork/TASKBOARD.md`
4. `cowork/handoff/brain-cookbook.md`

## Hard rules (do not break)
- Security **option A**: no Lirem / customer message content to any hosted API.
  Local models only. If a task seems to need a hosted call, STOP and write it
  under "Cross-requests" in `cowork/TASKBOARD.md`.
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before any `gbrain` command.
  Never touch `~/.gbrain/` (developer's personal brain).
- Do NOT edit vendored code under `packages/brain/` (reading is fine).
- Do NOT touch existing `app/` routes that are not under `app/(projects)/`.
- `npm run build` must pass before every commit. Commit after each task with a
  clear message; end with `Co-Authored-By: Codex <noreply@openai.com>`.
- Do NOT start tasks 3+ (Slack/Notion connectors). Stop after task 2.

## TASK 1 — verify + fix the dashboard
The dashboard UI is already committed (`2ac53059`) under `app/(projects)/`.
- Start the dev server (`npm run dev`), open `/projects` and
  `/projects/c_lp_relaunch`.
- Confirm: it renders with the Tako visual system (rice-paper background,
  pine/sage/amber, Noto Sans JP), the four sections (遅延 / 対応漏れ /
  未実行の決定 / 停滞) populate from `sampleBoard`, and every claim row shows a
  `SourceRef` (channel + location + timestamp + excerpt) or an explicit
  "根拠未取得".
- Check the CSS variable names in `app/(projects)/_components/projects.module.css`
  actually resolve against `app/globals.css`. If any are wrong/missing, fix them
  (only inside `app/(projects)/`).
- Fix any render errors, hydration warnings, or broken layout — only inside
  `app/(projects)/`.
- Commit the fixes (if any). If nothing needed fixing, note that in
  `cowork/handoff/codex-tasks-1-2-report.md` and still tick task 1 on the taskboard.

## TASK 2 — map gbrain's connector / integration framework
No connector code yet. This task produces a decision doc.
- Explore: `bun packages/brain/src/cli.ts integrations --help` and
  `... integrations list` (from `packages/brain/`, with `GBRAIN_HOME` set).
- Read: `packages/brain/src/core/` for `integration`, `sense`, `reflex`,
  `recipe`; `packages/brain/docs/` (start at `llms.txt` / `llms-full.txt`);
  `packages/brain/recipes/`.
- Write `docs/BRAIN_CONNECTORS.md` covering:
  - The sanctioned way to add a data source to gbrain (the "senses/reflexes" or
    integration-recipe mechanism), with the exact file/dir layout an integration
    lives in and how gbrain discovers it.
  - Whether an integration can run fully local (no hosted calls) — required for
    option A.
  - **The decision:** for Lirem messages, do we (a) write each message as a
    gbrain page under `messages/<tool>/<channel>/<ts>` and let the graph extract
    entities, or (b) keep raw messages in our own store and only push extracted
    case/task/decision entities into gbrain? Recommend one, with reasons
    (dedup, re-processing, privacy, volume, how detectors query it).
  - How the Slack and Notion connectors (tasks 3–4) should be structured given
    the above — a short spec the next session can implement directly.
- Update `cowork/TASKBOARD.md`: tick tasks 1 and 2, add any Cross-requests.
- Commit `docs/BRAIN_CONNECTORS.md` + taskboard.
- Write a 6–10 line summary to `cowork/handoff/codex-tasks-1-2-report.md`.

Then STOP. Do not continue to task 3.
