import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedVerdicts, canApprove, latestDecision, newReview, overallRisk, receiptLine,
  recordDecision, setCheck, type CheckKey, type ReviewItem,
} from "../lib/review/model.ts";

const NOW = "2026-08-31T00:00:00.000Z";

function base(over: Partial<Parameters<typeof newReview>[0]> = {}): ReviewItem {
  return newReview({
    title: "Onocom ヒアリング後の御礼メール下書き",
    intent: "ヒアリングの御礼と次アクションの確認",
    audience: "オノコム 齋藤様（社外メール）",
    body: "本日はありがとうございました。次回は…[discord/hearing/thread-onocom-1542758419616890930]",
    submittedBy: "Grace",
    sources: ["discord/hearing/thread-onocom-1542758419616890930"],
    now: NOW,
    ...over,
  });
}

function allOk(item: ReviewItem): ReviewItem {
  return (["intent", "merit", "harm", "evidence", "policy"] as CheckKey[])
    .reduce((acc, k) => setCheck(acc, k, { status: "ok", note: "" }), item);
}

test("newReview starts in submitted with all checks unchecked", () => {
  const r = base();
  assert.equal(r.state, "submitted");
  assert.deepEqual(r.decisions, []);
  assert.equal(latestDecision(r), null);
  assert.ok(r.id.startsWith("rev_"));
  assert.deepEqual(Object.values(r.checks).map((c) => c.status), ["unchecked", "unchecked", "unchecked", "unchecked", "unchecked"]);
});

test("setCheck is immutable and moves submitted -> in_review", () => {
  const r = base();
  const r2 = setCheck(r, "intent", { status: "ok", note: "purpose + audience clear" });
  assert.equal(r.checks.intent.status, "unchecked");   // original untouched
  assert.equal(r2.checks.intent.status, "ok");
  assert.equal(r2.state, "in_review");
});

test("overallRisk: blocker -> high, two concerns -> medium, clean -> low", () => {
  let r = allOk(base());
  assert.equal(overallRisk(r), "low");
  r = setCheck(r, "harm", { status: "concern", note: "mentions an internal name" });
  assert.equal(overallRisk(r), "medium");
  r = setCheck(r, "policy", { status: "concern", note: "outbound email — confirm allowed" });
  assert.equal(overallRisk(r), "medium");
  r = setCheck(r, "evidence", { status: "blocker", note: "a claim is not in any source" });
  assert.equal(overallRisk(r), "high");
});

test("overallRisk: unchecked harm/evidence is at least medium", () => {
  const r = setCheck(base(), "intent", { status: "ok", note: "" });
  assert.equal(overallRisk(r), "medium");
});

test("canApprove requires all checks, no blockers, evidence ok, and sources", () => {
  assert.equal(canApprove(base()).ok, false);                    // nothing checked

  const noSources = allOk(base({ sources: [] }));
  assert.equal(canApprove(noSources).ok, false);
  assert.match(canApprove(noSources).reasons.join(" "), /no grounding sources/);

  const evidenceConcern = setCheck(allOk(base()), "evidence", { status: "concern", note: "partly" });
  assert.equal(canApprove(evidenceConcern).ok, false);
  assert.match(canApprove(evidenceConcern).reasons.join(" "), /evidence is not confirmed ok/);

  assert.equal(canApprove(allOk(base())).ok, true);
});

test("allowedVerdicts excludes approved until canApprove, and nothing after a terminal verdict", () => {
  assert.deepEqual(allowedVerdicts(base()).sort(), ["escalated", "rejected", "revise"]);
  assert.ok(allowedVerdicts(allOk(base())).includes("approved"));

  const rejected = recordDecision(allOk(base()), "rejected", "Yan", "audience wrong", NOW);
  assert.deepEqual(allowedVerdicts(rejected), []);
});

test("recordDecision refuses a disallowed verdict and is immutable", () => {
  const r = base(); // not approvable
  assert.throws(() => recordDecision(r, "approved", "Yan", "", NOW), /not allowed/);
  const approved = recordDecision(allOk(base()), "approved", "Ai Ling", "ok to send", NOW);
  assert.equal(approved.state, "approved");
  assert.equal(latestDecision(approved)?.by, "Ai Ling");
  assert.equal(base().state, "submitted"); // original class untouched
});

test("recordDecision appends to the decision history rather than overwriting it", () => {
  const escalated = recordDecision(base(), "escalated", "Grace", "need a second opinion", NOW);
  assert.equal(escalated.decisions.length, 1);
  const later = "2026-09-01T00:00:00.000Z";
  const revised = recordDecision(escalated, "revise", "Yan", "audience needs updating", later);
  // both decisions survive — the first is not lost when the second is recorded
  assert.equal(revised.decisions.length, 2);
  assert.equal(revised.decisions[0].by, "Grace");
  assert.equal(revised.decisions[0].verdict, "escalated");
  assert.equal(revised.decisions[1].by, "Yan");
  assert.equal(latestDecision(revised)?.by, "Yan");
});

test("receiptLine summarises checks, risk, decision and sources", () => {
  const approved = recordDecision(allOk(base()), "approved", "Ai Ling", "send as-is", NOW);
  const line = receiptLine(approved);
  assert.match(line, /承認 by Ai Ling on 2026-08-31/);
  assert.match(line, /risk:low/);
  assert.match(line, /intent:ok merit:ok harm:ok evidence:ok policy:ok/);
  assert.match(line, /sources:1/);
  assert.match(line, /send as-is/);

  assert.match(receiptLine(base()), /pending \(submitted\)/);
});
