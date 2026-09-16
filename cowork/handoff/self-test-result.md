# Self-test result — 2026-08-28

Ran the full pipeline on the developer's own Notion database
(`3ca943af75c88019a64bee683cb33662`, 3 rows).

## Works end-to-end, local only (option A)

| Step | Result |
|---|---|
| `npm run connectors:notion` | wrote 3 markdown files to `brain-sources/notion/<db>/` with provenance frontmatter |
| `git -C brain-sources init` + commit | ok (gbrain `sources add` requires a committed git repo) |
| `gbrain sources add notion --path .../brain-sources` | source created (federated:false — search with `--source notion`) |
| `gbrain sync --source notion` | 3 pages imported, 3 chunks, embedded with `ollama:bge-m3` |
| `gbrain query "campaign proposal"` | returns all 3 pages ranked. Local vector search ok |
| `gbrain think "..." --model ollama:qwen2.5:3b-instruct` | synthesised answer listing all 3 docs by title |

No hosted API calls. Nothing left the machine.

## Findings / caveats

1. **`gbrain think` defaults to `anthropic:claude-opus-4-7`** and skips synthesis
   with `NO_ANTHROPIC_API_KEY`. Must pass `--model ollama:<model>` for local synth.
   Worth wiring a default (config `chat_model` is NOT read by `think`).
2. **`ollama:qwen3.5:9b` times out** in `think`'s internal LLM-call budget on this
   hardware (cold 6.6 GB load). `ollama:qwen2.5:3b-instruct` (1.9 GB, pre-warmed
   with `keep_alive`) completes fast but emits `CITATIONS_REGEX_FALLBACK` — the
   small model doesn't produce gbrain's citation format. Citations: 0.
   → For cited synthesis: a mid-size local model kept warm, or option B (hosted).
3. **Connector reads page BODY blocks only, not database COLUMN/property values.**
   The dev's 3 rows are also empty Notion templates (identical placeholder body),
   so there is no real content to retrieve yet — only titles.
   → Fix: extend `collect.ts` to serialise row `properties` into the markdown.
   → And: dev should put real prose in a page and re-run for a meaningful test.

## Next connector improvement (before Slack)

`lib/connectors/notion/collect.ts` — in `toRecord`, also emit the page's
`properties` (select, multi_select, date, people, number, rich_text, checkbox,
relation, status) as a `## Properties` section or frontmatter, so database rows
carry their structured data into the brain.

---

## Re-run with real content — 2026-08-28 (PASS)

Developer replaced the 3 empty template rows with one real page
"Tako｜AIプロジェクト運用アシスタント" (substantive JA content: 概要 /
方向性の根拠（Liremヒアリング）/ Recommendations / 最初のPoC).

- `npm run connectors:notion -- --full` → wrote the 1 current row. (Stale .md
  files for the deleted rows had to be removed by hand — **connector does not
  prune deleted Notion pages**; add this to `run.ts`.)
- `gbrain sync --source notion` → `+1 added, -3 deleted` (gbrain DOES prune when
  the source file is gone). 1 page embedded.
- `gbrain think "Liremのヒアリングで分かった課題と、最初のPoCの入力・抽出項目"
  --model ollama:qwen2.5:3b-instruct` → **synthesised JA answer with 2 inline
  citations** pointing at the source page. Correctly pulled: PoC input = Slack
  messages + meeting memos; extract = 案件名 / 担当者 / 期限 / 決定事項 /
  未解決事項 / 次の行動; plus the list of items to verify in the next customer
  hearing.

Full local pipeline (connector → git source → sync → local embed → local synth
with citations) confirmed on the developer's own data. No hosted calls.

Quality: the 3b model's answer is slightly loose and emits
`CITATIONS_INLINE_NOT_IN_STRUCTURED`. A mid-size local model kept warm, a higher
`think` LLM timeout, or option B would tighten it.

## Connector backlog (before Slack)
1. Serialise Notion database row **properties** into the markdown (status, owner,
   dates, select, relation).
2. **Prune** `.md` files whose Notion page no longer appears in the pull.
3. `slugify` drops CJK titles entirely (file became `tako-ai-<id>.md`). Keep a
   transliteration or fall back to the id; frontmatter title is already correct.

---

## Slack connector — live PASS (2026-08-28)

- `npm run connectors:slack` against workspace "Hestia", channel `all-hestia`
  (bot `@aletheia_brain` invited) → wrote 1 thread file:
  `brain-sources/slack/all-hestia/<ts>.md` — real `chat.getPermalink` URL,
  resolved author "Khew Ai Ling", UTC timestamp, body "testing: we need to
  reframe of PoC".
- `gbrain sync --source notion` → `+1 added` (one source covers the whole
  brain-sources tree: notion/ + slack/).
- `gbrain think "PoCについてSlackとNotionに書かれていることをまとめて"
  --model ollama:qwen2.5:3b-instruct` → **Pages: 2, Citations: 2** — retrieved
  and cited BOTH the Slack thread and the Notion page in one answer. Local only.

Two connectors now feed one local brain with cross-source cited synthesis.
Quality still limited by the 3b model (muddled prose, structured-not-inline
citations). Next: local-notes connector, then person/entity resolution, then
saved questions. Slack archive/`--since` mode (threads older than lookback) is
deferred.

## Google Drive connector — live PASS (2026-08-28)

- OAuth Playground access token (`drive.readonly`) + folder ID in `config/connectors.json`.
  Folder-id input now tolerates `folders/<id>` and full URLs (`e0eb563b`).
  Google Slides added alongside Docs (`00a26ead`). PDF + DOCX still unsupported
  (need `unpdf` / `mammoth` — owner's first folder was all PDFs, switched folders).
- `npm run connectors:drive` → 1 Google Doc ("Izu Trip 2026") →
  `brain-sources/shared/drive/…md` with a real docs.google.com URL.
- `gbrain sync --source shared` + `embed --all` → shared brain now = Notion + Drive.
- `gbrain think --source shared "…Izu trip…" --model ollama:qwen2.5:3b-instruct`
  → Pages 2, cited the Drive doc, correct trip length ("4-day, 3-night").
- Gap: Drive connector has NO incremental cursor — re-pulls the full folder every run.

## Drive PDF/DOCX — live PASS (2026-08-29), slow

- `unpdf` (PDF) + `mammoth` (DOCX) on a folder of 8 Japanese lab reports.
- Extraction quality is good: DOCX keeps headings/bullets; PDF text is clean and
  technical (temps, RPM, formulas), with minor table-cell line-splitting.
- **Slow**: pdf.js takes ~30-60s per CID-font-heavy Japanese PDF; the
  `withTimeout` guard does NOT interrupt pdf.js's synchronous CPU work, so a
  large batch still runs for minutes. Mitigations in place: incremental write
  (each .md saved as ready) + `.drive-cursor.json` (re-runs skip done files).
- 6 PDF/DOCX pages synced into `shared` (now 8 pages, 100% embedded). Keyword
  search `"質量減少速度 発熱量"` returns the right PDF at 0.87.
- If PDF volume grows, swap `unpdf` for native `pdftotext` (poppler) — ~100x
  faster but a system dependency. Not needed yet.
