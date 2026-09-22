import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NAV_GROUPS, activityView, renderActivityList, renderPage, readSkillFiles, AB_TRIGGER_OPTIONS } from "../scripts/demo.ts";
import { TAKO_COLORS, TAKO_CSS_TOKENS } from "../scripts/tako/tokens.ts";
import { TRIGGER_NODE_TO_STRING } from "../lib/connectors/automation-canvas/adapter.ts";

// scripts/demo.ts always resolves config/reviews.json against the real repo
// root -- there's no env-var override for this path (unlike, e.g.,
// CONNECTORS_CONFIG_PATH for the connector runners). config/reviews.example.json
// (what a fresh clone actually has) contains no "needs retry" item, so the
// activity test below must seed a real, temporary fixture and always restore
// whatever was there before -- never leave a developer's real local
// config/reviews.json altered, whether the test passes or throws.
const REVIEWS_PATH = join(import.meta.dir, "..", "config", "reviews.json");
function withSeededRetryReview<T>(fn: () => T): T {
  const existed = existsSync(REVIEWS_PATH);
  const original = existed ? readFileSync(REVIEWS_PATH, "utf8") : null;
  const fixture = {
    reviews: [{
      id: "rev_test_retry_fixture",
      title: "Test fixture needing revision",
      intent: "test", audience: "test", body: "test body", sources: ["shared/notes/x"],
      submittedBy: "test", submittedAt: "2026-01-01T00:00:00.000Z",
      state: "revise",
      checks: {
        intent: { status: "ok", note: "" }, merit: { status: "ok", note: "" },
        harm: { status: "ok", note: "" }, evidence: { status: "ok", note: "" }, policy: { status: "ok", note: "" },
      },
      decisions: [{ verdict: "revise", by: "test", at: "2026-01-01T00:00:00.000Z", note: "needs another pass" }],
    }],
  };
  try {
    writeFileSync(REVIEWS_PATH, JSON.stringify(fixture, null, 2));
    return fn();
  } finally {
    if (existed) writeFileSync(REVIEWS_PATH, original!);
    else if (existsSync(REVIEWS_PATH)) unlinkSync(REVIEWS_PATH);
  }
}

test("navigation matches the tako information architecture exactly", () => {
  assert.deepEqual(NAV_GROUPS, [
    { group: "Workspace", items: [
      { id: "home", label: "Home" },
      { id: "ask", label: "Ask Tako" },
    ]},
    { group: "Automate", items: [
      { id: "automations", label: "Automations" },
      { id: "connect", label: "Connected Apps" },
      { id: "tasks", label: "Tasks" },
      { id: "activity", label: "Activity" },
    ]},
    { group: "Govern", items: [
      { id: "approvals", label: "Approvals" },
      { id: "permissions", label: "Team & Permissions" },
    ]},
  ]);
});

test("no screen exposes internal platform jargon", () => {
  const html = renderPage();
  // The whole page (including inline <script> UI-rendering code) is checked,
  // since most of this app's visible copy is built via client-side
  // `innerHTML =` string concatenation inside <script> tags — stripping
  // <script> contents would blind this guardrail to that text entirely.
  // The one narrow, legitimate exception is `mcpUrl`, a JS property/variable
  // name (an API response field, never rendered as literal text) that
  // false-positives the "MCP" check without ever being shown to a user.
  const visibleHtml = html.replace(/\bmcpUrl\b/g, "");
  for (const forbidden of ["iPaaS", "MCP", "frontmatter", "source slug", "rollup"]) {
    assert.doesNotMatch(visibleHtml, new RegExp(forbidden, "i"), `found forbidden term: ${forbidden}`);
  }
});

test("Overview is not a separate nav destination", () => {
  const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!ids.includes("overview"), "Overview must be merged into Home, not its own nav item");
});

test("Home has the specified headline, actions, and four status summaries", () => {
  const html = renderPage();
  assert.match(html, /Work, connected\./);
  assert.match(html, /Create automation/);
  assert.match(html, /Ask Tako/);
  for (const label of ["Active automations", "Connected apps", "Completed today", "Needs approval"]) {
    assert.match(html, new RegExp(label));
  }
});

