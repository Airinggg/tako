import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { EvaluationResult, GroundedItem, ProjectState } from "./score.ts";

export type EvalLabel = ProjectState & { project: string; sources: string[] };
export type EvalConfig = { source: string; model: string; think?: boolean };
export type ThinkExecutor = (question: string, project: string, config: EvalConfig, brainHome: string) => Promise<string>;
export type EvalRunResult = EvaluationResult & {
  project: string;
  raw_answer: string;
  audit_answer: string;
  citations: string[];
};

export function assertScratchBrainHome(brainHome: string): void {
  const candidate = resolve(brainHome);
  const tempRoot = resolve(tmpdir());
  const forbidden = [resolve(join(homedir(), ".gbrain")), resolve(join(homedir(), ".aletheia-brain"))];
  if (!candidate.startsWith(`${tempRoot}${sep}`) || !basename(candidate).startsWith("tako-eval-")) {
    throw new Error(`evaluation GBRAIN_HOME must be an tako-eval-* directory under ${tempRoot}`);
  }
  if (forbidden.some((path) => candidate === path || candidate.startsWith(`${path}${sep}`))) {
    throw new Error("refusing to use a persistent brain home for evaluation");
  }
}

function localModel(model: string): string {
  return model.startsWith("ollama:") ? model : `ollama:${model}`;
}

export function localOnlyEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of [
    "ANTHROPIC_API_KEY", "COHERE_API_KEY", "DASHSCOPE_API_KEY", "GEMINI_API_KEY",
    "GOOGLE_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
    "VOYAGE_API_KEY", "XAI_API_KEY", "ZEROENTROPY_API_KEY",
  ]) delete env[key];
  return env;
}

// Kept to ONE line each: `gbrain think` echoes the question as a leading `# …`
// line, and answerBody() strips exactly that one line.
export function buildProjectStatusQuestion(project: string): string {
  return `About the project "${project}", using only the pages in this source: who is the owner, what is the current stage (not_started, in_progress, blocked, review, or done), which tasks are overdue, which tasks were dropped or abandoned, and which decisions were made but never carried out? Reply with lines "Owner: NAME [source-page]" and "Stage: STAGE [source-page]", then "Overdue:", "Dropped:", and "Decided, not executed:" sections each with "- ITEM [source-page]" bullets. Cite a real page slug in square brackets for every fact. Leave a section empty if it has none. Do not guess.`;
}

export function buildDecisionAuditQuestion(project: string): string {
  return `In the project "${project}", which decisions were settled but have no later follow-up (no task, message, or doc acting on them)? Reply with a "Stranded decisions (no follow-up found):" heading followed by "- DECISION [source-page]" bullets, one per stranded decision, citing a real page slug. If there are none, write nothing under the heading.`;
}

