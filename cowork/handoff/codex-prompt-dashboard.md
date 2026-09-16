You are Codex, co-working with Claude on the `feat/brain-foundation` branch of
this repo (a Next.js app). Claude is building the data/brain layer in parallel.
Your job is ONE thing: the project-status dashboard UI.

## Read first
- `cowork/README.md` — ground rules.
- `cowork/TASKBOARD.md` — the "Codex (assigned)" section is your spec. Follow it exactly.
- `cowork/handoff/case-state-contract.ts` — the TypeScript contract. Import types
  from `@/cowork/handoff/case-state-contract`. Use its exported `sampleBoard` as
  the only data source.
- `app/globals.css` and `app/about/page.tsx` — match this visual system and JA-first tone.

## Hard boundaries (do not cross)
- Only create/edit files under `app/(projects)/`. Nothing else. Do NOT touch
  `packages/brain/`, `lib/`, `worker/`, `cowork/`, or any existing `app/` route.
- Do NOT run `git commit`, `git push`, or `git checkout`. Leave changes in the
  working tree. Claude handles commits.
- No new dependencies. Use what's already in `package.json`.
- Do NOT fetch data, import from `packages/brain`, or add API routes. Fixture only.

## Deliverable
- `app/(projects)/projects/page.tsx` — board overview: all cases most-recent-first,
  with owner, stage, next action, and four filtered sections: 遅延 (overdue),
  対応漏れ (dropped tasks), 未実行の決定 (decided-not-executed), 停滞 (stale).
- `app/(projects)/projects/[caseId]/page.tsx` — one case in full: tasks,
  decisions, and every `SourceRef` shown inline (channel, location, timestamp,
  excerpt). No claim without its source. This is a hard product rule.
- Any components under `app/(projects)/_components/`.
- Japanese-first UI text. Tap targets >= 44x44 px. Respect `prefers-reduced-motion`.
- `npm run build` must pass. Then tick the Codex checkbox in `cowork/TASKBOARD.md`
  (this is the one file outside your boundary you may edit, checkbox only) and
  write a 5-line summary of what you built to `cowork/handoff/codex-report.md`.

Work fast. Ask nothing. If the contract is ambiguous, pick the reading that keeps
`npm run build` green and note it in `codex-report.md`.
