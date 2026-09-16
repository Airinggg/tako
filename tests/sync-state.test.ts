import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSyncState, saveSyncState } from "../lib/sync/state.ts";

test("missing and corrupt state are treated as a first run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tako-sync-state-"));
  const path = join(directory, "state.json");
  try {
    assert.deepEqual(await loadSyncState(path), {});
    await writeFile(path, "not json\n");
    assert.deepEqual(await loadSyncState(path), {});
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("state is saved atomically and can be loaded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tako-sync-state-"));
  const path = join(directory, "nested/state.json");
  const state = {
    notion: {
      lastRunAt: "2026-08-30T00:00:00.000Z",
      lastStatus: "failure" as const,
      consecutiveFailures: 2,
    },
  };
  try {
    await saveSyncState(state, path);
    assert.deepEqual(await loadSyncState(path), state);
    assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
  } finally {
    await rm(directory, { recursive: true });
  }
});
