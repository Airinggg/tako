# Codex tasks 1–2 report

- Read the direction change and kept the parked `app/(projects)/` surface untouched.
- Documented the vendored GBrain console build, local serve, login, pages, and SPA API surface.
- Confirmed `serve --http --port 8787` is the intended local command; it defaults to loopback.
- Bun's admin `bun install`/build was blocked here by its temp-directory permission denial.
- The non-interactive serve attempt exited without a usable persistent listener, so browser/page screenshots were not possible in this sandbox.
- Root `npm run build` passed after the documentation work.
- Confirmed `agent register` supports a locally minted, source-scoped `read` token with a 30-day default TTL.
- Documented the `lirem-aoki` Claude Code registration and paste-ready MCP command; no token was written to the repository.
- `.git/index.lock` creation is denied by this workspace sandbox, blocking both required commits despite otherwise ready changes.
