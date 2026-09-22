import assert from "node:assert/strict";
import test from "node:test";
import { categorizeText, DEPARTMENTS } from "../lib/govern/categorize.ts";

test("classifies a clear finance document", () => {
  assert.equal(categorizeText("Q3 budget forecast and invoice reconciliation"), "finance");
});

test("classifies a clear HR document", () => {
  assert.equal(categorizeText("New hire onboarding checklist and benefits enrollment"), "hr");
});

test("classifies a clear engineering document", () => {
  assert.equal(categorizeText("Pull request: fix deploy pipeline bug in the connector"), "engineering");
});

test("classifies a clear sales document", () => {
  assert.equal(categorizeText("Sales pipeline review — new leads and contract renewal"), "sales");
});

test("classifies Japanese keywords the same as their English equivalents", () => {
  assert.equal(categorizeText("採用面接のフィードバックと入社手続き"), "hr");
  assert.equal(categorizeText("今期の予算と経費精算について"), "finance");
});

test("falls back to general when nothing matches", () => {
  assert.equal(categorizeText("The weather was nice during the team lunch"), "general");
});

test("breaks a tie toward general rather than guessing", () => {
  // Exactly one finance keyword and one hr keyword — no clear winner.
  assert.equal(categorizeText("budget for the new hire's laptop"), "general");
});

test("DEPARTMENTS lists general last, as the safe fallback", () => {
  assert.equal(DEPARTMENTS[DEPARTMENTS.length - 1], "general");
});

test("a slug literally naming the department wins even with sparse body text", () => {
  // Regression: a channel/path named after its department (e.g. Slack's
  // "tako-demo-sales") must classify correctly even when the keyword list
  // doesn't happen to match anything else in a short slug.
  assert.equal(categorizeText("slack tako demo sales 1790030961 782899"), "sales");
  assert.equal(categorizeText("slack tako demo finance 1790031431 430699"), "finance");
});

test("a customer-support channel does not get misclassified as sales", () => {
  // Regression: "customer" alone used to be a sales keyword, which wrongly
  // tagged a customer-support channel as Sales.
  assert.equal(categorizeText("slack tako demo customer support 1790031688 168119"), "general");
});
