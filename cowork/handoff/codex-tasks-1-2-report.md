# Codex tasks 1–2 report

- Task 1: checked the scoped dashboard code and its CSS variables against `app/globals.css`.
- The explicit missing-evidence label is now `根拠未取得` in all source-list fallbacks.
- `npm run build` passes and lists both `/projects` and `/projects/:caseId` routes.
- The sandbox blocked `npm run dev` before serving because its inspector cannot bind port 9229.
- The browser therefore could not open the two localhost routes; no route render errors were observed at build time.
- Task 2: mapped integration recipes, deterministic collectors, senses, reflexes, and recipe discovery.
- Decision: raw Slack/Notion messages remain in a local Tako store; derived entities are published to GBrain.
- `docs/BRAIN_CONNECTORS.md` provides the option-A connector specification for tasks 3–4.
- `cowork/TASKBOARD.md` marks tasks 1–2 complete; no hosted-data cross-request was required.
