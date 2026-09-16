/**
 * Working-memory model — decide which ongoing-task items a company brain should
 * keep hot, keep as a one-line rollup, or forget.
 *
 * The knowledge sources grow forever; this layer keeps the *task* view legible
 * by actively deciding what has stopped mattering. Pure — no I/O. gbrain's
 * `salience`, `recency` and `forget --rollup` are the mechanism this feeds.
 */

export type TaskState = "open" | "in_progress" | "blocked" | "done" | "dropped";
export const TASK_STATES: TaskState[] = ["open", "in_progress", "blocked", "done", "dropped"];

export type Task = {
  id: string;
  title: string;
  owner: string | null;
  state: TaskState;
  source: string;        // page slug it was mined from
  firstSeen: string;     // ISO date
  lastTouched: string;   // ISO date
  mentions: number;      // times referenced across the corpus
  hasDeadline: boolean;
  quote?: string;        // short evidence quote
};

export type DecayPolicy = {
  warmAfterDays: number;   // active but idle this long -> warm
  coldAfterDays: number;   // idle this long -> cold (rollup candidate)
  closedGraceDays: number; // done/dropped older than this -> cold
  noiseMinTitleChars: number;
};

export const DEFAULT_POLICY: DecayPolicy = {
  warmAfterDays: 7,
  coldAfterDays: 21,
  closedGraceDays: 10,
  noiseMinTitleChars: 8,
};

export type Bucket = "hot" | "warm" | "cold" | "noise";

const DAY = 86_400_000;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Whole days between an ISO date and `now` (>= 0; a future date reads as 0). */
export function ageDays(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / DAY));
}

const NOISE_TITLE = /^(ok(ay)?|lol+|thx|thanks|ty|nice|cool|\+1|done|👍|🎉|got it|noted|sure|yes|no|yep|nope)[!.\s]*$/i;

/** A title that carries no task content — chatter, acks, emoji-only. */
export function isNoise(task: Pick<Task, "title">, policy = DEFAULT_POLICY): boolean {
  const t = task.title.trim();
  if (NOISE_TITLE.test(t)) return true;
  if (!/[A-Za-z぀-ヿ一-鿿]/.test(t)) return true; // no letters/kana/kanji at all
  // Weighted length: a CJK character carries more meaning than a latin one, so a
  // terse Japanese title ("資料をまとめる") is not noise while "fix it" is.
  const cjk = (t.match(/[぀-ヿ一-鿿]/g) ?? []).length;
  const other = t.replace(/\s+/g, "").length - cjk;
  if (other + 2 * cjk < policy.noiseMinTitleChars) return true;
  return false;
}

const STATE_WEIGHT: Record<TaskState, number> = {
  blocked: 1, in_progress: 0.9, open: 0.7, done: 0.2, dropped: 0.1,
};

/** 0–100. Higher = more worth keeping hot. recency × frequency × owner × deadline, scaled by state. */
export function priorityScore(task: Task, now: number, policy = DEFAULT_POLICY): number {
  const idle = ageDays(task.lastTouched, now);
  const recency = clamp01(1 - idle / Math.max(1, policy.coldAfterDays));
  const freq = Math.min(task.mentions, 5) / 5;
  const owner = task.owner ? 1 : 0;
  const deadline = task.hasDeadline ? 1 : 0;
  const raw = 0.4 * recency + 0.25 * freq + 0.2 * owner + 0.15 * deadline;
  return Math.round(100 * STATE_WEIGHT[task.state] * raw);
}

/** Which bucket a task falls in, and a one-line human reason. */
export function classify(task: Task, now: number, policy = DEFAULT_POLICY): { bucket: Bucket; reason: string } {
  if (isNoise(task, policy)) return { bucket: "noise", reason: "no task content — chatter or acknowledgement" };

  const idle = ageDays(task.lastTouched, now);
  const closed = task.state === "done" || task.state === "dropped";

  if (closed) {
    return idle > policy.closedGraceDays
      ? { bucket: "cold", reason: `${task.state} ${idle}d ago — roll up` }
      : { bucket: "warm", reason: `recently ${task.state} (${idle}d ago)` };
  }

  if (idle > policy.coldAfterDays) {
    return { bucket: "cold", reason: `no activity ${idle}d${task.owner ? "" : ", no owner"} — roll up` };
  }

  const active = task.state === "blocked" || task.state === "in_progress";
  if (task.hasDeadline || (task.owner && idle <= policy.warmAfterDays && (active || task.state === "open"))) {
    return {
      bucket: "hot",
      reason: task.hasDeadline ? "has a deadline" : `${task.owner} · touched ${idle}d ago`,
    };
  }

  if (!task.owner) return { bucket: "warm", reason: `no owner · idle ${idle}d` };
  return { bucket: "warm", reason: `idle ${idle}d (> ${policy.warmAfterDays}d)` };
}

export type Classified = Task & { bucket: Bucket; reason: string; score: number };

/** Classify + score a list, sorted by bucket (hot→noise) then score desc. */
export function triage(tasks: Task[], now: number, policy = DEFAULT_POLICY): Classified[] {
  const order: Record<Bucket, number> = { hot: 0, warm: 1, cold: 2, noise: 3 };
  return tasks
    .map((t) => {
      const { bucket, reason } = classify(t, now, policy);
      return { ...t, bucket, reason, score: priorityScore(t, now, policy) };
    })
    .sort((a, b) => order[a.bucket] - order[b.bucket] || b.score - a.score || a.title.localeCompare(b.title));
}

/** A single summary line standing in for a batch of cold tasks (the `forget --rollup` payload). */
export function rollupLine(tasks: Task[], now: number): string {
  if (!tasks.length) return "";
  const dates = tasks.map((t) => t.lastTouched).sort();
  const span = dates[0] === dates[dates.length - 1] ? dates[0].slice(0, 10) : `${dates[0].slice(0, 10)}–${dates[dates.length - 1].slice(0, 10)}`;
  const titles = tasks.map((t) => t.title.trim()).filter(Boolean).slice(0, 8).join("; ");
  const more = tasks.length > 8 ? ` (+${tasks.length - 8} more)` : "";
  return `${tasks.length} stale task(s) rolled up on ${new Date(now).toISOString().slice(0, 10)} [${span}]: ${titles}${more}`;
}
