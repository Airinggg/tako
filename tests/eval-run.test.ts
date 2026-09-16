import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertScratchBrainHome, buildDecisionAuditQuestion, buildProjectStatusQuestion, localOnlyEnvironment, parseDecisionAudit, parseProjectStatus, runEvaluation } from "../lib/eval/run.ts";

const statusAnswer = `Owner: 佐藤 [notion/projects/sakura-portal]\nStage: in_progress [notion/projects/sakura-portal]\nOverdue:\n- モバイル画面のワイヤーフレーム [notion/projects/sakura-portal]\nDropped:\n- 紙の申込書を残す案 [notion/projects/sakura-portal]\nDecided, not executed:\n- 検索基盤はMeilisearchを採用する [slack/product/1754000001]`;
const auditAnswer = `Stranded decisions (no follow-up found):\n- 検索基盤はMeilisearchを採用する [slack/product/1754000001]`;

test("questions encode the two skill procedures and strict output shapes", () => {
  assert.match(buildProjectStatusQuestion("案件A"), /"案件A"/);
  assert.match(buildProjectStatusQuestion("案件A"), /Dropped:/);
  assert.ok(!buildProjectStatusQuestion("案件A").includes("\n"), "question must be one line");
  assert.match(buildDecisionAuditQuestion("案件A"), /Stranded decisions/);
});

test("parses project status values, item citations, and audit decisions", () => {
  const parsed = parseProjectStatus(statusAnswer);
  assert.equal(parsed.state.owner, "佐藤");
  assert.deepEqual(parsed.state.dropped, ["紙の申込書を残す案"]);
  assert.deepEqual(parsed.citations.sort(), ["notion/projects/sakura-portal", "slack/product/1754000001"]);
  assert.equal(parseDecisionAudit(auditAnswer)[0].value, "検索基盤はMeilisearchを採用する");
});

test("ignores the echoed question line and the Model: footer (real gbrain think shape)", () => {
  const raw = [
    `# ${buildProjectStatusQuestion("さくら市民ポータル")}`,        // gbrain echoes the one-line question as a "# …" heading
    "Owner: 佐藤 [notion/projects/sakura-portal]",
    "Stage: in_progress [notion/projects/sakura-portal]",
    "Overdue:",
    "- モバイル画面のワイヤーフレーム [slack/product/1754000001]",
    "Dropped:",
    "- None",
    "",
    "---",
    "Model: ollama:qwen2.5:3b-instruct | Pages: 2",
  ].join("\n");
  const parsed = parseProjectStatus(raw);
  assert.equal(parsed.state.owner, "佐藤");
  assert.equal(parsed.state.stage, "in_progress");
  assert.deepEqual(parsed.state.overdue, ["モバイル画面のワイヤーフレーム"]);
  assert.deepEqual(parsed.state.dropped, []);                     // "None" is not an item
  assert.deepEqual(parsed.citations.sort(), ["notion/projects/sakura-portal", "slack/product/1754000001"]);
});

test("runner invokes status and audit and merges duplicate decisions", async () => {
  const scratch = join(tmpdir(), "tako-eval-offline-test");
  const calls: string[] = [];
  const result = await runEvaluation([{
    project: "さくら市民ポータル", owner: "佐藤", stage: "in_progress",
    overdue: ["モバイル画面のワイヤーフレーム"], dropped: ["紙の申込書を残す案"],
    decided_not_executed: ["検索基盤はMeilisearchを採用する"], sources: ["notion/projects/sakura-portal"],
  }], { source: "synthetic", model: "qwen2.5:3b-instruct" }, scratch, async (question, _project) => {
    calls.push(question);
    return question.includes("decision-log-audit") ? auditAnswer : statusAnswer;
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result[0].predicted.decided_not_executed, ["検索基盤はMeilisearchを採用する"]);
  assert.ok(result[0].latency_ms >= 0);
});

test("persistent brain homes are rejected", () => {
  assert.throws(() => assertScratchBrainHome(join(process.env.HOME!, ".gbrain")));
  assert.throws(() => assertScratchBrainHome(join(process.env.HOME!, ".aletheia-brain")));
});

test("hosted provider credentials are removed from evaluation children", () => {
  const env = localOnlyEnvironment({ OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", OLLAMA_HOST: "127.0.0.1" });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OLLAMA_HOST, "127.0.0.1");
});
