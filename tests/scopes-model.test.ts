import assert from "node:assert/strict";
import test from "node:test";
import { buildTree, excluded, included, realisationPlan, type Scope } from "../lib/scopes/model.ts";

const tree = buildTree([
  { slug: "notion/eng-wiki/architecture/page-a", source: "shared" },
  { slug: "notion/eng-wiki/runbooks/page-b", source: "shared" },
  { slug: "notion/company-home/page-c", source: "shared" },
  { slug: "slack/general/100", source: "engineering" },
  { slug: "slack/platform/200", source: "engineering" },
  { slug: "drive/roadmap", source: "shared" },
]);

test("buildTree groups connectors and at most two subtree levels deterministically", () => {
  assert.deepEqual(tree.map((node) => [node.name, node.pageCount]), [["drive", 1], ["notion", 3], ["slack", 2]]);
  const notion = tree[1];
  assert.deepEqual(notion.children.map((node) => [node.prefix, node.pageCount]), [["notion/company-home/", 1], ["notion/eng-wiki/", 2]]);
  assert.deepEqual(notion.children[1].children.map((node) => node.prefix), ["notion/eng-wiki/architecture/", "notion/eng-wiki/runbooks/"]);
});

test("included and excluded return counts and warn on partial selection in a shared source", () => {
  const inside = included(tree, ["notion/eng-wiki/"]);
  assert.deepEqual(inside.map((node) => [node.prefix, node.pageCount]), [["notion/eng-wiki/", 2]]);
  const outside = excluded(tree, ["notion/eng-wiki/"]);
  assert.ok(outside.nodes.some((node) => node.prefix === "notion/company-home/" && node.pageCount === 1));
  assert.match(outside.sharedSourceWarning[0], /notion.*shared.*separate source/i);
});

test("realisationPlan notes whole-source reads and plans partial source carving", () => {
  const whole: Scope = { name: "all-shared", purpose: "All shared docs", rules: [], includePrefixes: ["notion/"], createdAt: "2026-08-30T00:00:00Z" };
  const sourceMap = new Map([["notion/", "shared"], ["notion/eng-wiki/", "shared"], ["slack/", "engineering"], ["slack/general/", "engineering"]]);
  const wholePlan = realisationPlan(whole, sourceMap, "/repo");
  assert.ok(wholePlan.some((line) => line.includes("--federated-read shared")));
  assert.ok(!wholePlan.some((line) => line.includes("sources add")));

  const partial: Scope = { ...whole, name: "general-only", includePrefixes: ["slack/general/"] };
  const partialPlan = realisationPlan(partial, sourceMap, "/repo");
  assert.ok(partialPlan.some((line) => line.includes("rsync -a") && line.includes("slack/general")));
  assert.ok(partialPlan.some((line) => line.includes("git -C") && line.includes("commit")));
  assert.ok(partialPlan.some((line) => line.includes("sources add 'general-only'") && line.includes("/repo/brain-sources/general-only")));
  assert.ok(partialPlan.some((line) => line.includes("sync --source 'general-only'")));
  partialPlan.forEach((line, index) => {
    if (!line.startsWith("# ")) assert.ok(index > 0 && partialPlan[index - 1].startsWith("# "), `command lacks an explanatory comment: ${line}`);
  });
});
