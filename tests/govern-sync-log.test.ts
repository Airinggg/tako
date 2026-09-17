import assert from "node:assert/strict";
import test from "node:test";
import { diffGitStatus, formatSyncLogLines, hashContent, parseChangedPaths, parseGitStatus, type SyncLogEntry } from "../lib/govern/sync-log.ts";

test("hashContent is deterministic and content-sensitive", () => {
  assert.equal(hashContent("hello"), hashContent("hello"));
  assert.notEqual(hashContent("hello"), hashContent("hello!"));
  assert.match(hashContent("hello"), /^[a-f0-9]{64}$/);
});

test("formatSyncLogLines writes one JSON object per line, newline-terminated", () => {
  const entries: SyncLogEntry[] = [
    { source: "notion", path: "shared/notion/a.md", action: "synced", hash: "abc", syncedBy: "operator", syncedAt: "2026-09-15T00:00:00.000Z" },
    { source: "notion", path: "shared/notion/b.md", action: "synced", hash: "def", syncedBy: "operator", syncedAt: "2026-09-15T00:00:00.000Z" },
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

test("parseGitStatus separates changed from deleted paths", () => {
  const porcelain = [
    "?? shared/notion/new-page.md",
    " M shared/notion/edited-page.md",
    " D shared/notion/removed-page.md",
    "D  shared/notion/also-removed.md",
    "",
  ].join("\n");
  assert.deepEqual(parseGitStatus(porcelain), {
    changed: ["shared/notion/new-page.md", "shared/notion/edited-page.md"],
    deleted: ["shared/notion/removed-page.md", "shared/notion/also-removed.md"],
  });
});

test("diffGitStatus excludes paths that were already dirty before this run (regression for #11)", () => {
  // Simulates the real bug: notion and drive both default to the "shared"
  // subdir. If drive already left an uncommitted file dirty before notion's
  // sync even starts, a naive (non-diffed) status read after notion's pull
  // would attribute drive's leftover file to notion too.
  const before = { changed: ["shared/drive/leftover.md"], deleted: [] };
  const after = { changed: ["shared/drive/leftover.md", "shared/notion/new-page.md"], deleted: ["shared/notion/old-page.md"] };
  assert.deepEqual(diffGitStatus(before, after), {
    changed: ["shared/notion/new-page.md"],
    deleted: ["shared/notion/old-page.md"],
  });
});

test("diffGitStatus: a deletion already present before this run is not re-attributed either", () => {
  const before = { changed: [], deleted: ["shared/drive/gone-already.md"] };
  const after = { changed: [], deleted: ["shared/drive/gone-already.md", "shared/notion/newly-gone.md"] };
  assert.deepEqual(diffGitStatus(before, after), { changed: [], deleted: ["shared/notion/newly-gone.md"] });
});
