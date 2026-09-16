import assert from "node:assert/strict";
import test from "node:test";
import { dueWorkers, nextRun, type Worker, type WorkersState } from "../lib/workers/model.ts";

function worker(id: string, schedule: Worker["schedule"], lastRunAt: string | null = null): Worker {
  return {
    id,
    name: id,
    skill: "weekly-digest",
    scope: "all-hands",
    schedule,
    deliverTo: "#general — DRAFT",
    lastRunAt,
    lastStatus: lastRunAt ? "queued" : null,
  };
}

test("nothing is due before its next boundary", () => {
  const workers = [
    worker("daily", "daily@09:00", "2026-08-31T09:05:00.000Z"),
    worker("interval", "everyNhours:4", "2026-08-31T08:00:00.000Z"),
  ];
  assert.deepEqual(dueWorkers(workers, {}, new Date("2026-08-31T10:00:00.000Z")), []);
});

test("daily and weekly workers become due at their UTC boundaries", () => {
  const workers = [
    worker("weekly", "weekly@mon09:00", "2026-08-24T09:02:00.000Z"),
    worker("daily", "daily@09:00", "2026-08-30T09:02:00.000Z"),
  ];
  assert.deepEqual(
    dueWorkers(workers, {}, new Date("2026-08-31T09:00:00.000Z")).map(({ id }) => id),
    ["daily", "weekly"],
  );
  assert.equal(
    nextRun(worker("daily-next", "daily@09:00", "2026-08-31T09:02:00.000Z"), new Date("2026-08-31T10:00:00.000Z")),
    "2026-09-01T09:00:00.000Z",
  );
  assert.equal(
    nextRun(worker("weekly-next", "weekly@mon09:00", "2026-08-31T09:02:00.000Z"), new Date("2026-08-31T10:00:00.000Z")),
    "2026-09-07T09:00:00.000Z",
  );
});

test("a worker without run state is due on first pass", () => {
  assert.deepEqual(
    dueWorkers([worker("new", "daily@23:59")], {}, new Date("2026-08-31T00:00:00.000Z"))
      .map(({ id }) => id),
    ["new"],
  );
});

test("per-worker interval and state override control the next run", () => {
  const workers = [
    worker("two-hour", "everyNhours:2", "2026-08-31T00:00:00.000Z"),
    worker("six-hour", "everyNhours:6", "2026-08-31T00:00:00.000Z"),
  ];
  const state: WorkersState = {
    "two-hour": { lastRunAt: "2026-08-31T08:00:00.000Z", lastStatus: "queued" },
  };
  const now = new Date("2026-08-31T09:00:00.000Z");
  assert.deepEqual(dueWorkers(workers, state, now).map(({ id }) => id), ["six-hour"]);
  assert.equal(nextRun({ ...workers[0], lastRunAt: state["two-hour"]!.lastRunAt }, now), "2026-08-31T10:00:00.000Z");
  assert.equal(nextRun(worker("first-interval", "everyNhours:3"), now), now.toISOString());
});
