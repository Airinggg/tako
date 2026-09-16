You are Codex, continuing on branch `feat/brain-foundation`. Direction changed —
read `cowork/HANDOFF.md` (the "DIRECTION CHANGE" section) and `cowork/TASKBOARD.md`
first. Do ONLY the two tasks below, then STOP.

## Context in one line
The product surface is now gbrain's own admin SPA (`packages/brain/admin/`, served
by `gbrain serve --http` at `/admin`). The old `app/(projects)/` dashboard is
PARKED — do not touch it, do not delete it.

## Hard rules
- Security option A: no customer message content to any hosted API. Local only.
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before any `gbrain` command.
  Never touch `~/.gbrain/`.
- Do NOT edit vendored code under `packages/brain/` — including `packages/brain/admin/`.
  Building it (`bun run build` inside `admin/`) is fine; editing its source is not.
- `packages/brain/admin/dist/` IS a committed file in the vendored subtree. After
  you `bun run build`, the rebuild will show `dist/` as modified. Do NOT stage or
  commit that — run `git checkout -- packages/brain/admin/dist` to restore the
  vendored version once `serve` works. We only need the build to run locally.
- Do NOT touch `app/` routes. `npm run build` (repo root) must still pass before any commit.
- Commit after each task. Trailer: `Co-Authored-By: Codex <noreply@openai.com>`.
- If a step needs the network or a port your sandbox denies, do as much as you can,
  write down exactly what's blocked, and move on. Claude will finish live verification.

## TASK A — stand up gbrain's admin UI as the product surface
1. `cd packages/brain/admin && bun install && bun run build`  (SPA → `admin/dist/`).
2. Read `packages/brain/src/commands/serve-http.ts` and `serve.ts` for: the exact
   `gbrain serve --http` flags, the port, and how a login token for `/admin/login`
   is obtained (it's magic-link style — printed by serve, or a helper subcommand;
   find it, don't guess).
3. Try to run it:
   `cd packages/brain && GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts serve --http --port 8787`
   If it starts, open `http://localhost:8787/admin`, log in, and note which pages
   render (Dashboard, Agents, RequestLog, JobsWatch, Calibration) against our
   near-empty brain. If the sandbox blocks the port, say so.
4. Write `docs/CONSOLE_SETUP.md`:
   - build command, serve command, port, login-token steps
   - the list of admin pages and what each shows
   - the `/admin/api/*` endpoints (from `admin/src/api.ts`)
   - a note that rebranding is deferred and must be done by copying `admin/` →
     `apps/console/`, never by editing the vendored tree
5. `git add docs/CONSOLE_SETUP.md` + any non-vendored changes; commit. Tick task 1
   on `cowork/TASKBOARD.md`.

## TASK B — scoped endpoint per person
1. Read `packages/brain/src/commands/agent-register.ts`. Work out the flow to mint
   a scoped, read-only token for one named person (e.g. `lirem-aoki`) that their
   Claude Code / Codex / Cursor can plug into as an MCP endpoint.
   `cd packages/brain && GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts agent register --help`
2. If it can run locally without a hosted call, actually register one test agent
   and capture the printed copy-paste block. If it requires `gbrain serve --http`
   running as the host, note that dependency.
3. Append a "Scoped endpoints" section to `docs/CONSOLE_SETUP.md`: the exact
   command, what scopes to use (read-only for employees; never `admin` /
   `users_admin` / `sources_admin`), token TTL, and the resulting Claude Code
   config block.
4. Commit. Tick task 2. Write a 6-10 line summary to
   `cowork/handoff/codex-tasks-3-4-report.md`.

Then STOP. Do not start the Slack/Notion connectors (tasks 4-5 on the board).
