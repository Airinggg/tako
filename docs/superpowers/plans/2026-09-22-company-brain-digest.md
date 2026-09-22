# Company-Brain Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Digest screen that proactively surfaces what changed and what
contradicts an earlier statement, and lets a topic's history be browsed as
institutional memory — without adding a new approval gate or a new model
provider.

**Architecture:** A new `lib/digest/` module maintains a small JSON ledger
(one entry per extracted claim, grouped into topics by an exact kebab-case
key). After each connector sync, an incremental pass reads only pages newer
than a per-source watermark, extracts claims from them with one local-model
call per page, and — for any topic that already has history — makes one more
model call comparing the new claim against the topic's immediately-preceding
entry. A new "Digest" screen in `scripts/demo.ts` renders the ledger.

**Tech Stack:** Bun/TypeScript, the existing `gb()` CLI wrapper and
`synthesizeAnswer`/`extractPageDate` from `lib/eval/qa.ts` (so this also
respects the Gemini demo-mode toggle), `writePrivateFileAtomic` for the
ledger file, `node:test` + `bun:test` per existing convention.

**Spec:** `docs/superpowers/specs/2026-09-22-company-brain-digest-design.md`

## Global Constraints

- Local-only by default: model calls go through `synthesizeAnswer` (never a
  raw `fetch` to a hosted API directly) so the existing Ollama/Gemini
  provider dispatch and its opt-in-only guarantee (`usesHostedProvider()`)
  keep working unchanged.
- No approval-queue gating. Digest entries are internal browsing aids,
  labeled "AI-detected — verify against sources" (same disclaimer text
  style Ask already uses), never routed through `lib/review/model.ts`.
- No fuzzy/semantic topic matching. Topic identity is an exact string match
  on the model-assigned `topicKey`. Do not add embeddings-based clustering.
- Per-run cost must stay bounded: only pages newer than the watermark are
  processed (never the whole corpus), and contradiction-checking a topic
  costs exactly one model call per new entry (compared only against the
  immediately preceding entry, never the whole topic history).
- The ledger file (`config/digest-ledger.json`) is local, git-ignored state
  — same precedent as `config/tasks.json` and `config/reviews.json`.
- Sync must never block on this: the trigger call is fire-and-forget
  (logged on failure, never awaited by the HTTP response or the sync
  daemon's own success/failure state).

---

### Task 1: Ledger data model and pure watermark/merge logic

**Files:**
- Create: `lib/digest/ledger.ts`
- Test: `tests/digest-ledger.test.ts`

**Interfaces:**
- Produces: `LedgerEntry`, `Topic`, `DigestLedger` types; `loadLedger(path?: string): DigestLedger`; `saveLedger(ledger: DigestLedger, path?: string): void`; `isPageNew(ledger: DigestLedger, source: string, pageDate: string): boolean`; `advanceWatermark(ledger: DigestLedger, source: string, pageDate: string): void`; `upsertEntry(ledger: DigestLedger, topicKey: string, topicLabel: string, entry: LedgerEntry): Topic` (creates the topic if it doesn't exist, appends the entry, returns the topic); `addContradiction(topic: Topic, laterEntryId: string, earlierEntryId: string, explanation: string): void`.
- Consumes: `writePrivateFileAtomic` from `../util/private-file.ts` (already exists — signature `(path: string, content: string): void`).

This task has no dependency on any other task in this plan — it's pure data
structure and file I/O, testable without a model call or a `gb()` call.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/digest-ledger.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLedger, saveLedger, isPageNew, advanceWatermark, upsertEntry, addContradiction,
  type DigestLedger,
} from "../lib/digest/ledger.ts";

function tmpLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "digest-ledger-"));
  return join(dir, "digest-ledger.json");
}

test("loadLedger returns an empty ledger when the file doesn't exist yet", () => {
  const ledger = loadLedger(tmpLedgerPath());
  assert.deepEqual(ledger, { lastProcessedAt: {}, topics: [] });
});

