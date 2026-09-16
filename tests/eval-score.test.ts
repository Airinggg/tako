import assert from "node:assert/strict";
import test from "node:test";
import { fuzzyItemMatch, grounding, norm, ownerAccuracy, setPrecisionRecall, stageAccuracy } from "../lib/eval/score.ts";

test("norm handles NFKC, whitespace, case, and Japanese text", () => {
  assert.equal(norm("  ＡＣＭＥ　案件  "), "acme 案件");
  assert.equal(norm("  進捗\n確認  "), "進捗 確認");
});

test("item matching accepts normalized exact and high Dice similarity", () => {
  assert.equal(fuzzyItemMatch("Launch Checklist", " launch   checklist "), true);
  assert.equal(fuzzyItemMatch("全ページのワイヤーフレーム", "全ページのワイヤーフレーム作成"), true);
  assert.equal(fuzzyItemMatch("design review", "invoice approval"), false);
});

test("owner and stage accuracy follow their distinct matching rules", () => {
  assert.equal(ownerAccuracy([" 青木 ", "BEA"], ["青木", "bea"]), 1);
  assert.equal(stageAccuracy(["in_progress", "Done"], ["in_progress", "done"]), 0.5);
});

test("set precision and recall handle fuzzy overlap and empty sets", () => {
  assert.deepEqual(setPrecisionRecall(["wireframe review", "unknown task"], ["wireframe reviews"]), { precision: 0.5, recall: 1 });
  assert.deepEqual(setPrecisionRecall([], []), { precision: 1, recall: 1 });
  assert.deepEqual(setPrecisionRecall([], ["missing"]), { precision: 1, recall: 0 });
  assert.deepEqual(setPrecisionRecall(["extra"], []), { precision: 0, recall: 1 });
});

test("grounding rejects a surfaced item with a hallucinated citation", () => {
  const items = [
    { citations: ["[notion/projects/acme]"] },
    { citations: ["[slack/team/123]", "[made-up/source]"] },
    { citations: [] },
  ];
  assert.equal(grounding(items, ["notion/projects/acme", "slack/team/123"]), 1 / 3);
});
