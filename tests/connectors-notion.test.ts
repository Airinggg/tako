import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectNotion } from "../lib/connectors/notion/collect.ts";
import { renderNotion } from "../lib/connectors/notion/render.ts";
import { pruneStale } from "../lib/connectors/shared/prune.ts";

const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../lib/connectors/notion/__fixtures__/${name}`, import.meta.url), "utf8"));

test("collects database rows and pages into retrieval records", async () => {
  const db = await fixture("notion-db-query.json"); const page = await fixture("notion-page.json"); const blocks = await fixture("notion-block-children.json");
  const request = async (path: string) => path === "/databases/team-wiki/query" ? db : path === "/pages/page-456" ? page : blocks;
  const records = await collectNotion(request, { databases: ["team-wiki"], pages: ["page-456"] });
  assert.equal(records.length, 2);
  // records[0] is the standalone page (id "page-456" sorts before "row-123"); a page has no column values.
  assert.deepEqual(records[0], { id: "page-456", workspace: "default", kind: "page", title: "Team notes", url: "https://www.notion.so/page-456", author: "Bea Example", createdTime: "2026-08-21T09:00:00.000Z", lastEditedTime: "2026-08-23T10:30:00.000Z", text: "## Decision\n\nShip the beta on Friday.\n\n- [ ] Notify testers\n\n```ts\ndeploy();\n```" });
});

test("pulls database column values, skipping empty ones", async () => {
  const db = await fixture("notion-db-query.json"); const blocks = await fixture("notion-block-children.json");
  const request = async (path: string) => path === "/databases/team-wiki/query" ? db : blocks;
  const [row] = await collectNotion(request, { databases: ["team-wiki"], pages: [] });
  assert.deepEqual(row.properties, {
    Status: "In progress",
    Owner: "Ada Example",
    Due: "2026-09-01",
    Priority: "High",
    Tags: "launch, q3",
    Blocked: "no",
    Notes: "waiting on legal sign-off",
  });
  assert.ok(!("Empty" in (row.properties ?? {})), "empty rich_text column is dropped");
  assert.ok(!("Name" in (row.properties ?? {})), "the title column is not repeated as a property");
});

test("renders stable Markdown frontmatter and flattened text", () => {
  const output = renderNotion({ id: "row-123", workspace: "team-wiki", kind: "db_row", title: "Launch checklist", url: "https://www.notion.so/row-123", author: "Ada Example", createdTime: "2026-08-20T09:00:00.000Z", lastEditedTime: "2026-08-22T10:30:00.000Z", text: "# Ready\n\n- [ ] Notify testers" });
  assert.equal(output.path, "notion/team-wiki/launch-checklist-row-123.md");
  assert.match(output.markdown, /^---\nid: "row-123"\nsource: notion\ntitle: "Launch checklist"/);
  assert.match(output.markdown, /created: "2026-08-20T09:00:00.000Z"/);
  assert.match(output.markdown, /# Ready\n\n- \[ \] Notify testers\n$/);
});

test("renders a Properties section when the record has column values", () => {
  const output = renderNotion({ id: "row-9", workspace: "wiki", kind: "db_row", title: "Task", url: "u", createdTime: "c", lastEditedTime: "e", text: "", properties: { Status: "In progress", Owner: "Ada Example" } });
  assert.match(output.markdown, /---\n\n## Properties\n\n- \*\*Status:\*\* In progress\n- \*\*Owner:\*\* Ada Example\n$/);
});

test("pruneStale deletes notion markdown that is no longer in the pull", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notion-prune-"));
  await mkdir(join(dir, "notion", "wiki"), { recursive: true });
  await mkdir(join(dir, "notion", "gone"), { recursive: true });
  const keep = join(dir, "notion", "wiki", "keep-1.md");
  await writeFile(keep, "keep");
  await writeFile(join(dir, "notion", "wiki", "stale-2.md"), "stale");
  await writeFile(join(dir, "notion", "gone", "stale-3.md"), "stale");
  await writeFile(join(dir, ".notion-cursor.json"), "{}"); // must survive

  const removed = await pruneStale(dir, "notion", [keep]);

  assert.deepEqual(removed.sort(), ["notion/gone/stale-3.md", "notion/wiki/stale-2.md"]);
  assert.deepEqual(await readdir(join(dir, "notion", "wiki")), ["keep-1.md"]);
  assert.ok((await readdir(dir)).includes(".notion-cursor.json"), "cursor file is untouched");
});
