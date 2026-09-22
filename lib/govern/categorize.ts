/**
 * Department-based content categorization — browsing/search only.
 *
 * This is deliberately independent of the access-control `subdir` scope
 * already used by connectors (config/connectors.json's `subdir`, e.g.
 * "engineering", "shared"). A wrong category here only misfiles something
 * for browsing; it never changes who can read what. No local model call —
 * pure keyword scoring, consistent with lib/govern/redact.ts's rule style
 * and fast enough to run over every listed page.
 */

export const DEPARTMENTS = ["finance", "hr", "engineering", "sales", "legal", "operations", "general"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  finance: "財務 / Finance",
  hr: "人事 / HR",
  engineering: "エンジニアリング / Engineering",
  sales: "営業 / Sales",
  legal: "法務 / Legal",
  operations: "業務 / Operations",
  general: "その他 / General",
};

// One keyword list per department, English + Japanese terms mixed (matching
// this product's bilingual audience). Matching is case-insensitive substring
// search — good enough for browsing; not meant to be a precise classifier.
const KEYWORDS: Record<Exclude<Department, "general">, string[]> = {
  finance: [
    "invoice", "budget", "revenue", "expense", "forecast", "payroll cost", "accounting",
    "請求書", "予算", "売上", "経費", "決算", "会計",
  ],
  hr: [
    "onboarding", "hire", "hiring", "candidate", "performance review", "payroll", "benefits", "recruiting",
    "採用", "人事評価", "給与", "福利厚生", "入社",
  ],
  engineering: [
    "deploy", "bug", "api", "pull request", "architecture", "sprint", "codebase", "connector", "cad", "fusion",
    "設計", "実装", "バグ", "デプロイ",
  ],
  sales: [
    "pipeline", "quote", "proposal", "lead", "deal", "contract renewal", "crm", "prospect",
    "見積", "商談", "契約更新", "案件",
  ],
  legal: [
    "contract", "nda", "compliance", "liability", "terms of service", "regulation", "clause",
    "契約書", "規約", "コンプライアンス", "法令",
  ],
  operations: [
    "logistics", "shipment", "inventory", "vendor", "procurement", "facilities", "supply chain",
    "物流", "在庫", "調達", "発注",
  ],
};

// A department's own English name appearing literally in the text (e.g. a
// channel or folder actually named "...-sales...") is a much stronger
// signal than an incidental topic keyword — score it heavily enough that it
// reliably wins over a single generic keyword hit elsewhere (see: a
// "customer-support" channel must not out-score an actual "sales" channel
// just because "customer" happens to be a sales-adjacent word).
const NAME_MATCH_WEIGHT = 5;

/** Classifies free text into one department using keyword-hit scoring. Ties
 *  and no-match both fall back to "general" rather than guessing. */
export function categorizeText(text: string): Department {
  const lower = text.toLowerCase();
  const scores = {} as Record<Exclude<Department, "general">, number>;
  let bestScore = 0;
  for (const dept of Object.keys(KEYWORDS) as Exclude<Department, "general">[]) {
    let score = lower.includes(dept) ? NAME_MATCH_WEIGHT : 0;
    for (const kw of KEYWORDS[dept]) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    scores[dept] = score;
    if (score > bestScore) bestScore = score;
  }
  if (bestScore === 0) return "general";
  const leaders = (Object.keys(scores) as Exclude<Department, "general">[]).filter((d) => scores[d] === bestScore);
  return leaders.length === 1 ? leaders[0] : "general";
}
