/**
 * Grounded-QA eval — runs a hand-labelled question set against the LIVE brain
 * (real ingested data, not synthetic fixtures) and writes a scored report.
 *
 *   npm run eval:qa -- discord-real
 *   npm run eval:qa -- discord-real --source engineering --model qwen2.5:3b-instruct
 *
 * Auto-scores what is mechanical (citation hit, groundedness, refusal). The
 * answer-correctness verdict is left blank for a human to fill in the report.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { answerFromSource, citedSlugs, gbrainHome } from "../lib/eval/qa.ts";

type Question = {
  id: string; question: string;
  expected_answer: string; expected_sources: string[]; notes?: string;
};

const suite = process.argv[2];
if (!suite || !/^[a-z0-9][a-z0-9_-]*$/i.test(suite)) {
  console.error("Usage: npm run eval:qa -- <suite>   (e.g. discord-real)");
  process.exit(2);
}
const flag = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const source = flag("source", "engineering");
const model = flag("model", process.env.ASK_MODEL || "qwen2.5:3b-instruct");

const repoRoot = resolve(import.meta.dir, "..");
const suiteDir = join(repoRoot, "evals", suite);
const questions: Question[] = (await readFile(join(suiteDir, "questions.jsonl"), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

// normalise a slug so "discord/engineering/discord/general/..." and
// "discord/general/..." compare equal — labels may carry the source prefix.
const tail = (s: string) => s.replace(/^.*?\bdiscord\//, "discord/").replace(/^.*?\bslack\//, "slack/");
const REFUSAL = /\b(no pages|do not|don't|cannot|can't|not (?:enough|available|found)|no (?:information|evidence|mention))\b/i;

console.log(`eval:qa "${suite}"  source=${source}  model=${model}  GBRAIN_HOME=${gbrainHome()}\n`);

const rows: string[] = [];
let citeHits = 0, grounded = 0, refusals = 0;
const latencies: number[] = [];

for (const q of questions) {
  process.stdout.write(`  ${q.id} … `);
  let r;
  try {
    r = await answerFromSource(q.question, source, { model, topK: 3 });
  } catch (err) {
    console.log(`ERROR ${(err as Error).message}`);
    rows.push(`| ${q.id} | ${q.question} | **ERROR** — ${(err as Error).message} | | | | |`);
    continue;
  }
  latencies.push(r.ms);
  const cited = citedSlugs(r.answer).map(tail);
  const want = q.expected_sources.map(tail);
  const citeHit = want.some((w) => cited.includes(w) || r.pages.map(tail).includes(w));
  const isGrounded = cited.length === 0 || cited.every((c) => r.pages.map(tail).includes(c));
  const refused = REFUSAL.test(r.answer) && r.answer.length < 240;
  if (citeHit) citeHits++;
  if (isGrounded) grounded++;
  if (refused) refusals++;
  console.log(`${r.ms}ms  cite:${citeHit ? "hit" : "miss"}  ${isGrounded ? "grounded" : "UNGROUNDED"}${refused ? "  refused" : ""}`);

  const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
  rows.push(
    `| ${q.id} | ${oneLine(q.question)} | ${oneLine(r.answer)} | ${oneLine(q.expected_answer)} | ` +
    `${want.join("<br>")} | ${(cited.length ? cited : r.pages.map(tail)).join("<br>")} | ` +
    `${citeHit ? "✅" : "❌"} / ${isGrounded ? "✅" : "❌"} / _?_ |`,
  );
}

const pct = (n: number) => `${n}/${questions.length} (${(100 * n / questions.length).toFixed(0)}%)`;
const p = (arr: number[], q: number) => arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(q * arr.length))] : 0;

const report = `# Grounded-QA eval: ${suite}

Run against the **live brain** (\`GBRAIN_HOME=${gbrainHome()}\`, source \`${source}\`),
local models only. Model: \`${model}\`. Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z.

This suite tests retrieval grounding and citation on real, messy, multilingual
team chat — a different axis from \`evals/synthetic\` (structured project-status
extraction on invented data).

## Metrics (mechanical)

| Metric | Value |
| --- | ---: |
| Citation hit (an expected source is cited or retrieved) | ${pct(citeHits)} |
| Grounded (no citation to a page not retrieved) | ${pct(grounded)} |
| Refusals (model declined to answer) | ${pct(refusals)} |
| Latency p50 | ${p(latencies, 0.5)} ms |
| Latency p95 | ${p(latencies, 0.95)} ms |

**Answer correctness is scored by hand** — fill the third slot of the last column
(\`✅ / ✅ / ?\` → \`… / … / ✅|➗|❌\`) after reading each row. ➗ = partially correct.

## Results

| id | question | model answer | expected | expected sources | cited / retrieved | cite / grounded / correct |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Notes per question

${questions.map((q) => `- **${q.id}** — ${q.notes ?? "(none)"}`).join("\n")}

## Limitations

Ten questions over four days of one Discord channel plus two hearing threads is a
smoke test, not an accuracy claim. The corpus is the team's own operational
chatter (code-switching EN/JA/ZH, emoji, quoted emails); results will differ on
customer project docs. Latency is dominated by local-model cold start on the
first call. Citation-hit counts a retrieved-but-uncited source as a hit because
the ${model} answers often drop the bracketed slug even when grounded.
`;

await writeFile(join(suiteDir, "report.md"), report);
console.log(`\nwrote ${join("evals", suite, "report.md")}`);
console.log(`cite-hit ${pct(citeHits)} · grounded ${pct(grounded)} · refusals ${pct(refusals)} · p50 ${p(latencies, 0.5)}ms`);
