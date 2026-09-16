import assert from "node:assert/strict";
import test from "node:test";
import { formatSyncLogLines, hashContent, parseChangedPaths, type SyncLogEntry } from "../lib/govern/sync-log.ts";

test("hashContent is deterministic and content-sensitive", () => {
  assert.equal(hashContent("hello"), hashContent("hello"));
  assert.notEqual(hashContent("hello"), hashContent("hello!"));
  assert.match(hashContent("hello"), /^[a-f0-9]{64}$/);
});

test("formatSyncLogLines writes one JSON object per line, newline-terminated", () => {
  const entries: SyncLogEntry[] = [
    { source: "notion", path: "shared/notion/a.md", hash: "abc", syncedBy: "operator", syncedAt: "2026-09-15T00:00:00.000Z" },
    { source: "notion", path: "shared/notion/b.md", hash: "def", syncedBy: "operator", syncedAt: "2026-09-15T00:00:00.000Z" },
  ];
  const out = formatSyncLogLines(entries);
  const lines = out.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), entries[0]);
  assert.deepEqual(JSON.parse(lines[1]), entries[1]);
  assert.ok(out.endsWith("\n"));
});

test("formatSyncLogLines returns an empty string for no entries", () => {
  assert.equal(formatSyncLogLines([]), "");
});

test("parseChangedPaths extracts added/modified paths, skips deletions", () => {
  const porcelain = [
    "?? shared/notion/new-page.md",
    " M shared/notion/edited-page.md",
    " D shared/notion/removed-page.md",
    "D  shared/notion/also-removed.md",
    "",
  ].join("\n");
  assert.deepEqual(parseChangedPaths(porcelain), ["shared/notion/new-page.md", "shared/notion/edited-page.md"]);
});

test("parseChangedPaths returns an empty list for no changes", () => {
  assert.deepEqual(parseChangedPaths(""), []);
  assert.deepEqual(parseChangedPaths("\n\n"), []);
});
