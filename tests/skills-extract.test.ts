import assert from "node:assert/strict";
import test from "node:test";
import { mineSkills } from "../lib/skills/extract.ts";
import { renderDraft } from "../lib/skills/render-draft.ts";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const corpus = [
  { path: "slack/eng/1.md", text: "when a spec question comes up we check the notion page, update it, then post in #eng" },
];

test("mineSkills parses the local model's JSON array and drops non-procedures", async () => {
  const model = async () => JSON.stringify([
    { name: "Spec Lookup", description: "answer a spec question", triggers: ["what's the spec", "current spec"],
      steps: ["check the Notion spec page", "update it if stale", "post the answer in #eng"],
      sources: ["slack", "notion", "bogus"], evidence: ["'we check the notion page, update it'"] },
    { name: "one-off", description: "not a procedure", triggers: [], steps: ["do it once"], sources: [] }, // <2 steps -> dropped
    "garbage",
  ]);
  const drafts = await mineSkills(corpus, model);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].name, "spec-lookup");            // kebab-cased
  assert.deepEqual(drafts[0].sources, ["slack", "notion"]); // "bogus" filtered
  assert.equal(drafts[0].steps.length, 3);
});

test("mineSkills tolerates prose around the JSON and empty results", async () => {
  assert.deepEqual(await mineSkills(corpus, async () => "here you go:\n[]\nthanks"), []);
  assert.deepEqual(await mineSkills(corpus, async () => "no json at all"), []);
  assert.deepEqual(await mineSkills([], async () => "[]"), []);
});

test("mineSkills handles a bare object and object-form steps (real 3b output shape)", async () => {
  const model = async () => JSON.stringify({
    name: "Onboarding New Hires",
    description: "onboard a new hire",
    triggers: [{ trigger: "new hire starts" }],
    steps: [
      { name: "Notion page", description: "create their people/ page in Notion" },
      { name: "Slack", description: "add them to #general and #eng" },
      { name: "Meetings", description: "schedule three intro meetings" },
    ],
    sources: ["notion", "slack"],
    evidence: [{ text: "'Bea creates their people/ page'" }],
  });
  const [d] = await mineSkills(corpus, model);
  assert.equal(d.name, "onboarding-new-hires");
  assert.deepEqual(d.steps, [
    "create their people/ page in Notion",
    "add them to #general and #eng",
    "schedule three intro meetings",
  ]);
  assert.deepEqual(d.triggers, ["new hire starts"]);
  assert.deepEqual(d.evidence, ["'Bea creates their people/ page'"]);
});

test("renderDraft produces a review-gated SKILL.md", () => {
  const { path, markdown } = renderDraft(
    { name: "spec-lookup", description: "answer a spec question", triggers: ["current spec"],
      steps: ["check Notion", "post in #eng"], sources: ["slack", "notion"], evidence: ["quote"] },
    "engineering", "2026-08-29T00:00:00Z",
  );
  assert.equal(path, "engineering/spec-lookup.md");
  assert.match(markdown, /^---\nname: spec-lookup\nversion: 0\.0\.1\nstatus: draft/);
  assert.match(markdown, /extracted_from: engineering/);
  assert.match(markdown, /reads:\n  - slack   #.*\n  - notion   #/);   // declared data access
  assert.match(markdown, /reads_note: "A scope grants this skill only if/);
  assert.match(markdown, /DRAFT — human review required/);
  assert.match(markdown, /1\. check Notion\n2\. post in #eng/);
});

// Fixture helper: creates a temporary skill file in a test-specific brain-sources directory
// and returns the skill slug for lookup
function createSkillFixture(skillName: string, procedureSteps: string[]): string {
  const brainSourcesRoot = join(process.cwd(), "brain-sources");
  const testSourceDir = join(brainSourcesRoot, "test-fixture");
  const skillDir = join(testSourceDir, "skills", skillName);

  mkdirSync(skillDir, { recursive: true });

  const procedureText = procedureSteps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  const skillMarkdown = `---
name: ${skillName}
version: 0.0.1
status: draft
description: Test skill
triggers:
  - test trigger
reads:
  - shared
---

# ${skillName}

## Procedure

${procedureText}
`;

  writeFileSync(join(skillDir, "SKILL.md"), skillMarkdown);
  return skillName;
}

// Cleanup helper
function cleanupSkillFixture(): void {
  const brainSourcesRoot = join(process.cwd(), "brain-sources");
  const testSourceDir = join(brainSourcesRoot, "test-fixture");
  try {
    rmSync(testSourceDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Test implementation of readSkillFiles (without procedureSteps initially - to verify test fails before implementation)
function testReadSkillFiles(): Array<{ name: string; description: string; triggers: string[]; reads: string[]; steps: number }> {
  const root = join(process.cwd(), "brain-sources");
  if (!existsSync(root)) return [];
  const out: Array<{ name: string; description: string; triggers: string[]; reads: string[]; steps: number }> = [];

  for (const src of readdirSync(root, { withFileTypes: true })) {
    if (!src.isDirectory()) continue;
    const skillsDir = join(root, src.name, "skills");
    if (!existsSync(skillsDir)) continue;
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      const file = join(skillsDir, d.name, "SKILL.md");
      if (!d.isDirectory() || !existsSync(file)) continue;
      const md = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const fm = md.startsWith("---\n") ? md.slice(4, md.indexOf("\n---", 4)) : "";
      const val = (k: string) => fm.match(new RegExp(`^${k}:[ ]*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
      const list = (k: string) => {
        const m = fm.match(new RegExp(`^${k}:\\n((?:[ ]+-.*\\n?)+)`, "m"));
        return m ? m[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim()).filter(Boolean) : [];
      };
      const proc = md.match(/##\s*Procedure\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i)?.[1] ?? "";
      const steps = (proc.match(/^\s*\d+\.\s+/gm) ?? []).length;
      out.push({ name: val("name") || d.name, description: val("description"), triggers: list("triggers"), reads: list("reads"), steps });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

test("readSkillFiles exposes verbatim procedure step text, not just a count", () => {
  try {
    const skillName = createSkillFixture("test-skill", ["Summarize the content", "Post to Slack"]);
    const skills = testReadSkillFiles();
    const skill = skills.find((s) => s.name === skillName);
    assert.ok(skill);
    assert.deepEqual(skill!.procedureSteps, ["Summarize the content", "Post to Slack"]);
    assert.equal(skill!.steps, 2); // existing count field must still agree
  } finally {
    cleanupSkillFixture();
  }
});
