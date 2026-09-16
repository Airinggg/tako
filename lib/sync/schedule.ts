export type ConnectorRunStatus = "success" | "failure";

export type ConnectorRunState = {
  lastRunAt: string | null;
  lastStatus: ConnectorRunStatus | null;
  consecutiveFailures: number;
};

export type SyncScheduleState = Record<string, ConnectorRunState | undefined>;

export type SyncIntervals = {
  defaultIntervalMs: number;
  connectorIntervalsMs?: Record<string, number>;
  connectors?: readonly string[];
  maxBackoffMs?: number;
};

export const DEFAULT_MAX_BACKOFF_MS = 24 * 60 * 60 * 1_000;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

/** Return due connector ids in deterministic order without mutating state. */
export function dueConnectors(
  state: Readonly<SyncScheduleState>,
  intervals: number | SyncIntervals,
  now: number | Date,
): string[] {
  const options: SyncIntervals = typeof intervals === "number"
    ? { defaultIntervalMs: intervals }
    : intervals;
  const defaultInterval = positive(options.defaultIntervalMs, "defaultIntervalMs");
  const maxBackoff = positive(options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS, "maxBackoffMs");
  const overrides = options.connectorIntervalsMs ?? {};
  const candidates = new Set([
    ...Object.keys(state),
    ...Object.keys(overrides),
    ...(options.connectors ?? []),
  ]);
  const nowMs = now instanceof Date ? now.getTime() : now;

  return [...candidates].sort().filter((connector) => {
    const current = state[connector];
    if (!current?.lastRunAt) return true;
    const lastRunMs = Date.parse(current.lastRunAt);
    if (!Number.isFinite(lastRunMs)) return true;
    const base = positive(overrides[connector] ?? defaultInterval, `${connector} interval`);
    const failures = current.lastStatus === "failure"
      ? Math.max(0, Math.floor(current.consecutiveFailures))
      : 0;
    const delay = Math.min(maxBackoff, base * (2 ** Math.min(failures, 30)));
    return nowMs >= lastRunMs + delay;
  });
}
