# For the next agent

Active work is on branch `feat/brain-foundation`: pivoting Tako into a
project-intelligence layer for the customer Lirem, built on a vendored GBrain
engine (`packages/brain/`, MIT).

**Start here:** [`cowork/HANDOFF.md`](cowork/HANDOFF.md) — full state, what's done,
your task queue.

Supporting docs:
- [`cowork/TASKBOARD.md`](cowork/TASKBOARD.md) — live checklist.
- [`cowork/handoff/brain-cookbook.md`](cowork/handoff/brain-cookbook.md) — gbrain commands for this project.
- [`docs/BRAIN_SETUP.md`](docs/BRAIN_SETUP.md) — how the local-model brain is set up.
- `cowork/handoff/case-state-contract.ts` — the frozen `ProjectBoard` type both sides build against.
- Design doc: `~/.gstack/projects/Airinggg-aletheia-ai-adoption-desk/2026-08-28-design-omnibrain-foundation.md`

Hard rules: security **option A** (no Lirem data to hosted APIs — local models
only); always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before `gbrain`; never
touch `~/.gbrain/`; don't edit vendored `packages/brain/`; leave the existing
`app/` routes (no route group) alone; `npm test` must complete with no new failures before each commit.

The pre-pivot Tako AI Adoption Desk remains in `app/` and is unchanged.