test("Home is not only a question box", () => {
  const html = renderPage();
  // The spec explicitly forbids the question box being the only feature on
  // Home — assert the app-tile/mascot composition markup is present too.
  assert.match(html, /tako-scene/);
});

test("renderPage returns the full HTML document without starting a server", () => {
  const html = renderPage();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<\/html>/i);
});

test("color tokens match the spec exactly", () => {
  assert.deepEqual(TAKO_COLORS, {
    canvas: "#F3F5F1",
    surface: "#FFFFFF",
    text: "#1E2925",
    textSecondary: "#66716C",
    primary: "#286653",
    selected: "#DCEBE4",
    info: "#527E8A",
    amber: "#D49A55",
    cream: "#F2D5A7",
    error: "#B85D55",
    border: "#DDE2DE",
  });
});

test("token CSS never sets white text directly on the amber background", () => {
  // A crude but effective guard: the amber token and #fff must never appear
  // together inside the same CSS rule body.
  const rules = TAKO_CSS_TOKENS.split("}");
  for (const rule of rules) {
    if (rule.includes(TAKO_COLORS.amber) && /color:\s*#fff/i.test(rule)) {
      assert.fail(`found white text paired with amber in: ${rule}`);
    }
  }
});

import { mascotMark, mascotScene, MASCOT_PLACEMENT } from "../scripts/tako/mascot.ts";

test("mascot placement rules match the spec exactly", () => {
  assert.deepEqual(MASCOT_PLACEMENT, {
    prominent: ["onboarding", "home-empty", "connect-setup", "automation-templates", "success-recovery"],
    sparing: ["ask", "tasks", "activity"],
    never: ["approvals", "permissions"],
  });
});

test("the mascot mark always has exactly eight arms", () => {
  const svg = mascotMark("large");
  const armCount = (svg.match(/class="tako-arm"/g) || []).length;
  assert.equal(armCount, 8, "the mascot must have exactly eight arms per the spec");
});

test("the mascot never renders on a never-list screen", () => {
  // A structural guard for later tasks: this asserts the function itself
  // refuses, so a screen task cannot accidentally call it there.
  assert.throws(() => mascotScene("connecting" as any, "approvals" as any));
});

test("Automations shows trigger/action sentences, not a technical list", () => {
  const html = renderPage();
  assert.match(html, /New automation/);
  assert.match(html, /Run details/);
  assert.doesNotMatch(html, /per-step receipt/i);
});

test("New automation shows templates before a blank builder, with the mascot present", () => {
  const html = renderPage();
  assert.match(html, /id="automation-templates"/);
  assert.match(html, /Start from scratch/);
  const templatesBlock = html.split('id="automation-templates"')[1]?.split("</div>")[0] || "";
  assert.match(templatesBlock, /tako-scene/);
});

test("the connecting-state nodes render inside the svg, not as invalid bare siblings", () => {
  // Regression: nodeSvg()'s <circle> elements must live inside the <svg>
  // element bodySvg() returns — a bare <circle> outside any <svg> context
  // is invalid HTML and silently fails to render in a real browser.
  const html = mascotScene("connecting", "home-empty");
  const svgOpenIndex = html.indexOf("<svg");
  const firstCircleIndex = html.indexOf("<circle");
  assert.ok(svgOpenIndex >= 0, "expected an <svg> element");
  assert.ok(firstCircleIndex > svgOpenIndex, "connecting-state <circle> nodes must appear after the <svg> opening tag, not before it");
  const svgCloseIndex = html.indexOf("</svg>");
  assert.ok(svgCloseIndex > firstCircleIndex, "connecting-state <circle> nodes must appear before the </svg> closing tag");
});

test("Connected Apps does not ask an ordinary user for a token directly on the main grid", () => {
  const html = renderPage();
  const connectSection = html.split('<section class="section" data-name="connect">')[1]?.split("</section>")[0] || "";
  // Token inputs must live behind an explicit "Advanced" disclosure, not be
  // the first thing visible on the card grid.
  assert.match(connectSection, /Advanced/);
});

test("Ask Tako has the specified header copy", () => {
  const html = renderPage();
  const askSection = html.split('<section class="section" data-name="ask">')[1]?.split("</section>")[0] || "";
  assert.match(askSection, /Ask Tako/);
  assert.match(askSection, /Find answers across your connected apps\./);
});

