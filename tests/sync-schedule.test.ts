import assert from "node:assert/strict";
import test from "node:test";
import { dueConnectors, type ConnectorRunState } from "../lib/sync/schedule.ts";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const state = (ageMs: number, overrides: Partial<ConnectorRunState> = {}): ConnectorRunState => ({
  lastRunAt: new Date(NOW - ageMs).toISOString(),
  lastStatus: "success",
  consecutiveFailures: 0,
  ...overrides,
});

test("returns nothing when every connector is inside its interval", () => {
  assert.deepEqual(dueConnectors({ notion: state(999), slack: state(500) }, 1_000, NOW), []);
});

test("returns only connectors whose interval elapsed", () => {
  assert.deepEqual(dueConnectors({ notion: state(1_000), slack: state(999) }, 1_000, NOW), ["notion"]);
});

test("failure backoff grows exponentially", () => {
  const failed = { notion: state(3_999, { lastStatus: "failure", consecutiveFailures: 2 }) };
  assert.deepEqual(dueConnectors(failed, 1_000, NOW), []);
  assert.deepEqual(dueConnectors({ notion: state(4_000, { lastStatus: "failure", consecutiveFailures: 2 }) }, 1_000, NOW), ["notion"]);
});

test("failure backoff respects its cap", () => {
  const intervals = { defaultIntervalMs: 1_000, maxBackoffMs: 5_000 };
  assert.deepEqual(dueConnectors({ notion: state(4_999, { lastStatus: "failure", consecutiveFailures: 20 }) }, intervals, NOW), []);
  assert.deepEqual(dueConnectors({ notion: state(5_000, { lastStatus: "failure", consecutiveFailures: 20 }) }, intervals, NOW), ["notion"]);
});

test("connectors with no state are due on the first run", () => {
  assert.deepEqual(dueConnectors({}, { defaultIntervalMs: 1_000, connectors: ["slack", "notion"] }, NOW), ["notion", "slack"]);
});

test("per-connector intervals override the default", () => {
  const intervals = { defaultIntervalMs: 1_000, connectorIntervalsMs: { slack: 5_000 } };
  assert.deepEqual(dueConnectors({ notion: state(1_000), slack: state(1_000) }, intervals, NOW), ["notion"]);
});
