import assert from "node:assert/strict";
import test from "node:test";
import {
  ageDays, classify, DEFAULT_POLICY, isNoise, priorityScore, rollupLine, triage, type Task,
} from "../lib/tasks/model.ts";

const NOW = Date.parse("2026-08-31T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function task(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "Reply to the Onocom scheduling email",
    owner: "owner" in over ? (over.owner ?? null) : "Grace",
    state: over.state ?? "in_progress",
    source: over.source ?? "discord/hearing/thread-onocom",
    firstSeen: over.firstSeen ?? daysAgo(3),
    lastTouched: over.lastTouched ?? daysAgo(2),
    mentions: over.mentions ?? 3,
    hasDeadline: over.hasDeadline ?? false,
    quote: over.quote,
  };
}

test("ageDays is whole days, floored, never negative", () => {
  assert.equal(ageDays(daysAgo(5), NOW), 5);
  assert.equal(ageDays(daysAgo(0), NOW), 0);
  assert.equal(ageDays("2030-01-01T00:00:00Z", NOW), 0); // future
  assert.equal(ageDays("not-a-date", NOW), 0);
});

test("isNoise catches chatter, acks, too-short and letterless titles", () => {
  assert.ok(isNoise({ title: "ok" }));
  assert.ok(isNoise({ title: "thanks!" }));
  assert.ok(isNoise({ title: "👍" }));
  assert.ok(isNoise({ title: "1234567" }));           // < 8 non-space chars
  assert.ok(!isNoise({ title: "Book the meeting room" }));
  assert.ok(!isNoise({ title: "資料をまとめる" }));
});

test("classify: owner + recent + active -> hot", () => {
  const { bucket } = classify(task({ lastTouched: daysAgo(1) }), NOW);
  assert.equal(bucket, "hot");
});

test("classify: a deadline forces hot even when idle-ish", () => {
  const { bucket, reason } = classify(task({ owner: null, lastTouched: daysAgo(6), hasDeadline: true }), NOW);
  assert.equal(bucket, "hot");
  assert.match(reason, /deadline/);
});

test("classify: no owner -> warm", () => {
  const { bucket, reason } = classify(task({ owner: null, lastTouched: daysAgo(2) }), NOW);
  assert.equal(bucket, "warm");
  assert.match(reason, /no owner/);
});

test("classify: idle past coldAfterDays -> cold with rollup reason", () => {
  const { bucket, reason } = classify(task({ lastTouched: daysAgo(30) }), NOW);
  assert.equal(bucket, "cold");
  assert.match(reason, /no activity 30d/);
  assert.match(reason, /roll up/);
});

test("classify: done recently -> warm; done long ago -> cold", () => {
  assert.equal(classify(task({ state: "done", lastTouched: daysAgo(3) }), NOW).bucket, "warm");
  assert.equal(classify(task({ state: "done", lastTouched: daysAgo(20) }), NOW).bucket, "cold");
});

test("classify: chatter title -> noise regardless of freshness", () => {
  assert.equal(classify(task({ title: "lol" , lastTouched: daysAgo(0) }), NOW).bucket, "noise");
});

test("priorityScore: fresh blocked+owner+deadline outranks stale ownerless open", () => {
  const hot = priorityScore(task({ state: "blocked", hasDeadline: true, mentions: 5, lastTouched: daysAgo(1) }), NOW);
  const cold = priorityScore(task({ state: "open", owner: null, hasDeadline: false, mentions: 1, lastTouched: daysAgo(25) }), NOW);
  assert.ok(hot > 60, `hot=${hot}`);
  assert.ok(cold < 20, `cold=${cold}`);
  assert.ok(hot > cold);
});

test("priorityScore: dropped tasks score near zero", () => {
  assert.ok(priorityScore(task({ state: "dropped", lastTouched: daysAgo(1) }), NOW) < 12);
});

test("triage sorts hot -> warm -> cold -> noise, then by score", () => {
  const rows = triage([
    task({ id: "cold1", title: "Migrate the old wiki", lastTouched: daysAgo(40), owner: null }),
    task({ id: "hot1", title: "Confirm the 9/1 ISJ slot", lastTouched: daysAgo(1), hasDeadline: true }),
    task({ id: "noise1", title: "ok" }),
    task({ id: "warm1", title: "Draft the pitch slides", owner: null, lastTouched: daysAgo(3) }),
  ], NOW);
  assert.deepEqual(rows.map((r) => r.bucket), ["hot", "warm", "cold", "noise"]);
  assert.equal(rows[0].id, "hot1");
});

test("rollupLine summarises a batch with a date span and capped titles", () => {
  const batch = [
    task({ title: "A", lastTouched: "2026-07-01T00:00:00Z" }),
    task({ title: "B", lastTouched: "2026-07-20T00:00:00Z" }),
  ];
  const line = rollupLine(batch, NOW);
  assert.match(line, /2 stale task\(s\) rolled up on 2026-08-31/);
  assert.match(line, /\[2026-07-01–2026-07-20\]/);
  assert.match(line, /A; B/);
  assert.equal(rollupLine([], NOW), "");
});