test("Ask Tako hides the model name from the main view", () => {
  const html = renderPage();
  // NB: use the full opening-tag pattern, not a bare `data-name="ask"`
  // substring split — the sidebar nav button also renders `data-name="ask"`
  // (renderSidebarNav() emits it for every nav item) and appears earlier in
  // the document, so splitting on the bare attribute grabs the wrong slice
  // of the page. This exact bug shipped once already on Connected Apps.
  const askSection = html.split('<section class="section" data-name="ask">')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(askSection, /qwen/i, "model name must not appear on the main Ask screen");
});

test("Activity shows outcome-first entries with a retry action on failure", () => {
  // renderPage()'s HTML is a module-level constant baked once at import
  // time (see scripts/demo.ts's `const PAGE = ...`) -- a fixture written
  // after the module has already loaded can never affect it. activityView()
  // itself, unlike the frozen page, reads config/reviews.json fresh on
  // every call (it's what the live /api/activity route also uses), so test
  // the real rendering path directly instead of the static page snapshot.
  withSeededRetryReview(() => {
    const html = renderActivityList(activityView().entries);
    assert.match(html, /Retry/);
  });
});

test("Approvals uses plain-language decision vocabulary, not academic terms", () => {
  const html = renderPage();
  const approvalsSection = html.split('<section class="section" data-name="approvals">')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(html, /INTENT-MERIT REVIEW/i);
  for (const action of ["Approve", "Request changes", "Reject", "Ask administrator"]) {
    assert.match(approvalsSection, new RegExp(action));
  }
  assert.match(approvalsSection, /Protect sensitive information/);
});

test("Approvals never renders the mascot", () => {
  const html = renderPage();
  const approvalsSection = html.split('<section class="section" data-name="approvals">')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(approvalsSection, /tako-scene|tako-mark/);
});

test("Tasks uses plain-language filters and never calls content noise", () => {
  const html = renderPage();
  // NB: use the full opening-tag pattern, not a bare `data-name="tasks"`
  // substring split — the sidebar nav button also renders `data-name="tasks"`
  // and appears earlier in the document, so splitting on the bare attribute
  // grabs the wrong slice of the page. Same bug class as Connected Apps/Ask.
  const tasksSection = html.split('<section class="section" data-name="tasks">')[1]?.split("</section>")[0] || "";
  for (const label of ["Needs attention", "Active", "Ready to archive", "Excluded"]) {
    assert.match(tasksSection, new RegExp(label));
  }
  assert.doesNotMatch(html, /\bnoise\b/i);
  assert.doesNotMatch(html, /\bidle \d+d\b/i);
  assert.doesNotMatch(html, /\brollup\b/i);
});

test("Team & Permissions uses plain-language access vocabulary", () => {
  const html = renderPage();
  // NB: use the full opening-tag pattern, not a bare `data-name="permissions"`
  // substring split — the sidebar nav button also renders `data-name="permissions"`
  // and appears earlier in the document. Same bug class as Connected Apps/Ask/Tasks/Activity.
  const permsSection = html.split('<section class="section" data-name="permissions">')[1]?.split("</section>")[0] || "";
  assert.match(permsSection, /Control what each person can access/);
  assert.doesNotMatch(permsSection, /\bScope\b/);
  assert.doesNotMatch(permsSection, /\bGranted\b/i);
});

test("Team & Permissions never renders the mascot", () => {
  const html = renderPage();
  const permsSection = html.split('<section class="section" data-name="permissions">')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(permsSection, /tako-scene|tako-mark/);
});

test("Automations empty state names what's missing and offers one action", () => {
  const html = renderPage();
  assert.match(html, /No automations yet/);
  assert.match(html, /Connect two apps to create your first automation/);
});

test("a successful automation save shows the success-recovery mascot moment", () => {
  const html = renderPage();
  assert.match(html, /id="automation-success"/);
  const successBlock = html.split('id="automation-success"')[1]?.split("</div>")[0] || "";
  assert.match(successBlock, /tako-scene/);
});

