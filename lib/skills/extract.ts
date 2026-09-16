/**
 * Automatic skill extraction — mine recurring procedures from ingested brain
 * content with a LOCAL model, and emit DRAFT skills for human review.
 *
 * OmniBrain's pitch is "extract how work is done". We do the same, with two
 * deliberate constraints from `_operating-rules.md`:
 *   - local models only (option A) — nothing leaves the machine;
 *   - drafts, never auto-published — a human reviews and promotes each one.
 */

export type DraftSkill = {
  name: string;            // kebab-case
  description: string;
  triggers: string[];
  steps: string[];
  sources: string[];       // source subtrees the procedure touches: notion/slack/drive/notes
  evidence: string[];      // short quotes/paths the model based this on
};

export type CorpusDoc = { path: string; text: string };

/** Signature of a local chat call. Injected so it can be tested offline. */
export type LocalModel = (prompt: string) => Promise<string>;

const SYSTEM = `You analyse a company's ingested knowledge (chat threads, docs, notes) and
identify RECURRING PROCEDURES — a repeated sequence of steps a person or team
carries out. A one-off task is not a procedure. A question is not a procedure.

Return ONLY a JSON array. Each item:
{
  "name": "kebab-case-short-name",
  "description": "one sentence: what the procedure accomplishes",
  "triggers": ["phrase a person would say to invoke this", "..."],
  "steps": ["step 1", "step 2", "..."],
  "sources": ["notion" | "slack" | "drive" | "notes", ...],
  "evidence": ["a short quote or path this is based on", "..."]
}

Rules: 2-6 procedures max. Only include a procedure you can point to evidence for.
If you find none, return []. No prose, no markdown fences — just the JSON array.`;

function coerceArray(raw: string): unknown[] {
  // Prefer a JSON array; fall back to a bare object; then a {procedures:[...]} wrapper.
  const tryParse = (a: number, b: number): unknown => {
    if (a === -1 || b === -1 || b < a) return undefined;
    try { return JSON.parse(raw.slice(a, b + 1)); } catch { return undefined; }
  };
  const arr = tryParse(raw.indexOf("["), raw.lastIndexOf("]"));
  if (Array.isArray(arr)) return arr;
  const obj = tryParse(raw.indexOf("{"), raw.lastIndexOf("}")) as any;
  if (obj && typeof obj === "object") {
    for (const key of ["procedures", "skills", "results", "items"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    return obj.name || obj.steps ? [obj] : [];
  }
  return [];
}

/** Local models emit list items as strings OR as {name,description,...} objects. Flatten both. */
const strArr = (v: unknown): string[] => {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [v.trim()] : [];
  return v
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const s = o.description ?? o.step ?? o.text ?? o.name ?? o.trigger ?? o.value;
        return typeof s === "string" ? s.trim() : "";
      }
      return "";
    })
    .filter((s) => s.length > 0);
};

function toDraft(item: any): DraftSkill | null {
  const name = String(item?.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) return null;
  const steps = strArr(item?.steps);
  if (steps.length < 2) return null; // not a procedure
  return {
    name,
    description: String(item?.description ?? "").trim(),
    triggers: strArr(item?.triggers),
    steps,
    sources: strArr(item?.sources).filter((s) => ["notion", "slack", "drive", "notes"].includes(s)),
    evidence: strArr(item?.evidence).slice(0, 6),
  };
}

/** Mine draft skills from a corpus. `model` runs locally. */
export async function mineSkills(corpus: CorpusDoc[], model: LocalModel, maxChars = 24_000): Promise<DraftSkill[]> {
  if (corpus.length === 0) return [];
  let budget = maxChars;
  const parts: string[] = [];
  for (const doc of corpus) {
    if (budget <= 0) break;
    const slice = doc.text.slice(0, Math.min(doc.text.length, budget, 4_000));
    parts.push(`--- ${doc.path} ---\n${slice}`);
    budget -= slice.length;
  }
  const prompt = `${SYSTEM}\n\n=== CONTENT ===\n${parts.join("\n\n")}`;
  const raw = await model(prompt);
  const drafts = coerceArray(raw).map(toDraft).filter((d): d is DraftSkill => d !== null);
  // de-dupe by name
  const seen = new Set<string>();
  return drafts.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
}

/** Default local model: Ollama /api/generate with JSON output. */
export function ollamaModel(modelId = process.env.SKILLS_MODEL || "qwen2.5:3b-instruct", host = process.env.OLLAMA_HOST || "http://localhost:11434"): LocalModel {
  return async (prompt: string) => {
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, prompt, stream: false, format: "json", options: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    return (await res.json()).response ?? "";
  };
}
