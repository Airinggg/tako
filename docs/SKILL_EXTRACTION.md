# Automatic skill extraction

OmniBrain's differentiator is "extract how work is done". This does the same,
with two guardrails from `_operating-rules.md`:

- **Local models only** (option A) — extraction runs on Ollama; no content leaves.
- **Drafts, never auto-published** — a human reviews and promotes each skill.

```bash
npm run skills:extract              # all department sources
npm run skills:extract -- shared    # one source
SKILLS_MODEL=qwen3.5:9b npm run skills:extract
```

## What it does

1. Reads each source's ingested Markdown under `brain-sources/<source>/`
   (excluding `skills/`), strips frontmatter.
2. Feeds up to ~24k chars to a local model asking for **recurring procedures** —
   a repeated sequence of steps a person/team carries out (not one-offs, not
   questions). Returns JSON.
3. Writes each proposal as a review-gated draft:
   `skill-drafts/<source>/<name>.md` — `status: draft`, `extracted_from`,
   `extracted_at`, the steps, and the evidence the model cited. `skill-drafts/`
   is gitignored (content-derived).

## Promoting a draft

Each draft's header lists the steps:

1. Check steps + triggers against reality; edit freely.
2. Move to `brain-sources/<source>/skills/<name>/SKILL.md`, drop `status: draft`.
3. Add a row to that source's `skills/RESOLVER.md`.
4. Commit the source repo, `gbrain sync --source <source>`.

## Quality notes

- `qwen2.5:3b-instruct` (default) works but is terse and sometimes returns a bare
  object or object-form steps — the parser flattens both. `qwen3.5:9b` is better
  when it doesn't time out (`SKILLS_MODEL=qwen3.5:9b`, expect minutes).
- Extraction only finds what's actually in the corpus. A brain of strategy docs
  and trip plans yields nothing — that's correct, not a failure. Ingest real
  team chat/process docs first.
- `lib/skills/extract.ts` (`mineSkills`, `ollamaModel`), `lib/skills/render-draft.ts`,
  `scripts/extract-skills.ts`. Offline tests: `tests/skills-extract.test.ts`.
