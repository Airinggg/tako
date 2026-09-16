import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RULES, redact, redactNames, resolveRules, summariseHits, type RedactionRule,
} from "../lib/govern/redact.ts";

test("masks email and phone, leaving a labelled box", () => {
  const r = redact("Reach 齋藤 at saito@onocom.co.jp or 0532-12-3456 today.");
  assert.ok(!r.text.includes("saito@onocom.co.jp"));
  assert.ok(!r.text.includes("0532-12-3456"));
  assert.match(r.text, /\[██ メール ██\]/);
  assert.match(r.text, /\[██ 電話番号 ██\]/);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.hits.map((h) => h.rule).sort(), ["email", "phone-jp"]);
});

test("blocks on an API token and reports blocked", () => {
  const r = redact("token: xoxb-123456789012-abcdefghijklmnop in the config");
  assert.equal(r.blocked, true);
  assert.ok(!r.text.includes("xoxb-123456789012"));
  assert.equal(r.hits[0].action, "block");
});

test("credit-card rule only fires on a Luhn-valid number", () => {
  const valid = redact("card 4111 1111 1111 1111 on file");     // Luhn-valid test number
  assert.equal(valid.blocked, true);
  assert.ok(valid.hits.some((h) => h.rule === "credit-card"));

  const notACard = redact("order 1234 5678 9012 3456 shipped");  // 16 digits, Luhn-invalid
  assert.ok(!notACard.hits.some((h) => h.rule === "credit-card"));
});

test("flag-only rule records a hit without changing the text", () => {
  const rules: RedactionRule[] = [{ name: "internal", label: "社内語 / internal term", action: "flag", pattern: "Hestia" }];
  const r = redact("Team Hestia will present.", rules);
  assert.equal(r.text, "Team Hestia will present.");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].action, "flag");
  assert.equal(r.blocked, false);
});

test("redactNames masks a name list, longest first, and ignores empties", () => {
  const r = redactNames("Ada Lovelace met Ada at noon.", ["Ada", "Ada Lovelace", "  "]);
  assert.equal((r.text.match(/\[██ 個人名 ██\]/g) ?? []).length, 2);
  assert.ok(!r.text.includes("Ada Lovelace"));
});

test("summariseHits counts by rule, most frequent first", () => {
  const r = redact("a@x.com, b@y.com, c@z.com, call 03-1234-5678");
  const s = summariseHits(r.hits);
  assert.equal(s[0].count, 3);
  assert.match(s[0].label, /メール/);
});

test("resolveRules lets an operator rule override a default by name", () => {
  const merged = resolveRules([{ name: "email", label: "E", action: "flag", pattern: "x" }]);
  assert.equal(merged.find((r) => r.name === "email")?.action, "flag");
  assert.equal(merged.length, DEFAULT_RULES.length);
});

test("a malformed custom pattern is skipped, not thrown", () => {
  const r = redact("hello", [{ name: "bad", label: "bad", action: "mask", pattern: "([" }]);
  assert.equal(r.text, "hello");
  assert.equal(r.hits.length, 0);
});
