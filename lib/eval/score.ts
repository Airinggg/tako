export type ProjectState = {
  owner: string;
  stage: string;
  overdue: string[];
  dropped: string[];
  decided_not_executed: string[];
};

export type GroundedItem = { citations: string[] };
export type EvaluationResult = {
  gold: ProjectState;
  predicted: ProjectState;
  surfaced: GroundedItem[];
  latency_ms: number;
};

export type PrecisionRecall = { precision: number; recall: number };
export type EvalMetrics = {
  owner_accuracy: number;
  stage_accuracy: number;
  overdue_precision: number;
  overdue_recall: number;
  dropped_recall: number;
  decided_not_executed_recall: number;
  grounding: number;
  latency_p50: number;
  latency_p95: number;
};

export function norm(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function bigrams(value: string): string[] {
  const chars = Array.from(norm(value));
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

export function diceCoefficient(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const pair of b) remaining.set(pair, (remaining.get(pair) ?? 0) + 1);
  let intersection = 0;
  for (const pair of a) {
    const count = remaining.get(pair) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

export function fuzzyItemMatch(left: string, right: string): boolean {
  return norm(left) === norm(right) || diceCoefficient(left, right) >= 0.8;
}

export function ownerAccuracy(predicted: readonly string[], gold: readonly string[]): number {
  if (predicted.length !== gold.length) throw new Error("owner arrays must have equal length");
  if (gold.length === 0) return 1;
  return predicted.filter((value, index) => norm(value) === norm(gold[index])).length / gold.length;
}

export function stageAccuracy(predicted: readonly string[], gold: readonly string[]): number {
  if (predicted.length !== gold.length) throw new Error("stage arrays must have equal length");
  if (gold.length === 0) return 1;
  return predicted.filter((value, index) => value === gold[index]).length / gold.length;
}

export function setPrecisionRecall(predicted: readonly string[], gold: readonly string[]): PrecisionRecall {
  const unmatched = new Set(gold.map((_, index) => index));
  let matches = 0;
  for (const item of predicted) {
    const match = [...unmatched].find((index) => fuzzyItemMatch(item, gold[index]));
    if (match !== undefined) {
      matches += 1;
      unmatched.delete(match);
    }
  }
  return {
    precision: predicted.length === 0 ? 1 : matches / predicted.length,
    recall: gold.length === 0 ? 1 : matches / gold.length,
  };
}

function citationSlug(citation: string): string {
  return norm(citation.replace(/^\s*\[/, "").replace(/\]\s*$/, "").replace(/\.md$/i, ""));
}

export function grounding(items: readonly GroundedItem[], knownSlugs: readonly string[]): number {
  if (items.length === 0) return 1;
  const known = new Set(knownSlugs.map(citationSlug));
  const grounded = items.filter((item) => item.citations.length > 0 && item.citations.every((citation) => known.has(citationSlug(citation)))).length;
  return grounded / items.length;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

export function scoreMetrics(results: readonly EvaluationResult[], knownSlugs: readonly string[]): EvalMetrics {
  const predictedOwners = results.map((result) => result.predicted.owner);
  const goldOwners = results.map((result) => result.gold.owner);
  const predictedStages = results.map((result) => result.predicted.stage);
  const goldStages = results.map((result) => result.gold.stage);
  const overdue = setPrecisionRecall(results.flatMap((result) => result.predicted.overdue), results.flatMap((result) => result.gold.overdue));
  const dropped = setPrecisionRecall(results.flatMap((result) => result.predicted.dropped), results.flatMap((result) => result.gold.dropped));
  const decisions = setPrecisionRecall(results.flatMap((result) => result.predicted.decided_not_executed), results.flatMap((result) => result.gold.decided_not_executed));
  return {
    owner_accuracy: ownerAccuracy(predictedOwners, goldOwners),
    stage_accuracy: stageAccuracy(predictedStages, goldStages),
    overdue_precision: overdue.precision,
    overdue_recall: overdue.recall,
    dropped_recall: dropped.recall,
    decided_not_executed_recall: decisions.recall,
    grounding: grounding(results.flatMap((result) => result.surfaced), knownSlugs),
    latency_p50: percentile(results.map((result) => result.latency_ms), 0.5),
    latency_p95: percentile(results.map((result) => result.latency_ms), 0.95),
  };
}
