export type WorkerSchedule =
  | `daily@${string}`
  | `weekly@${string}`
  | `everyNhours:${number}`;

export type WorkerLastStatus = "queued" | "refused" | "failure" | null;

export type Worker<TSkill = string> = {
  id: string;
  name: string;
  skill: TSkill;
  scope: string;
  schedule: WorkerSchedule;
  /** Human-facing draft destination. Workers never send to this target. */
  deliverTo: string;
  lastRunAt: string | null;
  lastStatus: WorkerLastStatus;
};

export type WorkerRunState = {
  lastRunAt: string | null;
  lastStatus: WorkerLastStatus;
};

export type WorkersState = Record<string, WorkerRunState | undefined>;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type ParsedSchedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "interval"; hours: number };

function parseSchedule(value: string): ParsedSchedule {
  const daily = value.match(/^daily@([01]\d|2[0-3]):([0-5]\d)$/);
  if (daily) return { kind: "daily", hour: Number(daily[1]), minute: Number(daily[2]) };

  const weekly = value.match(/^weekly@(sun|mon|tue|wed|thu|fri|sat)([01]\d|2[0-3]):([0-5]\d)$/i);
  if (weekly) {
    return {
      kind: "weekly",
      weekday: WEEKDAYS.indexOf(weekly[1].toLowerCase() as typeof WEEKDAYS[number]),
      hour: Number(weekly[2]),
      minute: Number(weekly[3]),
    };
  }

  const interval = value.match(/^everyNhours:(\d+(?:\.\d+)?)$/);
  if (interval && Number(interval[1]) > 0) return { kind: "interval", hours: Number(interval[1]) };
  throw new Error(`Invalid worker schedule: ${value}`);
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function scheduledAfter(schedule: ParsedSchedule, after: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(after.getTime() + schedule.hours * 60 * 60 * 1_000);
  }

  if (schedule.kind === "daily") {
    const next = new Date(Date.UTC(
      after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), schedule.hour, schedule.minute,
    ));
    if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  const daysAhead = (schedule.weekday - after.getUTCDay() + 7) % 7;
  const next = new Date(Date.UTC(
    after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate() + daysAhead,
    schedule.hour, schedule.minute,
  ));
  if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

function effectiveWorker(worker: Worker, state: Readonly<WorkersState>): Worker {
  const runState = state[worker.id];
  return runState
    ? { ...worker, lastRunAt: runState.lastRunAt, lastStatus: runState.lastStatus }
    : worker;
}

/** Return due workers in deterministic id order. A worker with no run state is due immediately. */
export function dueWorkers(
  workers: readonly Worker[],
  state: Readonly<WorkersState>,
  now: Date,
): Worker[] {
  return [...workers].sort((left, right) => left.id.localeCompare(right.id)).filter((candidate) => {
    const worker = effectiveWorker(candidate, state);
    const lastRun = validDate(worker.lastRunAt);
    if (!lastRun) return true;
    return scheduledAfter(parseSchedule(worker.schedule), lastRun).getTime() <= now.getTime();
  });
}

/** Return the next UTC schedule boundary as ISO-8601. First interval runs are due now. */
export function nextRun(worker: Worker, now: Date): string {
  const schedule = parseSchedule(worker.schedule);
  const lastRun = validDate(worker.lastRunAt);
  if (lastRun) return scheduledAfter(schedule, lastRun).toISOString();
  if (schedule.kind === "interval") return now.toISOString();

  // One millisecond earlier makes a boundary exactly at `now` count as next.
  return scheduledAfter(schedule, new Date(now.getTime() - 1)).toISOString();
}