test("saveLedger then loadLedger round-trips exactly", () => {
  const path = tmpLedgerPath();
  const ledger: DigestLedger = {
    lastProcessedAt: { engineering: "2026-09-20" },
    topics: [{ key: "pricing", label: "Pricing", entries: [], contradictions: [] }],
  };
  saveLedger(ledger, path);
  assert.deepEqual(loadLedger(path), ledger);
  rmSync(join(path, ".."), { recursive: true, force: true });
});

test("isPageNew compares against the source's watermark, not other sources'", () => {
  const ledger: DigestLedger = { lastProcessedAt: { engineering: "2026-09-15" }, topics: [] };
  assert.equal(isPageNew(ledger, "engineering", "2026-09-16"), true);
  assert.equal(isPageNew(ledger, "engineering", "2026-09-15"), false);
  assert.equal(isPageNew(ledger, "engineering", "2026-09-10"), false);
  assert.equal(isPageNew(ledger, "shared", "2026-09-01"), true, "a source with no watermark yet treats every page as new");
});

test("advanceWatermark only moves forward, never backward", () => {
  const ledger: DigestLedger = { lastProcessedAt: { engineering: "2026-09-15" }, topics: [] };
  advanceWatermark(ledger, "engineering", "2026-09-10");
  assert.equal(ledger.lastProcessedAt.engineering, "2026-09-15", "an older page date must not roll the watermark back");
  advanceWatermark(ledger, "engineering", "2026-09-20");
  assert.equal(ledger.lastProcessedAt.engineering, "2026-09-20");
});

test("upsertEntry creates a new topic on first use, then appends to it", () => {
  const ledger: DigestLedger = { lastProcessedAt: {}, topics: [] };
  const t1 = upsertEntry(ledger, "pricing", "Pricing", { id: "e1", claim: "10万円/月", source: "shared/deck", extractedAt: "2026-09-20T00:00:00Z", contentDate: "2026-09-20" });
  assert.equal(ledger.topics.length, 1);
  assert.equal(t1.entries.length, 1);
  const t2 = upsertEntry(ledger, "pricing", "Pricing", { id: "e2", claim: "15万円/月", source: "shared/deck2", extractedAt: "2026-09-21T00:00:00Z", contentDate: "2026-09-21" });
  assert.equal(ledger.topics.length, 1, "same key must not create a second topic");
  assert.equal(t2.entries.length, 2);
  assert.equal(t2.entries[0].id, "e1", "entries stay in insertion (chronological) order");
});

