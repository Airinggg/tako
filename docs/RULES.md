# Brain rules (`_*-rules.md`)

Convention files at `brain-sources/<source>/skills/`, following the gbrain
company-brain tutorial (Part 7). They are the de-facto policy every agent and
skill reads before working against the brain. Edit one, commit, `gbrain sync` —
every agent picks it up on the next request.

They are synced into the brain as ordinary pages (`title`, `source: policy`
frontmatter), so an agent can `gbrain search "operating rules"` and find them.

## The files (in `brain-sources/shared/skills/`)

| File | Covers |
|---|---|
| `_operating-rules.md` | Security (option A — local models only), human-in-the-loop for anything external, `$GBRAIN_HOME` isolation, scope discipline |
| `_output-rules.md` | Cite every claim, deterministic links only, say what's unknown, plain language, page shape |
| `_brain-filing-rules.md` | Where an **agent-authored** page belongs (people/ companies/ projects/ meetings/ concepts/ decisions/) — first match wins |
| `_excluded-people.md` | Privacy gate: names never to reference in output, even when present in a scoped source |
| `_connector-rules.md` | Per-source (Slack / Notion / Drive / notes) conventions for reading connector output |

## Where they live

`shared/skills/` because the `shared` source is readable by every scoped client.
A department that needs stricter rules can add its own
`brain-sources/<dept>/skills/_*-rules.md`; department rules override shared ones
for that department's agents.

## Adding a rule

1. Edit the relevant `_*-rules.md` (or add a new `_<topic>-rules.md`).
2. `git -C brain-sources/shared commit -am "rules: …"`
3. `cd packages/brain && GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts sync --source shared`

## Enforcement

These are conventions the agent is expected to follow, not hard controls. The
hard guarantees are:

- **Source scoping** (`--source` / `--federated-read`) — DB-enforced, see `docs/MULTI_BRAIN.md`.
- **Read-only connectors** — nothing writes back to the source systems.
- **Local-only models** — no hosted API in the pipeline.
