# Agent orientation — Tako

This is the standalone [`Airinggg/tako`](https://github.com/Airinggg/tako)
repository. Active development is on `main`. It was split from the earlier
Aletheia monorepo; there is no `app/` directory or parked prototype in this
repository.

## Start here

- [`README.md`](README.md) — product, setup and security posture.
- [`cowork/HANDOFF.md`](cowork/HANDOFF.md) — current implementation state and
  known open work.
- [`docs/BRAIN_SETUP.md`](docs/BRAIN_SETUP.md) — local Ollama/gbrain setup.
- [`docs/BRAIN_CONNECTORS.md`](docs/BRAIN_CONNECTORS.md) — connector model.
- [`docs/PROTOTYPE_SECURITY_CHECKLIST.md`](docs/PROTOTYPE_SECURITY_CHECKLIST.md)
  and [`docs/audit/`](docs/audit/) — launch gates and evidence.

## Repository rules

- Customer content stays on customer-controlled infrastructure and is processed
  by local models only. Do not introduce hosted-model or telemetry data flows.
- Set `GBRAIN_HOME="$HOME/.aletheia-brain"` for gbrain commands. Never operate
  on `~/.gbrain/`.
- `packages/brain/` is vendored gbrain. Build around it; do not casually modify
  vendored code.
- Keep connectors config-driven and read-only. Never commit tokens, synced
  customer content, local databases or generated credentials.
- Run `npm test` before every commit. Two known failures are currently tracked
  as GitHub issues #1 and #2; do not introduce additional failures.
- Use small, focused commits and reference the corresponding GitHub issue.

## Common commands

```bash
./bin/omnibrain doctor
./bin/omnibrain setup
npm run demo
npm test
```

The Bun demo server listens on `127.0.0.1:4400` by default. Treat it as a
single-instance, customer-controlled deployment; it is not a serverless app.