function citationsFrom(value: string): string[] {
  return [...value.matchAll(/\[([^\]\n]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

function cleanValue(value: string): string {
  return value.replace(/\[[^\]\n]+\]/g, "").trim().replace(/^['"]|['"]$/g, "");
}

/**
 * `gbrain think` echoes the question (which contains literal `Owner:` /
 * `Overdue:` template lines) before the answer, and appends a `--- Model: …`
 * footer. Strip both so parsing only sees the model's answer.
 */
function answerBody(raw: string): string {
  let body = raw.split(/\n---\s*\nModel:/i)[0].trim();
  // `gbrain think` echoes the (single-line) question as a leading "# …" line.
  const firstNl = body.indexOf("\n");
  if (body.startsWith("#") && firstNl > 0) body = body.slice(firstNl + 1);
  return body.trim();
}

function scalar(answer: string, field: string): { value: string; citations: string[] } {
  // last occurrence wins — the echoed template line comes before the real answer
  const matches = [...answer.matchAll(new RegExp(`^\\s*${field}:\\s*(.+)$`, "gim"))];
  const match = matches.at(-1);
  return match ? { value: cleanValue(match[1]), citations: citationsFrom(match[1]) } : { value: "", citations: [] };
}

function listSection(answer: string, heading: RegExp): Array<{ value: string; citations: string[] }> {
  const lines = answer.split(/\r?\n/);
  const start = lines.map((line, i) => (heading.test(line.trim()) ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
  if (start < 0) return [];
  const items: Array<{ value: string; citations: string[] }> = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^[\p{L}][^:]{0,80}:\s*$/u.test(trimmed) || /^Unclear\b/i.test(trimmed)) break;
    const match = trimmed.match(/^[-*]\s+(.+)$/);
    if (!match) continue;
    const value = cleanValue(match[1]);
    if (value && !/^(none|なし|該当なし)$/i.test(value)) items.push({ value, citations: citationsFrom(match[1]) });
  }
  return items;
}

const STAGES = ["not_started", "in_progress", "blocked", "review", "done"];

export function parseProjectStatus(rawAnswer: string): { state: ProjectState; surfaced: GroundedItem[]; citations: string[] } {
  const answer = answerBody(rawAnswer);
  const owner = scalar(answer, "Owner");
  const stage = scalar(answer, "Stage");
  // models sometimes prefix the instruction token ("Stage: STAGE in_progress")
  const stageToken = stage.value.toLowerCase().match(new RegExp(STAGES.join("|")))?.[0];
  if (stageToken) stage.value = stageToken;
  const overdue = listSection(answer, /^Overdue:/i);
  const dropped = listSection(answer, /^Dropped:/i);
  const decisions = listSection(answer, /^Decided,? not executed:/i);
  const claims = [owner, stage, ...overdue, ...dropped, ...decisions].filter((claim) => claim.value);
  return {
    state: {
      owner: owner.value,
      stage: stage.value,
      overdue: overdue.map((item) => item.value),
      dropped: dropped.map((item) => item.value),
      decided_not_executed: decisions.map((item) => item.value),
    },
    surfaced: claims.map((claim) => ({ citations: claim.citations })),
    citations: [...new Set(claims.flatMap((claim) => claim.citations))],
  };
}

export function parseDecisionAudit(rawAnswer: string): Array<{ value: string; citations: string[] }> {
  return listSection(answerBody(rawAnswer), /^Stranded decisions(?:\s*\(.*\))?:?$/i);
}

async function gbrainOut(args: string[], brainHome: string): Promise<string> {
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(process.cwd(), "packages/brain"),
    env: { ...localOnlyEnvironment(), GBRAIN_HOME: brainHome },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`gbrain ${args[0]} failed (${exitCode}): ${stderr.trim()}`);
  return stdout.replace(/^gbrain \d.*available\. Run:.*$/m, "").trim();
}

async function ollamaGenerate(model: string, prompt: string, think = false, host = process.env.OLLAMA_HOST || "http://localhost:11434"): Promise<string> {
  const timeoutMs = Number(process.env.EVAL_MODEL_TIMEOUT_MS) || 1_800_000; // 30 min/call (reasoning runs are slow)
  const res = await fetch(`${host}/api/generate`, {
    method: "POST", headers: { "content-type": "application/json" },
    // `think` toggles the reasoning phase on models like qwen3.5. false = faster,
    // clean `.response`; true = the fair comparison but minutes per call.
    body: JSON.stringify({ model: model.replace(/^ollama:/, ""), prompt, stream: false, think, keep_alive: "30m", options: { temperature: 0 } }),
    // Bun's built-in fetch timeout (~5 min) fires before a long reasoning call
    // finishes — disable it and rely on the explicit AbortSignal ceiling.
    timeout: false as never,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const text: string = (await res.json()).response ?? "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(); // reasoning goes to .thinking, but strip inline tags defensively
}

/**
 * Retrieve-then-extract, scoped to one project. `gbrain think`'s synthesis
 * pipeline is built for a frontier model and returns near-nothing on a local 3B;
 * instead we keyword-search for the project, pull the top pages verbatim, and
 * ask the local model to extract from just those.
 */
export const executeThink: ThinkExecutor = async (question, project, config, brainHome) => {
  assertScratchBrainHome(brainHome);
  // `gbrain search` prints "[<score>] <slug> -- <excerpt>" per line.
  const hits = await gbrainOut(["search", project, "--source", config.source], brainHome);
  const slugs = [...new Set(
    hits.split("\n")
      .map((l) => l.match(/^\[[\d.]+\]\s+(\S+)/)?.[1])
      .filter((s): s is string => !!s && s.includes("/")),
  )].slice(0, 8);
  if (slugs.length === 0) return "";
  const pages: string[] = [];
  for (const slug of slugs) {
    const page = await gbrainOut(["get", slug], brainHome).catch((e) => `(could not read ${slug}: ${e.message})`);
    pages.push(`--- ${slug} ---\n${page}`);
  }
  const prompt = `${question}\n\nUse ONLY these source pages. The bracket citation for a fact is the page's "--- <slug> ---" header.\n\n${pages.join("\n\n")}`;
  return (await ollamaGenerate(localModel(config.model), prompt, config.think === true)).trim();
};

export async function runEvaluation(labels: readonly EvalLabel[], config: EvalConfig, brainHome: string, think: ThinkExecutor = executeThink): Promise<EvalRunResult[]> {
  assertScratchBrainHome(brainHome);
  const results: EvalRunResult[] = [];
  for (const label of labels) {
    const started = performance.now();
    const rawAnswer = await think(buildProjectStatusQuestion(label.project), label.project, config, brainHome);
    const auditAnswer = await think(buildDecisionAuditQuestion(label.project), label.project, config, brainHome);
    const status = parseProjectStatus(rawAnswer);
    const audit = parseDecisionAudit(auditAnswer);
    const decisions = [...status.state.decided_not_executed];
    for (const item of audit) if (!decisions.includes(item.value)) decisions.push(item.value);
    const surfaced = [...status.surfaced, ...audit.map((item) => ({ citations: item.citations }))];
    const citations = [...new Set([...status.citations, ...audit.flatMap((item) => item.citations)])];
    results.push({
      project: label.project,
      gold: label,
      predicted: { ...status.state, decided_not_executed: decisions },
      surfaced,
      citations,
      raw_answer: rawAnswer,
      audit_answer: auditAnswer,
      latency_ms: Math.round(performance.now() - started),
    });
  }
  return results;
}
