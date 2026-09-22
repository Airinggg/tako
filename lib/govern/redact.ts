/**
 * Redaction — the filtering / masking layer for AI governance.
 *
 * Two placements, same engine:
 *   - on ingestion: mask secrets and PII before content enters the brain;
 *   - on output: mask (or block) before an answer or a review body is shown.
 *
 * Pure — no I/O. Rules are data (config/redaction.json), so an operator can add
 * a house pattern without code.
 */

export type RedactionAction = "mask" | "flag" | "block";

export type RedactionRule = {
  name: string;            // stable id
  label: string;           // shown to a person: "メール", "APIキー"
  action: RedactionAction; // mask = replace, flag = keep + record, block = record + stop
  /** A source regex (string, so it survives JSON). Global flag is added automatically. */
  pattern: string;
  /** optional: only count a match if this predicate passes (e.g. Luhn for card numbers) */
  check?: "luhn";
};

export type RedactionHit = {
  rule: string;
  label: string;
  action: RedactionAction;
  match: string;           // the raw text that matched (for the audit log, not for display)
  index: number;
};

export type RedactionResult = {
  text: string;            // masked text (unchanged for flag-only rules)
  hits: RedactionHit[];
  blocked: boolean;        // a `block` rule fired — the output must not leave
};

// Order matters: the most specific / highest-value rules run first so a generic
// digit rule can't eat part of a token before the token rule sees it.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_RULES: RedactionRule[] = [
  { name: "private-key", label: "秘密鍵ブロック / private key block", action: "block",
    pattern: "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\\s\\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----" },
  { name: "api-secret", label: "APIキー・トークン / API key or token", action: "block",
    // sk- keys allow "-"/"_" in the body (not just alnum): OpenAI's current
    // project-scoped format is "sk-proj-<...>", and other sk--prefixed keys
    // commonly segment the same way — a flat alnum-only class missed those.
    pattern: "\\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ya29\\.[A-Za-z0-9_-]{20,}|ntn_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})" },
  { name: "bearer", label: "Bearer トークン / bearer token", action: "block",
    pattern: "Bearer\\s+[A-Za-z0-9._-]{16,}" },
  { name: "credit-card", label: "カード番号らしき数字 / card-like number", action: "block",
    pattern: "\\b(?:\\d[ -]?){13,16}\\b", check: "luhn" },
  { name: "my-number", label: "マイナンバーらしき12桁 / 12-digit id", action: "block",
    pattern: "(?<![\\w-])\\d{4}[ -]?\\d{4}[ -]?\\d{4}(?![\\w-])" },
  { name: "email", label: "メール / email", action: "mask",
    pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" },
  { name: "phone-jp", label: "電話番号 / phone", action: "mask",
    pattern: "0\\d{1,3}[-(－]?\\d{2,4}[-)－]?\\d{3,4}" },
];

function luhnOk(digitsRaw: string): boolean {
  const d = digitsRaw.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

const box = (label: string) => `[██ ${label.split(" / ")[0]} ██]`;

/** Apply the rules. `mask` replaces the match with a labelled box; `flag` records
 *  it without changing text; `block` records it and sets `blocked`. */
export function redact(text: string, rules: readonly RedactionRule[] = DEFAULT_RULES): RedactionResult {
  const hits: RedactionHit[] = [];
  let blocked = false;
  let out = String(text ?? "");

  for (const rule of rules) {
    let re: RegExp;
    try { re = new RegExp(rule.pattern, "g"); } catch { continue; }
    // collect matches first (indices shift once we start replacing)
    const found: { match: string; index: number }[] = [];
    for (const m of out.matchAll(re)) {
      if (m.index === undefined) continue;
      if (rule.check === "luhn" && !luhnOk(m[0])) continue;
      found.push({ match: m[0], index: m.index });
    }
    if (!found.length) continue;

    for (const f of found) {
      hits.push({ rule: rule.name, label: rule.label, action: rule.action, match: f.match, index: f.index });
      if (rule.action === "block") blocked = true;
    }
    if (rule.action === "mask" || rule.action === "block") {
      out = out.replace(new RegExp(rule.pattern, "g"), (m) =>
        (rule.check === "luhn" && !luhnOk(m)) ? m : box(rule.label));
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return { text: out, hits, blocked };
}

/** Mask an explicit list of names (from config/people.json's excluded list or
 *  `_excluded-people.md`). Whole-word, case-insensitive; longest names first so
 *  "Ada Lovelace" masks before "Ada". */
export function redactNames(text: string, names: readonly string[], label = "個人名 / person"): RedactionResult {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!clean.length) return { text: String(text ?? ""), hits: [], blocked: false };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule: RedactionRule = { name: "person", label, action: "mask", pattern: `(?:${clean.map(esc).join("|")})` };
  return redact(text, [rule]);
}

export type RedactionSummary = { label: string; action: RedactionAction; count: number }[];

export function summariseHits(hits: readonly RedactionHit[]): RedactionSummary {
  const by = new Map<string, { label: string; action: RedactionAction; count: number }>();
  for (const h of hits) {
    const k = h.rule;
    const cur = by.get(k) ?? { label: h.label, action: h.action, count: 0 };
    cur.count++;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** Merge default rules with operator-supplied ones (by name; operator wins). */
export function resolveRules(extra: readonly RedactionRule[] = []): RedactionRule[] {
  const byName = new Map(DEFAULT_RULES.map((r) => [r.name, r]));
  for (const r of extra) if (r && r.name && r.pattern) byName.set(r.name, r);
  return [...byName.values()];
}
