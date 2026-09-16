/**
 * Intent-Merit Review — the governed path for letting an AI-assisted output
 * leave the company. Tako never sends or publishes anything itself; an
 * output is registered here with its purpose and audience, run through six
 * checks, and a human records 承認 / 修正 / 却下 / エスカレーション. Everything
 * is auditable. Pure — no I/O.
 *
 * Lean-canvas flow: 成果物・目的・公開先を登録 → 機密・根拠・社内ルールを確認
 *   → Intent–Merit Review で価値と影響を整理 → 修正・承認・差戻しを記録
 */

export type CheckKey = "intent" | "merit" | "harm" | "evidence" | "policy";
export const CHECK_KEYS: CheckKey[] = ["intent", "merit", "harm", "evidence", "policy"];

export const CHECK_LABELS: Record<CheckKey, { ja: string; en: string; asks: string }> = {
  intent:   { ja: "意図",   en: "Intent",   asks: "何のための成果物で、誰に・どこに公開するか" },
  merit:    { ja: "価値",   en: "Merit",    asks: "公開した場合の便益。曖昧なら concern" },
  harm:     { ja: "リスク", en: "Harm",     asks: "誤情報・機密漏えい・関係者への影響。少しでもあれば concern、確実な害は blocker" },
  evidence: { ja: "根拠",   en: "Evidence", asks: "本文の主張が取り込み済みの出典で裏づくか。裏づかない主張が残るなら blocker" },
  policy:   { ja: "規程",   en: "Policy",   asks: "_operating-rules と社内ルールに反しないか（例：ローカル外への送信、権限外の参照）" },
};

export type CheckStatus = "ok" | "concern" | "blocker" | "unchecked";
export type CheckResult = { status: CheckStatus; note: string; by?: string; at?: string };

export type Verdict = "approved" | "revise" | "rejected" | "escalated";
export type ReviewState = "submitted" | "in_review" | Verdict;
export const VERDICTS: Verdict[] = ["approved", "revise", "rejected", "escalated"];

export type Decision = { verdict: Verdict; by: string; at: string; note: string };

export type ReviewItem = {
  id: string;
  title: string;
  intent: string;            // purpose, one line
  audience: string;          // who / where it will be published
  body: string;              // the AI-assisted output under review
  sources: string[];         // page slugs the body is grounded in
  submittedBy: string;
  submittedAt: string;       // ISO
  state: ReviewState;
  checks: Record<CheckKey, CheckResult>;
  /** Append-only — a re-decision (e.g. out of "revise" or "escalated") adds a
   *  new entry rather than overwriting the last one, so no prior verdict's
   *  by/at/note is ever lost. `latestDecision()` reads the current one. */
  decisions: Decision[];
};

const clone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function emptyChecks(): Record<CheckKey, CheckResult> {
  return Object.fromEntries(CHECK_KEYS.map((k) => [k, { status: "unchecked", note: "" } as CheckResult])) as Record<CheckKey, CheckResult>;
}

/** A fresh review item in `submitted` state. */
export function newReview(
  input: Pick<ReviewItem, "title" | "intent" | "audience" | "body" | "submittedBy"> & { sources?: string[]; id?: string; now?: string },
): ReviewItem {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `rev_${(Date.parse(now) || 0).toString(36)}_${input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "item"}`,
    title: input.title.trim(),
    intent: input.intent.trim(),
    audience: input.audience.trim(),
    body: input.body,
    sources: [...new Set(input.sources ?? [])],
    submittedBy: input.submittedBy,
    submittedAt: now,
    state: "submitted",
    checks: emptyChecks(),
    decisions: [],
  };
}

/** The current decision, if any — the last entry in the append-only log. */
export function latestDecision(item: ReviewItem): Decision | null {
  return item.decisions.length ? item.decisions[item.decisions.length - 1] : null;
}

export type Risk = "low" | "medium" | "high";

/** Aggregate risk from the checks: any blocker → high; 2+ concerns or an
 *  unchecked harm/evidence → medium; else low. */
export function overallRisk(item: ReviewItem): Risk {
  const vals = CHECK_KEYS.map((k) => item.checks[k]);
  if (vals.some((c) => c.status === "blocker")) return "high";
  const concerns = vals.filter((c) => c.status === "concern").length;
  const criticalUnchecked = (["harm", "evidence"] as CheckKey[]).some((k) => item.checks[k].status === "unchecked");
  if (concerns >= 2 || (concerns >= 1 && criticalUnchecked)) return "medium";
  if (criticalUnchecked) return "medium";
  return concerns >= 1 ? "medium" : "low";
}

export function allChecked(item: ReviewItem): boolean {
  return CHECK_KEYS.every((k) => item.checks[k].status !== "unchecked");
}

/** Approval needs every check done, no blockers, evidence explicitly ok, and a
 *  grounded body (at least one source). */
export function canApprove(item: ReviewItem): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!allChecked(item)) reasons.push("未チェックの項目がある / a check is still unchecked");
  if (CHECK_KEYS.some((k) => item.checks[k].status === "blocker")) reasons.push("blocker が残っている / a blocker is unresolved");
  if (item.checks.evidence.status !== "ok") reasons.push("根拠が ok になっていない / evidence is not confirmed ok");
  if (item.sources.length === 0) reasons.push("出典が0件 / no grounding sources attached");
  return { ok: reasons.length === 0, reasons };
}

/** Verdicts allowed from the current state. */
export function allowedVerdicts(item: ReviewItem): Verdict[] {
  if (item.state === "approved" || item.state === "rejected") return [];
  const base: Verdict[] = ["revise", "rejected", "escalated"];
  return canApprove(item).ok ? ["approved", ...base] : base;
}

export function setCheck(item: ReviewItem, key: CheckKey, result: CheckResult): ReviewItem {
  const next = clone(item);
  next.checks[key] = { ...result, note: result.note ?? "" };
  if (next.state === "submitted") next.state = "in_review";
  return next;
}

export function recordDecision(item: ReviewItem, verdict: Verdict, by: string, note = "", now = new Date().toISOString()): ReviewItem {
  if (!allowedVerdicts(item).includes(verdict)) {
    throw new Error(`verdict "${verdict}" not allowed from state "${item.state}"`);
  }
  const next = clone(item);
  next.decisions = [...next.decisions, { verdict, by, at: now, note: note.trim() }];
  next.state = verdict;
  return next;
}

/** One-line audit entry — what a reviewer would paste into the record. */
export function receiptLine(item: ReviewItem): string {
  const marks = CHECK_KEYS.map((k) => `${CHECK_LABELS[k].en.toLowerCase()}:${item.checks[k].status}`).join(" ");
  const d = latestDecision(item);
  const head = d ? `${verdictJa(d.verdict)} by ${d.by} on ${d.at.slice(0, 10)}` : `pending (${item.state})`;
  return `${head} — risk:${overallRisk(item)} — ${marks} — sources:${item.sources.length}${d?.note ? ` — ${d.note}` : ""}`;
}

export function verdictJa(v: Verdict): string {
  return { approved: "承認", revise: "修正", rejected: "却下", escalated: "エスカレーション" }[v];
}
