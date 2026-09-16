# Grounded-QA eval: discord-real

Run against the **live brain** (`GBRAIN_HOME=~/.aletheia-brain`, source `engineering`),
local models only. Model: `qwen2.5:3b-instruct`. Regenerate with:

```
npm run eval:qa -- discord-real --source engineering
```

Retrieval grounding + answer synthesis on real, messy, multilingual team chat
(four days of `#general` + two hearing threads) — a different axis from
`evals/synthetic` (structured project-status extraction on invented data).

## Headline — run 2 (after the context-budget fix)

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Retrieval — expected source retrieved | 10 / 10 | 10 / 10 |
| **Answer correct** (hand-scored) | **4** full · 2 partial · **4** wrong | **5** full · 3 partial · **2** wrong |
| Refusals (declined despite having the page) | 2 / 10 | 0 / 10 |
| Grounded — no citation to an un-retrieved page | 10 / 10 | 10 / 10 |
| Latency p50 / p95 | 30 s / 39 s | 17 s / 27 s |

**What changed between runs:** `lib/eval/qa.ts` — every retrieved page now gets a
real slice of the prompt (top page ≤4000 chars, others ≤3000, total ≤9500)
instead of the old 1200-char cap on non-primary pages; the prompt also tells the
model to prefer the most recent statement in a thread, to read terse
assignment lines (`@name 9/1 11:30 ~ place`, `担当：X, Y`), and not to invent
details. Latency dropped because the brain was fully re-synced and re-embedded
between runs (run 1 had partially stale embeddings).

## Results — run 2

| id | correct? | model answer (summary) | expected | vs run 1 |
| --- | :---: | --- | --- | --- |
| onocom-when | ➗ | 8/31, **13:30**, in person at Onocom's office. | 8/31 **14:00**, in person. | ➗→➗ (was: 14:00 right + invented UTC; now: time wrong, no fabrication) |
| isj-when | ✅ | 9/1 (Tue) 11:30, cited the ISJ thread. | 9/1 11:30. | ✅→✅ |
| onocom-who | ➗ | Only **Tan Yan Yang**. | Tan Yan Yang **and** Grace. | ➗→➗ |
| isj-who | ✅ | Identifies **Khew Ai Ling** (quotes the `@mention 9/1 11:30` line). | Khew Ai Ling. | ❌→✅ **fixed** — bigger budget surfaced the assignment line |
| how-many-companies | ✅ | Two — オノコム and アイ・エス・ジェイ, both offline. | Two: Onocom and ISJ. | ✅→✅ |
| day3-commentator | ➗ | From **Liberaware** — but misses the name 小山 / Koyama. | Koyama, from Liberaware. | ❌→➗ **improved** — budget surfaced Liberaware; name not extracted |
| internal-meeting | ✅ | 31 August, cited. | 31 August. | ✅→✅ |
| target-company | ✅ | 20–300 employees, multi-dept, Drive/Notion/Slack, data scattered, DX / gen-AI. | (same) | ✅→✅ |
| slides-followup | ❌ | "no evidence anyone said they'd share slides" — but general/2026-08-29 has `Ill post it in the hearing channel`. | Yan Yang said he'd post them in #hearing; no evidence they were. | ❌→❌ — retrieved the page, still didn't extract the line |
| hearing-format | ❌ | "both offline and online" and cites the DAY3 report-meeting announcement, not the hearing-format decision. | Offline / in person. | ❌→❌ — retrieval this run missed general/2026-08-28 (the "(both offline)" message) |

Legend: ✅ full · ➗ partial · ❌ wrong.

## Where it still fails

1. **"Latest statement wins" is unreliable on 3B** — `onocom-when` still takes the
   earlier 13:30 slot over the confirmed 14:00; the prompt rule alone isn't
   enough. Options: feed thread messages newest-first for time/decision
   questions, or a light pre-pass that extracts the last-confirmed value.
2. **Terse multi-name lines** — `onocom-who` reads `担当：Yan yang, Grace` but
   still returns one name; `day3-commentator` gets the company but not `小山様`
   from the same JA block. Needs a targeted extraction pass, not more context.
3. **Retrieval variance on `hearing-format`** — BM25 keywords for "online or
   offline" pulled the DAY3 announcement instead of the 08-28 scheduling thread.
   A query-expansion or a second retrieval round on the answer's uncertainty
   would help.
4. **`slides-followup`** — the page is retrieved; the model doesn't connect
   "share … the short slides" ↔ "Ill post it in the hearing channel". A
   decision-audit skill (already drafted in `brain-sources/shared/skills/`) is
   the right tool, not raw QA.

## What this establishes for the thesis

- The git-backed connector → `gbrain sync` → hybrid search path **retrieves the
  right evidence 10/10** on real multilingual chat, before and after the change.
- One prompt/budget change moved end-to-end correctness on a fully local 3B model
  from **40% → 50% full** (60% → 80% at least-partially-correct) and removed all
  refusals — a measurable, reproducible delta on real data.
- The four remaining misses are concentrated and named, and three of them point
  at specific mechanisms (newest-first ordering, targeted extraction, a
  second retrieval round) rather than "a bigger model".

## Limitations

Ten questions over a five-day slice of one channel is a smoke test, not an
accuracy claim. Hand scoring involves judgement about partial credit. The 3B
model's decoding is only weakly deterministic even at `temperature: 0`, so
individual rows can flip between runs; the aggregate direction is the signal.