test("addContradiction appends a flagged pair to the topic", () => {
  const ledger: DigestLedger = { lastProcessedAt: {}, topics: [] };
  const topic = upsertEntry(ledger, "pricing", "Pricing", { id: "e1", claim: "10万円", source: "s1", extractedAt: "t1", contentDate: "2026-09-20" });
  addContradiction(topic, "e2", "e1", "price changed from 10万円 to 15万円");
  assert.equal(topic.contradictions.length, 1);
  assert.equal(topic.contradictions[0].laterEntryId, "e2");
  assert.equal(topic.contradictions[0].earlierEntryId, "e1");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/digest-ledger.test.ts`
Expected: FAIL — `Cannot find module '../lib/digest/ledger.ts'`

- [ ] **Step 3: Implement the ledger module**

```typescript
// lib/digest/ledger.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writePrivateFileAtomic } from "../util/private-file.ts";

export type LedgerEntry = {
  id: string;
  claim: string;
  source: string;
  extractedAt: string;
  contentDate: string;
};

export type Contradiction = {
  laterEntryId: string;
  earlierEntryId: string;
  explanation: string;
  detectedAt: string;
};

export type Topic = {
  key: string;
  label: string;
  entries: LedgerEntry[];
  contradictions: Contradiction[];
};

export type DigestLedger = {
  lastProcessedAt: Record<string, string>;
  topics: Topic[];
};

const DEFAULT_PATH = "config/digest-ledger.json";

export function loadLedger(path: string = DEFAULT_PATH): DigestLedger {
  if (!existsSync(path)) return { lastProcessedAt: {}, topics: [] };
  return JSON.parse(readFileSync(path, "utf8")) as DigestLedger;
}

export function saveLedger(ledger: DigestLedger, path: string = DEFAULT_PATH): void {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomic(path, JSON.stringify(ledger, null, 2));
}

/** A page counts as new when the source has no watermark yet, or the page's
 *  date sorts strictly after it. String comparison works across the two
 *  date granularities extractPageDate can return (bare YYYY-MM-DD or a full
 *  ISO timestamp) because a bare date always sorts before any timestamp
 *  that extends it. */
export function isPageNew(ledger: DigestLedger, source: string, pageDate: string): boolean {
  const watermark = ledger.lastProcessedAt[source];
  if (!watermark) return true;
  return pageDate > watermark;
}

export function advanceWatermark(ledger: DigestLedger, source: string, pageDate: string): void {
  const current = ledger.lastProcessedAt[source];
  if (!current || pageDate > current) ledger.lastProcessedAt[source] = pageDate;
}

export function upsertEntry(ledger: DigestLedger, topicKey: string, topicLabel: string, entry: LedgerEntry): Topic {
  let topic = ledger.topics.find((t) => t.key === topicKey);
  if (!topic) {
    topic = { key: topicKey, label: topicLabel, entries: [], contradictions: [] };
    ledger.topics.push(topic);
  }
  topic.entries.push(entry);
  return topic;
}

export function addContradiction(topic: Topic, laterEntryId: string, earlierEntryId: string, explanation: string): void {
  topic.contradictions.push({ laterEntryId, earlierEntryId, explanation, detectedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/digest-ledger.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/digest/ledger.ts tests/digest-ledger.test.ts
git commit -m "Add the digest ledger data model (watermarks, topics, contradictions)"
```

---

### Task 2: Extraction and contradiction-detection pipeline

**Files:**
- Create: `lib/digest/run.ts`
- Test: `tests/digest-run.test.ts`

**Interfaces:**
- Consumes: `loadLedger`, `saveLedger`, `isPageNew`, `advanceWatermark`, `upsertEntry`, `addContradiction` from `./ledger.ts` (Task 1); `gb(args: string[], home?: string): string` and `extractPageDate(slug: string, rawContentWithFrontmatter: string): string` from `../eval/qa.ts` (both already exist).
- Produces: `type LocalModel = (prompt: string) => Promise<string>` (mirrors `lib/skills/extract.ts`'s injected-model pattern so tests never make a real network/Ollama call); `extractClaims(text: string, model: LocalModel): Promise<{ claim: string; topicKey: string; topicLabel: string }[]>`; `checkContradiction(priorClaim: string, newClaim: string, model: LocalModel): Promise<{ contradicts: boolean; explanation: string }>`; `runDigestPass(opts: { sources: string[]; home?: string; ledgerPath?: string; model?: LocalModel }): Promise<{ processed: number; newEntries: number; newContradictions: number }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/digest-run.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractClaims, checkContradiction } from "../lib/digest/run.ts";

test("extractClaims parses a clean JSON array from the model", async () => {
  const model = async () => JSON.stringify([
    { claim: "Meeting with 堀さん moved to 20:00", topicKey: "meeting-hori-san", topicLabel: "Meeting with 堀さん" },
  ]);
  const claims = await extractClaims("some page text", model);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].topicKey, "meeting-hori-san");
});

test("extractClaims tolerates prose wrapped around the JSON array", async () => {
  const model = async () => "Here you go:\n```json\n[{\"claim\":\"c\",\"topicKey\":\"k\",\"topicLabel\":\"L\"}]\n```\nDone.";
  const claims = await extractClaims("text", model);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].claim, "c");
});

