# cowork/ — Claude + Codex parallel build

Two agents building the project-intelligence layer on the `feat/brain-foundation`
branch at the same time. This folder is the coordination surface.

## Ground rules (avoid stepping on each other)

- **Claude owns:** `packages/brain/` config, `lib/`, `worker/`, `app/(brain)/`,
  connectors, extraction, real data layer, this `cowork/` folder.
- **Codex owns:** `app/(projects)/` (the dashboard UI) and
  `app/(projects)/_mock/` (fixture data). Nothing else.
- Neither agent edits the other's paths. If you need a change on the other side,
  write it in `TASKBOARD.md` under "Cross-requests".
- The contract between the two sides is `cowork/handoff/case-state-contract.ts`.
  Codex builds against it. Claude fills it with real data later. Do not change
  the exported type shape without noting it in `TASKBOARD.md`.
- Existing Tako app under `app/` (no route group) is **untouched** by both.
- Run `npm run build` before handing back. Keep it green.

## Status

See `TASKBOARD.md`.
