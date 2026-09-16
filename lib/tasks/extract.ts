/**
 * Task extraction — mine ongoing-task items from ingested brain content with a
 * LOCAL model. Same constraints as skill extraction: local-only, and the output
 * is a working-memory view, not a system of record. Pair with `triage()` in
 * ./model.ts to decide what to keep hot vs. roll up vs. forget.
 */
import { TASK_STATES, type Task, type TaskState } from "./model.ts";

export type CorpusDoc = { path: string; text: string; date?: string };

/** Signature of a local chat call. Injected so it can be tested offline. */
export type LocalModel = (prompt: string) => Promise<string>;

const SYSTEM = `You read a company's ingested chat and documents and list the ONGOING TASKS
mentioned — concrete things someone needs to do, is doing, has finished, or
decided to drop. Not opinions, not questions, not general discussion.

Return ONLY a JSON array. Each item:
{
  "title": "short imperative phrase, in the language it was written in",
  "owner": "person responsible, or null if none is named",
  "state": "open" | "in_progress" | "blocked" | "done" | "dropped",
  "has_deadline": true | false,
  "quote": "a short quote the task is based on"
}

Rules: at most 12 tasks. Only include a task you can point to a quote for.
Merge duplicates. If you find none, return []. No prose, no fences — just JSON.`;

/** Every top-level bracket-balanced JSON value in the string (handles several
 *  concatenated arrays/objects from batched model calls). */
function jsonValues(raw: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < raw.length; i++) {
    const open = raw[i];
    if (open !== "[" && open !== "{") continue;
    const close = open === "[" ? "]" : "}";
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < raw.length; j++) {
      const c = raw[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { out.push(JSON.parse(raw.slice(i, j + 1))); } catch { /* skip */ }
        i = j;
        break;
      }
    }
  }
  return out;
}

function coerceArray(raw: string): unknown[] {
  const items: unknown[] = [];
  for (const v of jsonValues(raw)) {
    if (Array.isArray(v)) items.push(...v);
    else if (v && typeof v === "object") {
      const o = v as any;
      const list = ["tasks", "items", "results", "task_list"].map((k) => o[k]).find(Array.isArray);
      if (list) items.push(...list);
      else if (o.title || o.task || o.name) items.push(o);
    }
  }
  return items;
}

// Small local models label state freely ("In Progress", "To Do", "Scheduled").
const STATE_ALIAS: Record<string, TaskState> = {
  todo: "open", to_do: "open", not_started: "open", scheduled: "open", planned: "open", new: "open",
  doing: "in_progress", wip: "in_progress", active: "in_progress", ongoing: "in_progress", started: "in_progress",
  waiting: "blocked", stuck: "blocked", on_hold: "blocked", pending: "blocked",
  complete: "done", completed: "done", finished: "done", closed: "done", resolved: "done",
  cancelled: "dropped", canceled: "dropped", abandoned: "dropped", wont_do: "dropped", wontfix: "dropped",
};
const asState = (v: unknown): TaskState => {
  const s = String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if ((TASK_STATES as string[]).includes(s)) return s as TaskState;
  return STATE_ALIAS[s] ?? "open";
};
const asBool = (v: unknown): boolean => v === true || v === "true" || v === "yes";
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const DEADLINE_HINT = /\b\d{1,2}\/\d{1,2}\b|\d{4}-\d{2}-\d{2}|\bby (?:mon|tue|wed|thu|fri|sat|sun|tomorrow|eod|today)|deadline|due\b|期限|締切|まで(?:に)?|日まで/i;

function stableId(title: string): string {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) { h ^= title.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "t_" + (h >>> 0).toString(36);
}

/** Words worth matching for a rough cross-document mention count. */
function keywords(title: string): string[] {
  return (title.match(/[A-Za-z0-9]{3,}|[぀-ヿ一-鿿]{2,}/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => !["the", "and", "for", "with", "する", "した", "して"].includes(w));
}

/**
 * Mine tasks from a corpus. Model output is combined with each document's date
 * to seed firstSeen/lastTouched; `mentions` counts documents that reference the
 * task's keywords.
 */
export async function mineTasks(
  corpus: CorpusDoc[], model: LocalModel, now = () => new Date().toISOString(),
  // small local models degrade on a big low-signal chat dump — keep the window
  // tight and process in batches, merging results.
  maxChars = 6_000, perDoc = 1_800, batchDocs = 3,
): Promise<Task[]> {
  if (corpus.length === 0) return [];

  const raws: string[] = [];
  for (let i = 0; i < corpus.length; i += batchDocs) {
    const batch = corpus.slice(i, i + batchDocs);
    let budget = maxChars;
    const parts: string[] = [];
    for (const doc of batch) {
      if (budget <= 0) break;
      const slice = doc.text.slice(0, Math.min(doc.text.length, budget, perDoc));
      parts.push(`--- ${doc.path}${doc.date ? ` (${doc.date.slice(0, 10)})` : ""} ---\n${slice}`);
      budget -= slice.length;
    }
    raws.push(await model(`${SYSTEM}\n\n=== CONTENT ===\n${parts.join("\n\n")}`));
  }
  const raw = raws.join("\n");

  const docDate = (text: string): string | undefined =>
    corpus.find((d) => d.text.includes(text.slice(0, 40)))?.date;
  const fallbackDate = corpus.map((d) => d.date).filter(Boolean).sort().at(-1) ?? now().slice(0, 10);

  const byTitle = new Map<string, Task>();
  for (const item of coerceArray(raw)) {
    const it = item as Record<string, unknown>;
    const title = str(it.title) || str(it.task) || str(it.name);
    if (!title) continue;
    const key = title.toLowerCase();
    if (byTitle.has(key)) { byTitle.get(key)!.mentions += 1; continue; }

    const quote = str(it.quote) || str(it.details) || str(it.evidence) || str(it.description) || str(it.context);
    const date = (quote && docDate(quote)) || fallbackDate;
    const words = keywords(title);
    const mentions = Math.max(
      1,
      corpus.filter((d) => words.some((w) => d.text.toLowerCase().includes(w))).length,
    );
    byTitle.set(key, {
      id: stableId(title),
      title,
      owner: str(it.owner ?? it.assignee) && str(it.owner ?? it.assignee).toLowerCase() !== "null" ? str(it.owner ?? it.assignee) : null,
      state: asState(it.state ?? it.status),
      source: corpus.find((d) => quote && d.text.includes(quote.slice(0, 40)))?.path ?? corpus[0].path,
      firstSeen: date,
      lastTouched: date,
      mentions,
      hasDeadline: asBool(it.has_deadline ?? it.hasDeadline ?? it.deadline) || DEADLINE_HINT.test(`${title} ${quote}`),
      ...(quote ? { quote } : {}),
    });
  }
  return [...byTitle.values()];
}

/** Default local model: Ollama /api/generate with JSON output. */
export function ollamaModel(
  modelId = process.env.TASKS_MODEL || "qwen2.5:3b-instruct",
  host = process.env.OLLAMA_HOST || "http://localhost:11434",
): LocalModel {
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
