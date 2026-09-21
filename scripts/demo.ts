/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ tako — unified demo surface (concept name: OmniBrain)          npm run demo │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │ One Bun server, three sections, one design world. Everything reads the  │
 * │ live brain through the vendored gbrain CLI; retrieval + synthesis stay  │
 * │ on local Ollama. No brain mutations here (no invite/revoke) — a stage   │
 * │ surface, not the admin console.                                         │
 * │                                                                        │
 * │   http://localhost:4400   ·   PORT / ASK_MODEL / DEMO_SOURCE override   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * DIRECTION CONTRACT — "Governed calm"
 * THESIS: a single, generous question surface makes governed company knowledge
 *   feel immediate, while every outward path still terminates with a person.
 * OWN-WORLD: cool-grey ground, pure-white rounded surfaces, bold Noto Sans JP,
 *   near-black actions, and one friendly blue for links, focus, and requests.
 * STORY: ask in plain language, inspect cited evidence, then move through an
 *   explicit approval boundary; integrations remain a calm searchable catalog.
 * FIRST VIEWPORT: centered heavyweight question, oversized white prompt, a few
 *   neutral example chips, then the governed flow as one horizontal sequence.
 * FORM: Yoom's airy web grammar, rebuilt with Tako content and neutral marks;
 *   no Yoom logo, mascot, wordmark, or marketing copy is reproduced.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { TAKO_CSS_TOKENS } from "./tako/tokens.ts";
import { mascotScene, mascotMark } from "./tako/mascot.ts";
import { answerFromSource, citedSlugs, gb, gbrainHome, usesHostedProvider } from "../lib/eval/qa.ts";
import { loadDashboard, loadMembers } from "../lib/console/data.ts";
import { connectorRunner, isConnectorName } from "../lib/connectors/registry.ts";
import { parseSkill } from "../lib/skills/parse.ts";
import { runSkill } from "../lib/skills/run.ts";
import { createLiveStepRunner } from "../lib/skills/run-live.ts";
import type { SkillRunReceipt } from "../lib/skills/receipt.ts";
import { DEFAULT_POLICY, rollupLine, triage, type DecayPolicy, type Task } from "../lib/tasks/model.ts";
import { CHECK_KEYS, CHECK_LABELS, allowedVerdicts, canApprove, latestDecision, newReview, overallRisk, receiptLine, recordDecision, setCheck, VERDICTS, type ReviewItem, type Verdict } from "../lib/review/model.ts";
import { resolveSecret } from "../lib/connectors/shared/config.ts";
import { DEFAULT_RULES, redact, resolveRules, summariseHits, type RedactionRule } from "../lib/govern/redact.ts";
import { categorizeText, DEPARTMENT_LABELS, DEPARTMENTS, type Department } from "../lib/govern/categorize.ts";
import { diffGitStatus, formatSyncLogLines, hashContent, parseGitStatus, type SyncLogEntry } from "../lib/govern/sync-log.ts";
import { checkRateLimit, ClientError, clientKey, readJsonBody, requireAdmin, resolveAdminToken, safeErrorResponse } from "../lib/util/http-security.ts";
import { writePrivateFileAtomic } from "../lib/util/private-file.ts";

const REPO = import.meta.dir ? join(import.meta.dir, "..") : process.cwd();

const PORT = Number(process.env.PORT) || 4400;
const MODEL = process.env.ASK_MODEL || "qwen2.5:3b-instruct";
const DEFAULT_SOURCE = process.env.DEMO_SOURCE || "engineering";

// ── brain reads ────────────────────────────────────────────────────────────
type SourceRow = {
  source_id: string; name: string; total_pages: number;
  embed_coverage_pct: number; last_sync_at: string | null; sync_running: boolean;
};