test("the automation builder has a real submit action, not just a template picker", () => {
  const html = renderPage();
  const automationsSection = html.split('<section class="section" data-name="automations">')[1]?.split("</section>")[0] || "";
  assert.match(automationsSection, /data-action="create-automation-submit"/);
});

test("screens with fetched lists render a skeleton placeholder, not raw 'Loading' text alone", () => {
  const html = renderPage();
  // Home's two lists, Automations, Tasks, and Approvals' queue all read from
  // the same server-rendered seed markup before client JS replaces it.
  assert.match(html, /tako-skeleton/);
});

test("motion respects prefers-reduced-motion", () => {
  const html = renderPage();
  assert.match(html, /prefers-reduced-motion/);
});

test("interactive elements have a visible focus style", () => {
  const html = renderPage();
  assert.match(html, /:focus-visible/);
});

test("tako heading tokens are not overridden by legacy CSS", () => {
  const html = renderPage();
  const css = html.split("<style>")[1]?.split("</style>")[0] || "";
  // find the LAST top-level h1{...} rule in the stylesheet and assert
  // it uses the token, not a hardcoded clamp/900-weight value
  const h1Rules = [...css.matchAll(/(?<![.\[#])h1\s*\{[^}]*\}/g)].map(m => m[0]);
  const lastH1Rule = h1Rules[h1Rules.length - 1] || "";
  assert.doesNotMatch(lastH1Rule, /clamp\(38px/);
  assert.doesNotMatch(lastH1Rule, /font-weight:\s*900/);
});

test("focus-visible outline is not overridden by a low-contrast legacy rule", () => {
  const html = renderPage();
  assert.doesNotMatch(html, /rgba\(45,\s*109,\s*246,\s*\.?5\)/);
});

test("Settings and Help never leave the main area blank", () => {
  const html = renderPage();
  for (const name of ["settings", "help"]) {
    const section = html.split(`<section class="section" data-name="${name}">`)[1]?.split("</section>")[0] || "";
    assert.notEqual(section, "", `expected a real section for data-name="${name}"`);
  }
});

test("Connected Apps and Ask show one language per screen, not both", () => {
  const html = renderPage();
  for (const name of ["connect", "ask"]) {
    const section = html.split(`<section class="section" data-name="${name}">`)[1]?.split("</section>")[0] || "";
    // spot-check a few of the specific bilingual patterns that existed before this fix
    assert.doesNotMatch(section, /接続状況|今すぐ同期|接続テスト|接続済み|読み込み中|ソース \/ source/);
  }
});

test("Team & Permissions and Connected Apps use the shared skeleton pattern, not a bare spinner", () => {
  const html = renderPage();
  for (const name of ["permissions", "connect"]) {
    const section = html.split(`<section class="section" data-name="${name}">`)[1]?.split("</section>")[0] || "";
    assert.doesNotMatch(section, /Loading…/);
  }
});

// Fixture helper: creates a temporary skill directory with proper structure
function createSkillFixture(tempRoot: string, skillName: string, procedureSteps: string[]): void {
  const skillDir = join(tempRoot, "test-source", "skills", skillName);
  
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
}

test("readSkillFiles exposes verbatim procedure step text, not just a count", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tako-skill-test-"));
  try {
    const skillName = "test-skill";
    createSkillFixture(tempRoot, skillName, ["Summarize the content", "Post to Slack"]);
    const skills = readSkillFiles(tempRoot);
    const skill = skills.find((s) => s.name === skillName);
    assert.ok(skill);
    assert.deepEqual(skill!.procedureSteps, ["Summarize the content", "Post to Slack"]);
    assert.equal(skill!.steps, 2); // existing count field must still agree
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});


test("every adapter trigger string is one of the builder's real AB_TRIGGER_OPTIONS", () => {
  for (const str of Object.values(TRIGGER_NODE_TO_STRING)) {
    assert.ok(AB_TRIGGER_OPTIONS.includes(str), `"${str}" is not in AB_TRIGGER_OPTIONS`);
  }
  assert.equal(Object.values(TRIGGER_NODE_TO_STRING).length, AB_TRIGGER_OPTIONS.length);
});

test("Team & Permissions member panel offers Issue agent access", () => {
  const html = renderPage();
  assert.match(html, /Issue agent access/);
});
