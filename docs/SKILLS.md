# Brain skills

Project-owned skills live at `brain-sources/<source>/skills/<name>/SKILL.md`,
alongside the `_*-rules.md` policy files. They sync into the brain as pages, so a
scoped agent finds them with `gbrain search` (or a harness matches a request
against each skill's `triggers:` frontmatter via `RESOLVER.md`).

This is the OmniBrain "N skills per brain" idea — the recurring procedures a team
wants its agents to run against the brain, versioned in git and reviewable.

## Shared skills (`brain-sources/shared/skills/`)

| Skill | Triggers | What it does |
|---|---|---|
| `project-status` | "status of X", "案件の状況", "進捗を教えて" | Owner / stage / next action / overdue / decided-but-not-executed for one project, from Notion + Slack + Drive + meeting notes, every line cited |
| `weekly-digest` | "weekly digest", "what changed this week", "今週の動き" | What moved across scoped sources in the last N days, grouped by project, cited |
| `decision-log-audit` | "what did we decide but not do", "未実行の決定" | Decisions with no follow-up (no task / message / doc after), oldest first, cited |

All are `mutating: false` — read-only, cite-everything, never write pages or
touch source systems.

## Adding a skill

1. `brain-sources/shared/skills/<name>/SKILL.md` — frontmatter (`name`,
   `description`, `triggers`, `mutating`, `writes_pages`) + a procedure body.
   Reference the `_*-rules.md` files in the body.
2. Add a row to `brain-sources/shared/skills/RESOLVER.md`.
3. `git -C brain-sources/shared commit -am "skills: …"` then
   `gbrain sync --source shared`.

## Department skills

A department (`brain-sources/<dept>/skills/`) can add its own skills + resolver;
they take precedence for that department's agents. Example candidates:
`onboarding-new-hire` (HR), `customer-success-followup` (sales),
`decision-log-audit` (find decisions with no follow-up).

## Per-step receipts

The offline receipt layer in `lib/skills/receipt.ts` records a skill run's
effective scope and, for every step, its declared and observed source reads plus
start/end timestamps and an optional note. `verifyReceipt(run, skillReads)`
returns a new receipt and reports either of these access violations:

- an observed source is missing from the approved skill's frontmatter `reads:`;
- an observed source is missing from the scope's `federatedRead` set.

Both checks apply independently, so one read can produce both findings. The
input receipt is not mutated. `lib/skills/receipt-render.ts` turns the verified
receipt into stable Markdown with violations at the top and a ✓/✗ source list
for each step.

## Executing a skill

`parseSkill(markdown)` in `lib/skills/parse.ts` parses the reviewed identity,
description, triggers, declared reads, and numbered `## Procedure` steps.
Continuation lines within each numbered item stay with that instruction.

`runSkill(skill, opts)` in `lib/skills/run.ts` is the pure-testable executor. It
accepts a scope name, that scope's realised source IDs, and an injected step
runner. Before executing anything it applies the same all-required-sources rule
as the console via `grantsForScope`. A missing source refuses the whole run and
returns one explicit violation without calling the runner.

For a granted skill, each procedure step receives only the skill's declared
sources (all of which the scope grants). A step runner returns its text and the
source-prefixed pages it actually read, such as
`shared/notion/project-alpha`. The executor records the source prefix in a
`StepReceipt`, includes the returned text as the step note, and calls
`verifyReceipt` before returning the completed `SkillRunReceipt`.

`createLiveStepRunner()` in `lib/skills/run-live.ts` is the local implementation.
It uses the existing retrieve-then-extract pipeline one source at a time through
GBrain and Ollama, then returns exactly the pages supplied to the local model.
Keeping this adapter separate means parser, grant enforcement, sequencing, and
receipt verification remain offline-testable.

Inventory reviewed skills and their eligible configured scopes with:

```bash
omnibrain skills
```

The command is read-only and does not execute a skill or persist a receipt.