function sourceRows(): SourceRow[] {
  const out = gb(["sources", "status", "--json"]);
  const start = out.search(/[[{]/);
  const parsed = JSON.parse(start >= 0 ? out.slice(start) : out) as { sources: SourceRow[] };
  return parsed.sources.filter((s) => s.source_id !== "default");
}

function pageBody(slug: string, source: string): string {
  return gb(["get", slug, "--source", source]).replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** Per-source doc / skill / rule split, matching the console's counting. */
function breakdown(source: string): { docs: number; skills: number; rules: number } {
  let docs = 0, skills = 0, rules = 0;
  for (const line of gb(["list", "--source", source]).split("\n")) {
    const slug = line.split("\t")[0]?.trim();
    if (!slug?.includes("/")) continue;
    if (/^skills\/_/.test(slug)) rules++;
    else if (/^skills\/.+\/skill$/.test(slug)) skills++;
    else docs++;
  }
  return { docs, skills, rules };
}

function overview() {
  const rows = sourceRows();
  const sources = rows
    .map((r) => ({
      id: r.source_id,
      name: r.name || r.source_id,
      pages: r.total_pages,
      embed: r.embed_coverage_pct,
      lastSync: r.last_sync_at,
      syncing: r.sync_running,
      ...breakdown(r.source_id),
    }))
    .filter((s) => s.docs + s.skills + s.rules > 0); // only sources that actually carry knowledge
  let members = 0;
  try { members = loadMembers().length; } catch { /* no clients registered */ }

  // Home's four stat tiles + two lists — all derived from data other screens
  // already compute (via their memoised *Cached wrappers), nothing fabricated.
  const today = new Date().toISOString().slice(0, 10);
  const skills = skillsCached();
  const connectors = connectorsCached();
  const tasks = tasksCached();
  const reviews = reviewsCached();
  const homeStats = {
    activeAutomations: skills.skills.length,
    connectedApps: connectors.rows.filter((r) => r.configured).length,
    completedToday: tasks.rows.filter((t) => t.state === "done" && t.lastTouched.slice(0, 10) === today).length,
    needsApproval: reviews.counts.open,
    recentActivity: [...tasks.rows]
      .sort((a, b) => b.lastTouched.localeCompare(a.lastTouched))
      .slice(0, 5)
      .map((t) => ({ title: t.title, lastTouched: t.lastTouched })),
    needsAttention: reviews.rows
      .filter((r) => r.state === "submitted" || r.state === "in_review")
      .slice(0, 5)
      .map((r) => ({ id: r.id, title: r.title })),
  };

  return {
    model: usesHostedProvider() ? `${process.env.GEMINI_MODEL || "gemini-3.6-flash"} (external — demo mode)` : MODEL,
    localOnly: !usesHostedProvider(),
    gbrainHome: gbrainHome(),
    totals: {
      sources: sources.length,
      docs: sources.reduce((n, s) => n + s.docs, 0),
      skills: sources.reduce((n, s) => n + s.skills, 0),
      members,
    },
    sources,
    homeStats,
  };
}

// ── skills ─────────────────────────────────────────────────────────────────
// Each skill declares `reads:` — the source ids it needs. A scope grants a
// skill only if the scope's realised sources cover every id. (OmniBrain:
// "skills declare the data access they assume, reviewed once.")
type SkillView = {
  name: string; description: string; triggers: string[];
  reads: string[]; steps: number; procedureSteps: string[]; grantedBy: string[];
  // Automations-screen fields (Task 6) — each derived from data already read
  // above, never fabricated. See skillsView() for how each is computed.
  trigger: string; actionSummary: string; connectedApps: string[];
  status: string; lastRun: string | null; owner: string; approvalRequired: string;
};

export function readSkillFiles(rootOverride?: string): Omit<SkillView, "grantedBy" | "trigger" | "actionSummary" | "connectedApps" | "status" | "lastRun" | "owner" | "approvalRequired">[] {
  const root = rootOverride || join(REPO, "brain-sources");
  if (!existsSync(root)) return [];
  const out: Omit<SkillView, "grantedBy" | "trigger" | "actionSummary" | "connectedApps" | "status" | "lastRun" | "owner" | "approvalRequired">[] = [];
  for (const src of readdirSync(root, { withFileTypes: true })) {
    if (!src.isDirectory()) continue;
    const skillsDir = join(root, src.name, "skills");
    if (!existsSync(skillsDir)) continue;
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      const file = join(skillsDir, d.name, "SKILL.md");
      if (!d.isDirectory() || !existsSync(file)) continue;
      const md = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const fm = md.startsWith("---\n") ? md.slice(4, md.indexOf("\n---", 4)) : "";
      const val = (k: string) => fm.match(new RegExp(`^${k}:[ ]*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
      const list = (k: string) => {
        const m = fm.match(new RegExp(`^${k}:\\n((?:[ ]+-.*\\n?)+)`, "m"));
        return m ? m[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim()).filter(Boolean) : [];
      };
      const proc = md.match(/##\s*Procedure\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i)?.[1] ?? "";
      const steps = (proc.match(/^\s*\d+\.\s+/gm) ?? []).length;
      const procedureSteps = (proc.match(/^\s*\d+\.\s+.+$/gm) ?? [])
        .map((line) => line.replace(/^\s*\d+\.\s+/, "").trim());
      out.push({ name: val("name") || d.name, description: val("description"), triggers: list("triggers"), reads: list("reads"), steps, procedureSteps });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function skillsView(): { skills: SkillView[]; scopes: { name: string; readSources: string[] }[] } {
  let brains: ReturnType<typeof loadDashboard>["brains"] = [];
  try { brains = loadDashboard().brains; } catch { /* none */ }
  const scopes = brains
    .filter((b) => b.kind === "scope")
    .map((b) => ({ name: b.name, readSources: b.readSources as string[] }));
  // Connected apps (Automations screen, Task 6): join each skill's declared
  // `reads` scope ids against the connectors that are actually configured and
  // write into that scope — a real join of two existing data sources, not a
  // fabricated list.
  let connectorRows: ReturnType<typeof connectorsView>["rows"] = [];
  try { connectorRows = connectorsView().rows; } catch { /* none */ }
  const skills = readSkillFiles().map((s) => {
    const grantedBy = scopes.filter((sc) => s.reads.length > 0 && s.reads.every((r) => sc.readSources.includes(r))).map((sc) => sc.name);
    const connectedApps = connectorRows
      .filter((row) => row.configured && s.reads.includes(row.subdir))
      .map((row) => row.label);
    return {
      ...s,
      grantedBy,
      // Trigger: the skill's first declared trigger phrase, or "Manual" when
      // the skill file states none — never invented.
      trigger: s.triggers[0] ?? "Manual",
      // Action summary: the skill's existing plain-English `description` —
      // it already reads as the action summary, so reuse it directly.
      actionSummary: s.description,
      connectedApps,
      // Status: real, because a skill with no granting scope genuinely isn't
      // usable yet.
      status: grantedBy.length > 0 ? "Active" : "Not granted",
      // Last run: the one real per-skill run receipt in the system
      // (computeSkillRun's `skillRun`), matched by name. Every other skill
      // has no real last-run data.
      lastRun: skillRun && skillRun.skill === s.name ? skillRun.endedAt : null,
      // Owner: no SKILL.md declares an owner/author field anywhere in the
      // repo — there is no real data to show here.
      owner: "Unassigned",
      // Approval requirement: a real, constant fact about this product's
      // governance model (see Home's "governed path" — human approval is
      // never skippable), true for every automation, not per-skill fabrication.
      approvalRequired: "Yes",
    };
  });
  return { skills, scopes, exampleRun: skillRun };
}

/** Slugify two action strings into a filesystem-safe, hyphenated directory
 * name — lowercase, alphanumeric-and-hyphen only — then disambiguate against
 * any existing skill directory with a numeric suffix, so a new automation
 * never silently overwrites one that already exists. */
function generateAutomationSlug(action1: string, action2: string): string {
  const base = `${action1}-${action2}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "automation";
  const skillsDir = join(REPO, "brain-sources/shared/skills");
  let slug = base;
  let n = 2;
  while (existsSync(join(skillsDir, slug))) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

// The builder's own <select> options — kept as the single source of truth
// server-side so createAutomation can reject anything that isn't one of
// these (the client script below interpolates the same arrays rather than
// hardcoding its own copy, so the two can never drift apart).
export const AB_TRIGGER_OPTIONS = ["New file added to Drive", "New page added to Notion", "New message in Slack", "Every Monday morning", "Manual"];
export const AB_ACTION_OPTIONS = ["Summarize the content", "Draft a notification", "Run the decision audit", "Post to Slack", "Notify the team channel", "Send an email digest"];

/** Create a real automation by writing a new SKILL.md — completing the
 * Task 6 builder, which could pick a trigger/action pair but never had a way
 * to actually finish creating one. The three values come straight from the
 * builder's own `<select>` options, so the generated description never
 * states more than what was actually selected. */
function createAutomation(trigger: string, action1: string, action2: string): { ok: true; slug: string } | { error: string } {
  if (READ_ONLY) throw new ClientError("この画面は読み取り専用です / this instance is read-only");
  const trig = String(trigger ?? "").trim().replace(/[\r\n]+/g, " ");
  const a1 = String(action1 ?? "").trim().replace(/[\r\n]+/g, " ");
  const a2 = String(action2 ?? "").trim().replace(/[\r\n]+/g, " ");
  if (!trig || !a1 || !a2) return { error: "trigger and both actions are required" };
  if (!AB_TRIGGER_OPTIONS.includes(trig)) return { error: "unrecognized trigger" };
  if (!AB_ACTION_OPTIONS.includes(a1) || !AB_ACTION_OPTIONS.includes(a2)) return { error: "unrecognized action" };
  const slug = generateAutomationSlug(a1, a2);
  const dir = join(REPO, "brain-sources/shared/skills", slug);
  mkdirSync(dir, { recursive: true });
  // NB: `description` becomes this skill's actionSummary in skillsView(),
  // which the Automations list itself prefixes with "When <trigger>, " (see
  // sentenceFor() in the client script below) — so it must NOT repeat the
  // trigger itself, or the rendered sentence doubles it ("When X, When X,
  // ..."). Every other real SKILL.md follows this same convention: the
  // description states only the action, never the trigger.
  const description = `${a1} and ${a2}.`;
  const trigEscaped = trig.replace(/"/g, '\\"');
  const md = `---
name: ${slug}
version: 0.1.0
description: ${description}
triggers:
  - "${trigEscaped}"
reads:
  - shared
mutating: false
writes_pages: false
---

# ${slug}

## Procedure

1. ${a1}
2. ${a2}
`;
  writeFileSync(join(dir, "SKILL.md"), md, "utf8");
  skillsCached.clear();
  overviewCached.clear();
  return { ok: true, slug };
}

// ── working memory ─────────────────────────────────────────────────────────
function readJson<T>(rel: string, fallback: T): T {
  try { return JSON.parse(readFileSync(join(REPO, rel), "utf8")) as T; } catch { return fallback; }
}

// ── review desk + redaction (AI governance) ────────────────────────────────
function redactionRules(): RedactionRule[] {
  return resolveRules(readJson<RedactionRule[]>("config/redaction.json", []));
}

// The intake form writes to config/reviews.json. Set DEMO_READONLY=1 to disable
// (e.g. showing the demo to a room off a shared machine).
const READ_ONLY = process.env.DEMO_READONLY === "1";
const REVIEWS_FILE = join(REPO, "config/reviews.json");

/** Append a new review item from the intake form. Runs redaction on the body and
 *  pre-seeds the harm check from what it found — masking informs the review. */
function submitReview(input: { title?: string; intent?: string; audience?: string; body?: string; sources?: string; submittedBy?: string }): { id: string } {
  if (READ_ONLY) throw new ClientError("この画面は読み取り専用です / this instance is read-only");
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (title.length < 3) throw new ClientError("題名を入力してください（3文字以上）/ title too short");
  if (body.length < 10) throw new ClientError("本文を入力してください / body too short");

  const sources = String(input.sources ?? "").split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean);
  let item = newReview({
    title,
    intent: String(input.intent ?? "").trim() || "(未記入 / not stated)",
    audience: String(input.audience ?? "").trim() || "(未記入 / not stated)",
    body,
    sources,
    submittedBy: String(input.submittedBy ?? "").trim() || "intake form",
  });

  const red = redact(body, redactionRules());
  if (red.blocked) {
    item = setCheck(item, "harm", { status: "blocker", note: `フィルタが公開ブロック対象を検出：${summariseHits(red.hits).map((s) => s.label.split(" / ")[0]).join("、")}` });
  } else if (red.hits.length) {
    item = setCheck(item, "harm", { status: "concern", note: `自動マスク ${red.hits.length}件：${summariseHits(red.hits).map((s) => `${s.label.split(" / ")[0]}×${s.count}`).join("、")}` });
  }
  if (sources.length === 0) {
    item = setCheck(item, "evidence", { status: "concern", note: "出典が添付されていない / no grounding source attached" });
  }

  const file = readJson<{ note?: string; reviews: ReviewItem[] }>("config/reviews.json", { reviews: [] });
  file.reviews = [item, ...(file.reviews ?? [])];
  const tmp = `${REVIEWS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmp, REVIEWS_FILE);
  reviewsCached.clear();
  return { id: item.id };
}

/** Record a human decision (approve/revise/reject/escalate) on an existing
 *  review. Mirrors submitReview()'s exact read/mutate/write-tmp/rename/clear-
 *  cache file-handling — same file, same pattern — but the governance logic
 *  itself (which verdicts are currently allowed, what moves state where) is
 *  never reimplemented here: it's recordDecision()/allowedVerdicts() from
 *  lib/review/model.ts, unchanged. `by` defaults the same way submitReview()
 *  defaults `submittedBy` — a fixed label naming the surface used, since this
 *  is a single-user local demo with no login system. */
function reviewDecide(input: { id?: string; verdict?: string; by?: string; note?: string }): { id: string; state: ReviewItem["state"]; decision: ReviewItem["decision"] } {
  if (READ_ONLY) throw new ClientError("この画面は読み取り専用です / this instance is read-only");
  const id = String(input.id ?? "").trim();
  if (!id) throw new ClientError("id が必要です / id required");
  const verdict = String(input.verdict ?? "") as Verdict;
  if (!VERDICTS.includes(verdict)) throw new ClientError(`不正な verdict です / invalid verdict "${verdict}"`);
  const by = String(input.by ?? "").trim() || "review desk";
  const note = String(input.note ?? "").trim();

  const file = readJson<{ note?: string; reviews: ReviewItem[] }>("config/reviews.json", { reviews: [] });
  const idx = (file.reviews ?? []).findIndex((r) => r.id === id);
  if (idx < 0) throw new ClientError(`レビューが見つかりません / review "${id}" not found`);

  // recordDecision() throws if `verdict` isn't currently allowed from the
  // item's state (e.g. a stale client tried to approve something that just
  // became blocked) — that error message propagates up to the http handler's
  // catch-all, same as every other route in this file.
  const updated = recordDecision(file.reviews[idx], verdict, by, note);
  file.reviews[idx] = updated;

  const tmp = `${REVIEWS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmp, REVIEWS_FILE);
  reviewsCached.clear();
  overviewCached.clear();
  return { id: updated.id, state: updated.state, decision: latestDecision(updated) };
}

// ── connect a service (front-end for config/connectors.json) ───────────────
const CONNECTORS_FILE = join(REPO, "config/connectors.json");

type FieldSpec = { key: string; label: string; list?: boolean; num?: boolean; ph?: string; def?: string };
type ConnectorSpec = {
  label: string; hasToken: boolean; tokenLabel: string; tokenPh: string;
  /** catalog grouping, Yoom-style — "日本語 / English" */
  category: string;
  help: string; fields: FieldSpec[]; fixed: Record<string, unknown>;
  /** when set, the `system` field keys an entry inside cfg[name][nested] rather
   *  than the connector being one flat block (used by the CAD connector). */
  nested?: string;
  /** filename under docs/connectors/ with step-by-step token-acquisition
   *  instructions for this connector — served read-only via the whitelisted
   *  /docs/connectors/:file route below (see CREDENTIALS_DOCS). */
  credentialsDoc?: string;
};

const CONNECTOR_SPECS: Record<string, ConnectorSpec> = {
  notion: {
    label: "Notion", category: "ドキュメント / Docs", hasToken: true, tokenLabel: "内部インテグレーションのトークン", tokenPh: "ntn_…",
    help: "Notion で内部インテグレーションを作成し、対象のデータベースに接続を共有します。",
    credentialsDoc: "notion-credentials.md",
    fields: [
      { key: "databases", label: "データベースID", list: true, ph: "3ca943af75c88019a64bee683cb33662" },
      { key: "subdir", label: "取り込み先スコープ", def: "shared" },
    ],
    fixed: { sourceDir: "brain-sources", pages: [], notionVersion: "2022-06-28" },
  },
  slack: {
    label: "Slack", category: "チャット / Chat", hasToken: true, tokenLabel: "ボットトークン", tokenPh: "xoxb-…",
    help: "channels:history / channels:read / users:read 権限のボットを、読みたいチャンネルに招待します。",
    credentialsDoc: "slack-credentials.md",
    fields: [
      { key: "channels", label: "チャンネル（IDまたは名前）", list: true, ph: "all-hestia" },
      { key: "subdir", label: "取り込み先スコープ", def: "engineering" },
      { key: "lookbackDays", label: "遡る日数", num: true, def: "30" },
    ],
    fixed: { sourceDir: "brain-sources", includeThreads: true },
  },
  drive: {
    label: "Google Drive", category: "ファイル / Files", hasToken: true, tokenLabel: "アクセストークン", tokenPh: "ya29.…",
    help: "drive.readonly スコープのトークン。フォルダ直下のファイルのみ取り込みます（サブフォルダは各IDを追加）。",
    credentialsDoc: "drive-credentials.md",
    fields: [
      { key: "folderIds", label: "フォルダID", list: true, ph: "1ueXJLTio4EE9lhXS9uzifnsIPMAuLHQ_" },
      { key: "subdir", label: "取り込み先スコープ", def: "shared" },
    ],
    fixed: { sourceDir: "brain-sources" },
  },
  discord: {
    label: "Discord", category: "チャット / Chat", hasToken: true, tokenLabel: "ボットトークン", tokenPh: "MTU0…",
    help: "ボットを対象サーバーに参加させ、Message Content Intent を有効にします。",
    credentialsDoc: "discord-credentials.md",
    fields: [
      { key: "guildId", label: "サーバーID", ph: "1542488991729852516" },
      { key: "channels", label: "チャンネルID", list: true, ph: "1542488992279167090" },
      { key: "subdir", label: "取り込み先スコープ", def: "engineering" },
      { key: "lookbackDays", label: "遡る日数", num: true, def: "30" },
    ],
    fixed: { sourceDir: "brain-sources", includeThreads: true },
  },
  notes: {
    label: "ローカルノート", category: "ファイル / Files", hasToken: false, tokenLabel: "", tokenPh: "",
    help: "この端末上の Markdown / テキストのフォルダ。ネットワークに出ません。",
    fields: [
      { key: "roots", label: "フォルダの絶対パス", list: true, ph: "/Users/you/notes" },
      { key: "subdir", label: "取り込み先スコープ", def: "personal-notes" },
    ],
    fixed: { sourceDir: "brain-sources", extensions: [".md", ".markdown", ".txt"] },
  },
  mcp: {
    label: "MCP ソース（任意のサーバー）", category: "拡張 / Extend", hasToken: false, tokenLabel: "", tokenPh: "",
    help: "読み取り対応の MCP サーバーを指定すると、そのリソースをスコープに取り込みます。実行前にレビュー済みマニフェストを検証し、各読み取りをポリシー判定・マスキング・監査します。URL（Streamable-HTTP）かローカルコマンドのどちらか一方。",
    fields: [
      { key: "system", label: "サーバー名（短い識別子）", ph: "confluence" },
      { key: "manifest", label: "レビュー済みマニフェスト", ph: "config/manifests/confluence.json" },
      { key: "url", label: "エンドポイントURL", ph: "https://mcp.example.com/mcp" },
      { key: "command", label: "またはローカルコマンド（URLの代わり）", ph: "npx -y @scope/server ..." },
      { key: "subdir", label: "取り込み先スコープ", def: "shared" },
    ],
    fixed: { sourceDir: "brain-sources" },
    nested: "servers",
  },
  cad: {
    label: "CAD（Fusion / SolidWorks / …）", category: "設計・CAD / Engineering", hasToken: false, tokenLabel: "", tokenPh: "",
    help: "CAD / PDM が動く端末で、部品・アセンブリ・図面のメタデータとBOMを JSON か CSV に書き出し、そのファイルのパスを指定します。CADの中身は解析せず、CADアプリを操作もしません（読み取り専用）。システムごとに1つずつ登録できます。",
    fields: [
      { key: "system", label: "CADシステム名（例: solidworks / catia / fusion）", ph: "solidworks" },
      { key: "exportFile", label: "メタデータ書き出しファイルの絶対パス", ph: "/path/to/cad-export.json" },
      { key: "subdir", label: "取り込み先スコープ", def: "engineering" },
    ],
    fixed: { sourceDir: "brain-sources" },
    nested: "systems",
  },
};

const maskToken = (t?: string) => {
  const s = String(t ?? "");
  if (!s || s.startsWith("env:")) return s;
  return s.length <= 8 ? "••••" : `${s.slice(0, 5)}${"•".repeat(Math.min(14, s.length - 5))}`;
};
const MASK_SENTINEL = "•••• keep existing ••••";

function connectorsView() {
  const cfg = readJson<Record<string, any>>("config/connectors.json", {});
  let sourceRowsList: SourceRow[] = [];
  try { sourceRowsList = sourceRows(); } catch { /* brain not up */ }
  const rows = Object.entries(CONNECTOR_SPECS).map(([name, spec]) => {
    const c = cfg[name] ?? {};
    const nestedKeys = spec.nested && c[spec.nested] && typeof c[spec.nested] === "object" ? Object.keys(c[spec.nested]) : [];
    const configured = spec.nested ? nestedKeys.length > 0
      : spec.hasToken ? Boolean(c.token)
      : Array.isArray(c.roots) && c.roots.length > 0;
    const src = sourceRowsList.find((s) => s.source_id === c.subdir);
    return {
      name, label: spec.label, help: spec.help, category: spec.category,
      credentialsDocUrl: spec.credentialsDoc ? `/docs/connectors/${spec.credentialsDoc}` : "",
      hasToken: spec.hasToken, tokenLabel: spec.tokenLabel, tokenPh: spec.tokenPh,
      tokenMasked: spec.hasToken ? maskToken(c.token) : "",
      configured,
      // Server-side flag so the client never needs to compare against a
      // connector's internal registry name — that internal name is one of
      // this product's own jargon terms and must not leak into the served
      // page's static script text (see docs/audit for the jargon-leak test
      // this closes).
      hasIndustrialCatalog: name === "mcp",
      note: spec.nested && nestedKeys.length ? `登録済み: ${nestedKeys.join(", ")}` : "",
      fields: spec.fields.map((f) => {
        const v = spec.nested && f.key !== "subdir" ? "" : c[f.key];   // nested fields start blank (add one at a time)
        return { ...f, value: f.list ? (Array.isArray(v) ? v.join(", ") : "") : (v ?? f.def ?? "") };
      }),
      subdir: c.subdir ?? spec.fields.find((f) => f.key === "subdir")?.def ?? "",
      lastSync: src?.last_sync_at ?? null,
      pages: src?.total_pages ?? 0,
    };
  });
  return { canSave: !READ_ONLY, rows };
}

type IndustrialConnectorView = {
  id: string; label: string; domain: string; executionPattern: string;
  riskCeiling: string; proposedWave: string; evidence: string; note: string;
  localCommand?: string;
};

function industrialCatalogView() {
  const rows = readJson<IndustrialConnectorView[]>("config/industrial-connectors.json", []);
  return {
    total: rows.length,
    rows: rows.map((row) => ({ ...row, built: Boolean(row.localCommand) })),
  };
}

/** Merge one connector's form values into config/connectors.json. Secrets stay
 *  on this machine, in plaintext — a real deployment needs an encrypted store. */
function saveConnector(name: string, input: Record<string, any>): { ok: true } {
  if (READ_ONLY) throw new ClientError("この画面は読み取り専用です / read-only instance");
  const spec = CONNECTOR_SPECS[name];
  if (!spec) throw new ClientError(`unknown connector "${name}"`);

  const cfg = readJson<Record<string, any>>("config/connectors.json", {});

  // nested connector (CAD / MCP): the `system` field keys an entry in a map;
  // every other non-scope field becomes a property of that entry.
  if (spec.nested) {
    const key = String(input.system ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!key) throw new ClientError("名前（識別子）を入力してください");
    const entry: Record<string, unknown> = {};
    for (const f of spec.fields) {
      if (f.key === "system" || f.key === "subdir") continue;
      const v = String(input[f.key] ?? "").trim();
      if (!v) continue;
      if (f.key === "command") { entry.command = v.split(/\s+/)[0]; entry.args = v.split(/\s+/).slice(1); }
      else entry[f.key] = v;
    }
    if (Object.keys(entry).length === 0) {
      throw new ClientError(name === "mcp" ? "URL かローカルコマンドのどちらかを入力してください" : "少なくとも1つの値を入力してください");
    }
    const cur = cfg[name] ?? {};
    cfg[name] = {
      ...spec.fixed, ...cur,
      subdir: String(input.subdir ?? cur.subdir ?? spec.fields.find((f) => f.key === "subdir")?.def ?? "").trim(),
      [spec.nested]: { ...(cur[spec.nested] ?? {}), [key]: entry },
    };
    writePrivateFileAtomic(CONNECTORS_FILE, JSON.stringify(cfg, null, 2) + "\n");
    connectorsCached.clear();
    return { ok: true };
  }

  const cur = cfg[name] ?? {};
  const next: Record<string, unknown> = { ...cur, ...spec.fixed };

  if (spec.hasToken) {
    const t = String(input.token ?? "").trim();
    if (t && t !== MASK_SENTINEL) next.token = t;
    if (!next.token) throw new ClientError(`${spec.label} のトークンを入力してください`);
  }
  for (const f of spec.fields) {
    const raw = input[f.key];
    if (f.list) {
      const arr = String(raw ?? "").split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean);
      next[f.key] = arr;
    } else if (f.num) {
      const n = Number(raw);
      next[f.key] = Number.isFinite(n) && n > 0 ? n : Number(f.def ?? 30);
    } else {
      next[f.key] = String(raw ?? f.def ?? "").trim();
    }
  }
  // require at least one list-of-ids field to be non-empty…
  const idField = spec.fields.find((f) => f.list && f.key !== "roots") ?? spec.fields.find((f) => f.list);
  if (idField && (next[idField.key] as string[]).length === 0) {
    throw new ClientError(`${idField.label} を1つ以上入力してください`);
  }
  // …or, for a connector with no list field, the one non-scope text field
  if (!idField) {
    const req = spec.fields.find((f) => !f.list && !f.num && f.key !== "subdir");
    if (req && !String(next[req.key] ?? "").trim()) throw new ClientError(`${req.label} を入力してください`);
  }

  cfg[name] = next;
  writePrivateFileAtomic(CONNECTORS_FILE, JSON.stringify(cfg, null, 2) + "\n");
  connectorsCached.clear();
  return { ok: true };
}

/** One lightweight auth check per service — proves the credentials work without
 *  ingesting anything. */
async function testConnector(name: string): Promise<{ ok: boolean; detail: string }> {
  const cfg = readJson<Record<string, any>>("config/connectors.json", {});
  const c = cfg[name] ?? {};
  try {
    if (name === "notes") {
      const roots: string[] = Array.isArray(c.roots) ? c.roots : [];
      if (!roots.length) return { ok: false, detail: "フォルダのパスが未設定" };
      const bad = roots.filter((p) => !existsSync(p));
      return bad.length ? { ok: false, detail: `見つからないパス: ${bad.join(", ")}` } : { ok: true, detail: `${roots.length} フォルダを確認` };
    }
    if (name === "mcp") {
      const servers = (c.servers && typeof c.servers === "object") ? c.servers as Record<string, any> : {};
      const names = Object.keys(servers);
      if (!names.length) return { ok: false, detail: "MCPサーバーが未登録" };
      const { McpClient, httpTransport } = await import("../lib/connectors/mcp/client.ts");
      const parts: string[] = [];
      let allOk = true;
      for (const s of names) {
        const e = servers[s] ?? {};
        if (!e.url) { parts.push(`${s}: ローカルコマンド（起動時に確認）`); continue; }
        try {
          const cl = new McpClient(httpTransport(e.url, e.headers ?? {}, 8_000));
          const info = await cl.initialize();
          const list = await cl.listResources(1);
          parts.push(`${s}: ${info.name}${list.length ? " ・ resources 有" : " ・ resources 0"}`);
        } catch (err) { parts.push(`${s}: ${(err as Error).message.slice(0, 60)}`); allOk = false; }
      }
      return { ok: allOk, detail: parts.join(" ／ ") };
    }
    if (name === "cad") {
      const systems = (c.systems && typeof c.systems === "object") ? c.systems as Record<string, { exportFile?: string }> : {};
      const names = Object.keys(systems);
      if (!names.length) return { ok: false, detail: "CADシステムが未登録" };
      const { collectCad } = await import("../lib/connectors/cad/collect.ts");
      const parts: string[] = [];
      let allOk = true;
      for (const s of names) {
        const f = String(systems[s]?.exportFile ?? "");
        if (!f || !existsSync(f)) { parts.push(`${s}: ファイルなし`); allOk = false; continue; }
        try { const d = await collectCad(f, s); parts.push(`${s}: ${d.length}件`); if (!d.length) allOk = false; }
        catch (e) { parts.push(`${s}: 解析エラー`); allOk = false; }
      }
      return { ok: allOk, detail: parts.join(" ・ ") };
    }
    const rawToken = String(c.token ?? "");
    if (!rawToken) return { ok: false, detail: "トークン未設定" };
    // Match the real connector loaders: config may hold `env:VARNAME`, but
    // only the resolved value is sent to the provider. It is never returned
    // to the browser or included in the result detail.
    const t = resolveSecret(rawToken);
    let url = "", headers: Record<string, string> = {}, pick = (j: any) => JSON.stringify(j).slice(0, 80);
    if (name === "notion") { url = "https://api.notion.com/v1/users/me"; headers = { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28" }; pick = (j) => j.name || j.bot?.owner?.type || "ok"; }
    else if (name === "slack") { url = "https://slack.com/api/auth.test"; headers = { Authorization: `Bearer ${t}` }; pick = (j) => (j.ok ? `${j.team} / ${j.user}` : j.error); }
    else if (name === "drive") { url = "https://www.googleapis.com/drive/v3/about?fields=user"; headers = { Authorization: `Bearer ${t}` }; pick = (j) => j.user?.emailAddress || j.error?.message || "ok"; }
    else if (name === "discord") { url = "https://discord.com/api/v10/users/@me"; headers = { Authorization: `Bot ${t}` }; pick = (j) => j.username ? `${j.username}` : (j.message || "?"); }
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const j = await r.json().catch(() => ({}));
    const softFail = name === "slack" && j && j.ok === false;
    return { ok: r.ok && !softFail, detail: `${r.status} ・ ${pick(j)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

const SYNC_LOG_FILE = join(REPO, "config/sync-log.jsonl");

/** `git status --porcelain -- subdir`, parsed. Read-only — safe to call
 *  before and after a connector run to isolate what THAT run actually
 *  touched (see appendSyncLog). */
function gitStatusFor(subdir: string): { changed: string[]; deleted: string[] } {
  const status = spawnSync("git", ["status", "--porcelain", "--", subdir], {
    cwd: join(REPO, "brain-sources"), encoding: "utf8", timeout: 10_000,
  });
  if (status.status !== 0) return { changed: [], deleted: [] };
  return parseGitStatus(status.stdout);
}

/** Append what a sync actually added/changed/deleted to the provenance
 *  log — never a gate, only a record (see lib/govern/sync-log.ts's header
 *  comment for why). `before` is the subdir's git status captured BEFORE
 *  this connector's pull ran; diffing against the current status is what
 *  keeps two connectors sharing a subdir (e.g. notion and drive both
 *  default to "shared") from attributing each other's leftover dirty
 *  files to whichever one happens to sync last. Failure to log never
 *  blocks the sync itself; it's best-effort. */
function appendSyncLog(name: string, subdir: string, before: { changed: string[]; deleted: string[] }): void {
  try {
    const after = gitStatusFor(subdir);
    const { changed, deleted } = diffGitStatus(before, after);
    const now = new Date().toISOString();
    const entries: SyncLogEntry[] = [
      ...changed.map((path): SyncLogEntry => {
        let hash = "";
        try { hash = hashContent(readFileSync(join(REPO, "brain-sources", path), "utf8")); } catch { /* file gone by the time we read it — skip hashing, still log the path */ }
        return { source: name, path, action: "synced", hash, syncedBy: "operator", syncedAt: now };
      }),
      ...deleted.map((path): SyncLogEntry => ({ source: name, path, action: "deleted", hash: "", syncedBy: "operator", syncedAt: now })),
    ];
    if (entries.length) appendFileSync(SYNC_LOG_FILE, formatSyncLogLines(entries));
  } catch { /* logging must never break the sync it's describing */ }
}

/** Pull fresh content for one connector, then ingest it into the brain — the
 *  two steps a person previously had to run by hand (`npm run connectors:X`
 *  then a manual `gbrain sync`) after updating a token. Mutating and slow
 *  (a live fetch plus an embed pass), so this blocks the request — do not
 *  reuse the read-only `gb()` helper, which is documented as unsafe for
 *  mutating commands and kills long-running processes early. */
async function syncConnector(name: string): Promise<{ ok: boolean; detail: string }> {
  if (!isConnectorName(name)) return { ok: false, detail: "不明なコネクタ / unknown connector" };
  const cfg = readJson<Record<string, any>>("config/connectors.json", {});
  const c = cfg[name];
  if (!c) return { ok: false, detail: "未設定 / not configured yet" };

  const subdir = String(c.subdir || "shared");
  // Snapshot BEFORE the pull runs — this is what makes attribution correct
  // when another connector shares this subdir and left it dirty already
  // (see appendSyncLog's doc comment).
  const beforePull = gitStatusFor(subdir);

  const pull = spawnSync("bun", [connectorRunner(name)], {
    cwd: REPO, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL",
  });
  if (pull.status !== 0) {
    return { ok: false, detail: `取り込み失敗 / fetch failed: ${(pull.stderr || pull.error?.message || "unknown error").toString().slice(0, 200)}` };
  }

  // Log what's about to be embedded (source, hash, who, when) before the
  // embed pass, so the trail exists even if the embed step itself fails.
  appendSyncLog(name, subdir, beforePull);

  const sync = spawnSync("bun", ["src/cli.ts", "sync", "--source", subdir, "--working-tree"], {
    cwd: join(REPO, "packages/brain"),
    env: { ...process.env, GBRAIN_HOME: gbrainHome(), GBRAIN_DISABLE_UPGRADE_CHECK: "1", GBRAIN_SKIP_STARTUP_HOOKS: "1" },
    encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL",
  });
  if (sync.status !== 0) {
    return { ok: false, detail: `同期失敗 / sync failed: ${(sync.stderr || sync.error?.message || "unknown error").toString().slice(0, 200)}` };
  }

  connectorsCached.clear();
  return { ok: true, detail: "最新の内容を取り込みました / synced the latest content" };
}

function reviewsView() {
  const file = readJson<{ note?: string; reviews: ReviewItem[] }>("config/reviews.json", { reviews: [] });
  const rules = redactionRules();
  const rows = (file.reviews ?? []).map((r) => {
    const red = redact(r.body, rules);
    return {
      id: r.id, title: r.title, intent: r.intent, audience: r.audience,
      submittedBy: r.submittedBy, submittedAt: r.submittedAt, state: r.state,
      sources: r.sources ?? [],
      risk: overallRisk(r),
      checks: CHECK_KEYS.map((k) => ({ key: k, ...CHECK_LABELS[k], ...r.checks[k] })),
      decision: latestDecision(r),
      receipt: receiptLine(r),
      bodyMasked: red.text,
      redaction: { blocked: red.blocked, summary: summariseHits(red.hits), count: red.hits.length },
      // Governance gate, computed from the same pure functions recordDecision()
      // itself checks against — the client never re-implements this logic, it
      // only renders `allowed`/`approveGate` as given.
      allowed: allowedVerdicts(r),
      approveGate: canApprove(r),
    };
  });
  const open = rows.filter((r) => r.state === "submitted" || r.state === "in_review");
  return {
    note: file.note ?? "",
    canSubmit: !READ_ONLY,
    rules: rules.map((r) => ({ name: r.name, label: r.label, action: r.action })),
    counts: {
      open: open.length,
      approved: rows.filter((r) => r.state === "approved").length,
      revise: rows.filter((r) => r.state === "revise").length,
      rejected: rows.filter((r) => r.state === "rejected").length,
      escalated: rows.filter((r) => r.state === "escalated").length,
    },
    rows,
  };
}

function tasksView() {
  const file = readJson<{ source?: string; note?: string; extractedAt?: string; tasks: Task[] }>(
    "config/tasks.json", { tasks: [] },
  );
  const policy: DecayPolicy = { ...DEFAULT_POLICY, ...readJson<Partial<DecayPolicy>>("config/task-policy.json", {}) };
  const now = Date.now();
  const rows = triage(file.tasks ?? [], now, policy);
  const cold = rows.filter((r) => r.bucket === "cold");
  const counts = { hot: 0, warm: 0, cold: 0, noise: 0 };
  for (const r of rows) counts[r.bucket]++;
  return {
    source: file.source ?? "engineering",
    note: file.note ?? "",
    extractedAt: file.extractedAt ?? null,
    policy,
    counts,
    rows,
    archiveNote: rollupLine(cold, now),
  };
}

// One skill actually executed once at boot (background) so the Automations
// screen can show real run details: which sources each step read, and any
// violation of the skill's declared `reads:`. Heavy (steps × retrieval × local
// model), so it runs last, against one source, first few steps only.
const RUN_SKILL = "decision-log-audit";
const RUN_SCOPE = "all-hands";
const RUN_STEPS = 3;
let skillRun: (SkillRunReceipt & { note?: string; stepsShown: number; stepsTotal: number }) | null = null;

async function computeSkillRun() {
  if (process.env.DEMO_SKILL_RUN === "0") return;
  try {
    const file = join(REPO, "brain-sources/shared/skills", RUN_SKILL, "SKILL.md");
    if (!existsSync(file)) return;
    const full = parseSkill(readFileSync(file, "utf8"));
    const skill = { ...full, steps: full.steps.slice(0, RUN_STEPS) };
    // one source keeps it inside a demo-tolerable boot budget; the receipt then
    // legitimately shows actualReads ⊂ declaredReads for this run.
    const runner = createLiveStepRunner({ model: MODEL, topK: 2 });
    const oneSource = async (instruction: string, _sources: string[]) => runner(instruction, ["engineering"]);
    const receipt = await runSkill(skill, {
      scope: RUN_SCOPE, grantedSources: ["engineering", "shared"], stepRunner: oneSource,
    });
    skillRun = { ...receipt, stepsShown: skill.steps.length, stepsTotal: full.steps.length };
    console.log(`  skill run ready: ${RUN_SKILL} (${receipt.steps.length} steps, ${receipt.violations.length} violations)`);
  } catch (err) {
    console.warn(`  skill run unavailable: ${(err as Error).message}`);
  }
}

// ── activity (Task 10) ──────────────────────────────────────────────────────
// Two real sources, merged — no third, parallel "fake" data source:
//   1. the one genuine per-skill run receipt in the system (computeSkillRun's
//      module-level `skillRun`, above) — real timestamps, real scope, real
//      violations.
//   2. every real review-submission event (reviewsView().rows, config/reviews
//      .json) — real state, real submittedAt/submittedBy, real sources.
// An entry type with no real backing data for a field (a review's "duration",
// a skill run's "initiator" — SkillRunReceipt carries neither) shows "—"
// rather than inventing one.
type ActivityOutcome = "success" | "pending" | "failure";
type ActivityRetry = { kind: "skill-run" } | { kind: "review"; reviewId: string };
type ActivityEntry = {
  id: string;
  time: string | null;
  label: string;
  initiator: string;
  sources: string[];
  outcome: ActivityOutcome;
  outcomeLabel: string;
  duration: string;
  needsRetry: boolean;
  retry?: ActivityRetry;
  detail?: string;
  affected?: string;
  action?: string;
};

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function fmtActivityTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtActivityDuration(startedAt?: string, endedAt?: string): string {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const REVIEW_STATE_OUTCOME: Record<string, ActivityOutcome> = {
  approved: "success",
  revise: "failure",
  rejected: "failure",
  escalated: "failure",
  submitted: "pending",
  in_review: "pending",
};
const REVIEW_STATE_LABEL: Record<string, string> = {
  approved: "Approved",
  revise: "Needs revision",
  rejected: "Rejected",
  escalated: "Escalated",
  submitted: "Submitted",
  in_review: "In review",
};

// Exported for testing: unlike renderPage() (a module-level constant baked
// once at import time), this reads config/reviews.json fresh on every call
// -- the same function the live /api/activity route uses -- so a test can
// seed a fixture and see it reflected without needing to reload the module.
export function activityView(): { entries: ActivityEntry[] } {
  const entries: ActivityEntry[] = [];

  // Source 1: the one real per-skill run receipt (module-level `skillRun`,
  // populated at boot by computeSkillRun() — see above). May be null (never
  // ran, or DEMO_SKILL_RUN=0) — that's a normal state, not an error.
  if (skillRun) {
    const failed = skillRun.violations.length > 0;
    entries.push({
      id: "skill-run",
      time: skillRun.endedAt,
      label: `Automation run: ${skillRun.skill}`,
      initiator: "—", // SkillRunReceipt has no real initiator field to show
      sources: skillRun.scope.federatedRead,
      outcome: failed ? "failure" : "success",
      outcomeLabel: failed ? "Failed" : "Success",
      duration: fmtActivityDuration(skillRun.startedAt, skillRun.endedAt),
      needsRetry: failed,
      retry: failed ? { kind: "skill-run" } : undefined,
      detail: failed ? `Read outside its declared or granted scope: ${skillRun.violations.join(" ")}` : undefined,
      affected: failed ? `Scope "${skillRun.scope.name}"` : undefined,
      action: failed ? "Retry the run, or narrow the skill's declared reads." : undefined,
    });
  }

  // Source 2: every real review-submission event.
  for (const r of reviewsView().rows) {
    const outcome = REVIEW_STATE_OUTCOME[r.state] ?? "pending";
    const needsRetry = outcome === "failure";
    entries.push({
      id: r.id,
      time: r.submittedAt,
      label: r.title,
      initiator: r.submittedBy || "—",
      sources: r.sources,
      outcome,
      outcomeLabel: REVIEW_STATE_LABEL[r.state] ?? r.state,
      duration: "—", // reviews have no real duration concept — not fabricated
      needsRetry,
      retry: needsRetry ? { kind: "review", reviewId: r.id } : undefined,
      detail: needsRetry ? (r.decision?.note || `Review marked "${r.state}".`) : undefined,
      affected: needsRetry ? r.audience : undefined,
      action: needsRetry ? "Revise and resubmit from Approvals." : undefined,
    });
  }

  entries.sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime());
  return { entries };
}

function activityBadgeClass(outcome: ActivityOutcome): string {
  return outcome === "success" ? "tako-badge--success" : outcome === "pending" ? "tako-badge--warning" : "tako-badge--error";
}

function renderActivityItem(e: ActivityEntry): string {
  const apps = e.sources.length ? e.sources.join(", ") : "—";
  const retryAttrs = e.retry
    ? ` data-retry-kind="${escHtml(e.retry.kind)}"${e.retry.kind === "review" ? ` data-review-id="${escHtml(e.retry.reviewId)}"` : ""}`
    : "";
  return `<li class="tako-activity-item" data-outcome="${escHtml(e.outcome)}">`
    + `<div class="tako-activity-top"><span class="tako-activity-time">${escHtml(fmtActivityTime(e.time))}</span>`
    + `<span class="tako-badge ${activityBadgeClass(e.outcome)}">${escHtml(e.outcomeLabel)}</span></div>`
    + `<p class="tako-activity-label">${escHtml(e.label)}</p>`
    + `<div class="tako-activity-meta">`
      + `<span><b>Initiator</b> ${escHtml(e.initiator)}</span>`
      + `<span><b>Apps/sources</b> ${escHtml(apps)}</span>`
      + `<span><b>Duration</b> ${escHtml(e.duration)}</span>`
    + `</div>`
    + (e.needsRetry
      ? `<div class="tako-activity-failure">`
        + (e.detail ? `<p>${escHtml(e.detail)}</p>` : "")
        + (e.affected ? `<p><b>Affected</b> ${escHtml(e.affected)}</p>` : "")
        + (e.action ? `<p>${escHtml(e.action)}</p>` : "")
        + `<button class="tako-btn tako-btn--secondary"${retryAttrs}>Retry</button>`
        + `</div>`
      : "")
    + `</li>`;
}

export function renderActivityList(entries: ActivityEntry[]): string {
  return entries.length ? entries.map(renderActivityItem).join("") : '<li class="hint">No activity yet.</li>';
}

// The Overview's worked example. A live retrieve-then-extract at boot froze the
// single-threaded server (spawnSync `search` does not self-exit on this build),
// so ship a verified, previously-generated entry and let a background refresh
// replace it if it succeeds. The answer below was produced by this exact
// pipeline (qwen2.5:3b-instruct over the engineering source) and hand-checked
// against discord/hearing/thread-onocom-1542758419616890930.
const WORKED_QUESTION = "オノコムのヒアリングはいつ・どこで、オンラインか対面か？";
type Worked = { question: string; answer: string; pages: string[]; cited: string[]; ms: number; source: string; canned?: boolean };
let workedEntry: Worked = {
  question: WORKED_QUESTION,
  answer:
    "オノコムのヒアリングは8月31日（月）14:00に、オノコムの事務所で対面で行われます。" +
    "受付は事務所の1階で、名前を伝えれば対応してもらえます。車で行く場合は敷地内（R259側）の来客用駐車場を使えます。 " +
    "[discord/hearing/thread-onocom-1542758419616890930]",
  pages: ["discord/hearing/thread-onocom-1542758419616890930"],
  cited: ["discord/hearing/thread-onocom-1542758419616890930"],
  ms: 9000,
  source: DEFAULT_SOURCE,
  canned: true,
};

async function refreshWorkedEntry() {
  try {
    const r = await answerFromSource(WORKED_QUESTION, DEFAULT_SOURCE, { model: MODEL, topK: 3 });
    if (r.pages.length) {
      workedEntry = { question: WORKED_QUESTION, answer: r.answer, pages: r.pages, cited: citedSlugs(r.answer), ms: r.ms, source: DEFAULT_SOURCE };
      console.log(`  worked entry refreshed live (${r.ms} ms)`);
    }
  } catch (err) {
    console.warn(`  worked entry: keeping canned copy (${(err as Error).message})`);
  }
}

// gb() below the surface is spawnSync — it blocks this single-threaded server
// for the length of each call. Cache the read-only aggregates so clicking around
// on stage stays snappy; an ask still blocks (~30s, one presenter, spinner shows).
type Memoised<T> = (() => T) & { clear: () => void };
function memo<T>(ttlMs: number, fn: () => T): Memoised<T> {
  let at = 0;
  let value: T;
  const m = (() => {
    if (Date.now() - at > ttlMs) { value = fn(); at = Date.now(); }
    return value;
  }) as Memoised<T>;
  m.clear = () => { at = 0; };
  return m;
}
const overviewCached = memo(15_000, overview);
const accessCached = memo(15_000, () => {
  let dash: ReturnType<typeof loadDashboard> | { mode: string; banner: string; brains: never[] };
  try { dash = loadDashboard(); } catch (e) { dash = { mode: "sources", banner: (e as Error).message, brains: [] }; }
  let members: ReturnType<typeof loadMembers> = [];
  try {
    members = loadMembers()
      .filter((m) => !/^test-/.test(m.name))                        // hide dev fixture clients
      .map((m) => (m.name === "me" ? { ...m, name: "Owner (you)", isOwner: true } : { ...m, isOwner: false }));
  } catch { /* none */ }
  return { ...dash, members };
});
const skillsCached = memo(15_000, skillsView);
const tasksCached = memo(10_000, tasksView);
const reviewsCached = memo(10_000, reviewsView);
const connectorsCached = memo(8_000, connectorsView);
const industrialCatalogCached = memo(60_000, industrialCatalogView);

// ── http ───────────────────────────────────────────────────────────────────
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

export function renderPage(): string {
  return PAGE;
}

// Mutating routes gated by X-Admin-Token — see requireAdmin() in
// lib/util/http-security.ts. Checked once, before the route if-chain, rather
// than repeated per-route below.
const ADMIN_ROUTES = new Set([
  "/api/automations/create",
  "/api/activity/retry",
  "/api/review-submit",
  "/api/review-decide",
  "/api/connectors/save",
  "/api/connectors/test",
  "/api/connectors/sync",
  "/api/ask-provider",
]);

if (import.meta.main) {
  const ADMIN_TOKEN = resolveAdminToken();
  Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    idleTimeout: 240,
    async fetch(req, server) {
      const url = new URL(req.url);
      try {
        if (req.method === "POST" && ADMIN_ROUTES.has(url.pathname)) {
          const err = requireAdmin(req, ADMIN_TOKEN);
          if (err) return json({ error: err.message }, err.status);
        }

        if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });

        // Whitelisted, read-only credential guides. The path segment is
        // matched against the exact filenames CONNECTOR_SPECS references —
        // never resolved from the URL itself — so this cannot be used for
        // directory traversal or to serve arbitrary repo files.
        if (url.pathname.startsWith("/docs/connectors/")) {
          const requested = url.pathname.slice("/docs/connectors/".length);
          const known = new Set(Object.values(CONNECTOR_SPECS).map((s) => s.credentialsDoc).filter(Boolean));
          if (known.has(requested)) {
            const file = Bun.file(new URL(`../docs/connectors/${requested}`, import.meta.url));
            return new Response(file, { headers: { "content-type": "text/markdown; charset=utf-8" } });
          }
          return new Response("Not found", { status: 404 });
        }

        if (url.pathname === "/api/overview") {
          return json({ ...overviewCached(), worked: workedEntry });
        }

        if (url.pathname === "/api/ask" && req.method === "POST") {
          if (!checkRateLimit(`ask:${clientKey(req, server)}`, 10, 60_000)) {
            return json({ error: "too many requests, try again shortly" }, 429);
          }
          const { question, source, category } = await readJsonBody<{ question?: string; source?: string; category?: string }>(req);
          const q = String(question ?? "").trim();
          if (!q) return json({ error: "質問を入力してください" }, 400);
          const src = String(source || DEFAULT_SOURCE);
          const dept = DEPARTMENTS.includes(category as Department) ? (category as Department) : undefined;
          const r = await answerFromSource(q, src, { model: MODEL, department: dept });
          return json({ answer: r.answer, pages: r.pages, retrieved: r.retrieved, cited: citedSlugs(r.answer), ms: r.ms, source: src, category: dept ?? null });
        }

        if (url.pathname === "/api/ask-provider" && req.method === "POST") {
          const { provider } = await readJsonBody<{ provider?: string }>(req);
          if (provider !== "ollama" && provider !== "gemini") {
            return json({ error: 'provider must be "ollama" or "gemini"' }, 400);
          }
          if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
            return json({ error: "GEMINI_API_KEY is not set — add it to .env and restart before switching to Gemini" }, 400);
          }
          // In-memory only, not persisted to .env — a real server restart
          // always falls back to .env's own setting, so a demo session can
          // never accidentally leave hosted-provider mode on permanently.
          process.env.ASK_PROVIDER = provider;
          return json({ ok: true, provider, localOnly: !usesHostedProvider() });
        }

        if (url.pathname === "/api/page") {
          const slug = url.searchParams.get("slug") ?? "";
          const source = url.searchParams.get("source") ?? DEFAULT_SOURCE;
          if (!slug) return json({ error: "slug required" }, 400);
          return json({ slug, source, body: pageBody(slug, source) });
        }

        if (url.pathname === "/api/access") {
          return json(accessCached());
        }

        if (url.pathname === "/api/skills") {
          return json(skillsCached());
        }

        if (url.pathname === "/api/automations/create" && req.method === "POST") {
          const { trigger, action1, action2 } = await readJsonBody<{ trigger?: string; action1?: string; action2?: string }>(req);
          const result = createAutomation(String(trigger ?? ""), String(action1 ?? ""), String(action2 ?? ""));
          if ("error" in result) return json(result, 400);
          return json(result);
        }

        if (url.pathname === "/api/tasks") {
          return json(tasksCached());
        }

        if (url.pathname === "/api/reviews") {
          return json(reviewsCached());
        }

        if (url.pathname === "/api/activity") {
          return json(activityView());
        }

        if (url.pathname === "/api/activity/retry" && req.method === "POST") {
          if (!checkRateLimit(`activity-retry:${clientKey(req, server)}`, 2, 60_000)) {
            return json({ error: "too many requests, try again shortly" }, 429);
          }
          if (READ_ONLY) throw new ClientError("この画面は読み取り専用です / this instance is read-only");
          const { kind } = await readJsonBody<{ kind?: string }>(req);
          if (kind !== "skill-run") return json({ error: "unsupported retry kind" }, 400);
          // Re-invoke the exact same run path used at boot (computeSkillRun),
          // not a fake progress animation — a real re-run of the same skill.
          await computeSkillRun();
          return json(activityView());
        }

        if (url.pathname === "/api/redact-try" && req.method === "POST") {
          const { text } = await readJsonBody<{ text?: string }>(req);
          return json(redact(String(text ?? ""), redactionRules()));
        }

        if (url.pathname === "/api/review-submit" && req.method === "POST") {
          return json(submitReview(await readJsonBody<Record<string, string>>(req)));
        }

        if (url.pathname === "/api/review-decide" && req.method === "POST") {
          return json(reviewDecide(await readJsonBody<Record<string, string>>(req)));
        }

        if (url.pathname === "/api/connectors") {
          return json(connectorsCached());
        }
        if (url.pathname === "/api/connectors/industrial-catalog") {
          return json(industrialCatalogCached());
        }
        if (url.pathname === "/api/connectors/save" && req.method === "POST") {
          const b = await readJsonBody<{ name?: string } & Record<string, any>>(req);
          return json(saveConnector(String(b.name), b));
        }
        if (url.pathname === "/api/connectors/test" && req.method === "POST") {
          const { name } = await readJsonBody<{ name?: string }>(req);
          return json(await testConnector(String(name)));
        }
        if (url.pathname === "/api/connectors/sync" && req.method === "POST") {
          if (!checkRateLimit(`connectors-sync:${clientKey(req, server)}`, 5, 60_000)) {
            return json({ error: "too many requests, try again shortly" }, 429);
          }
          const { name } = await readJsonBody<{ name?: string }>(req);
          return json(await syncConnector(String(name)));
        }

        return new Response("not found", { status: 404 });
      } catch (err) {
        return safeErrorResponse(err, json);
      }
    },
  });

  console.log(`\n  tako demo  →  http://localhost:${PORT}`);
  console.log(`  model: ${MODEL}   ·   default source: ${DEFAULT_SOURCE}   ·   GBRAIN_HOME=${gbrainHome()}`);
  console.log(usesHostedProvider()
    ? `  ⚠ DEMO MODE — synthesis is routed to an external API (Gemini), not local Ollama. Do not use with real customer data.\n`
    : `  local only — retrieval and synthesis both run on Ollama, nothing leaves this machine\n`);
  // Pre-warm the blocking reads so the stage machine's first paint is instant.
  // The Overview's worked entry stays the hand-verified canned copy — the live
  // 3B model is (correctly) shown only in the Ask tab, where the presenter drives
  // and the draft caveat is in full view. Set DEMO_LIVE_WORKED=1 to override.
  setTimeout(() => {
    try { overviewCached(); accessCached(); skillsCached(); tasksCached(); reviewsCached(); connectorsCached(); industrialCatalogCached(); console.log("  summaries warm"); } catch (e) { console.warn(`  warmup: ${(e as Error).message}`); }
    if (process.env.DEMO_LIVE_WORKED === "1") refreshWorkedEntry();
    // last, and only after the summaries are warm — this one blocks for a while
    setTimeout(computeSkillRun, 1500);
  }, 400);
}

// ── navigation ─────────────────────────────────────────────────────────────
// The grouped left sidebar per the tako information architecture. Screen ids
// here are what `.section[data-name]` and `goto()` key off of.
export const NAV_GROUPS = [
  { group: "Workspace", items: [
    { id: "home", label: "Home" },
    { id: "ask", label: "Ask Tako" },
  ]},
  { group: "Automate", items: [
    { id: "automations", label: "Automations" },
    { id: "connect", label: "Connected Apps" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
  ]},
  { group: "Govern", items: [
    { id: "approvals", label: "Approvals" },
    { id: "permissions", label: "Team & Permissions" },
  ]},
] as const;

function renderSidebarNav(): string {
  const groups = NAV_GROUPS.map((g) => `
    <div class="tako-nav-group">
      <div class="tako-nav-group-label">${g.group}</div>
      ${g.items.map((item) => `<button class="tako-nav-item" data-name="${item.id}">${item.label}</button>`).join("")}
    </div>`).join("");
  return `
  <nav class="tako-sidebar" aria-label="Main">
    <div class="tako-wordmark">tako</div>
    ${groups}
    <div class="tako-nav-footer">
      <button class="tako-nav-item" data-name="settings">Settings</button>
      <button class="tako-nav-item" data-name="help">Help</button>
    </div>
  </nav>`;
}

// ── page ───────────────────────────────────────────────────────────────────
// Tako keeps its governance truth inside Yoom's calm, airy interface grammar.
const PAGE = /* html */ `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tako ・ 台帳</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper); color:var(--ink);
  font:400 16px/1.75 var(--sans);
  font-feature-settings:"palt" 1;
  -webkit-font-smoothing:antialiased;
}
::selection{background:rgba(192,57,43,.16)}
a{color:var(--vermilion-ink);text-underline-offset:3px;text-decoration-thickness:1px}
b,strong{font-weight:700}
.tnum{font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono);font-size:.86em}


/* ── page column ───────────────────────────────────────────────── */
.page{position:relative;padding:64px clamp(34px,6vw,92px) 112px;min-width:0}
.sheet{max-width:var(--col);margin:0 auto}
h1{font:700 clamp(34px,4vw,52px)/1.28 var(--serif);margin:0 0 8px;letter-spacing:-.025em}
h2{font:600 22px/1.5 var(--serif);margin:56px 0 6px;letter-spacing:-.01em}
.section{display:none;animation:rise .44s cubic-bezier(.16,.84,.44,1) both}
.section[data-active]{display:block}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── ledger summary block ──────────────────────────────────────── */
.ledger{border:1px solid var(--rule);background:var(--paper-2);margin:30px 0 8px;border-radius:14px;overflow:hidden;box-shadow:0 12px 34px rgba(48,40,32,.05)}
.ledger .row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:baseline;
  padding:13px 18px;border-bottom:1px solid var(--rule)}
.ledger .row:last-child{border-bottom:0}
.ledger .row .k{font-size:13px;color:var(--ink-soft)}
.ledger .row .v{font:700 22px/1 var(--serif);font-variant-numeric:tabular-nums}
.ledger .row .v small{font:500 11px/1 var(--sans);color:var(--ink-faint);margin-left:6px}
.hint{font-size:12.5px;color:var(--ink-faint);margin:10px 2px 0}

/* ── filed entry (Q→A) ─────────────────────────────────────────── */
.entry{position:relative;margin:24px 0;padding:26px 28px 24px;background:var(--paper-2);
  border:1px solid var(--rule);border-radius:14px;box-shadow:0 14px 36px rgba(48,40,32,.06)}
.entry.sealed .q,.entry.sealed .a{padding-right:88px}
.entry .q{font:600 16px/1.7 var(--serif);color:var(--ink);margin:0 0 4px}
.entry .q::before{content:"Q ";color:var(--vermilion-ink);font-weight:700;font-size:.82em;letter-spacing:.05em}
.entry .a{margin:14px 0 0;white-space:pre-wrap;line-height:1.85}
.entry .a::before{content:"A ";color:var(--ink-soft);font-weight:700;font-family:var(--serif);font-size:.82em;letter-spacing:.05em}
.entry .meta{margin-top:16px;padding-top:12px;border-top:1px solid var(--rule);
  display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:12px;color:var(--ink-faint)}
.entry .trail{margin-top:8px;display:flex;flex-wrap:wrap;gap:7px 12px;align-items:center;
  font-size:11.5px;color:var(--ink-faint)}
.entry .trail .t-n{background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:2px 8px}
.entry .caveat{margin-top:12px;font-size:11px;line-height:1.6;color:var(--ink-faint);font-style:normal}
.cite{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 7px;
  background:var(--paper);border:1px solid var(--rule-strong);border-radius:6px;
  font-family:var(--mono);font-size:11px;color:var(--ink-soft);cursor:pointer;transition:border-color .12s}
.cite:hover{border-color:var(--vermilion)}
.cite::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--vermilion);flex:none}

/* the seal: marks that the answer is filed against an openable source.
   It certifies provenance, not correctness — the meta line says "要確認". */
.seal{position:absolute;top:16px;right:16px;width:62px;height:62px;border-radius:50%;
  border:2px solid var(--vermilion);color:var(--vermilion);
  display:grid;place-content:center;text-align:center;
  font:700 11px/1.3 var(--serif);letter-spacing:.06em;
  transform:rotate(-7deg);opacity:.92;
  box-shadow:inset 0 0 0 3px var(--paper-2), inset 0 0 0 4px rgba(192,57,43,.35)}
.seal b{display:block;font-size:16px;font-weight:700;margin-top:1px}
.seal.stamp{animation:stamp .34s cubic-bezier(.16,.84,.44,1) both}
@keyframes stamp{0%{opacity:0;transform:rotate(-7deg) scale(1.45)}40%{opacity:1}100%{transform:rotate(-7deg) scale(1)}}

/* ── ask form ──────────────────────────────────────────────────── */
form.ask{margin:24px 0 0}
.ask textarea{width:100%;min-height:106px;resize:vertical;background:var(--paper-2);
  border:1px solid var(--rule);border-radius:14px;padding:16px 18px;
  font:400 15.5px/1.7 var(--sans);color:var(--ink)}
.ask textarea:focus{outline:2px solid rgba(183,71,52,.38);outline-offset:2px;border-color:var(--vermilion)}
.ask .controls{display:flex;align-items:center;gap:12px;margin-top:12px}
.ask select{font:400 13px var(--sans);padding:9px 12px;background:var(--paper-2);
  border:1px solid var(--rule-strong);border-radius:8px;color:var(--ink)}
button.file{margin-left:auto;font:600 14px var(--serif);letter-spacing:.06em;
  padding:11px 24px;border:1px solid var(--vermilion);background:var(--vermilion);color:#fff;
  border-radius:999px;cursor:pointer;transition:background .14s,transform .12s,box-shadow .14s}
button.file:hover{background:var(--vermilion-ink)}
button.file:active{transform:translateY(1px)}
button.file:disabled{opacity:.5;cursor:default}
.working{display:flex;align-items:center;gap:12px;color:var(--ink-soft);font-size:13.5px;margin:20px 2px}
.working .ring{width:16px;height:16px;border-radius:50%;border:2px solid var(--rule-strong);
  border-top-color:var(--vermilion);animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.note-err{border:1px solid rgba(183,71,52,.34);border-radius:10px;padding:10px 14px;color:var(--vermilion-ink);
  background:rgba(183,71,52,.045);font-size:13.5px;margin:16px 0}

/* ── access section ───────────────────────────────────────────── */
.banner{border:1px solid var(--warn);background:rgba(154,107,30,.08);color:var(--warn);
  padding:10px 14px;font-size:13px;margin:18px 0}
.bound{font-size:12.5px;line-height:1.7;border-top:1px solid var(--rule);padding-top:10px}
.bound .in{color:var(--ok)}.bound .out{color:var(--vermilion-ink)}
.bound b{font-family:var(--serif)}

/* ── skills section ───────────────────────────────────────────── */
.tag{display:inline-block;font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:2px;border:1px solid var(--rule-strong)}
.tag.read{color:var(--indigo);background:var(--paper)}
.tag.grant{color:var(--ok);border-color:var(--ok)}
.tag.none{color:var(--vermilion-ink);border-color:var(--vermilion);font-family:var(--sans)}

/* ── working memory ───────────────────────────────────────────── */
.mbucket{border:1px solid var(--rule-strong);background:var(--paper-2);margin:14px 0;padding:0}
.mbucket .mb-head{display:flex;align-items:baseline;gap:10px;padding:12px 18px;border-bottom:1px solid var(--rule);
  font-size:13px}
.mbucket .mb-head b{font-family:var(--serif);font-size:14px}
.mbucket .mb-head span{color:var(--ink-faint);font-size:11px}
.mbucket .mb-head .mb-n{margin-left:auto;font:700 15px/1 var(--serif)}
.mbucket .mb-head::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--rule-strong);flex:none;align-self:center}
.mbucket.b-needs-attention .mb-head::before{background:var(--ok)}
.mbucket.b-ready-to-archive .mb-head::before{background:var(--vermilion)}
.mbucket.b-excluded .mb-head{color:var(--ink-faint)}
.mtask{padding:11px 18px;border-bottom:1px solid var(--rule)}
.mtask:last-child{border-bottom:0}
.mt-main{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.mt-title{font-size:14px}
.mt-dl{font-size:11px;color:var(--warn)}
.mt-meta{margin-top:5px;font-size:11.5px;color:var(--ink-faint);line-height:1.9}
.mt-score{background:var(--paper);border:1px solid var(--rule);border-radius:2px;padding:1px 6px}
.mt-reason{color:var(--ink-soft)}
.task-archive-note{border:1px solid var(--vermilion);background:rgba(192,57,43,.05);padding:16px 18px;margin:18px 0}
.task-archive-note b{font-family:var(--serif);font-size:14px}
.task-archive-note p.mono{font-size:12px;line-height:1.7;margin:8px 0;color:var(--ink)}

/* ── review desk + redaction ─────────────────────────────────── */
.rules-strip{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 4px}
.rules-strip .tag{font-family:var(--mono);font-size:10.5px}
.rules-strip .tag.a-block{color:var(--vermilion-ink);border-color:var(--vermilion)}
.rules-strip .tag.a-mask{color:var(--indigo)}
.rules-strip .tag.a-flag{color:var(--ink-faint)}
.redbox{border:1px solid var(--rule-strong);background:var(--paper-2);padding:14px 16px;margin:14px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.8}
.redbox .box{background:rgba(192,57,43,.10);border:1px solid var(--rule-strong);border-radius:2px;padding:0 4px;font-family:var(--mono);font-size:11.5px;color:var(--vermilion-ink)}
.red-sum{font-size:12px;color:var(--ink-faint);margin-top:8px}
.red-blocked{color:var(--vermilion-ink);font-weight:700}

.rv-card{border:1px solid var(--rule-strong);background:var(--paper-2);margin:14px 0;padding:18px 20px}
.rv-top{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:baseline}
.rv-card h3{margin:0;font:600 16px/1.4 var(--serif);flex:1 1 auto}
.rv-fields{font-size:12.5px;color:var(--ink-soft);margin:8px 0 0;line-height:1.8}
.rv-fields b{font-family:var(--serif);color:var(--ink-faint);font-weight:600;margin-right:4px}
.rv-body{border:1px solid var(--rule);background:var(--paper);padding:12px 14px;margin:12px 0;
  white-space:pre-wrap;font-size:12.5px;line-height:1.75;color:var(--ink-soft);max-height:12em;overflow:auto}
.rv-body .box{background:rgba(192,57,43,.10);border:1px solid var(--rule-strong);border-radius:2px;padding:0 3px;font-family:var(--mono);font-size:11px;color:var(--vermilion-ink)}
.rv-checks{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.chk{display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--rule-strong);border-radius:2px;padding:3px 8px;font-size:11.5px}
.chk .m{font-family:var(--mono);font-weight:700}
.chk.s-ok .m{color:var(--ok)}
.chk.s-concern .m{color:var(--warn)}
.chk.s-blocker .m{color:var(--vermilion)}
.chk.s-unchecked{color:var(--ink-faint)}
.rv-decision{margin-top:12px;padding-top:10px;border-top:1px solid var(--rule);font-size:12px;color:var(--ink-faint)}
.rv-decision .verdict{font-family:var(--serif);font-weight:700}
.rv-decision .receipt{display:block;margin-top:4px;font-family:var(--mono);font-size:10.5px;word-break:break-word}
.risk{font-size:10.5px;padding:1px 8px;border-radius:9999px;border:1px solid currentColor;letter-spacing:.04em}
.risk.low{color:var(--ok)} .risk.medium{color:var(--warn)} .risk.high{color:var(--vermilion-ink)}

.intake{margin:14px 0 0;display:flex;flex-direction:column;gap:12px}
.intake .grid2{display:grid;gap:12px}
@media(min-width:640px){.intake .grid2{grid-template-columns:1fr 1fr}}
.intake label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--ink-faint)}
.intake input,.intake textarea{background:var(--paper-2);border:1px solid var(--rule-strong);border-radius:2px;
  padding:9px 11px;font:400 14px/1.6 var(--sans);color:var(--ink)}
.intake textarea{min-height:120px;resize:vertical}
.intake input:focus,.intake textarea:focus{outline:2px solid rgba(183,71,52,.38);outline-offset:1px}
.intake .controls{align-items:center}
.form-ok{border:1px solid rgba(63,107,75,.35);border-radius:10px;padding:9px 13px;color:var(--ok);font-size:13.5px;margin:14px 0;background:rgba(63,107,75,.05)}

/* ── connect a service ───────────────────────────────────────── */
.cx{border:1px solid var(--rule-strong);background:var(--paper-2);margin:12px 0}
.cx-head{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;user-select:none}
.cx-head h3{margin:0;font:600 16px/1.4 var(--serif);flex:1 1 auto}
.cx-head .tokm{font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
.cx-head .chev{color:var(--ink-faint);font-size:12px;transition:transform .15s}
.cx[open] .cx-head .chev{transform:rotate(90deg)}
.cx-body{display:none;padding:2px 18px 18px;border-top:1px solid var(--rule)}
.cx[open] .cx-body{display:block}
.cx-help{font-size:12.5px;color:var(--ink-soft);margin:12px 0}
.cx-body label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--ink-faint);margin:10px 0}
.cx-body input{background:var(--paper);border:1px solid var(--rule-strong);border-radius:2px;padding:9px 11px;
  font:400 13.5px/1.5 var(--sans);color:var(--ink)}
.cx-body input:focus{outline:2px solid rgba(183,71,52,.38);outline-offset:1px}
.cx-body input.mono{font-family:var(--mono);font-size:12.5px}
.cx-actions{display:flex;gap:10px;align-items:center;margin-top:14px}
.cx-actions .test{background:transparent;border:1px solid var(--rule-strong);color:var(--ink-soft);
  font:500 13px var(--sans);padding:9px 16px;border-radius:2px;cursor:pointer}
.cx-actions .test:hover{border-color:var(--vermilion);color:var(--ink)}
.cx-actions .out{font-size:12px;color:var(--ink-faint)}
.cx-actions .out.ok{color:var(--ok)} .cx-actions .out.bad{color:var(--vermilion-ink)}
.dot-ok,.dot-off{width:8px;height:8px;border-radius:50%;flex:none}
.dot-ok{background:var(--ok)} .dot-off{background:var(--rule-strong)}
.industrial{margin-top:18px;border-top:1px solid var(--rule-strong);padding-top:14px}
.industrial .ih{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:10px}
.industrial .ih b{font:600 14px/1.4 var(--serif)}
.industrial .ih span{font-size:11px;color:var(--ink-faint)}
.ind-domain{margin:12px 0 4px;font:600 11px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--vermilion-ink)}
.ind-row{display:grid;grid-template-columns:18px minmax(130px,1fr) minmax(90px,.7fr) minmax(70px,.5fr);gap:8px;
  padding:7px 0;border-bottom:1px solid var(--rule);align-items:baseline;font-size:11.5px}
.ind-row .mark{font-family:var(--mono);color:var(--ink-faint)}
.ind-row .mark.built{color:var(--ok)}
.ind-row .name{font-weight:600;color:var(--ink)}
.ind-row .risk,.ind-row .wave{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint)}
.pill{display:inline-block;font-size:11px;padding:2px 9px;border-radius:9999px;border:1px solid currentColor}
.pill.ok{color:var(--ok)}.pill.warn{color:var(--warn)}
table.mem{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
table.mem th{text-align:left;font:500 10.5px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink-faint);padding:10px 12px;border-bottom:1px solid var(--rule-strong)}
table.mem td{padding:11px 12px;border-bottom:1px solid var(--rule)}
table.mem td.rd{font-family:var(--mono);font-size:11px;color:var(--ink-soft)}

/* ── home: one focal question + a governed receipt path ───────── */
.home-stage{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(310px,.72fr);gap:clamp(32px,6vw,76px);align-items:start}
.home-copy{padding-top:16px}
.home-hero{margin:0}
.home-hero h1{max-width:none;font-size:clamp(44px,4.7vw,68px);line-height:1.15;margin-bottom:14px;letter-spacing:-.05em;white-space:nowrap}
.prompt{margin:34px 0 8px;border:1px solid var(--rule);background:var(--paper-2);
  border-radius:22px;padding:10px 10px 10px 22px;display:flex;align-items:flex-end;gap:14px;
  box-shadow:0 22px 54px rgba(48,40,32,.09);transition:border-color .16s,box-shadow .16s,transform .16s}
.prompt:focus-within{border-color:var(--vermilion);box-shadow:0 24px 60px rgba(48,40,32,.11),0 0 0 4px rgba(183,71,52,.08);transform:translateY(-1px)}
.prompt textarea{flex:1 1 auto;border:0;background:transparent;resize:none;min-height:92px;max-height:220px;
  padding:14px 0;font:400 17px/1.65 var(--sans);color:var(--ink);overflow:hidden}
.prompt textarea:focus{outline:none}
.prompt button{flex:none;align-self:flex-end;margin:0 0 4px;width:52px;height:52px;border-radius:50%;
  border:1px solid var(--vermilion);background:var(--vermilion);color:#fff;cursor:pointer;
  font-size:18px;line-height:1;transition:background .14s,transform .06s}
.prompt button:hover{background:var(--vermilion-ink)}
.prompt button:active{transform:translateY(1px)}
.prompt button:disabled{opacity:.5;cursor:default}
.prompt-note{font-size:11.5px;color:var(--ink-faint);margin:10px 4px 0}

/* the governed path — the last step is a person, and it is the anchor */
.home-path{position:relative;background:var(--paper-2);border:1px solid var(--rule);border-radius:18px;padding:28px 28px 24px;box-shadow:0 18px 46px rgba(48,40,32,.055)}
.home-path h2{font-size:19px;margin:0 0 4px}
/* ── connect: Yoom-style service catalog ─────────────────────── */
.catalog{display:grid;grid-template-columns:170px 1fr;gap:46px;margin:40px 0 0}
.cat-rail{display:flex;flex-direction:column;gap:2px;align-self:start;position:sticky;top:20px}
.cat-rail button{appearance:none;border:0;background:transparent;text-align:left;cursor:pointer;
  font:500 13px/1.4 var(--sans);color:var(--ink-soft);padding:10px 2px;transition:color .12s,transform .12s}
.cat-rail button:hover{color:var(--ink);transform:translateX(2px)}
.cat-rail button[aria-current="true"]{color:var(--vermilion-ink);font-weight:700}
.cat-rail button[aria-current="true"]::before{content:"◯";display:inline-block;width:20px;color:var(--vermilion);font-size:10px}
.cat-main{min-width:0}
.cat-search{width:100%;background:var(--paper-2);border:1px solid var(--rule);border-radius:26px;
  padding:14px 20px;font:400 14px/1.5 var(--sans);color:var(--ink);margin-bottom:22px;box-shadow:0 10px 28px rgba(48,40,32,.04)}
.cat-search:focus{outline:2px solid rgba(183,71,52,.34);outline-offset:2px;border-color:var(--vermilion)}
.cx-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.cx-card{appearance:none;text-align:left;cursor:pointer;border:1px solid var(--rule);background:var(--paper-2);
  border-radius:12px;padding:17px 18px;min-height:104px;display:grid;grid-template-columns:44px 1fr;grid-template-rows:auto auto;column-gap:14px;align-items:center;
  box-shadow:0 8px 24px rgba(48,40,32,.045);transition:border-color .14s,transform .14s,box-shadow .14s}
.cx-card:hover{border-color:var(--rule-strong);transform:translateY(-2px);box-shadow:0 15px 32px rgba(48,40,32,.09)}
.cx-card:active{transform:translateY(1px)}
.cx-card[aria-expanded="true"]{border-color:var(--vermilion);box-shadow:0 15px 32px rgba(48,40,32,.09)}
.service-mark{width:44px;height:44px;border-radius:11px;border:1px solid var(--rule);background:var(--paper);
  display:grid;place-content:center;color:var(--ink-soft);grid-row:1/3}
.service-mark svg{display:block;width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.cx-card .nm{font:600 14px/1.4 var(--serif);color:var(--ink)}
.cx-card .st{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--ink-faint)}
.cx-card .st .dot-ok,.cx-card .st .dot-off{width:7px;height:7px}
.cx-none{color:var(--ink-faint);font-size:13px;padding:20px 4px}
.cx-panel{margin:22px 0 0;border:1px solid var(--rule-strong);background:var(--paper-2);border-radius:14px;
  padding:24px 26px;box-shadow:0 16px 38px rgba(48,40,32,.07)}
.cx-panel[hidden]{display:none}
.cx-panel .pnl-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.cx-panel .pnl-head h3{margin:0;font:600 17px/1.4 var(--serif)}
.cx-panel .pnl-head .tokm{font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-left:auto}
.cx-panel .cx-body{display:block;padding:0;border-top:0}
.cx-summary{display:grid;gap:10px;margin:14px 0 4px}
.cx-summary-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;font-size:13px;padding:9px 0;border-bottom:1px solid var(--rule)}
.cx-summary-row:last-of-type{border-bottom:0}
.cx-summary-label{color:var(--ink-faint);font-size:11.5px;letter-spacing:.03em}
.cx-summary-row .st{display:inline-flex;align-items:center;gap:6px}
.cx-manage{justify-self:start;margin-top:4px}
.cx-summary-actions{display:flex;gap:10px;align-items:center;margin-top:4px}
.cx-sync-out{font-size:12px;color:var(--ink-faint);margin:8px 0 0}
.cx-sync-out.ok{color:var(--ok)} .cx-sync-out.bad{color:var(--vermilion-ink)}
.tako-advanced{margin-top:18px;border-top:1px solid var(--rule);padding-top:14px}
.tako-advanced summary{cursor:pointer;font:600 12.5px/1.4 var(--sans);color:var(--ink-soft);letter-spacing:.02em;list-style:revert}
.tako-advanced[open] summary{margin-bottom:14px}
.cx-mascot{margin-top:18px;display:flex;justify-content:center}
.cx-mascot[hidden]{display:none}

/* ── source drawer ────────────────────────────────────────────── */
.scrim{position:fixed;inset:0;background:rgba(33,30,26,.34);opacity:0;pointer-events:none;transition:opacity .2s;z-index:40}
.scrim[data-open]{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(560px,92vw);background:var(--paper-2);
  border-left:1px solid var(--rule-strong);box-shadow:-24px 0 60px -30px rgba(33,30,26,.5);
  transform:translateX(100%);transition:transform .26s cubic-bezier(.16,.84,.44,1);z-index:41;
  display:flex;flex-direction:column}
.drawer[data-open]{transform:none}
.drawer header{padding:20px 24px;border-bottom:1px solid var(--rule-strong);display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.drawer header .slug{font-family:var(--mono);font-size:12px;color:var(--indigo);word-break:break-all}
.drawer header .src{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);margin-top:4px}
.drawer .body{padding:22px 24px 60px;overflow:auto;white-space:pre-wrap;font-size:13.5px;line-height:1.8;color:var(--ink-soft)}
.drawer button.x{appearance:none;border:1px solid var(--rule-strong);background:var(--paper);border-radius:2px;
  width:30px;height:30px;cursor:pointer;font-size:16px;line-height:1;color:var(--ink-soft);flex:none}

@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}

@media(max-width:980px){
  .page{padding:46px 26px 80px}
  .home-stage{grid-template-columns:1fr;gap:48px}
  .home-hero h1{max-width:9em}
  .catalog{grid-template-columns:1fr;gap:14px}
  .cat-rail{position:static;flex-direction:row;flex-wrap:wrap;gap:4px 18px;margin-bottom:12px}
  .cx-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:620px){
  .page{padding:34px 18px 64px}
  h1{font-size:34px}.home-hero h1{font-size:46px;white-space:normal}.home-copy{padding-top:0}
  .prompt{border-radius:16px;padding-left:16px}.prompt textarea{min-height:76px;font-size:15px}.prompt button{width:46px;height:46px}
  .home-path{padding:23px 20px}
  .cx-grid{grid-template-columns:1fr}.catalog{margin-top:30px}.cat-rail{flex-wrap:nowrap;overflow:auto;padding-bottom:5px}
}

/* ── Yoom-derived visual world: cool, rounded, spacious ───────── */
:root{
  --paper:#F5F6F8;--paper-2:#FFFFFF;--paper-sink:#EEF0F3;
  --ink:#1A1A1A;--ink-soft:#4F5359;--ink-faint:#686D75;
  --rule:#E8EAED;--rule-strong:#DDE0E5;
  --vermilion:#2D6DF6;--vermilion-ink:#1F57CB;
  --indigo:#2D6DF6;--indigo-soft:#6591F8;
  --ok:#3F6B4B;--warn:#9A6B1E;
  --mono:"SFMono-Regular",ui-monospace,"JetBrains Mono",Menlo,monospace;
  --serif:"Noto Sans JP",system-ui,sans-serif;--sans:"Noto Sans JP",system-ui,sans-serif;
  --col:74rem
}
html,body{overflow-x:clip}
body{background:var(--paper);color:var(--ink);font:400 15px/1.75 var(--sans)}
::selection{background:rgba(45,109,246,.18)}
.page{padding:clamp(52px,7vw,92px) clamp(28px,6vw,88px) 120px}
.sheet{max-width:var(--col)}
h1{max-width:20ch;font:900 clamp(38px,4.5vw,62px)/1.18 var(--sans);letter-spacing:-.04em;text-wrap:balance}
h2{font:800 22px/1.45 var(--sans);letter-spacing:-.025em;margin-top:64px}
.section{animation:yoom-rise .42s cubic-bezier(.16,1,.3,1) both}
@keyframes yoom-rise{from{opacity:.01;transform:translateY(6px)}to{opacity:1;transform:none}}

/* white surfaces across every operational screen */
.ledger,.entry,.mbucket,.rv-card,.redbox,.task-archive-note,.cx,.cx-panel,.home-path{
  background:#fff;border:1px solid var(--rule);border-radius:12px;box-shadow:none;overflow:hidden}
.ledger .row,.entry .meta,.entry .trail,.mbucket .mb-head,.rv-decision{border-color:var(--rule)}
.entry{padding:26px 28px}.entry .a::before{color:var(--ink-soft)}
.entry .trail .t-n,.cite,.tag,.chk{border-radius:7px;background:var(--paper)}
.cite{color:var(--vermilion-ink)}.cite:hover{border-color:var(--vermilion)}
.seal{border-color:var(--vermilion);color:var(--vermilion);box-shadow:inset 0 0 0 3px #fff,inset 0 0 0 4px rgba(45,109,246,.25)}
.ask textarea,.intake input,.intake textarea,.cx-body input,.ask select{background:#fff;border:1px solid #E6E8EB;border-radius:12px}
.ask textarea{min-height:112px;padding:17px 19px}.ask select{min-height:44px;padding:9px 13px}
.ask textarea:focus,.intake input:focus,.intake textarea:focus,.cx-body input:focus,.cat-search:focus{
  outline:3px solid rgba(45,109,246,.2);outline-offset:1px;border-color:var(--vermilion)}
button.file{min-height:44px;padding:11px 26px;background:#1E1E1E;border-color:#1E1E1E;border-radius:9999px;color:#fff;font:600 13px/1 var(--sans);letter-spacing:0}
button.file:hover{background:#000;border-color:#000;box-shadow:0 5px 14px rgba(0,0,0,.12)}
.cx-actions .test,.drawer button.x{min-height:42px;padding:9px 18px;background:#fff;border:1px solid var(--rule-strong);border-radius:9999px;color:var(--ink);font:600 12px var(--sans)}
.drawer button.x{width:42px;height:42px;padding:0;font-size:16px}
.cx-actions .test:hover{border-color:var(--ink);color:var(--ink)}
.note-err{border-color:rgba(45,109,246,.3);background:rgba(45,109,246,.05);color:var(--ink)}
.task-archive-note{border-color:var(--rule);background:#fff}.redbox .box,.rv-body .box{background:rgba(45,109,246,.08);color:var(--vermilion-ink)}
.banner{border-radius:12px}.risk,.pill{border-radius:9999px}
table.mem{background:#fff;border:1px solid var(--rule);border-radius:12px;border-spacing:0;overflow:hidden}

/* Home mirrors Yoom's centered prompt-first composition without its brand art. */
.home-stage{position:relative;display:block;max-width:1040px;margin:0 auto;padding:58px 0 18px;text-align:center;isolation:isolate}
.home-stage::before{content:"";position:absolute;z-index:-1;width:760px;height:760px;left:50%;top:-410px;transform:translateX(-50%);
  border:110px solid rgba(255,255,255,.68);border-radius:50%;pointer-events:none}
.home-copy{padding:0}.home-hero{position:relative}.home-hero h1{max-width:none;margin:0 auto 12px;font:900 clamp(52px,7vw,86px)/1.08 var(--sans);letter-spacing:-.055em;white-space:normal}
.prompt-zone{position:relative;max-width:1240px;margin:34px auto 0}
.prompt{position:relative;z-index:2;max-width:680px;margin:0 auto 10px;padding:18px 18px 18px 24px;background:#fff;border:1px solid #E6E8EB;border-radius:20px;
  box-shadow:0 16px 48px rgba(20,27,38,.09);transform:none}
.prompt:focus-within{border-color:var(--vermilion);box-shadow:0 18px 50px rgba(20,27,38,.1),0 0 0 4px rgba(45,109,246,.12);transform:none}
.prompt textarea{min-height:92px;padding:10px 2px;font:400 18px/1.65 var(--sans)}
.prompt button{width:52px;height:52px;margin:0 0 2px;border-radius:50%;background:#1E1E1E;border-color:#1E1E1E;color:#fff}
.prompt button:hover{background:#000;border-color:#000}
.prompt-note{text-align:center;color:var(--ink-faint)}
.prompt-chip{position:absolute;z-index:1;display:flex;flex-direction:column;min-width:150px;max-width:190px;padding:12px 16px;background:#fff;border:1px solid var(--rule);border-radius:9999px;
  color:var(--ink);text-align:left;box-shadow:0 8px 22px rgba(20,27,38,.055)}
.prompt-chip b{font:600 12px/1.35 var(--sans)}.prompt-chip small{font:400 9px/1.35 var(--sans);color:var(--ink-faint);margin-top:2px}
.prompt-chip.pc-a{left:0;top:10px}.prompt-chip.pc-b{right:0;top:70px}.prompt-chip.pc-c{left:0;bottom:16px}
.home-path{margin:86px auto 0;padding:26px 28px 24px;text-align:left}
.home-path h2{margin:0 0 3px;font-size:20px}
/* Connect follows Yoom Apps: plain rail, tall search, clean three-up cards. */
.section[data-name="connect"]{position:relative}
.catalog{grid-template-columns:170px minmax(0,1fr);gap:48px;margin-top:44px}
.cat-rail{gap:0}.cat-rail button{min-height:40px;padding:8px 2px;border-radius:0;font:600 13px/1.5 var(--sans);color:var(--ink-soft);transform:none}
.cat-rail button:hover{color:var(--ink);transform:none}.cat-rail button[aria-current="true"]{color:var(--ink);font-weight:800}
.cat-rail button[aria-current="true"]::before{display:none}
.cat-search{height:52px;margin-bottom:20px;padding:0 18px 0 48px;background-color:#fff;border:1px solid #E6E8EB;border-radius:12px;box-shadow:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2370757D' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:17px 50%}
.cx-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.cx-card{min-height:92px;padding:16px 18px;background:#fff;border:1px solid var(--rule);border-radius:12px;box-shadow:none;
  grid-template-columns:42px minmax(0,1fr);grid-template-rows:auto auto;column-gap:13px}
.cx-card:hover{border-color:var(--rule-strong);box-shadow:0 7px 20px rgba(20,27,38,.07);transform:translateY(-1px)}
.cx-card[aria-expanded="true"]{border-color:var(--vermilion);box-shadow:0 0 0 2px rgba(45,109,246,.1)}
.service-mark{width:42px;height:42px;border-radius:10px;background:#F7F8FA;border-color:var(--rule);color:#34383E}
.service-mark svg{width:23px;height:23px}.cx-card .nm{font:600 14px/1.35 var(--sans)}
.cx-card .st{font-size:9.5px;line-height:1.35}.cx-panel{margin-top:20px;padding:24px;box-shadow:none}
.request-bubble{display:inline-flex;align-items:center;gap:12px;margin:20px 0 0;padding:15px 18px;pointer-events:none;
  background:var(--vermilion);border-radius:18px;color:#fff;box-shadow:0 10px 30px rgba(45,109,246,.22)}
.request-bubble .plus{width:28px;height:28px;display:grid;place-content:center;background:rgba(255,255,255,.16);border-radius:50%;font:500 18px/1 var(--sans)}
.request-bubble b{display:block;font:700 12px/1.4 var(--sans)}.request-bubble small{display:block;font:400 10px/1.4 var(--sans);color:#fff;opacity:1}
.drawer{background:#fff}.drawer header .slug{color:var(--vermilion-ink)}

@media(max-width:1180px){
  .page{padding:58px 34px 96px}.home-hero h1{font-size:64px}
  /* no room for the floating example chips beside the prompt — drop them */
  .prompt-chip{display:none}
}
@media(max-width:920px){.request-bubble{position:static;margin:22px 0 0 auto;width:max-content;max-width:100%}}
@media(max-width:760px){
  .page{padding:38px 18px 72px}h1{font-size:38px}.home-stage{padding-top:30px}.home-hero h1{font-size:48px}
  .prompt-zone{margin-top:26px}.prompt-chip{display:none}.prompt{padding:14px;border-radius:16px}.prompt textarea{min-height:112px;font-size:16px}
  .home-path{margin-top:58px;padding:22px 18px}
  .catalog{grid-template-columns:1fr;gap:16px;margin-top:30px}.cat-rail{position:static;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;gap:20px;padding-bottom:5px}.cat-rail button{flex:none}
  .cx-grid{grid-template-columns:1fr}.request-bubble{position:static;margin-top:24px;width:max-content;max-width:100%}
}
${TAKO_CSS_TOKENS}
.tako-nav-item, .tako-btn, .tako-filter, .tako-app-tile {
  transition: background-color var(--tako-feedback-ms) ease, transform var(--tako-feedback-ms) ease;
}
.tako-panel, .section { transition: opacity var(--tako-panel-ms) ease; }
.tako-scene { transition: transform var(--tako-mascot-ms) ease; }

:focus-visible {
  outline: 2px solid var(--tako-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
h1 { font-size: var(--tako-page-title); font-weight: 700; margin: 0 0 4px; color: var(--tako-text); }
h2 { font-size: var(--tako-section-title); font-weight: 600; margin: 0 0 12px; color: var(--tako-text); }
.tako-supporting { font-size: var(--tako-supporting); color: var(--tako-text-secondary); margin: 0 0 var(--tako-space-3); }
body { font-family: var(--tako-font); font-size: var(--tako-body); color: var(--tako-text); background: var(--tako-canvas); }

/* Sidebar nav */
.tako-app-shell { display: flex; min-height: 100vh; }
.tako-sidebar { width: 240px; flex: 0 0 240px; background: var(--tako-surface); border-right: 1px solid var(--tako-border); padding: var(--tako-space-4) var(--tako-space-3); }
.tako-wordmark { font-size: 22px; font-weight: 700; color: var(--tako-text); margin-bottom: var(--tako-space-4); }
.tako-nav-group { margin-bottom: var(--tako-space-4); }
.tako-nav-group-label { font-size: var(--tako-label); text-transform: uppercase; letter-spacing: 0.06em; color: var(--tako-text-secondary); padding: 0 var(--tako-space-2); margin-bottom: var(--tako-space-1); }
.tako-nav-item { display: block; width: 100%; text-align: left; background: none; border: none; border-radius: 8px; padding: var(--tako-space-2); font-size: var(--tako-body); color: var(--tako-text); cursor: pointer; }
.tako-nav-item:hover { background: var(--tako-canvas); }
.tako-nav-item[aria-current="true"] { background: var(--tako-selected); font-weight: 600; }
.tako-nav-footer { margin-top: auto; padding-top: var(--tako-space-4); border-top: 1px solid var(--tako-border); }
.tako-main { flex: 1; padding: var(--tako-space-6); max-width: 1200px; }

/* Screen shell — visibility toggling (.section{display:none} and
   .section[data-active]{display:block}) already exists in demo.ts at
   lines 789-790; do not redefine it here, only add what's missing: */
.tako-screen-head { margin-bottom: var(--tako-space-4); }
.tako-actions { display: flex; gap: var(--tako-space-2); margin-top: var(--tako-space-3); }

/* Buttons */
.tako-btn { font-size: var(--tako-body); font-weight: 600; padding: 10px 18px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.tako-btn:disabled { opacity: .45; cursor: not-allowed; }
.tako-btn--primary { background: var(--tako-primary); color: var(--tako-surface); }
.tako-btn--primary:hover { background: #1f4f40; }
.tako-btn--secondary { background: var(--tako-surface); color: var(--tako-text); border-color: var(--tako-border); }
.tako-btn--secondary:hover { background: var(--tako-canvas); }

/* Cards, generically reused by stats, app tiles, list rows */
.tako-card { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }

/* Home */
.tako-stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--tako-space-3); margin: var(--tako-space-4) 0; }
.tako-stat { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }
.tako-stat-value { display: block; font-size: var(--tako-hero); font-weight: 700; }
.tako-stat-label { display: block; font-size: var(--tako-supporting); color: var(--tako-text-secondary); }
.tako-home-composition { display: flex; align-items: center; gap: var(--tako-space-4); background: var(--tako-surface); border-radius: var(--tako-radius-card); padding: var(--tako-space-4); margin-bottom: var(--tako-space-4); }
.tako-app-tiles { display: flex; gap: var(--tako-space-2); }
.tako-app-tile { background: var(--tako-canvas); border: 1px solid var(--tako-border); border-radius: 10px; padding: var(--tako-space-2) var(--tako-space-3); font-size: var(--tako-supporting); }
.tako-home-lists { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tako-space-4); }
.tako-home-lists ul { list-style: none; margin: 0; padding: 0; }

/* Automations */
.tako-automation-list { list-style: none; margin: 0 0 var(--tako-space-4); padding: 0; display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-automation-list li { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }
.tako-automation-sentence { font-size: var(--tako-body); font-weight: 600; margin: 0 0 var(--tako-space-1); }
.tako-automation-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--tako-supporting); color: var(--tako-text-secondary); margin: 0 0 var(--tako-space-1); }
.tako-automation-meta b { color: var(--tako-text); font-weight: 600; }
.tako-automation-apps { display: flex; flex-wrap: wrap; gap: 6px; }
.tako-automation-app-tag { background: var(--tako-canvas); border: 1px solid var(--tako-border); border-radius: 999px; padding: 2px 10px; font-size: var(--tako-label); }
.tako-status-pill { border-radius: 999px; padding: 2px 10px; font-size: var(--tako-label); font-weight: 600; }
.tako-status-pill--active { background: var(--tako-selected); color: var(--tako-primary); }
.tako-status-pill--inactive { background: var(--tako-canvas); color: var(--tako-text-secondary); border: 1px solid var(--tako-border); }
.tako-automation-templates, .tako-automation-builder { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-4); display: flex; flex-direction: column; gap: var(--tako-space-3); margin-bottom: var(--tako-space-4); }
.tako-automation-templates[hidden], .tako-automation-builder[hidden] { display: none; }
.tako-template-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-template-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--tako-space-2); background: var(--tako-canvas); border: 1px solid var(--tako-border); border-radius: 10px; padding: var(--tako-space-2) var(--tako-space-3); }
.tako-builder-step { display: flex; align-items: center; gap: var(--tako-space-2); }
.tako-builder-label { font-size: var(--tako-label); color: var(--tako-text-secondary); min-width: 140px; }

/* Connected Apps */
.tako-advanced { margin-top: var(--tako-space-3); border-top: 1px solid var(--tako-border); padding-top: var(--tako-space-3); }
.tako-advanced summary { cursor: pointer; font-size: var(--tako-supporting); color: var(--tako-text-secondary); }

/* Tasks */
.tako-filter-row { display: flex; gap: var(--tako-space-2); margin-bottom: var(--tako-space-3); }
.tako-filter { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: 999px; padding: 6px 14px; font-size: var(--tako-supporting); cursor: pointer; }
.tako-filter[aria-pressed="true"] { background: var(--tako-selected); border-color: var(--tako-primary); }

/* Activity */
.tako-activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-activity-list li { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }
.tako-activity-top { display: flex; align-items: center; justify-content: space-between; gap: var(--tako-space-2); margin-bottom: 4px; }
.tako-activity-time { font-size: var(--tako-label); color: var(--tako-text-secondary); }
.tako-activity-label { font-size: var(--tako-body); font-weight: 600; margin: 0 0 var(--tako-space-1); }
.tako-activity-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--tako-supporting); color: var(--tako-text-secondary); }
.tako-activity-meta b { color: var(--tako-text); font-weight: 600; }
.tako-activity-failure { margin-top: var(--tako-space-2); border-top: 1px solid var(--tako-border); padding-top: var(--tako-space-2); display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.tako-activity-failure p { margin: 0; font-size: var(--tako-supporting); }
.tako-badge { display: inline-block; font-size: var(--tako-label); font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.tako-badge--success { background: var(--tako-selected); color: var(--tako-primary); }
.tako-badge--warning { background: var(--tako-cream); color: #7A5A2A; }
.tako-badge--error { background: #F4E1DF; color: var(--tako-error); }

/* Approvals */
.tako-approval-actions { display: flex; flex-wrap: wrap; gap: var(--tako-space-2); margin-top: var(--tako-space-3); }
.tako-approvals-layout { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(320px, 1.5fr); gap: var(--tako-space-4); align-items: start; margin-top: var(--tako-space-3); }
.tako-approvals-queue { display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-approvals-queue h2, .tako-approvals-tool h2, .tako-approvals-submit h2 { font-size: var(--tako-body); margin: 0 0 var(--tako-space-2); }
.tako-approval-card { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); cursor: pointer; font: inherit; color: inherit; }
.tako-approval-card:hover { border-color: var(--tako-primary); }
.tako-approval-card.is-selected { border-color: var(--tako-primary); background: var(--tako-selected); }
.tako-approval-card-title { font-weight: 600; }
.tako-approval-card-meta { font-size: var(--tako-label); color: var(--tako-text-secondary); }
.tako-approvals-detail { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-4); }
.tako-approval-reasons { font-size: var(--tako-supporting); color: var(--tako-text-secondary); margin: var(--tako-space-2) 0 0; }
.tako-approvals-secondary { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tako-space-4); margin-top: var(--tako-space-5); }
@media (max-width: 900px) {
  .tako-approvals-layout, .tako-approvals-secondary { grid-template-columns: 1fr; }
}

/* Team & Permissions */
.tako-panel { position: fixed; top: 0; right: 0; height: 100%; width: 360px; background: var(--tako-surface); border-left: 1px solid var(--tako-border); padding: var(--tako-space-4); overflow-y: auto; }
.tako-panel-close { position: absolute; top: var(--tako-space-3); right: var(--tako-space-3); background: transparent; border: 0; font-size: 22px; line-height: 1; cursor: pointer; color: var(--tako-text-secondary); }
.tako-permissions-table { width: 100%; border-collapse: collapse; margin-top: var(--tako-space-3); }
.tako-permissions-table th { text-align: left; font-size: var(--tako-label); font-weight: 600; color: var(--tako-text-secondary); text-transform: uppercase; letter-spacing: .06em; padding: 0 var(--tako-space-2) var(--tako-space-1); border-bottom: 1px solid var(--tako-border); }
.tako-permissions-row { cursor: pointer; }
.tako-permissions-row:hover { background: var(--tako-selected); }
.tako-permissions-row td { padding: var(--tako-space-2); border-bottom: 1px solid var(--tako-border); vertical-align: top; }
.tako-permissions-name { font-weight: 600; }
.tako-permissions-content { font-size: var(--tako-supporting); color: var(--tako-text-secondary); }
.tako-permissions-groups { margin-top: var(--tako-space-5); }
.tako-group-card { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); margin-top: var(--tako-space-2); }
.tako-group-card h3 { margin: 0 0 4px; font-size: var(--tako-body); }
.tako-group-warning { margin-top: var(--tako-space-2); font-size: var(--tako-supporting); color: #7A5A2A; background: var(--tako-cream); border-radius: 8px; padding: 6px 10px; }
.tako-permissions-admin { margin-top: var(--tako-space-5); padding-top: var(--tako-space-4); border-top: 1px solid var(--tako-border); }
.tako-panel h2 { margin-bottom: 4px; }
.tako-panel h3 { font-size: var(--tako-body); margin: var(--tako-space-3) 0 4px; }
.tako-panel ul { margin: 0; padding-left: 18px; }

/* Empty states */
.tako-empty { text-align: center; padding: var(--tako-space-6) var(--tako-space-4); }
.tako-empty p:first-child { font-weight: 600; margin-bottom: 4px; }
.tako-empty .note-err { text-align: left; }

/* Loading skeletons — a plain pulsing block standing in for a real row while
   a fetch is in flight, never left indefinitely if that fetch fails (see the
   retry-on-failure handling in each screen's load function). */
.tako-skeleton { border-radius: var(--tako-radius-card); background: var(--tako-border); animation: tako-skeleton-pulse 1.2s ease-in-out infinite; }
.tako-skeleton-row { height: 56px; margin-bottom: var(--tako-space-2); }
.tako-skeleton-row:last-child { margin-bottom: 0; }
@keyframes tako-skeleton-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }

/* Mascot */
.tako-mark { vertical-align: middle; }
.tako-scene { width: 140px; flex: 0 0 140px; }
</style></head>
<body>
<div class="tako-app-shell">
  ${renderSidebarNav()}

  <main class="tako-main page"><div class="sheet">

    <section class="section" data-name="home" data-active>
      <header class="tako-screen-head">
        <h1>Work, connected.</h1>
        <p class="tako-supporting">Tako handles the handoffs between your team's tools.</p>
        <div class="tako-actions">
          <button class="tako-btn tako-btn--primary" data-action="create-automation">Create automation</button>
          <button class="tako-btn tako-btn--secondary" data-action="open-ask">Ask Tako</button>
        </div>
      </header>

      <div class="tako-stat-row">
        <div class="tako-stat"><span class="tako-stat-value" id="home-stat-active">–</span><span class="tako-stat-label">Active automations</span></div>
        <div class="tako-stat"><span class="tako-stat-value" id="home-stat-connected">–</span><span class="tako-stat-label">Connected apps</span></div>
        <div class="tako-stat"><span class="tako-stat-value" id="home-stat-completed">–</span><span class="tako-stat-label">Completed today</span></div>
        <div class="tako-stat"><span class="tako-stat-value" id="home-stat-approval">–</span><span class="tako-stat-label">Needs approval</span></div>
      </div>

      <div class="tako-home-composition">
        ${mascotScene("connecting", "home-empty")}
        <div class="tako-app-tiles" aria-hidden="true">
          <div class="tako-app-tile">Drive</div>
          <div class="tako-app-tile">Slack</div>
          <div class="tako-app-tile">Notion</div>
        </div>
      </div>

      <div class="tako-home-lists">
        <div>
          <h2>Recent activity</h2>
          <ul id="home-recent-activity"><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li></ul>
        </div>
        <div>
          <h2>Needs attention</h2>
          <ul id="home-needs-attention"><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li></ul>
        </div>
      </div>
    </section>

    <section class="section" data-name="connect">
      <header class="tako-screen-head">
        <h1>Connect your apps.</h1>
        <p class="tako-supporting" id="cx-note">Choose an app, connect it, and tell tako what to read — it federates read-only and never writes back.</p>
      </header>
      <div class="catalog">
        <div class="cat-rail" id="cx-rail"></div>
        <div class="cat-main">
          <input class="cat-search" id="cx-search" type="search" placeholder="Search services" autocomplete="off">
          <div class="cx-grid" id="cx-grid"><div class="tako-skeleton tako-skeleton-row" aria-hidden="true"></div><div class="tako-skeleton tako-skeleton-row" aria-hidden="true"></div></div>
          <div class="cx-panel" id="cx-panel" hidden>
            <!-- selectCx() below replaces this whole block per-connector on
                 card click; this seed keeps the summary-first shape (and the
                 collapsed Advanced disclosure) present even before any JS
                 runs, and it stays invisible because the panel itself is
                 [hidden] until a card is selected. -->
            <details class="tako-advanced"><summary>Advanced</summary></details>
          </div>
          <div class="cx-mascot" id="cx-mascot" hidden>${mascotScene("connecting", "connect-setup")}</div>
        </div>
      </div>
      <p class="hint" style="margin-top:22px">Tokens are stored in plaintext in this device's <span class="mono">config/connectors.json</span>.
      Production needs an encrypted credential store (onboarding gap #3).</p>
      <div class="request-bubble" role="note"><span class="plus">+</span><span><b>Request an integration</b></span></div>

      <aside class="tako-panel" id="cx-credentials-panel" hidden>
        <button class="tako-panel-close" id="cx-credentials-panel-close" aria-label="Close">×</button>
        <div id="cx-credentials-panel-body"></div>
      </aside>
    </section>

    <section class="section" data-name="ask">
      <header class="tako-screen-head">
        <h1>Ask Tako</h1>
        <p class="tako-supporting">Find answers across your connected apps.</p>
      </header>
      <form class="ask" id="ask-form">
        <textarea id="ask-q" placeholder="e.g. Who is running the Onocom hearing?"></textarea>
        <div class="controls">
          <label for="ask-src" style="font-size:12px;color:var(--ink-faint)">Source</label>
          <select id="ask-src"></select>
          <button class="file" type="submit">Ask</button>
        </div>
        <div class="tako-filter-row" id="ask-category-row" style="margin-top:10px;flex-wrap:wrap">
          <button class="tako-filter" type="button" data-category="" aria-pressed="true" style="white-space:nowrap">All categories</button>
          ${DEPARTMENTS.map((d) => `<button class="tako-filter" type="button" data-category="${d}" aria-pressed="false" style="white-space:nowrap">${DEPARTMENT_LABELS[d]}</button>`).join("")}
        </div>
      </form>
      <div class="tako-filter-row" id="ask-provider-row" style="margin-top:10px;align-items:center;gap:8px">
        <span class="hint" style="margin:0">Model:</span>
        <button class="tako-filter" type="button" data-provider="ollama" aria-pressed="true">Ollama (local)</button>
        <button class="tako-filter" type="button" data-provider="gemini" aria-pressed="false">Gemini (external, demo-only)</button>
      </div>
      <p class="hint" id="ask-hosted-warning" hidden style="color:var(--tako-danger,#b00);font-weight:600">⚠ Demo mode: this question and the retrieved document content are sent to an external API (Gemini), not processed locally.</p>
      <p class="out" id="ask-provider-out" hidden></p>
      <div id="ask-out"></div>
      <details class="tako-advanced">
        <summary>Details</summary>
        <p class="hint">Answers only from your connected sources ・ <span id="ask-model">—</span></p>
      </details>
    </section>

    <section class="section" data-name="automations">
      <header class="tako-screen-head">
        <h1>Automations</h1>
        <button class="tako-btn tako-btn--primary" data-action="new-automation">New automation</button>
      </header>
      <ul class="tako-automation-list" id="automation-list"><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li></ul>

      <div class="tako-empty" id="automations-empty" hidden>
        <p>No automations yet</p>
        <p class="tako-supporting">Connect two apps to create your first automation.</p>
        <button class="tako-btn tako-btn--primary" data-action="new-automation">Create automation</button>
      </div>

      <div class="tako-automation-templates" id="automation-templates" hidden>
        <h2>Start from a template</h2>
        ${mascotScene("resting", "automation-templates")}
        <ul class="tako-template-list" id="template-list"></ul>
        <button class="tako-btn tako-btn--secondary" data-action="start-from-scratch">Start from scratch</button>
      </div>

      <div class="tako-automation-builder" id="automation-builder" hidden>
        <h2>New automation</h2>
        <div class="tako-builder-step"><span class="tako-builder-label">When this happens</span><select id="ab-trigger"></select></div>
        <div class="tako-builder-step"><span class="tako-builder-label">Do this</span><select id="ab-action-1"></select></div>
        <div class="tako-builder-step"><span class="tako-builder-label">Then this</span><select id="ab-action-2"></select></div>
        <div class="note-err" id="automation-builder-error" hidden></div>
        <button class="tako-btn tako-btn--primary" data-action="create-automation-submit">Create automation</button>
        <button class="tako-btn tako-btn--secondary" data-action="back-to-templates">Choose a template instead</button>
      </div>

      <div class="tako-empty" id="automation-success" hidden>
        ${mascotScene("settled", "success-recovery")}
        <p>Automation created</p>
        <p class="tako-supporting">It will run the next time its trigger happens.</p>
      </div>
    </section>

    <section class="section" data-name="tasks">
      <header class="tako-screen-head">
        <h1>Tasks</h1>
        <p class="tako-supporting">Tako reads what's in progress across your connected sources and sorts it by how much it still needs from you.</p>
      </header>
      <div class="tako-filter-row">
        <button class="tako-filter" data-filter="needs-attention" aria-pressed="true">Needs attention</button>
        <button class="tako-filter" data-filter="active" aria-pressed="false">Active</button>
        <button class="tako-filter" data-filter="ready-to-archive" aria-pressed="false">Ready to archive</button>
        <button class="tako-filter" data-filter="excluded" aria-pressed="false">Excluded</button>
      </div>
      <span id="mem-src" class="hint" style="display:block;margin:-6px 0 12px"></span>
      <div id="mem-body"><div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div></div>
    </section>

    <section class="section" data-name="approvals">
      <header class="tako-screen-head">
        <h1>Approvals</h1>
        <p class="tako-supporting">Tako never sends or publishes anything on its own. Every AI-assisted output waits here until a person checks it and records a decision.</p>
      </header>

      <div class="tako-approvals-layout">
        <div class="tako-approvals-queue">
          <h2>Queue</h2>
          <div id="rv-list"><div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div></div>
        </div>
        <div class="tako-approvals-detail" id="rv-detail">
          <div class="tako-empty"><p>Select a review</p><p class="tako-supporting">Pick an item from the queue to see its checks and record a decision.</p></div>
        </div>
      </div>

      <!-- Template for the four decision buttons. Cloned per selected review by
           loadReview()/renderDetail() below, which sets data-review-id, disables
           Approve per the server's canApprove() gate, and omits the whole block
           for a review already in a terminal state (approved/rejected). Never
           rendered raw — this is a source, not visible markup. -->
      <template id="tako-approval-actions-template">
        <div class="tako-approval-actions">
          <button class="tako-btn tako-btn--primary" data-decision="approve">Approve</button>
          <button class="tako-btn tako-btn--secondary" data-decision="request-changes">Request changes</button>
          <button class="tako-btn tako-btn--secondary" data-decision="reject">Reject</button>
          <button class="tako-btn tako-btn--secondary" data-decision="ask-admin">Ask administrator</button>
        </div>
      </template>

      <div class="tako-approvals-secondary">
        <div class="tako-approvals-tool">
          <h2>Protect sensitive information</h2>
          <p class="tako-supporting">Paste text here to see what filtering/masking would catch before you submit it for review.</p>
          <div id="rv-rules" class="rules-strip"></div>
          <form class="ask" id="rd-form" style="margin-top:8px">
            <textarea id="rd-in" placeholder="Paste text to check — e.g. a name, email, phone number, or token"></textarea>
            <div class="controls"><button class="tako-btn tako-btn--secondary" type="submit">Check for sensitive info</button></div>
          </form>
          <div id="rd-out"></div>
        </div>

        <div class="tako-approvals-submit">
          <h2>Submit an output for review</h2>
          <form class="intake" id="rv-form">
            <div class="grid2">
              <label>Title<input type="text" id="iv-title" required maxlength="120" placeholder="e.g. Draft thank-you email to Onocom"></label>
              <label>Submitted by (optional)<input type="text" id="iv-by" maxlength="60" placeholder="Your name"></label>
              <label>Purpose<input type="text" id="iv-intent" maxlength="160" placeholder="What this output is for"></label>
              <label>Audience<input type="text" id="iv-aud" maxlength="120" placeholder="Who or where it will be published"></label>
            </div>
            <label>Body<textarea id="iv-body" required placeholder="Paste the AI-generated text under review"></textarea></label>
            <label>Grounding sources<input type="text" id="iv-src" placeholder="discord/hearing/thread-onocom-…  notion/pricing (space or comma separated)"></label>
            <div class="controls">
              <span class="hint" style="margin:0">Submitting runs filtering/masking automatically and feeds the result into the Safety check.</span>
              <button class="tako-btn tako-btn--primary" type="submit">Submit for review</button>
            </div>
          </form>
          <div id="rv-form-out"></div>
        </div>
      </div>
    </section>

    <section class="section" data-name="permissions">
      <header class="tako-screen-head">
        <h1>Control what each person can access.</h1>
        <p class="tako-supporting">Every member's access is read-only and limited to specific connected content. Select a member to see their detail.</p>
      </header>

      <div id="permissions-members"><div class="tako-skeleton tako-skeleton-row" aria-hidden="true"></div><div class="tako-skeleton tako-skeleton-row" aria-hidden="true"></div></div>

      <div class="tako-permissions-groups">
        <h2>Access groups</h2>
        <p class="tako-supporting">An access group is a read-only slice of the connected content. It always states what's included and what isn't.</p>
        <div id="permissions-groups"></div>
      </div>

      <div class="tako-permissions-admin">
        <h2>Administration</h2>
        <p class="tako-supporting">Inviting members, assigning access groups, and revoking access are done from the full console — not from this stage view.</p>
      </div>

      <aside class="tako-panel" id="permissions-panel" hidden>
        <button class="tako-panel-close" id="permissions-panel-close" aria-label="Close">×</button>
        <div id="permissions-panel-body"></div>
      </aside>
    </section>

    <section class="section" data-name="activity">
      <header class="tako-screen-head"><h1>Activity</h1></header>
      <ul class="tako-activity-list" id="activity-list">${renderActivityList(activityView().entries)}</ul>
    </section>

    <section class="section" data-name="settings">
      <header class="tako-screen-head"><h1>Settings</h1></header>

      <h2>Answer model</h2>
      <div class="cx-summary">
        <div class="cx-summary-row"><span class="cx-summary-label">Currently answering with</span><span id="settings-model">—</span></div>
      </div>
      <p class="hint">Switch between the local model and the demo-mode external model from <b>Ask Tako → Details</b>.</p>

      <h2 style="margin-top:var(--tako-space-4)">Company brain</h2>
      <div class="cx-summary">
        <div class="cx-summary-row"><span class="cx-summary-label">Brain location</span><span id="settings-brain-home" class="mono">—</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Connected sources</span><span id="settings-sources">—</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Indexed documents</span><span id="settings-docs">—</span></div>
      </div>
      <p class="hint">Manage which apps feed the brain from <b>Connected Apps</b>.</p>

      <h2 style="margin-top:var(--tako-space-4)">About</h2>
      <p class="tako-supporting">Tako is an on-premise company knowledge register. It federates read-only
      connections to your team's tools, answers questions using local models only, and never sends or
      publishes anything without a named person's approval.</p>
    </section>

    <section class="section" data-name="help">
      <header class="tako-screen-head"><h1>Help</h1></header>

      <h2>Quick tour</h2>
      <div class="cx-summary">
        <div class="cx-summary-row"><span class="cx-summary-label">Home</span><span>Today's activity and what needs you</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Ask Tako</span><span>Ask a question, get a cited answer from one connected source</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Automations</span><span>Teach Tako a trigger-and-steps routine</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Connected Apps</span><span>Connect an app and see its own credential guide</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Tasks</span><span>What's open across your connected sources, triaged</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Activity</span><span>Every action, human or automated, in one log</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Approvals</span><span>Every AI-drafted output waits here for a human decision</span></div>
        <div class="cx-summary-row"><span class="cx-summary-label">Team & Permissions</span><span>Who can read what, scoped per person</span></div>
      </div>

      <h2 style="margin-top:var(--tako-space-4)">Connecting an app</h2>
      <p class="tako-supporting">Open <b>Connected Apps</b>, choose a service, and click
      <b>"Where do I get this token?"</b> on its card — each one opens a step-by-step guide for that
      specific service, right inside the app.</p>

      <h2 style="margin-top:var(--tako-space-4)">How an answer is checked</h2>
      <p class="tako-supporting">質問 (Ask) → 検索 (Retrieve, cited) → 下書き (Draft, local model only)
      → フィルタ (Filter / mask sensitive info) → 人間の承認 (Human approval — required). Tako never
      skips the last step on its own.</p>
    </section>

  </div></main>
</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-hidden="true">
  <header>
    <div><div class="slug" id="dr-slug">—</div><div class="src" id="dr-src"></div></div>
    <button class="x" id="dr-x" aria-label="閉じる">×</button>
  </header>
  <div class="body" id="dr-body"></div>
</aside>

<script type="module">
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Minimal Markdown → HTML for rendering our own docs/connectors/*.md guides
   inside the app (headings, bold, inline code, code fences, links, lists,
   paragraphs) — no dependency, and the input is our own repo content. */
function mdToHtml(md){
  const inline=s=>esc(s)
    .replace(/\\\`([^\\\`]+)\\\`/g,'<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html='',inCode=false,listOpen=null;
  const closeList=()=>{if(listOpen){html+='</'+listOpen+'>';listOpen=null;}};
  for(const raw of md.split('\\n')){
    if(raw.trim().startsWith('\`\`\`')){
      if(!inCode){closeList();html+='<pre><code>';inCode=true;}
      else{html+='</code></pre>';inCode=false;}
      continue;
    }
    if(inCode){html+=esc(raw)+'\\n';continue;}
    const h=raw.match(/^(#{1,3})\\s+(.*)$/);
    if(h){closeList();const n=h[1].length+1;html+='<h'+n+'>'+inline(h[2])+'</h'+n+'>';continue;}
    const ol=raw.match(/^\\d+\\.\\s+(.*)$/);
    if(ol){if(listOpen!=='ol'){closeList();html+='<ol>';listOpen='ol';}html+='<li>'+inline(ol[1])+'</li>';continue;}
    const ul=raw.match(/^[-*]\\s+(.*)$/);
    if(ul){if(listOpen!=='ul'){closeList();html+='<ul>';listOpen='ul';}html+='<li>'+inline(ul[1])+'</li>';continue;}
    if(!raw.trim()){closeList();continue;}
    closeList();html+='<p>'+inline(raw)+'</p>';
  }
  closeList();
  return html;
}
const api=async(p,o)=>{const r=await fetch(p,o);const j=await r.json();if(!r.ok)throw new Error(j.error||'request failed');return j};
/* Admin-gated mutating routes need an X-Admin-Token header. The page itself
   stays unauthenticated (public demo screens must stay reachable) — only these
   requests attach a token, read from localStorage, prompting once if the
   server comes back 401 and retrying that single request. */
const adminFetch=async(p,o)=>{
  o=o||{};
  const headers=new Headers(o.headers||{});
  const stored=localStorage.getItem('tako-admin-token');
  if(stored)headers.set('X-Admin-Token',stored);
  let r=await fetch(p,{...o,headers});
  if(r.status===401){
    const entered=prompt('Admin token required for this action:');
    if(entered){
      localStorage.setItem('tako-admin-token',entered);
      headers.set('X-Admin-Token',entered);
      r=await fetch(p,{...o,headers});
    }
  }
  return r;
};
const adminApi=async(p,o)=>{const r=await adminFetch(p,o);const j=await r.json();if(!r.ok)throw new Error(j.error||'request failed');return j};
/* A failed fetch must never leave a screen stuck on "Loading…" — every load
   function below renders this instead, with a Retry button wired through
   RETRY_FNS (populated once each load function is declared, see the bottom
   of this script). */
function retryMarkup(message,key){
  return '<p>Couldn’t load</p><p class="tako-supporting">'+esc(message)+'</p><button class="tako-btn tako-btn--secondary" data-retry="'+esc(key)+'">Retry</button>';
}
const fmtDate=s=>s?new Date(s).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
/* relative time for the Home "recent activity" list — no existing helper for this in the file. */
function fmtAgo(iso){
  if(!iso)return '—';
  const ms=Date.now()-new Date(iso).getTime();
  const min=Math.floor(ms/60000);
  if(min<1)return 'just now';
  if(min<60)return min+'m ago';
  const hr=Math.floor(min/60);
  if(hr<24)return hr+'h ago';
  const d=Math.floor(hr/24);
  if(d<30)return d+'d ago';
  const mo=Math.floor(d/30);
  return mo+'mo ago';
}

/* section routing */
function goto(name){
  $$('.tako-nav-item').forEach(t=>t.setAttribute('aria-current',String(t.dataset.name===name)));
  $$('.section').forEach(s=>s.dataset.name===name?s.setAttribute('data-active',''):s.removeAttribute('data-active'));
  if(name==='permissions')loadAccess();
  if(name==='automations')loadSkills();
  if(name==='tasks')loadMemory();
  if(name==='approvals')loadReview();
  if(name==='connect')loadConnect();
  if(name==='activity')loadActivity();
  history.replaceState(null,'','#'+name);
}
$$('.tako-nav-item').forEach(t=>t.addEventListener('click',()=>goto(t.dataset.name)));

/* home: header actions */
$('[data-action="open-ask"]')?.addEventListener('click',()=>{goto('ask');$('#ask-q')?.focus();});
$('[data-action="create-automation"]')?.addEventListener('click',()=>goto('automations'));

/* citation chip -> source drawer */
function citeChip(slug,source){
  return '<span class="cite" data-slug="'+esc(slug)+'" data-source="'+esc(source)+'">'+esc(slug)+'</span>';
}
function wireCites(root){
  $$('.cite',root).forEach(c=>c.addEventListener('click',()=>openDrawer(c.dataset.slug,c.dataset.source)));
}
async function openDrawer(slug,source){
  $('#dr-slug').textContent=slug;$('#dr-src').textContent=source;
  $('#dr-body').textContent='Loading…';
  $('#drawer').setAttribute('data-open','');$('#scrim').setAttribute('data-open','');
  $('#drawer').setAttribute('aria-hidden','false');
  try{const j=await api('/api/page?slug='+encodeURIComponent(slug)+'&source='+encodeURIComponent(source));
    $('#dr-body').textContent=j.body||'(no body)';}
  catch(e){$('#dr-body').textContent='Couldn’t open: '+e.message}
}
function closeDrawer(){$('#drawer').removeAttribute('data-open');$('#scrim').removeAttribute('data-open');$('#drawer').setAttribute('aria-hidden','true')}
$('#dr-x').addEventListener('click',closeDrawer);$('#scrim').addEventListener('click',closeDrawer);
addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});

/* render one filed entry.
   NB: this whole <script> lives inside a server-side template literal, so every
   backslash below is doubled — it must survive as a literal backslash in the
   regex the browser parses. */
function cleanAnswer(s){
  return String(s||'')
    .replace(/\\[[^\\]\\s]*\\/[^\\]\\s]*\\]/g,'')  // drop [slug] markers — shown as chips below
    .replace(/[ \\t]+\\n/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim();
}
function entryHtml(o,{stamp=false}={}){
  const cites=(o.cited&&o.cited.length?o.cited:o.pages||[]);
  const sealed=cites.length>0;
  const read=(o.pages||[]);                         // pages fed to the model
  const extra=read.filter(p=>cites.indexOf(p)<0);   // read but not cited in the answer
  const nSearched=(o.retrieved||[]).length;
  return '<div class="entry'+(sealed?' sealed':'')+'">'
    +(sealed?'<div class="seal'+(stamp?' stamp':'')+'">Sources<b>'+cites.length+'</b></div>':'')
    +'<p class="q">'+esc(o.question)+'</p>'
    +'<div class="a">'+esc(cleanAnswer(o.answer))+'</div>'
    +'<div class="meta">'
      +(cites.length?'<span>Sources</span>'+cites.map(s=>citeChip(s,o.source)).join(''):'<span>No source — answer withheld</span>')
    +'</div>'
    +'<div class="trail">'
      +'<span>Examined</span>'
      +(nSearched?'<span class="t-n tnum">'+nSearched+' found</span>':'')
      +'<span class="t-n tnum">'+read.length+' read</span>'
      +(extra.length?extra.map(s=>citeChip(s,o.source)).join(''):'')
      +'<span style="margin-left:auto" class="tnum">'+Math.round((o.ms||0)/1000)+'s · '+esc(o.source)+'</span>'
    +'</div>'
    +'<div class="caveat">Draft from a small local model — always verify the answer against the sources.</div>'
    +'</div>';
}

/* ── home ── */
async function loadHome(){
  try{
    const o=await api('/api/overview');
    $('#ask-model').textContent=o.model;
    $('#ask-hosted-warning').hidden=o.localOnly!==false;
    $$('#ask-provider-row .tako-filter').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.provider===(o.localOnly===false?'gemini':'ollama'))));
    $('#settings-model').textContent=o.model;
    $('#settings-brain-home').textContent=o.gbrainHome||'—';
    $('#settings-sources').textContent=o.totals.sources;
    $('#settings-docs').textContent=o.totals.docs;
    // ask-source options — populated here since this is the one unconditional load on boot
    $('#ask-src').innerHTML=o.sources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' ('+s.docs+')</option>').join('');

    const hs=o.homeStats||{};
    $('#home-stat-active').textContent=hs.activeAutomations??'—';
    $('#home-stat-connected').textContent=hs.connectedApps??'—';
    $('#home-stat-completed').textContent=hs.completedToday??'—';
    $('#home-stat-approval').textContent=hs.needsApproval??'—';

    $('#home-recent-activity').innerHTML=(hs.recentActivity&&hs.recentActivity.length)
      ?hs.recentActivity.map(t=>'<li>'+esc(t.title)+' <span class="tako-supporting">'+fmtAgo(t.lastTouched)+'</span></li>').join('')
      :'<li class="tako-supporting">No recent activity</li>';
    $('#home-needs-attention').innerHTML=(hs.needsAttention&&hs.needsAttention.length)
      ?hs.needsAttention.map(r=>'<li>'+esc(r.title)+'</li>').join('')
      :'<li class="tako-supporting">Nothing needs attention</li>';
  }catch(e){
    $('#home-recent-activity').innerHTML='<li>'+retryMarkup(e.message,'home')+'</li>';
    $('#home-needs-attention').innerHTML='<li class="tako-supporting">Nothing needs attention</li>';
  }
}

/* ── ask ── */
let askCategory='';
$$('#ask-category-row .tako-filter').forEach(btn=>btn.addEventListener('click',()=>{
  askCategory=btn.dataset.category||'';
  $$('#ask-category-row .tako-filter').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));
}));
$$('#ask-provider-row .tako-filter').forEach(btn=>btn.addEventListener('click',async()=>{
  const provider=btn.dataset.provider;
  const out=$('#ask-provider-out');
  out.hidden=false;out.className='out';out.textContent='Switching…';
  try{
    const r=await adminApi('/api/ask-provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider})});
    $$('#ask-provider-row .tako-filter').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));
    $('#ask-hosted-warning').hidden=r.localOnly!==false;
    out.className='out ok';out.textContent='Switched to '+provider+' — takes effect on your next question.';
    loadHome(true);
  }catch(e){out.className='out bad';out.textContent=e.message;}
}));
$('#ask-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const q=$('#ask-q').value.trim();if(!q)return;
  const src=$('#ask-src').value;
  const btn=$('button.file');btn.disabled=true;
  $('#ask-out').innerHTML='<div class="working"><span class="ring"></span>Checking your connected apps…</div>';
  try{
    const r=await api('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,source:src,category:askCategory})});
    $('#ask-out').innerHTML=entryHtml({question:q,...r},{stamp:true});
    wireCites($('#ask-out'));
  }catch(err){$('#ask-out').innerHTML='<div class="note-err">'+esc(err.message)+'</div>';}
  finally{btn.disabled=false;}
});

/* ── access ── */
let accessLoaded=false;
let accessMembers=[];
function openPermissionsPanel(idx){
  const m=accessMembers[idx];
  if(!m)return;
  $('#permissions-panel-body').innerHTML=
    '<h2>'+esc(m.name)+'</h2>'
    +'<p class="tako-supporting">'+(m.isOwner?'Owner':'Member')+'</p>'
    +'<h3>Connected content</h3>'
    +'<ul>'+((m.read&&m.read.length)?m.read.map(s=>'<li>'+esc(s)+'</li>').join(''):'<li>—</li>')+'</ul>'
    +'<p class="tako-supporting">This member’s access is read-only.</p>';
  $('#permissions-panel').hidden=false;
}
$('#permissions-panel-close')?.addEventListener('click',()=>{$('#permissions-panel').hidden=true;});
$('#cx-credentials-panel-close')?.addEventListener('click',()=>{$('#cx-credentials-panel').hidden=true;});
async function loadAccess(force){
  if(accessLoaded&&!force)return;accessLoaded=true;
  try{
    const d=await api('/api/access');
    accessMembers=(d.members||[]);
    $('#permissions-members').innerHTML=accessMembers.length?(
      '<table class="tako-permissions-table"><thead><tr><th>Name</th><th>Role</th><th>Connected content</th></tr></thead><tbody>'
      +accessMembers.map((x,i)=>'<tr class="tako-permissions-row" data-idx="'+i+'"><td class="tako-permissions-name">'+esc(x.name)+'</td><td>'+(x.isOwner?'Owner':'Member')+'</td><td class="tako-permissions-content">'+esc((x.read||[]).join(', ')||'—')+'</td></tr>').join('')
      +'</tbody></table>'
    ):'<div class="tako-empty"><p>No members yet</p><p class="tako-supporting">Access is assigned from the full console.</p></div>';
    $$('#permissions-members .tako-permissions-row').forEach(row=>row.addEventListener('click',()=>openPermissionsPanel(Number(row.dataset.idx))));

    const groups=(d.brains||[]);
    $('#permissions-groups').innerHTML=groups.length?groups.map(b=>{
      const content=(b.readSources||[]).join(', ')||'—';
      return '<div class="tako-group-card"><h3>'+esc(b.name)+'</h3>'
        +(b.purpose?'<p class="tako-supporting">'+esc(b.purpose)+'</p>':'')
        +'<p class="tako-supporting"><b>Connected content:</b> '+esc(content)+'</p>'
        +'<p class="tako-supporting"><b>Members:</b> '+b.members+'</p>'
        +((b.warnings&&b.warnings.length)?'<div class="tako-group-warning">'+esc(b.warnings.join(' '))+'</div>':'')
        +'</div>';
    }).join(''):'<p class="tako-supporting">'+esc(d.banner||'Nothing indexed yet.')+'</p>';
  }catch(e){$('#permissions-members').innerHTML='<div class="tako-empty">'+retryMarkup(e.message,'access')+'</div>';}
}

/* ── automations ── */
let skillsLoaded=false;
const sentenceFor=s=>'When '+esc(s.trigger)+', '+esc(s.actionSummary);
function statusPill(s){
  return '<span class="tako-status-pill '+(s.status==='Active'?'tako-status-pill--active':'tako-status-pill--inactive')+'">'+esc(s.status)+'</span>';
}
function runDetails(s,r){
  if(!r||r.skill!==s.name)return '';
  const ok=(r.violations||[]).length===0;
  return '<details class="tako-run-details"><summary>Run details</summary>'
    +'<p class="hint">Ran under scope <b>'+esc(r.scope&&r.scope.name||'')+'</b>'
      +(r.stepsShown<r.stepsTotal?' — first '+r.stepsShown+'/'+r.stepsTotal+' steps shown (demo)':'')+'.</p>'
    +'<table class="mem"><thead><tr><th>step</th><th>declared</th><th>actually read</th></tr></thead><tbody>'
    +(r.steps||[]).map(st=>'<tr><td class="tnum">'+esc(st.step)+'</td>'
      +'<td>'+(st.declaredReads||[]).map(x=>'<span class="tag read">'+esc(x)+'</span>').join(' ')+'</td>'
      +'<td>'+((st.actualReads||[]).length?st.actualReads.map(x=>'<span class="tag grant">'+esc(x)+'</span>').join(' '):'<span style="color:var(--ink-faint)">—</span>')+'</td></tr>').join('')
    +'</tbody></table>'
    +((r.violations||[]).length?'<div class="bound" style="border-top:0;margin-top:10px"><b class="out">violations</b><br>'+r.violations.map(v=>esc(v)).join('<br>')+'</div>'
      :(ok?'<p class="hint">Within declared reads.</p>':''))
    +'</details>';
}
async function loadSkills(force){
  if(skillsLoaded&&!force)return;skillsLoaded=true;
  $('#automation-list').innerHTML='<li class="tako-skeleton tako-skeleton-row"></li><li class="tako-skeleton tako-skeleton-row"></li>';
  try{
    const d=await api('/api/skills');
    const sk=(d.skills||[]);
    if(!sk.length){
      $('#automation-list').hidden=true;
      $('#automations-empty').hidden=false;
      return;
    }
    $('#automations-empty').hidden=true;
    $('#automation-list').hidden=false;
    $('#automation-list').innerHTML=sk.map(s=>
      '<li class="tako-automation-card">'
      +'<p class="tako-automation-sentence">'+sentenceFor(s)+'.</p>'
      +'<div class="tako-automation-meta">'
        +'<span>'+statusPill(s)+'</span>'
        +'<span><b>Last run</b> '+(s.lastRun?fmtAgo(s.lastRun):'Not yet run')+'</span>'
        +'<span><b>Owner</b> '+esc(s.owner)+'</span>'
        +'<span><b>Approval</b> '+(s.approvalRequired==='Yes'?'Always requires approval':esc(s.approvalRequired))+'</span>'
      +'</div>'
      +'<div class="tako-automation-apps">'
        +((s.connectedApps||[]).length?s.connectedApps.map(a=>'<span class="tako-automation-app-tag">'+esc(a)+'</span>').join('')
          :'<span class="tako-automation-app-tag">No connected apps</span>')
      +'</div>'
      +runDetails(s,d.exampleRun)
      +'</li>').join('');
  }catch(e){
    $('#automations-empty').hidden=true;
    $('#automation-list').hidden=false;
    $('#automation-list').innerHTML='<li>'+retryMarkup(e.message,'skills')+'</li>';
  }
}

/* New automation: templates first, never a blank builder directly. */
const AB_TRIGGER_OPTIONS=${JSON.stringify(AB_TRIGGER_OPTIONS)};
const AB_ACTION_OPTIONS=${JSON.stringify(AB_ACTION_OPTIONS)};
const AUTOMATION_TEMPLATES=[
  {name:'Summarize new Drive files to Slack', trigger:'New file added to Drive', action1:'Summarize the content', action2:'Post to Slack'},
  {name:'Notify on a new Notion page', trigger:'New page added to Notion', action1:'Draft a notification', action2:'Notify the team channel'},
  {name:'Weekly stranded-decision digest', trigger:'Every Monday morning', action1:'Run the decision audit', action2:'Send an email digest'},
];
function populateBuilderOptions(){
  const opt=v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>';
  $('#ab-trigger').innerHTML=AB_TRIGGER_OPTIONS.map(opt).join('');
  $('#ab-action-1').innerHTML=AB_ACTION_OPTIONS.map(opt).join('');
  $('#ab-action-2').innerHTML=AB_ACTION_OPTIONS.map(opt).join('');
}
function renderTemplates(){
  $('#template-list').innerHTML=AUTOMATION_TEMPLATES.map((t,i)=>
    '<li><span>'+esc(t.name)+'</span><button class="tako-btn tako-btn--secondary" data-tpl="'+i+'">Use this</button></li>').join('');
  $$('#template-list [data-tpl]').forEach(b=>b.addEventListener('click',()=>{
    const t=AUTOMATION_TEMPLATES[+b.dataset.tpl]; if(!t)return;
    populateBuilderOptions();
    $('#ab-trigger').value=t.trigger; $('#ab-action-1').value=t.action1; $('#ab-action-2').value=t.action2;
    showBuilder();
  }));
}
function showTemplates(){renderTemplates();$('#automation-templates').hidden=false;$('#automation-builder').hidden=true;$('#automation-success').hidden=true;}
function showBuilder(){$('#automation-builder').hidden=false;$('#automation-templates').hidden=true;$('#automation-success').hidden=true;$('#automation-builder-error').hidden=true;}
// NB: two elements share data-action="new-automation" — the Automations
// header button and the empty-state's own "Create automation" button — so
// this must use $$ (all matches), not $ (first match only), or the
// empty-state button silently does nothing.
$$('[data-action="new-automation"]').forEach(b=>b.addEventListener('click',showTemplates));
$('[data-action="start-from-scratch"]')?.addEventListener('click',()=>{populateBuilderOptions();showBuilder();});
$('[data-action="back-to-templates"]')?.addEventListener('click',showTemplates);

async function submitAutomation(){
  const trigger=$('#ab-trigger').value;
  const action1=$('#ab-action-1').value;
  const action2=$('#ab-action-2').value;
  const btn=$('[data-action="create-automation-submit"]');
  const errBox=$('#automation-builder-error');
  errBox.hidden=true;
  btn.disabled=true;
  const orig=btn.textContent;
  btn.textContent='Creating…';
  try{
    await adminApi('/api/automations/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trigger,action1,action2})});
    $('#automation-templates').hidden=true;
    $('#automation-builder').hidden=true;
    $('#automations-empty').hidden=true;
    $('#automation-list').hidden=true;
    $('#automation-success').hidden=false;
    setTimeout(async()=>{
      $('#automation-success').hidden=true;
      await loadSkills(true);
    },2500);
  }catch(e){
    errBox.textContent=e.message;
    errBox.hidden=false;
  }finally{
    btn.disabled=false;
    btn.textContent=orig;
  }
}
$('[data-action="create-automation-submit"]')?.addEventListener('click',submitAutomation);

/* ── tasks ──
   tasksView()/triage() in lib/tasks/model.ts still classify tasks into their
   original internal buckets (see the Bucket type there) — that scoring logic
   is unchanged. Everything below is display-only: it maps to the
   plain-language filter slugs/labels the UI shows, and never interpolates a
   raw bucket key into HTML (class names included). Three of the four buckets
   get an explicit, named filter below; anything else falls into the fourth,
   catch-all "excluded" filter, so no internal bucket name has to be spelled
   out in this rendering code to reach it. */
let memLoaded=false;
let memData=null;
let memFilter='needs-attention';
const FILTER_TO_BUCKET={'needs-attention':'hot',active:'warm','ready-to-archive':'cold'};
const NAMED_BUCKETS=Object.values(FILTER_TO_BUCKET);
const FILTER_LABEL={'needs-attention':'Needs attention',active:'Active','ready-to-archive':'Ready to archive',excluded:'Excluded'};

/** Rewrite classify()'s internal-jargon reason strings into plain language
 * for display. lib/tasks/model.ts itself is untouched — this only reshapes
 * the string right before it hits the page. Handles every shape classify()
 * can produce: "no activity Nd[, no owner] — roll up", "<state> Nd ago[
 * — roll up]", "recently <state> (Nd ago)", "has a deadline",
 * "<owner> · touched Nd ago", "no owner · idle Nd", "idle Nd (> Nd)", and
 * the no-content acknowledgement line. */
function humanizeReason(reason){
  // NB: this file's <script> lives inside a server-side template literal (see
  // the note above cleanAnswer()) — every backslash here is doubled so a
  // single backslash survives into the regex the browser actually parses.
  let r=String(reason||'');
  r=r.replace(/\\bidle (\\d+)d\\b/gi,'No activity for $1 days');
  r=r.replace(/[-—–]?\\s*roll(?:ed)?[\\s-]*up\\b/gi,'');
  r=r.replace(/(\\d+)d\\b/g,'$1 days');
  r=r.replace(/\\s{2,}/g,' ').trim();
  r=r.replace(/[\\s,;\\-—–]+$/,'');
  return r;
}

async function loadMemory(force){
  if(memLoaded&&!force)return;memLoaded=true;
  $('#mem-body').innerHTML='<div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div>';
  try{
    memData=await api('/api/tasks');
    const d=memData;
    $('#mem-src').textContent='Source: '+d.source+(d.extractedAt?' ・ updated '+new Date(d.extractedAt).toLocaleDateString('en-US'):'');
    renderMemFilters();
    renderMemBody();
  }catch(e){$('#mem-body').innerHTML='<div class="tako-empty">'+retryMarkup(e.message,'memory')+'</div>';}
}
function renderMemFilters(){
  $$('.tako-filter[data-filter]').forEach(b=>{
    b.setAttribute('aria-pressed', b.dataset.filter===memFilter?'true':'false');
  });
}
function renderMemBody(){
  const d=memData; if(!d)return;
  const p=d.policy||{};
  const targetBucket=FILTER_TO_BUCKET[memFilter];
  const rows=(d.rows||[]).filter(r=>targetBucket?r.bucket===targetBucket:!NAMED_BUCKETS.includes(r.bucket));
  const label=FILTER_LABEL[memFilter]||FILTER_LABEL.excluded;
  let html='<p class="hint">Thresholds: moves to Active after '+p.warmAfterDays+' days with no activity, Ready to archive after '+p.coldAfterDays+' days'
    +' (or '+p.closedGraceDays+' days once done) ・ shortened for this ~5-day pilot corpus, defaults are 7 / 21 / 10 days.</p>';
  if(!rows.length){
    html+='<p class="hint">Nothing in '+esc(label)+' right now.</p>';
  }else{
    html+='<div class="mbucket b-'+esc(memFilter)+'"><div class="mb-head"><b>'+esc(label)+'</b>'
      +'<span class="mb-n tnum">'+rows.length+'</span></div>';
    html+=rows.map(r=>'<div class="mtask"><div class="mt-main"><span class="mt-title">'+esc(r.title)+'</span>'
      +'<span class="pill '+({open:'',in_progress:'ok',blocked:'warn',done:'ok',dropped:''}[r.state]||'')+'">'+esc(r.state)+'</span>'
      +(r.hasDeadline?'<span class="mt-dl">⏰ Has a deadline</span>':'')+'</div>'
      +'<div class="mt-meta">'+(r.owner?esc(r.owner):'No owner')
      +' ・ <span class="mt-reason">'+esc(humanizeReason(r.reason))+'</span>'
      +' ・ '+citeChip(r.source.replace(/^engineering\\//,'').replace(/\\.md$/,''),d.source)+'</div>'
      +'<details class="tako-advanced"><summary>Why this is grouped here</summary>'
      +'<p class="hint">Ranked by how recently it was touched, whether it has an owner, how often it comes up, and whether it has a deadline ・ mentioned ×'+r.mentions+'</p></details>'
      +'</div>').join('');
    html+='</div>';
  }
  if(targetBucket==='cold'&&d.archiveNote){
    html+='<details class="task-archive-note"><summary><b>Ready to archive — what gets summarized</b></summary>'
      +'<p class="mono">'+esc(d.archiveNote)+'</p>'
      +'<p class="hint">These tasks collapse into the single line above and move out of the active list. A person approves this, and it stays in the activity log.</p></details>';
  }
  $('#mem-body').innerHTML=html;
  wireCites($('#mem-body'));
}
$$('.tako-filter[data-filter]').forEach(b=>b.addEventListener('click',()=>{
  memFilter=b.dataset.filter;
  renderMemFilters();
  renderMemBody();
}));

/* ── connect: Yoom-style service catalog ── */
let connectLoaded=false;
let cxState={rows:[],industrial:null,cat:'all',q:'',sel:null};
const catKey=c=>String(c||'').split(' / ')[0];
const serviceMark=name=>{
  const icons={
    notion:'<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5"/>',
    slack:'<path d="M9 4.5v15M15 4.5v15M4.5 9h15M4.5 15h15"/>',
    drive:'<path d="m12 3 8 14H4L12 3Z"/><path d="m8 10 4 7 4-7M8 10h8"/>',
    discord:'<path d="M6 7.5c3.8-2 8.2-2 12 0l1.5 9c-2 1.7-3.8 2.5-5.5 2.8l-1.2-1.8h-1.6L10 19.3c-1.7-.3-3.5-1.1-5.5-2.8l1.5-9Z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/>',
    notes:'<path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v4h3M9 11h6M9 15h6"/>',
    customTool:'<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.4 11 7.2-4M8.4 13l7.2 4"/>',
    cad:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    solidworks:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'
  };
  const generic='<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v6.5M20.5 12H14M12 20.5V14M3.5 12H10"/>';
  return '<span class="service-mark" aria-hidden="true"><svg viewBox="0 0 24 24">'+(icons[name]||generic)+'</svg></span>';
};
async function loadConnect(force){
  if(connectLoaded&&!force)return;connectLoaded=true;
  try{
    const [d,industrial]=await Promise.all([api('/api/connectors'),api('/api/connectors/industrial-catalog')]);
    if(!d.canSave)$('#cx-note').textContent='Read-only instance (demo mode) — changes are disabled.';
    cxState.rows=d.rows||[];cxState.industrial=industrial;cxState.canSave=d.canSave;
    const cats=[...new Set(cxState.rows.map(r=>r.category))];
    $('#cx-rail').innerHTML=[['all','All'],...cats.map(c=>[c,c])]
      .map(([k,label])=>'<button data-cat="'+esc(k)+'"'+(k===cxState.cat?' aria-current="true"':'')+'>'+esc(k==='all'?label:catKey(label))+'</button>').join('');
    $$('#cx-rail button').forEach(b=>b.addEventListener('click',()=>{
      cxState.cat=b.dataset.cat;
      $$('#cx-rail button').forEach(x=>x.setAttribute('aria-current',String(x===b)));
      renderCxGrid();
    }));
    const s=$('#cx-search');
    s.addEventListener('input',()=>{cxState.q=s.value.trim().toLowerCase();renderCxGrid();});
    renderCxGrid();
    if(cxState.sel)selectCx(cxState.sel);
  }catch(e){$('#cx-grid').innerHTML='<div class="tako-empty">'+retryMarkup(e.message,'connect')+'</div>';}
}
function renderCxGrid(){
  const list=cxState.rows.filter(r=>
    (cxState.cat==='all'||r.category===cxState.cat)&&
    (!cxState.q||(r.label+' '+r.name+' '+r.category).toLowerCase().includes(cxState.q)));
  const grid=$('#cx-grid');
  if(!list.length){grid.innerHTML='<div class="cx-none">No services match</div>';return;}
  grid.innerHTML=list.map(r=>
    '<button class="cx-card" data-name="'+esc(r.name)+'" aria-expanded="'+(cxState.sel===r.name)+'">'
    +serviceMark(r.hasIndustrialCatalog?'customTool':r.name)
    +'<span class="nm">'+esc(r.label)+'</span>'
    +'<span class="st">'+(r.configured?'<span class="dot-ok"></span>Connected':'<span class="dot-off"></span>Not connected')
      +(r.pages?' · '+r.pages+' pages':'')+'</span></button>').join('');
  $$('.cx-card',grid).forEach(c=>c.addEventListener('click',()=>selectCx(c.dataset.name)));
}
function showMascotBriefly(){
  const m=$('#cx-mascot');if(!m)return;
  m.hidden=false;
  clearTimeout(showMascotBriefly._t);
  showMascotBriefly._t=setTimeout(()=>{m.hidden=true;},2200);
}
function selectCx(name,openAdvanced){
  cxState.sel=name;
  $$('.cx-card').forEach(c=>c.setAttribute('aria-expanded',String(c.dataset.name===name)));
  const r=cxState.rows.find(x=>x.name===name);const panel=$('#cx-panel');
  if(!r){panel.hidden=true;return;}
  const fields=r.fields.map(f=>
    '<label>'+esc(f.label)+(f.list?' (blank, or comma-separated)':'')
    +'<input data-k="'+esc(f.key)+'"'+(f.num?' type="text" inputmode="numeric"':' type="text"')
    +' value="'+esc(String(f.value))+'" placeholder="'+esc(f.ph||'')+'"></label>').join('');
  // Summary-first: only real fields from connectorsView() — app name, a
  // derived connected/not-connected status, the real subdir (relabeled for a
  // non-technical audience), and the real lastSync timestamp. There is no
  // account/workspace field anywhere in this data model (this system stores
  // a local token, it never calls back to the provider's API to discover
  // which account was authenticated), so that row is intentionally omitted
  // rather than faked.
  panel.innerHTML='<div class="pnl-head"><h3>'+esc(r.label)+'</h3>'
    +'<span class="tokm">'+esc(r.category)+'</span></div>'
    +(r.note?'<p class="cx-help">'+esc(r.note)+'</p>':'')
    +'<div class="cx-summary">'
      +'<div class="cx-summary-row"><span class="cx-summary-label">Status</span>'
        +'<span class="st">'+(r.configured?'<span class="dot-ok"></span>Connected':'<span class="dot-off"></span>Not connected')+'</span></div>'
      +'<div class="cx-summary-row"><span class="cx-summary-label">Feeds into</span><span>'+esc(r.subdir||'—')+'</span></div>'
      +'<div class="cx-summary-row"><span class="cx-summary-label">Last synced</span><span class="cx-lastsync">'+(r.lastSync?fmtDate(r.lastSync):'Never synced')+'</span></div>'
    +'</div>'
    +(r.credentialsDocUrl?'<p class="hint cx-credentials-link"><button class="cx-credentials-btn" type="button" data-doc="'+esc(r.credentialsDocUrl)+'">Where do I get this token? →</button></p>':'')
    +'<div class="cx-summary-actions">'
      +'<button class="tako-btn tako-btn--primary cx-manage" type="button">Manage</button>'
      +(r.configured&&cxState.canSave?'<button class="tako-btn tako-btn--secondary cx-sync-now" type="button">Sync now</button>':'')
    +'</div>'
    +(r.configured&&cxState.canSave?'<p class="cx-sync-out hint" hidden></p>':'')
    +'<details class="tako-advanced"'+(openAdvanced?' open':'')+'>'
      +'<summary>Advanced</summary>'
      +'<div class="cx-body"><p class="cx-help">'+esc(r.help)+'</p>'
      +(r.hasToken?'<label>'+esc(r.tokenLabel)+'<input class="mono" data-k="token" type="password" placeholder="'+esc(r.configured?'•••• enter only to change':r.tokenPh)+'"></label>':'')
      +fields
      +'<div class="cx-actions">'
        +(cxState.canSave?'<button class="file save" type="button">Save</button>':'')
        +'<button class="test" type="button">Test</button>'
        +'<span class="out"></span>'
      +'</div>'+(r.hasIndustrialCatalog?renderIndustrial(cxState.industrial):'')+'</div>'
    +'</details>';
  panel.hidden=false;
  const advanced=$('.tako-advanced',panel);
  $('.cx-manage',panel).addEventListener('click',()=>{advanced.open=true;advanced.scrollIntoView({behavior:'smooth',block:'nearest'});});
  const credsBtn=$('.cx-credentials-btn',panel);
  if(credsBtn)credsBtn.addEventListener('click',async()=>{
    const body=$('#cx-credentials-panel-body');
    body.innerHTML='<p class="hint">Loading…</p>';
    $('#cx-credentials-panel').hidden=false;
    try{
      const res=await fetch(credsBtn.dataset.doc);
      if(!res.ok)throw new Error('Could not load this guide (HTTP '+res.status+').');
      body.innerHTML=mdToHtml(await res.text());
    }catch(e){body.innerHTML='<p class="note-err">'+esc(e.message)+'</p>';}
  });
  const out=$('.out',panel);
  const vals=()=>{const o={name};$$('input[data-k]',panel).forEach(i=>o[i.dataset.k]=i.value);return o;};
  const save=$('.save',panel);
  if(save)save.addEventListener('click',async()=>{
    out.className='out';out.textContent='Saving…';
    try{await adminApi('/api/connectors/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(vals())});
      out.className='out ok';out.textContent='Saved — use "Sync now" to pull the latest content.';
      showMascotBriefly();
      setTimeout(()=>loadConnect(true),400);
    }catch(e){out.className='out bad';out.textContent=e.message;}
  });
  $('.test',panel).addEventListener('click',async()=>{
    out.className='out';out.textContent='Checking…';
    try{const rr=await adminApi('/api/connectors/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
      out.className='out '+(rr.ok?'ok':'bad');out.textContent=(rr.ok?'OK · ':'Failed · ')+rr.detail;
    }catch(e){out.className='out bad';out.textContent=e.message;}
  });
  const syncNow=$('.cx-sync-now',panel), syncOut=$('.cx-sync-out',panel);
  if(syncNow)syncNow.addEventListener('click',async()=>{
    syncNow.disabled=true;syncOut.hidden=false;syncOut.className='cx-sync-out hint';
    syncOut.textContent='Syncing… this can take up to a minute.';
    try{
      const rr=await adminApi('/api/connectors/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
      syncOut.className='cx-sync-out hint '+(rr.ok?'ok':'bad');
      syncOut.textContent=(rr.ok?'Done · ':'Failed · ')+rr.detail;
      if(rr.ok){showMascotBriefly();setTimeout(()=>loadConnect(true),400);}
    }catch(e){syncOut.className='cx-sync-out hint bad';syncOut.textContent=e.message;}
    finally{syncNow.disabled=false;}
  });
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderIndustrial(d){
  const order=['cad','plm','cae','erp','mes','qms','ot','cam','other'];
  const rows=d.rows||[];
  const domains=[...new Set(rows.map(r=>r.domain))].sort((a,b)=>order.indexOf(a)-order.indexOf(b)||a.localeCompare(b));
  return '<div class="industrial"><div class="ih"><b>産業コネクタ台帳 / industrial register</b><span>'+rows.length+' entries ・ ● built / ○ catalog-only</span></div>'
    +domains.map(domain=>'<div class="ind-domain">'+esc(domain)+'</div>'
      +rows.filter(r=>r.domain===domain).map(r=>'<div class="ind-row" title="'+esc(r.note)+'">'
        +'<span class="mark '+(r.built?'built':'')+'">'+(r.built?'●':'○')+'</span>'
        +'<span class="name">'+esc(r.label)+'</span>'
        +'<span class="risk">risk '+esc(r.riskCeiling)+'</span>'
        +'<span class="wave">'+esc(r.proposedWave)+'</span></div>').join('')).join('')+'</div>';
}

/* ── review desk + redaction ── */
const CHK_MARK={ok:'◯',concern:'△',blocker:'×',unchecked:'—'};
function boxify(s){ return esc(s).replace(/\\[██ ([^\\]]+?) ██\\]/g,'<span class="box">$1</span>'); }
$('#rd-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const t=$('#rd-in').value; if(!t.trim())return;
  const btn=$('#rd-form button'); btn.disabled=true;
  try{
    const r=await api('/api/redact-try',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t})});
    const sum=(r.hits||[]).reduce((m,h)=>{m[h.label]=(m[h.label]||0)+1;return m;},{});
    $('#rd-out').innerHTML='<div class="redbox">'+boxify(r.text)
      +'<div class="red-sum">'+(r.blocked?'<span class="red-blocked">Would be blocked</span> · ':'')
      +(r.hits.length?Object.entries(sum).map(([k,n])=>esc(k)+' ×'+n).join(' · '):'Nothing matched')+'</div></div>';
  }catch(err){$('#rd-out').innerHTML='<div class="note-err">'+esc(err.message)+'</div>';}
  finally{btn.disabled=false;}
});
$('#rv-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const body={
    title:$('#iv-title').value, submittedBy:$('#iv-by').value, intent:$('#iv-intent').value,
    audience:$('#iv-aud').value, body:$('#iv-body').value, sources:$('#iv-src').value,
  };
  const btn=$('#rv-form button'); btn.disabled=true; $('#rv-form-out').innerHTML='';
  try{
    const r=await adminApi('/api/review-submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    $('#rv-form-out').innerHTML='<div class="form-ok">Added to the queue (' + esc(r.id) + ').</div>';
    ['iv-title','iv-by','iv-intent','iv-aud','iv-body','iv-src'].forEach(i=>$('#'+i).value='');
    selectedReviewId=r.id;
    await loadReview(true);
    $('#rv-list').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){$('#rv-form-out').innerHTML='<div class="note-err">'+esc(err.message)+'</div>';}
  finally{btn.disabled=false;}
});

/* Vocabulary shown in this section — plain language, not the academic check
   names the governance model (lib/review/model.ts) uses internally. The model
   itself is untouched; only the display labels change here. */
const RV_STATE_LABEL={submitted:'Submitted',in_review:'In review',approved:'Approved',revise:'Needs revision',rejected:'Rejected',escalated:'Escalated'};
const RV_CHECK_LABEL={intent:'Purpose',merit:'Usefulness',harm:'Safety',evidence:'Sources',policy:'Company rules'};
const RV_VERDICT_LABEL={approved:'Approved',revise:'Needs revision',rejected:'Rejected',escalated:'Escalated'};
const RV_DECISION_VERDICT={approve:'approved','request-changes':'revise',reject:'rejected','ask-admin':'escalated'};
function humanizeReceipt(s){return String(s||'').replace(/\\b(intent|merit|harm|evidence|policy)\\b/gi,w=>RV_CHECK_LABEL[w.toLowerCase()]||w);}

let reviewRows=[];
let reviewCounts={};
let selectedReviewId=null;
let reviewLoaded=false;

function rvCard(r){
  const tone=r.state==='approved'?'ok':(r.state==='rejected'||r.state==='escalated')?'warn':'';
  return '<button type="button" class="tako-approval-card'+(r.id===selectedReviewId?' is-selected':'')+'" data-review-id="'+esc(r.id)+'">'
    +'<span class="tako-approval-card-title">'+esc(r.title)+'</span>'
    +'<span class="pill '+tone+'">'+esc(RV_STATE_LABEL[r.state]||r.state)+'</span>'
    +'<span class="tako-approval-card-meta">'+esc(r.submittedBy||'—')+' · risk '+esc(r.risk)+'</span>'
    +'</button>';
}
function renderApprovalQueue(){
  const c=reviewCounts||{};
  let html='<p class="hint">Open '+(c.open??0)+' · Approved '+(c.approved??0)+' · Needs revision '+(c.revise??0)+' · Rejected '+(c.rejected??0)+' · Escalated '+(c.escalated??0)+'</p>';
  html+=reviewRows.length?reviewRows.map(rvCard).join(''):'<p class="tako-supporting">No reviews yet.</p>';
  const list=$('#rv-list');
  list.innerHTML=html;
  $$('.tako-approval-card',list).forEach(btn=>btn.addEventListener('click',()=>{
    selectedReviewId=btn.dataset.reviewId;
    renderApprovalQueue();
    renderApprovalDetail();
  }));
}
function renderApprovalDetail(){
  const box=$('#rv-detail');
  const r=reviewRows.find(x=>x.id===selectedReviewId);
  if(!r){
    box.innerHTML='<div class="tako-empty"><p>Select a review</p><p class="tako-supporting">Pick an item from the queue to see its checks and record a decision.</p></div>';
    return;
  }
  const checksHtml=r.checks.map(k=>'<span class="chk s-'+k.status+'" title="'+esc(k.asks)+'"><span class="m">'+CHK_MARK[k.status]+'</span>'+esc(RV_CHECK_LABEL[k.key]||k.key)+(k.note?'：'+esc(k.note):'')+'</span>').join('');
  const decisionHtml=r.decision
    ?'<span class="verdict">'+esc(RV_VERDICT_LABEL[r.decision.verdict]||r.decision.verdict)+'</span> — '+esc(r.decision.by)+' · '+new Date(r.decision.at).toLocaleDateString()+(r.decision.note?' · '+esc(r.decision.note):'')
    :'No decision recorded yet.';
  // Actions: the four decision buttons come from the <template> in the markup
  // above, cloned per review — never hand-built here, so the exact button set
  // stays in one place. Omitted entirely for a terminal review (allowed==[]);
  // Approve is disabled (not hidden) when the server's canApprove() gate says
  // no, with its real reasons shown alongside.
  let actionsHtml='';
  if(r.allowed&&r.allowed.length){
    const tpl=document.getElementById('tako-approval-actions-template');
    const frag=tpl.content.cloneNode(true);
    const approveAllowed=r.allowed.includes('approved');
    const approveBtn=frag.querySelector('[data-decision="approve"]');
    if(approveBtn&&!approveAllowed){
      approveBtn.disabled=true;
      approveBtn.title='Approval is blocked — see the reasons below.';
    }
    frag.querySelectorAll('[data-decision]').forEach(b=>{b.dataset.reviewId=r.id;});
    const wrap=document.createElement('div');
    wrap.appendChild(frag);
    actionsHtml=wrap.innerHTML;
    if(!approveAllowed&&r.approveGate&&r.approveGate.reasons&&r.approveGate.reasons.length){
      actionsHtml+='<p class="tako-approval-reasons">Approval is blocked: '+r.approveGate.reasons.map(x=>esc(x)).join('; ')+'</p>';
    }
  }
  box.innerHTML='<h2>'+esc(r.title)+'</h2>'
    +'<p class="tako-approval-card-meta">'+esc(RV_STATE_LABEL[r.state]||r.state)+' · risk '+esc(r.risk)+'</p>'
    +'<div class="rv-fields"><b>Purpose</b>'+esc(r.intent)+'<br><b>Audience</b>'+esc(r.audience)
    +'<br><b>Submitted by</b>'+esc(r.submittedBy||'—')+' · '+new Date(r.submittedAt).toLocaleDateString()+'</div>'
    +'<div class="rv-body">'+boxify(r.bodyMasked)+'</div>'
    +'<div class="red-sum">'+(r.redaction.blocked?'<span class="red-blocked">Still blocked after masking</span> · ':'')
      +(r.redaction.count?('Auto-masked '+r.redaction.count+' item(s): '+r.redaction.summary.map(s=>esc(s.label.split(' / ')[0])+' ×'+s.count).join(', ')):'Auto-masking: nothing matched')+'</div>'
    +'<div class="rv-checks">'+checksHtml+'</div>'
    +(r.sources&&r.sources.length?'<div class="rv-checks">'+r.sources.map(s=>citeChip(s,'shared')).join('')+'</div>':'')
    +'<div class="rv-decision">'+decisionHtml+'<span class="receipt">'+esc(humanizeReceipt(r.receipt))+'</span></div>'
    +actionsHtml;
  wireCites(box);
  $$('[data-decision]',box).forEach(btn=>btn.addEventListener('click',()=>decide(btn.dataset.reviewId,btn.dataset.decision)));
}
async function decide(id,decisionKey){
  const verdict=RV_DECISION_VERDICT[decisionKey];
  if(!verdict)return;
  const btns=$$('[data-decision]',$('#rv-detail'));
  btns.forEach(b=>b.disabled=true);
  try{
    await adminApi('/api/review-decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,verdict})});
    await loadReview(true);
  }catch(err){
    $('#rv-detail').insertAdjacentHTML('beforeend','<div class="note-err">'+esc(err.message)+'</div>');
    btns.forEach(b=>b.disabled=false);
  }
}
async function loadReview(force){
  if(reviewLoaded&&!force)return;reviewLoaded=true;
  $('#rv-list').innerHTML='<div class="tako-skeleton tako-skeleton-row"></div><div class="tako-skeleton tako-skeleton-row"></div>';
  try{
    const d=await api('/api/reviews');
    $('#rv-rules').innerHTML=(d.rules||[]).map(r=>'<span class="tag a-'+r.action+'" title="'+r.action+'">'+esc(r.label)+' · '+r.action+'</span>').join('');
    reviewRows=d.rows||[];
    reviewCounts=d.counts||{};
    if(!reviewRows.some(r=>r.id===selectedReviewId)){
      const open=reviewRows.find(r=>r.state==='submitted'||r.state==='in_review');
      selectedReviewId=(open||reviewRows[0]||{}).id||null;
    }
    renderApprovalQueue();
    renderApprovalDetail();
  }catch(e){$('#rv-list').innerHTML='<div class="tako-empty">'+retryMarkup(e.message,'review')+'</div>';}
}

/* ── activity ──
   Two real sources merged server-side by activityView() (scripts/demo.ts):
   the one real per-skill run receipt and every real review-submission event.
   The initial list is server-rendered (below, in the "activity" section
   markup) so it's already real and present on first paint; this just keeps
   it fresh on revisit and wires the Retry action. */
function activityBadgeClass(outcome){return outcome==='success'?'tako-badge--success':outcome==='pending'?'tako-badge--warning':'tako-badge--error';}
function renderActivityItem(e){
  const apps=(e.sources&&e.sources.length)?e.sources.join(', '):'—';
  const retryAttrs=e.retry?(' data-retry-kind="'+esc(e.retry.kind)+'"'+(e.retry.kind==='review'?' data-review-id="'+esc(e.retry.reviewId)+'"':'')):'';
  return '<li class="tako-activity-item" data-outcome="'+esc(e.outcome)+'">'
    +'<div class="tako-activity-top"><span class="tako-activity-time">'+(e.time?fmtDate(e.time):'—')+'</span>'
    +'<span class="tako-badge '+activityBadgeClass(e.outcome)+'">'+esc(e.outcomeLabel)+'</span></div>'
    +'<p class="tako-activity-label">'+esc(e.label)+'</p>'
    +'<div class="tako-activity-meta">'
      +'<span><b>Initiator</b> '+esc(e.initiator)+'</span>'
      +'<span><b>Apps/sources</b> '+esc(apps)+'</span>'
      +'<span><b>Duration</b> '+esc(e.duration)+'</span>'
    +'</div>'
    +(e.needsRetry?('<div class="tako-activity-failure">'
      +(e.detail?'<p>'+esc(e.detail)+'</p>':'')
      +(e.affected?'<p><b>Affected</b> '+esc(e.affected)+'</p>':'')
      +(e.action?'<p>'+esc(e.action)+'</p>':'')
      +'<button class="tako-btn tako-btn--secondary"'+retryAttrs+'>Retry</button></div>'):'')
    +'</li>';
}
function wireActivityRetry(){
  $$('#activity-list [data-retry-kind]').forEach(btn=>{
    if(btn.dataset.wired)return; btn.dataset.wired='1';
    btn.addEventListener('click',async()=>{
      const kind=btn.dataset.retryKind;
      if(kind==='review'){goto('approvals');return;}
      if(kind==='skill-run'){
        btn.disabled=true; btn.textContent='Retrying…';
        try{await adminApi('/api/activity/retry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'skill-run'})});}
        catch(e){/* surfaced by the refreshed list below */}
        await loadActivity(true);
      }
    });
  });
}
let activityLoaded=false;
async function loadActivity(force){
  if(activityLoaded&&!force)return; activityLoaded=true;
  try{
    const d=await api('/api/activity');
    $('#activity-list').innerHTML=(d.entries||[]).length?d.entries.map(renderActivityItem).join(''):'<li class="tako-empty"><p>No activity yet</p><p class="tako-supporting">Runs and submissions will show up here as they happen.</p></li>';
    wireActivityRetry();
  }catch(e){$('#activity-list').innerHTML='<li>'+retryMarkup(e.message,'activity')+'</li>';}
}

/* Retry wiring for every screen whose fetch can fail — a delegated listener
   so it works for retry buttons rendered at any point, not just ones present
   at boot. */
const RETRY_FNS={
  home:()=>loadHome(),
  access:()=>loadAccess(true),
  skills:()=>loadSkills(true),
  memory:()=>loadMemory(true),
  review:()=>loadReview(true),
  activity:()=>loadActivity(true),
  connect:()=>loadConnect(true),
};
document.addEventListener('click',e=>{
  const btn=e.target.closest && e.target.closest('[data-retry]');
  if(!btn)return;
  const fn=RETRY_FNS[btn.dataset.retry];
  if(fn)fn();
});

/* boot */
loadHome();
wireActivityRetry(); // wire the server-rendered initial Activity list too
const start=(location.hash||'#home').slice(1);
if(['home','ask','automations','connect','tasks','activity','approvals','permissions','settings','help'].includes(start))goto(start);
</script>
</body></html>`;
