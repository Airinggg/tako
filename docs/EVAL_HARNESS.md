# Evaluation harness (STAPS thesis contribution)

Measures: does the local-only brain recover project state from scattered tools,
with cited answers? Config-driven so it runs on a synthetic set now and Lirem's
real data later.

## Layout

```
evals/
  <dataset>/
    labels.jsonl        # hand-labelled ground truth, one project per line
    config.json         # { "source": "shared", "model": "qwen2.5:3b-instruct" }
    fixtures/           # (synthetic dataset only) brain-source .md the runner seeds
    report.md           # generated
lib/eval/
  score.ts             # pure scoring functions (unit-tested, no I/O)
  run.ts               # orchestrates: for each label -> run skills/think -> collect
scripts/eval.ts        # CLI: npm run eval -- <dataset>
```

## `labels.jsonl` — one JSON object per line

```jsonc
{
  "project": "コーポレートサイト リニューアル",
  "owner": "青木",
  "stage": "in_progress",                       // not_started|in_progress|blocked|review|done
  "overdue": ["全ページのワイヤーフレーム"],
  "dropped": ["トップページのコピー案"],
  "decided_not_executed": ["CMSはNotion連携で進める"],
  "sources": ["notion/…/lirem-site", "slack/lirem-web/…"]  // where each fact lives
}
```

## Runner (`lib/eval/run.ts`, `scripts/eval.ts`)

For each label:
1. Ask `project-status` for `<project>` (build the prompt from the skill's
   procedure; call `gbrain think --source <cfg.source> --model <cfg.model>`).
2. Ask `decision-log-audit` (scoped) and `weekly-digest` where relevant.
3. Parse the answer into `{owner, stage, overdue[], dropped[], decided_not_executed[]}`
   plus the list of `[source]` citations it emitted.
4. Record raw answer + parsed + citations + latency_ms.

Local models only. `export GBRAIN_HOME="$HOME/.aletheia-brain"`. No hosted calls.

## Scorer (`lib/eval/score.ts` — pure, unit-tested)

| Metric | Definition |
|---|---|
| owner_accuracy | normalized-equal(pred, gold) over projects |
| stage_accuracy | exact match |
| overdue_precision / recall | set overlap, item text normalized (trim, lowercase, JA/EN tolerant) |
| dropped_recall | recall (the Lirem-critical metric) |
| decided_not_executed_recall | recall |
| grounding | fraction of surfaced items whose citation resolves to a real page slug in the brain (target: 1.0 — zero hallucinated citations) |
| latency_p50 / p95 | ms per project |

Normalization helper: `norm(s)` = NFKC, trim, collapse spaces, lowercase.
Fuzzy item match: exact after `norm`, else Dice-coefficient >= 0.8.

## Report (`report.md`)

- The metric table.
- Per-project: gold vs predicted, diffs highlighted, citations listed.
- A limitations paragraph (model size, PDF speed, label subjectivity, dataset size).

## Datasets

- `evals/synthetic/` — invented projects + `fixtures/*.md` the runner seeds into a
  scratch `GBRAIN_HOME` (so `npm test`-able, no real data). Build this first.
- `evals/hestia/` — owner's own team (Discord/Slack + Notion). Dev iteration.
- `evals/lirem/` — the thesis result. Needs Lirem access.

## Baseline result — synthetic set, qwen2.5:3b (2026-08-29)

Local-only, retrieve-then-extract (`gbrain search` → `gbrain get` top 8 →
`ollama /api/generate`), 7 bilingual synthetic projects. Full report:
`evals/synthetic/report.md`.

| Metric | Value |
| --- | ---: |
| owner_accuracy | 1.000 |
| stage_accuracy | 1.000 |
| overdue_precision / recall | 0.667 / 0.800 |
| dropped_recall | 0.800 |
| decided_not_executed_recall | 0.600 |
| grounding | 0.841 |
| latency p50 / p95 | 49 s / 87 s per project (2 model calls) |

Read: with the right pages in front of it, a 3B model nails owner + stage and
gets 60-80 % recall on the list dimensions; ~16 % of surfaced items cite a page
that doesn't resolve. Next comparisons: `qwen3.5:9b` (set `model` in
`config.json`), then a hosted model — and re-label on real Discord/Notion, then
Lirem data.

## Model comparison — synthetic set, 3b vs 9b (2026-08-29)

| Metric | qwen2.5:3b-instruct | qwen3.5:9b (think:false) |
| --- | ---: | ---: |
| owner_accuracy | 1.000 | 1.000 |
| stage_accuracy | 1.000 | 1.000 |
| overdue_precision / recall | 0.667 / 0.800 | 0.500 / 0.600 |
| dropped_recall | 0.800 | 0.400 |
| decided_not_executed_recall | 0.600 | 0.600 |
| grounding | 0.841 | 0.891 |
| latency p50 / p95 | 49 s / 87 s | 163 s / 326 s |

**Finding:** on this structured extraction task the smaller **instruct** model
beats the larger **reasoning** model on list recall, at ~3x lower latency. Only
grounding nudged up. Likely because `think:false` (forced to avoid fetch
timeouts) hobbles a model built to reason; a non-reasoning instruct model is in
its element here.

Caveats: n=7 projects (noisy); the 9b was NOT run with reasoning enabled (a fair
9b comparison needs `think:true` + minutes-per-call latency); no hosted-model
column yet. Reports: `evals/synthetic/report.md`, `evals/synthetic-9b/report.md`.

## Fair 9b-reasoning run — NOT FEASIBLE on this hardware (2026-08-29)

Attempted `qwen3.5:9b` with `think:true` (the fair comparison to `think:false`).
A single reasoning call on a *trivial* prompt did not return within **15
minutes** (exit 124), producing no output. With real 8-page prompts × 14 calls
this is >3.5 h and unreliable.

**Finding:** reasoning-model inference at 9B is not viable for an interactive
project-status tool on this machine. The `think:false` 9b run (163 s p50, already
3x the 3b) is the practical ceiling for local. The meaningful remaining
comparison is a **hosted model** — which is also the option-B decision the thesis
must make (local-only quality vs a hosted model with the customer's written
consent). Run that as the third column: set `evals/<dataset>/config.json` model
to a hosted id and provide the key in the environment (the harness strips hosted
keys from child processes by default — a hosted run needs that guard relaxed for
the model call only, and the run explicitly labelled as option B).

The `config.think` toggle and `synthetic-9b-reasoning` dataset stay in the repo
for a future run on faster hardware.
