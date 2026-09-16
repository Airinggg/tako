import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPeople, canonicalPerson } from "../lib/connectors/shared/people.ts";

test("canonicalPerson maps aliases, is case-insensitive, passes unknowns through", async () => {
  const dir = await mkdtemp(join(tmpdir(), "people-"));
  const cfg = join(dir, "people.json");
  await writeFile(cfg, JSON.stringify({
    aliases: {
      "Ada Example": ["ada", "U01ABCDEF", "ada@acme.com"],
      "Bea Example": ["bea"],
    },
  }));
  const people = await loadPeople(cfg);
  assert.equal(people.configured, true);

  assert.equal(canonicalPerson("ada", people), "Ada Example");
  assert.equal(canonicalPerson("U01ABCDEF", people), "Ada Example");
  assert.equal(canonicalPerson("ADA@ACME.COM", people), "Ada Example"); // case-insensitive
  assert.equal(canonicalPerson("Ada Example", people), "Ada Example");   // canonical maps to itself
  assert.equal(canonicalPerson("  bea  ", people), "Bea Example");       // trimmed
  assert.equal(canonicalPerson("carol", people), "carol");              // unknown -> unchanged
  assert.equal(canonicalPerson("", people), "");
});

test("loadPeople reports not-configured when the file is absent", async () => {
  const people = await loadPeople(join(tmpdir(), "does-not-exist-people.json"));
  assert.equal(people.configured, false);
  assert.equal(canonicalPerson("ada", people), "ada"); // no-op without config
});
