import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { assertScratchBrainHome, localOnlyEnvironment, runEvaluation, type EvalConfig, type EvalLabel } from "../lib/eval/run.ts";
import { scoreMetrics, type EvalMetrics } from "../lib/eval/score.ts";

const dataset = process.argv[2];
if (!dataset || !/^[a-z0-9][a-z0-9_-]*$/i.test(dataset)) {
  console.error("Usage: npm run eval -- <dataset>");
  process.exit(2);
}

const repoRoot = resolve(import.meta.dir, "..");
const datasetDir = join(repoRoot, "evals", dataset);
const fixtureDir = join(datasetDir, "fixtures");
const config: EvalConfig = JSON.parse(await readFile(join(datasetDir, "config.json"), "utf8"));
const labels: EvalLabel[] = (await readFile(join(datasetDir, "labels.jsonl"), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const scratchHome = await mkdtemp(join(tmpdir(), "tako-eval-"));
assertScratchBrainHome(scratchHome);

async function gbrain(args: string[]): Promise<void> {
  assertScratchBrainHome(scratchHome);
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(repoRoot, "packages/brain"),
    env: { ...localOnlyEnvironment(), GBRAIN_HOME: scratchHome },
    stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`gbrain ${args[0]} failed with exit ${exitCode}`);
}

async function fixtureSlugs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.filter((entry) => entry.endsWith(".md"))
    .map((entry) => relative(dir, join(dir, entry)).split(sep).join("/").replace(/\.md$/, ""));
}

function mdList(values: readonly string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("<br>") : "—";
}

function report(metrics: EvalMetrics, results: Awaited<ReturnType<typeof runEvaluation>>): string {
  const rows = Object.entries(metrics).map(([metric, value]) => `| ${metric} | ${metric.startsWith("latency_") ? `${value} ms` : value.toFixed(3)} |`).join("\n");
  const projects = results.map((result) => {
    const exact = result.gold.owner === result.predicted.owner && result.gold.stage === result.predicted.stage &&
      JSON.stringify(result.gold.overdue) === JSON.stringify(result.predicted.overdue) &&
      JSON.stringify(result.gold.dropped) === JSON.stringify(result.predicted.dropped) &&
      JSON.stringify(result.gold.decided_not_executed) === JSON.stringify(result.predicted.decided_not_executed);
    const mismatches = exact ? "No exact field differences." : "**Gold and prediction differ; inspect the fields below.**";
    return `### ${result.project}\n\n${mismatches}\n\n| Field | Gold | Predicted |\n| --- | --- | --- |\n| Owner | ${result.gold.owner} | ${result.predicted.owner || "—"} |\n| Stage | ${result.gold.stage} | ${result.predicted.stage || "—"} |\n| Overdue | ${mdList(result.gold.overdue)} | ${mdList(result.predicted.overdue)} |\n| Dropped | ${mdList(result.gold.dropped)} | ${mdList(result.predicted.dropped)} |\n| Decided, not executed | ${mdList(result.gold.decided_not_executed)} | ${mdList(result.predicted.decided_not_executed)} |\n\nCitations: ${result.citations.length ? result.citations.map((citation) => `\`${citation}\``).join(", ") : "none"}\n\n<details><summary>Raw local-model answers</summary>\n\n\`\`\`text\n${result.raw_answer}\n\n--- decision-log-audit ---\n${result.audit_answer}\n\`\`\`\n</details>\n`;
  }).join("\n");
  return `# Evaluation report: ${dataset}\n\nGenerated with local Ollama models in an ephemeral GBrain home.\n\n## Metrics\n\n| Metric | Value |\n| --- | ---: |\n${rows}\n\n## Projects\n\n${projects}\n## Limitations\n\nThis small synthetic dataset cannot establish production accuracy. Results depend on the configured local model size and decoding behavior; PDF extraction can add substantial latency; labels involve judgment about task equivalence and whether follow-up is sufficient; and seven invented projects do not represent the language, ambiguity, or source distribution of real customer work.\n`;
}

try {
  const model = config.model.startsWith("ollama:") ? config.model : `ollama:${config.model}`;
  await gbrain(["init", "--pglite", "--non-interactive", "--embedding-model", "ollama:bge-m3", "--embedding-dimensions", "1024", "--expansion-model", model, "--chat-model", model]);
  await gbrain(["config", "set", "search.reranker.enabled", "false"]);
  await gbrain(["sources", "add", config.source, "--path", fixtureDir, "--name", `${dataset} evaluation fixtures`]);
  await gbrain(["sync", "--source", config.source, "--no-embed", "--no-pull"]);
  await gbrain(["embed", "--all"]);
  const knownSlugs = await fixtureSlugs(fixtureDir);
  const results = await runEvaluation(labels, config, scratchHome);
  const metrics = scoreMetrics(results, knownSlugs);
  await writeFile(join(datasetDir, "report.md"), report(metrics, results));
  console.log(`wrote ${join(datasetDir, "report.md")}`);
} finally {
  await rm(scratchHome, { recursive: true, force: true });
}