test("extractClaims returns an empty array when the model finds nothing", async () => {
  const model = async () => "[]";
  assert.deepEqual(await extractClaims("just chit-chat", model), []);
});

test("extractClaims drops malformed items instead of throwing", async () => {
  const model = async () => JSON.stringify([{ claim: "ok", topicKey: "k", topicLabel: "L" }, { claim: "" }, "not-an-object"]);
  const claims = await extractClaims("text", model);
  assert.equal(claims.length, 1);
});

test("extractClaims returns an empty array for unparseable model output", async () => {
  const model = async () => "I cannot help with that.";
  assert.deepEqual(await extractClaims("text", model), []);
});

test("checkContradiction parses a true/false JSON verdict", async () => {
  const model = async () => JSON.stringify({ contradicts: true, explanation: "time changed from 14:00 to 20:00" });
  const result = await checkContradiction("meeting at 14:00", "meeting at 20:00", model);
  assert.equal(result.contradicts, true);
  assert.match(result.explanation, /20:00/);
});

test("checkContradiction defaults to false on malformed model output", async () => {
  const model = async () => "unparseable garbage";
  const result = await checkContradiction("a", "b", model);
  assert.equal(result.contradicts, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/digest-run.test.ts`
Expected: FAIL — `Cannot find module '../lib/digest/run.ts'`

- [ ] **Step 3: Implement extraction and contradiction-check parsing**

```typescript
// lib/digest/run.ts (part 1 — add runDigestPass in Step 3 of this task, below)
import { gb, extractPageDate, synthesizeAnswer } from "../eval/qa.ts";
import {
  loadLedger, saveLedger, isPageNew, advanceWatermark, upsertEntry, addContradiction,
  type DigestLedger,
} from "./ledger.ts";

/** Signature of a local/hosted chat call, injected so tests never hit a real
 *  model — mirrors lib/skills/extract.ts's LocalModel pattern. */
export type LocalModel = (prompt: string) => Promise<string>;

type RawClaim = { claim: string; topicKey: string; topicLabel: string };

function coerceArray(raw: string): unknown[] {
  const tryParse = (a: number, b: number): unknown => {
    if (a === -1 || b === -1 || b < a) return undefined;
    try { return JSON.parse(raw.slice(a, b + 1)); } catch { return undefined; }
  };
  const arr = tryParse(raw.indexOf("["), raw.lastIndexOf("]"));
  return Array.isArray(arr) ? arr : [];
}

function toClaim(item: unknown): RawClaim | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const claim = String(o.claim ?? "").trim();
  const topicKey = String(o.topicKey ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const topicLabel = String(o.topicLabel ?? "").trim();
  if (!claim || !topicKey || !topicLabel) return null;
  return { claim, topicKey, topicLabel };
}

const EXTRACT_SYSTEM = `List the concrete claims or decisions in this text as a JSON array.
A claim is a specific fact, decision, date, time, price, or assignment — not general chat.
Each item: {"claim": "one sentence", "topicKey": "short-kebab-case-id", "topicLabel": "Human-facing title"}.
If there are none, return []. No prose, no markdown fences — just the JSON array.`;

export async function extractClaims(text: string, model: LocalModel): Promise<RawClaim[]> {
  const raw = await model(`${EXTRACT_SYSTEM}\n\n=== TEXT ===\n${text}`);
  return coerceArray(raw).map(toClaim).filter((c): c is RawClaim => c !== null);
}

const CONTRADICTION_SYSTEM = `Claim A is earlier, claim B is later. Does B contradict or change A
(e.g. a different time, price, decision, or assignment for the same thing)? Reply with ONLY a
JSON object: {"contradicts": true or false, "explanation": "one sentence"}.`;

export async function checkContradiction(priorClaim: string, newClaim: string, model: LocalModel): Promise<{ contradicts: boolean; explanation: string }> {
  const raw = await model(`${CONTRADICTION_SYSTEM}\n\nClaim A (earlier): ${priorClaim}\nClaim B (later): ${newClaim}`);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { contradicts: false, explanation: "" };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return { contradicts: parsed?.contradicts === true, explanation: String(parsed?.explanation ?? "") };
  } catch {
    return { contradicts: false, explanation: "" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/digest-run.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Write the failing test for `runDigestPass`**

```typescript
// append to tests/digest-run.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadLedger } from "../lib/digest/ledger.ts";
import { runDigestPass } from "../lib/digest/run.ts";

function setupFakeGbrainHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "digest-home-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("runDigestPass is a no-op with zero cost when there are no sources configured", async () => {
  const ledgerPath = join(mkdtempSync(join(tmpdir(), "digest-ledger-")), "digest-ledger.json");
  let modelCalls = 0;
  const model: import("../lib/digest/run.ts").LocalModel = async () => { modelCalls++; return "[]"; };
  const result = await runDigestPass({ sources: [], ledgerPath, model });
  assert.deepEqual(result, { processed: 0, newEntries: 0, newContradictions: 0 });
  assert.equal(modelCalls, 0);
});
```

Full end-to-end coverage of `runDigestPass` against a real `gb()`-backed
gbrain source is exercised as part of Task 3's manual verification (a real
`gbrain sources add` + `sync` is required to produce pages `gb(["list"...])`
can see — not worth faking a whole gbrain store in a unit test). This unit
test only locks down the zero-sources edge case so the function's shape is
tested without that dependency.

- [ ] **Step 6: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/digest-run.test.ts`
Expected: FAIL — `runDigestPass is not a function`

- [ ] **Step 7: Implement `runDigestPass`**

```typescript
// append to lib/digest/run.ts
function slugDate(slug: string, raw: string): string {
  return extractPageDate(slug, raw);
}

async function defaultModel(prompt: string): Promise<string> {
  return synthesizeAnswer(prompt, {});
}

/** Runs one incremental digest pass over the given sources: extracts claims
 *  from every page newer than that source's watermark, merges them into the
 *  ledger's topics, and checks each updated topic's newest entry against its
 *  immediately-preceding one for a contradiction. Never processes a page
 *  twice — the watermark only advances past pages actually handled, so a
 *  failed extraction on one page is retried on the next pass rather than
 *  silently skipped forever. */
export async function runDigestPass(opts: {
  sources: string[];
  home?: string;
  ledgerPath?: string;
  model?: LocalModel;
}): Promise<{ processed: number; newEntries: number; newContradictions: number }> {
  const model = opts.model ?? defaultModel;
  const ledger: DigestLedger = loadLedger(opts.ledgerPath);
  let processed = 0, newEntries = 0, newContradictions = 0;
  const touchedTopicKeys = new Set<string>();

  for (const source of opts.sources) {
    let listing: string;
    try {
      listing = gb(["list", "--source", source], opts.home);
    } catch {
      continue; // source not registered yet, or empty — nothing to process
    }
    const slugs = listing.split("\n").map((l) => l.split("\t")[0]?.trim()).filter((s): s is string => !!s?.includes("/"));

    for (const slug of slugs) {
      let raw: string;
      try {
        raw = gb(["get", slug, "--source", source], opts.home);
      } catch {
        continue; // this one page failed to read — retry next pass
      }
      const pageDate = slugDate(slug, raw);
      if (!pageDate || !isPageNew(ledger, source, pageDate)) continue;

      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      let claims: Awaited<ReturnType<typeof extractClaims>>;
      try {
        claims = await extractClaims(body, model);
      } catch {
        continue; // extraction failed — do not advance the watermark past this page
      }

      for (const c of claims) {
        const topic = upsertEntry(ledger, c.topicKey, c.topicLabel, {
          id: `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          claim: c.claim,
          source: slug,
          extractedAt: new Date().toISOString(),
          contentDate: pageDate,
        });
        newEntries++;
        touchedTopicKeys.add(topic.key);
      }
      advanceWatermark(ledger, source, pageDate);
      processed++;
    }
  }

  for (const key of touchedTopicKeys) {
    const topic = ledger.topics.find((t) => t.key === key);
    if (!topic || topic.entries.length < 2) continue;
    const [prior, latest] = topic.entries.slice(-2);
    let verdict: { contradicts: boolean; explanation: string };
    try {
      verdict = await checkContradiction(prior.claim, latest.claim, model);
    } catch {
      verdict = { contradicts: false, explanation: "" };
    }
    if (verdict.contradicts) {
      addContradiction(topic, latest.id, prior.id, verdict.explanation);
      newContradictions++;
    }
  }

  saveLedger(ledger, opts.ledgerPath);
  return { processed, newEntries, newContradictions };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/digest-run.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 9: Commit**

```bash
git add lib/digest/run.ts tests/digest-run.test.ts
git commit -m "Add the digest extraction and contradiction-detection pipeline"
```

---

### Task 3: Wire the trigger into sync completion

**Files:**
- Modify: `scripts/demo.ts:756` (inside `syncConnector`, right after `connectorsCached.clear();`)
- Modify: `scripts/sync-daemon.ts:135` (inside `processConnector`, right after the `gbrain_embed succeeded` log line)
- Test: `tests/digest-trigger.test.ts`

**Interfaces:**
- Consumes: `runDigestPass` from `../lib/digest/run.ts` (Task 2).
- Produces: nothing new — this task only wires an existing function in as a fire-and-forget call at two call sites.

- [ ] **Step 1: Write the failing test**

This is an integration point, not new logic — the test asserts the two call
sites actually reference `runDigestPass` by reading the source, since
fire-and-forget calls have no return value to assert against in a unit test
and a full sync integration test already exists at a different layer
(`tests/connectors-all.test.ts`).

```typescript
// tests/digest-trigger.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

test("syncConnector triggers a digest pass after a successful sync", () => {
  const src = readFileSync(join(REPO, "scripts/demo.ts"), "utf8");
  const fnBody = src.slice(src.indexOf("async function syncConnector"), src.indexOf("async function syncConnector") + 2000);
  assert.match(fnBody, /runDigestPass\(/);
});

test("sync-daemon triggers a digest pass after a successful embed", () => {
  const src = readFileSync(join(REPO, "scripts/sync-daemon.ts"), "utf8");
  assert.match(src, /runDigestPass\(/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/digest-trigger.test.ts`
Expected: FAIL — both assertions fail (no match found)

- [ ] **Step 3: Wire the trigger into `scripts/demo.ts`**

Add the import near the top of `scripts/demo.ts`, alongside the existing
`lib/eval/qa.ts` import:

```typescript
import { runDigestPass } from "../lib/digest/run.ts";
```

Then in `syncConnector`, replace:

```typescript
  connectorsCached.clear();
  return { ok: true, detail: "最新の内容を取り込みました / synced the latest content" };
}
```

with:

```typescript
  connectorsCached.clear();
  // Fire-and-forget: a slow or failed digest pass must never delay or fail
  // the sync response itself.
  runDigestPass({ sources: [subdir], home: gbrainHome() }).catch((err) => {
    console.warn(`digest pass failed for source "${subdir}": ${(err as Error).message}`);
  });
  return { ok: true, detail: "最新の内容を取り込みました / synced the latest content" };
}
```

- [ ] **Step 4: Wire the trigger into `scripts/sync-daemon.ts`**

Add the import near the top:

```typescript
import { runDigestPass } from "../lib/digest/run.ts";
```

Then replace:

```typescript
    phase = "embed";
    log("gbrain_embed", "started", { connector, source: config.subdir });
    await runChild(["bun", BRAIN_CLI, "embed", "--all"], BRAIN_PACKAGE, brainEnv());
    log("gbrain_embed", "succeeded", { connector, source: config.subdir });

    state[connector] = { lastRunAt: new Date().toISOString(), lastStatus: "success", consecutiveFailures: 0 };
```

with:

```typescript
    phase = "embed";
    log("gbrain_embed", "started", { connector, source: config.subdir });
    await runChild(["bun", BRAIN_CLI, "embed", "--all"], BRAIN_PACKAGE, brainEnv());
    log("gbrain_embed", "succeeded", { connector, source: config.subdir });

    runDigestPass({ sources: [config.subdir] }).catch((error) => {
      log("digest", "failed", { connector, source: config.subdir, error: (error as Error).message });
    });

    state[connector] = { lastRunAt: new Date().toISOString(), lastStatus: "success", consecutiveFailures: 0 };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/digest-trigger.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Run the full existing suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, same count as before plus this task's 2 new tests

- [ ] **Step 7: Commit**

```bash
git add scripts/demo.ts scripts/sync-daemon.ts tests/digest-trigger.test.ts
git commit -m "Trigger a digest pass after every connector sync, fire-and-forget"
```

---

### Task 4: Digest screen — API route and sidebar entry

**Files:**
- Modify: `scripts/demo.ts` (NAV_GROUPS, a new `/api/digest` route, a new `<section data-name="digest">`, `goto()`)
- Test: `tests/tako-ui.test.ts` (append; follow the file's existing assertion style — it string-matches against `renderPage()`'s output, see e.g. the existing `"Settings and Help never leave the main area blank"` test)

**Interfaces:**
- Consumes: `loadLedger` from `../lib/digest/ledger.ts` (Task 1).
- Produces: `GET /api/digest` returning `{ topics: Topic[] }` (the full ledger's topics, newest-entry-first per topic — sorting is the server's job so the client never has to reimplement it).

- [ ] **Step 1: Write the failing UI test**

```typescript
// append to tests/tako-ui.test.ts, following the file's existing pattern
test("Digest is listed under Automate and never leaves the main area blank", () => {
  const html = renderPage();
  assert.match(html, /data-name="digest"/);
  assert.match(html, /<h1>Digest<\/h1>/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/tako-ui.test.ts`
Expected: FAIL — no `data-name="digest"` in the rendered page

- [ ] **Step 3: Add the sidebar entry**

In `scripts/demo.ts`, change:

```typescript
  { group: "Automate", items: [
    { id: "automations", label: "Automations" },
    { id: "connect", label: "Connected Apps" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
  ]},
```

to:

```typescript
  { group: "Automate", items: [
    { id: "automations", label: "Automations" },
    { id: "connect", label: "Connected Apps" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
    { id: "digest", label: "Digest" },
  ]},
```

- [ ] **Step 4: Add the screen markup**

Add this new `<section>` immediately after the `data-name="activity"` section
(find it by searching for `data-name="activity"` in `scripts/demo.ts`):

```html
<section class="section" data-name="digest">
  <header class="tako-screen-head">
    <h1>Digest</h1>
    <p class="tako-supporting">What changed, and what contradicts an earlier statement — across every connected source.</p>
  </header>
  <div id="digest-list"><div class="tako-skeleton tako-skeleton-row" aria-hidden="true"></div></div>
</section>
```

- [ ] **Step 5: Add the API route**

Add this import near the top of `scripts/demo.ts`:

```typescript
import { loadLedger } from "../lib/digest/ledger.ts";
```

Add this route inside the `Bun.serve` handler, next to `/api/activity`:

```typescript
        if (url.pathname === "/api/digest") {
          const ledger = loadLedger();
          const topics = ledger.topics.map((t) => ({
            ...t,
            entries: [...t.entries].sort((a, b) => b.contentDate.localeCompare(a.contentDate)),
          }));
          return json({ topics });
        }
```

- [ ] **Step 6: Wire `goto()` and the client-side render**

In `goto()`, add:

```typescript
  if(name==='digest')loadDigest();
```

Add a new client function near `loadActivity` (find it by searching for
`function loadActivity` in the `<script>` block):

```javascript
let digestLoaded=false;
async function loadDigest(force){
  if(digestLoaded&&!force)return;digestLoaded=true;
  try{
    const d=await api('/api/digest');
    const topics=(d.topics||[]);
    if(!topics.length){$('#digest-list').innerHTML='<div class="tako-empty"><p>No digest entries yet</p><p class="tako-supporting">Entries appear here after your first connector sync.</p></div>';return;}
    $('#digest-list').innerHTML=topics.map(t=>{
      const latest=t.entries[0];
      const contras=(t.contradictions||[]).map(c=>{
        const later=t.entries.find(e=>e.id===c.laterEntryId);
        const earlier=t.entries.find(e=>e.id===c.earlierEntryId);
        return '<div class="note-err">⚠ '+esc(c.explanation)+'<br><span class="hint">'+esc(earlier?.claim||'')+' → '+esc(later?.claim||'')+'</span></div>';
      }).join('');
      return '<div class="tako-summary" style="margin-bottom:12px">'
        +'<div class="cx-summary-row"><b>'+esc(t.label)+'</b><span class="hint">'+esc(latest?latest.contentDate:'')+'</span></div>'
        +'<div class="cx-summary-row"><span>'+esc(latest?latest.claim:'')+'</span><span class="hint">'+esc(latest?latest.source:'')+'</span></div>'
        +contras
        +'<p class="hint">AI-detected — verify against sources ・ '+t.entries.length+' entr'+(t.entries.length===1?'y':'ies')+' in this topic</p>'
        +'</div>';
    }).join('');
  }catch(e){$('#digest-list').innerHTML='<div class="note-err">'+esc(e.message)+'</div>';}
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/tako-ui.test.ts`
Expected: PASS

Run: `npm test`
Expected: PASS, full suite green

- [ ] **Step 8: Manual verification**

Start the demo server (`bun scripts/demo.ts`), click "Digest" in the
sidebar, confirm the empty state renders. Register a small test gbrain
source with one page containing an obvious claim (e.g. "Price is 10万円"),
sync it, run `runDigestPass` against it directly via a one-off script or by
triggering a real "Sync now" from the Connected Apps screen, reload Digest,
and confirm the claim appears. This is the point where the feature is
actually exercised against a real local (or Gemini, if demo mode is on)
model call — everything before this step only ever ran against injected
fake models in tests.

- [ ] **Step 9: Commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add the Digest screen: API route, sidebar entry, and topic rendering"
```

---

## Self-Review Notes

- **Spec coverage:** §2 (ledger data model) → Task 1. §3 (extraction) and §4
  (contradiction detection) → Task 2. §5 (trigger) → Task 3. §6 (Digest
  screen, including the "AI-detected — verify against sources" label and
  topic-timeline drill-down) → Task 4. §7 (error handling: skip-and-retry on
  extraction failure, default-false on malformed contradiction JSON, atomic
  ledger writes) is implemented inline across Tasks 1–2, not a separate
  task. §9 (testing strategy: pure watermark logic tested without a model,
  JSON-parsing tested against fixed sample outputs including malformed
  ones) is satisfied by Tasks 1 and 2's test suites.
- **Deferred per spec §8** (not tasks in this plan, by design): fuzzy topic
  matching, cross-referencing back into Ask's retrieval, and any
  dismiss/archive UI for stale contradictions.
- **Type consistency:** `LedgerEntry`, `Topic`, `DigestLedger` are defined
  once in Task 1 and imported (never redefined) by Tasks 2 and 4.
  `LocalModel` is defined once in Task 2 and used consistently in its own
  tests and `runDigestPass`'s signature.
