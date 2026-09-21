# Automation Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, visual "Canvas" view to the Automations screen — a
node-and-edge diagram of the real trigger → Approval pipeline, built on the
exact same data `createAutomation()` already persists, with no new backend
model and no claim of execution the app doesn't actually perform.

**Architecture:** A small, hand-written, vendored (no CDN, no framework)
client-side node-canvas renderer draws a fixed set of 9 nodes (5 real
connectors + Schedule + Manual + Discord/Notes/CAD/MCP shown inactive, plus
one Approval node). A pure-function adapter is the only place graph shape
and automation-record shape meet, so the existing List view and the new
Canvas view can never drift apart. Creating an automation on the canvas
calls the exact same `POST /api/automations/create` endpoint the dropdown
builder already uses.

**Tech Stack:** TypeScript (Bun), vanilla client-side JS (no framework, no
build step — matching `scripts/demo.ts`'s existing single-file,
server-rendered-HTML-plus-inline-script convention), `node:test` for
server-side logic, `bun test` for UI/DOM-adjacent string-matching tests.

**Spec:** `docs/superpowers/specs/2026-09-22-automation-canvas-design.md`

## Global Constraints

- No new automation data model — every task reuses the exact
  `trigger`/`action1`/`action2` shape `createAutomation()` already validates
  at `scripts/demo.ts:250-257`, and the exact `AB_TRIGGER_OPTIONS`
  (`scripts/demo.ts:242`) / `AB_ACTION_OPTIONS` (`scripts/demo.ts:243`)
  value sets.
- Graph shape is `[Trigger node] → [Approval node]` only — **no**
  destination-connector node or edge past Approval (spec §1 correction).
  Action strings render as labels inside the Approval node's detail panel,
  never as separate nodes.
- The node-canvas renderer is vendored into the repo, never loaded from a
  CDN (spec §3) — keeps the "nothing leaves this machine" property intact.
- The execution overlay reads real `/api/activity` entries only (spec §5)
  — no simulated/fake animation is permitted anywhere in this feature.
- Canvas is additive: the existing `#automation-list` /
  `#automation-templates` / `#automation-builder` / `#automation-success`
  dropdown-builder flow (`scripts/demo.ts:1973-2008`) is untouched and
  remains the default view.

## Plan-time correction (found while writing this plan, not in the spec)

The spec's adapter sketch (§4) assumed `action1`/`action2` are directly
retrievable per automation. They are not, today: `createAutomation()`
(`scripts/demo.ts:250-289`) persists them only as prose inside
`description: "${a1} and ${a2}."` and as two numbered lines under
`## Procedure` in the `SKILL.md` body — and `readSkillFiles()`
(`scripts/demo.ts:147-171`) currently discards the procedure text, keeping
only a `steps: number` **count** (`scripts/demo.ts:166`:
`const steps = (proc.match(/^\s*\d+\.\s+/gm) ?? []).length;`). Task 1 below
extends `readSkillFiles()`/`SkillView`/`skillsView()` to also expose the
two step strings verbatim, rather than having the adapter fragile-parse
`"${a1} and ${a2}."` back apart (which breaks if either action string ever
contains the word "and" — none do today, but that's a data-format
landmine, not a real invariant). This is additive to existing types, not a
breaking change to anything reading `steps: number` today.

---

### Task 1: Expose procedure step text from `readSkillFiles()`

**Files:**
- Modify: `scripts/demo.ts:138-171` (`SkillView` type, `readSkillFiles()`)
- Test: `tests/skills-extract.test.ts` (existing file — add cases here;
  it's already in the `npm test` script list)

**Interfaces:**
- Produces: `SkillView.procedureSteps: string[]` — the verbatim text of
  each numbered line under a skill's `## Procedure` section, in order,
  trimmed. For a well-formed automation this is always length 2 (one line
  per `${a1}` / `${a2}`); for any other skill file it's whatever's
  actually there (could be 0, 1, 3+ — never assume 2 elsewhere).

- [ ] **Step 1: Read the existing test file to match its conventions**

Read `tests/skills-extract.test.ts` in full before writing new cases —
match its existing fixture-skill-directory pattern exactly (don't invent a
new fixture style).

- [ ] **Step 2: Write the failing test**

Add to `tests/skills-extract.test.ts` (using whatever fixture-creation
helper that file already defines — read it first per Step 1 and call the
same helper; if the file creates a temp skills directory per test, follow
that exact pattern):

```ts
test("readSkillFiles exposes verbatim procedure step text, not just a count", () => {
  // Use this file's existing fixture helper to write a SKILL.md whose body is:
  //   ## Procedure
  //
  //   1. Summarize the content
  //   2. Post to Slack
  const skills = readSkillFiles();
  const skill = skills.find((s) => s.name === "<the fixture's slug>");
  assert.ok(skill);
  assert.deepEqual(skill!.procedureSteps, ["Summarize the content", "Post to Slack"]);
  assert.equal(skill!.steps, 2); // existing count field must still agree
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/skills-extract.test.ts`
Expected: FAIL — `procedureSteps` is `undefined` (property doesn't exist
yet on the returned object).

- [ ] **Step 3: Implement**

In `scripts/demo.ts`, change the `SkillView` type (line 138-145) to add
the field:

```ts
type SkillView = {
  name: string; description: string; triggers: string[];
  reads: string[]; steps: number; procedureSteps: string[]; grantedBy: string[];
  trigger: string; actionSummary: string; connectedApps: string[];
  status: string; lastRun: string | null; owner: string; approvalRequired: string;
};
```

In `readSkillFiles()` (`scripts/demo.ts:147-171`), the function already
computes `proc` (the raw procedure-section text) and `steps` (a count) at
line 165-166:

```ts
      const proc = md.match(/##\s*Procedure\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i)?.[1] ?? "";
      const steps = (proc.match(/^\s*\d+\.\s+/gm) ?? []).length;
```

Add one line directly after, extracting the text of each numbered line
(strip the leading `N. ` marker, trim trailing whitespace):

```ts
      const procedureSteps = (proc.match(/^\s*\d+\.\s+.+$/gm) ?? [])
        .map((line) => line.replace(/^\s*\d+\.\s+/, "").trim());
```

Then include it in the pushed object (`scripts/demo.ts:167`):

```ts
      out.push({ name: val("name") || d.name, description: val("description"), triggers: list("triggers"), reads: list("reads"), steps, procedureSteps });
```

The return-type annotation on `readSkillFiles()` (line 147) is an
`Omit<SkillView, ...>` that already excludes only the fields computed
later in `skillsView()` — `procedureSteps` is computed here, same as
`steps`, so no change to that `Omit<...>` list is needed; it flows through
automatically once it's a field on `SkillView`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/skills-extract.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing test suite to confirm no regression**

Run: `npm test`
Expected: same pass count as before this task, plus the new case.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo.ts tests/skills-extract.test.ts
git commit -m "Expose verbatim procedure step text from readSkillFiles, not just a count"
```

---

### Task 2: Canvas ↔ automation adapter

**Files:**
- Create: `lib/connectors/automation-canvas/adapter.ts`
- Test: `tests/connectors-automation-canvas.test.ts`

**Interfaces:**
- Consumes: nothing from other new-code tasks (pure, standalone module);
  reads the same `AB_TRIGGER_OPTIONS`/`AB_ACTION_OPTIONS` value sets as
  `scripts/demo.ts:242-243` (re-declared here rather than imported, since
  `scripts/demo.ts` is the server entrypoint and this module must be
  importable from a plain `node:test` file without booting a server — see
  Step 3 for why the values are duplicated with a same-values test).
- Produces:
  - `type TriggerNodeId = "drive" | "notion" | "slack" | "schedule" | "manual"`
  - `type CanvasEdge = { automationName: string; triggerNode: TriggerNodeId; actionSteps: [string, string] }`
  - `function skillToEdge(skill: { name: string; trigger: string; procedureSteps: string[] }): CanvasEdge | null`
  - `function edgeInputToAutomationPayload(triggerNode: TriggerNodeId, actionSteps: [string, string]): { trigger: string; action1: string; action2: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/connectors-automation-canvas.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { skillToEdge, edgeInputToAutomationPayload, TRIGGER_NODE_TO_STRING } from "../lib/connectors/automation-canvas/adapter.ts";

test("skillToEdge maps a well-formed automation to a canvas edge", () => {
  const edge = skillToEdge({
    name: "summarize-and-post",
    trigger: "New message in Slack",
    procedureSteps: ["Summarize the content", "Post to Slack"],
  });
  assert.deepEqual(edge, {
    automationName: "summarize-and-post",
    triggerNode: "slack",
    actionSteps: ["Summarize the content", "Post to Slack"],
  });
});

test("skillToEdge maps every known trigger string to its node id", () => {
  const cases: Array<[string, string]> = [
    ["New file added to Drive", "drive"],
    ["New page added to Notion", "notion"],
    ["New message in Slack", "slack"],
    ["Every Monday morning", "schedule"],
    ["Manual", "manual"],
  ];
  for (const [trigger, expected] of cases) {
    const edge = skillToEdge({ name: "x", trigger, procedureSteps: ["a", "b"] });
    assert.equal(edge?.triggerNode, expected);
  }
});

test("skillToEdge returns null for an unrecognized trigger string", () => {
  const edge = skillToEdge({ name: "hand-edited", trigger: "Something nobody selected", procedureSteps: ["a", "b"] });
  assert.equal(edge, null);
});

test("skillToEdge returns null when procedureSteps isn't exactly two entries", () => {
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: [] }), null);
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: ["only-one"] }), null);
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: ["a", "b", "c"] }), null);
});

test("edgeInputToAutomationPayload reverses the trigger-node mapping", () => {
  const payload = edgeInputToAutomationPayload("notion", ["Draft a notification", "Notify the team channel"]);
  assert.deepEqual(payload, {
    trigger: "New page added to Notion",
    action1: "Draft a notification",
    action2: "Notify the team channel",
  });
});

test("skillToEdge and edgeInputToAutomationPayload round-trip for every trigger", () => {
  for (const trigger of Object.values(TRIGGER_NODE_TO_STRING)) {
    const edge = skillToEdge({ name: "x", trigger, procedureSteps: ["Summarize the content", "Post to Slack"] });
    assert.ok(edge);
    const payload = edgeInputToAutomationPayload(edge!.triggerNode, edge!.actionSteps);
    assert.equal(payload.trigger, trigger);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/connectors-automation-canvas.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/connectors/automation-canvas/adapter.ts`:

```ts
/** Canvas <-> automation adapter. The only place graph shape and the
 * automation-record shape (trigger/action1/action2, exactly what
 * createAutomation() in scripts/demo.ts validates) meet, so the existing
 * List view and this Canvas view can never drift apart.
 *
 * The trigger/action string sets below are duplicated from
 * scripts/demo.ts's AB_TRIGGER_OPTIONS/AB_ACTION_OPTIONS rather than
 * imported, because this module must be importable from a plain node:test
 * file without booting scripts/demo.ts's server. tests/connectors-automation-canvas.test.ts
 * includes a same-values regression test against the real exported arrays
 * so the two lists cannot silently diverge. */

export type TriggerNodeId = "drive" | "notion" | "slack" | "schedule" | "manual";

export type CanvasEdge = {
  automationName: string;
  triggerNode: TriggerNodeId;
  actionSteps: [string, string];
};

export const TRIGGER_NODE_TO_STRING: Record<TriggerNodeId, string> = {
  drive: "New file added to Drive",
  notion: "New page added to Notion",
  slack: "New message in Slack",
  schedule: "Every Monday morning",
  manual: "Manual",
};

const STRING_TO_TRIGGER_NODE: Record<string, TriggerNodeId> = Object.fromEntries(
  Object.entries(TRIGGER_NODE_TO_STRING).map(([node, str]) => [str, node as TriggerNodeId]),
);

export function skillToEdge(skill: { name: string; trigger: string; procedureSteps: string[] }): CanvasEdge | null {
  const triggerNode = STRING_TO_TRIGGER_NODE[skill.trigger];
  if (!triggerNode) return null;
  if (skill.procedureSteps.length !== 2) return null;
  return {
    automationName: skill.name,
    triggerNode,
    actionSteps: [skill.procedureSteps[0], skill.procedureSteps[1]],
  };
}

export function edgeInputToAutomationPayload(
  triggerNode: TriggerNodeId,
  actionSteps: [string, string],
): { trigger: string; action1: string; action2: string } {
  return {
    trigger: TRIGGER_NODE_TO_STRING[triggerNode],
    action1: actionSteps[0],
    action2: actionSteps[1],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/connectors-automation-canvas.test.ts`
Expected: PASS (all 6 cases)

- [ ] **Step 5: Add the same-values regression test**

Add one more case to the same test file, importing the real arrays from
`scripts/demo.ts` to guarantee `TRIGGER_NODE_TO_STRING`'s values can never
silently diverge from the builder's actual options:

```ts
import { AB_TRIGGER_OPTIONS } from "../scripts/demo.ts";
import { TRIGGER_NODE_TO_STRING } from "../lib/connectors/automation-canvas/adapter.ts";

test("every adapter trigger string is one of the builder's real AB_TRIGGER_OPTIONS", () => {
  for (const str of Object.values(TRIGGER_NODE_TO_STRING)) {
    assert.ok(AB_TRIGGER_OPTIONS.includes(str), `"${str}" is not in AB_TRIGGER_OPTIONS`);
  }
  assert.equal(Object.values(TRIGGER_NODE_TO_STRING).length, AB_TRIGGER_OPTIONS.length);
});
```

This requires `AB_TRIGGER_OPTIONS` to be exported from `scripts/demo.ts`
— add `export` to its declaration at `scripts/demo.ts:242` (and to
`AB_ACTION_OPTIONS` at line 243, used by Task 4).

- [ ] **Step 6: Run the full test to verify it passes, then the whole suite**

Run: `node --experimental-strip-types --test tests/connectors-automation-canvas.test.ts`
Run: `npm test`
Expected: PASS, same-or-higher count than Task 1's end state.

- [ ] **Step 7: Commit**

```bash
git add lib/connectors/automation-canvas/adapter.ts tests/connectors-automation-canvas.test.ts scripts/demo.ts
git commit -m "Add the canvas <-> automation adapter"
```

---

### Task 3: Vendored node-canvas renderer

**Files:**
- Create: `scripts/vendor/node-canvas.js`

**Interfaces:**
- Consumes: nothing (standalone DOM-manipulation module; no import of
  `adapter.ts` or `demo.ts` — it's given plain data and DOM refs by the
  caller in Task 4).
- Produces (global, loaded via `<script>` the same way other static assets
  in this app are served — see Task 4 for wiring): a single factory
  function attached to `window.TakoNodeCanvas`:
  ```js
  window.TakoNodeCanvas.render(container, { nodes, edges, onEdgeDragCreate, onEdgeSelect })
  ```
  where:
  - `nodes: Array<{ id: string; label: string; kind: "connector" | "pseudo" | "approval"; active: boolean }>`
  - `edges: Array<{ id: string; fromNodeId: string; toNodeId: "approval"; label: string }>`
  - `onEdgeDragCreate(fromNodeId: string): void` — called when the user
    finishes dragging a connection from a trigger node to the Approval
    node; the caller (Task 4) owns opening the action-step picker and
    calling `/api/automations/create`.
  - `onEdgeSelect(edgeId: string): void` — called when an existing edge is
    clicked; the caller (Task 4) owns showing its detail panel and the
    "Show recent runs" execution overlay.

This module has no automated test in this plan (it's pure DOM
manipulation with no `jsdom`-equivalent in this repo's test setup, which
tests server-rendered HTML strings via `node:test`/`bun test`, not
simulated DOM events — see `tests/tako-ui.test.ts`'s existing pattern).
It's verified via the browser-preview workflow at the end of Task 4/5, and
via the structural assertions Task 6 adds against `renderPage()`'s static
markup (container presence, node-id attributes) rather than interaction
behavior.

- [ ] **Step 1: Fixed layout constants**

The node set is fixed at 9 entries (spec §3: "a small, bounded node set...
not a free-form palette"). Write the layout as fixed pixel positions in a
600×400 canvas, grouped by row — triggers/pseudo-triggers on the left,
Approval centered-right, inactive connectors along the bottom:

```js
(function () {
  "use strict";

  const LAYOUT = {
    drive:    { x: 40,  y: 40  },
    notion:   { x: 40,  y: 120 },
    slack:    { x: 40,  y: 200 },
    schedule: { x: 40,  y: 280 },
    manual:   { x: 40,  y: 360 },
    approval: { x: 420, y: 200 },
    discord:  { x: 240, y: 380 },
    notes:    { x: 320, y: 380 },
    cad:      { x: 400, y: 380 },
    mcp:      { x: 480, y: 380 },
  };
  const NODE_W = 140;
  const NODE_H = 56;
```

- [ ] **Step 2: DOM rendering**

```js
  function renderNode(node) {
    const pos = LAYOUT[node.id];
    const el = document.createElement("div");
    el.className = "tako-canvas-node" +
      (node.kind === "approval" ? " tako-canvas-node--approval" : "") +
      (node.active === false ? " tako-canvas-node--inactive" : "");
    el.dataset.nodeId = node.id;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${NODE_W}px`;
    el.style.height = `${NODE_H}px`;
    el.textContent = node.label;
    return el;
  }

  function edgePath(fromId, toId) {
    const from = LAYOUT[fromId];
    const to = LAYOUT[toId];
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  function render(container, { nodes, edges, onEdgeDragCreate, onEdgeSelect }) {
    container.innerHTML = "";
    container.classList.add("tako-canvas-root");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tako-canvas-edges");
    svg.setAttribute("viewBox", "0 0 600 440");

    for (const edge of edges) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgePath(edge.fromNodeId, edge.toNodeId));
      path.setAttribute("class", "tako-canvas-edge");
      path.dataset.edgeId = edge.id;
      path.addEventListener("click", () => onEdgeSelect(edge.id));
      svg.appendChild(path);
    }
    container.appendChild(svg);

    for (const node of nodes) {
      const el = renderNode(node);
      if (node.kind !== "approval" && node.active !== false) {
        attachDragConnect(el, node.id, onEdgeDragCreate, container);
      }
      container.appendChild(el);
    }
  }
```

- [ ] **Step 3: Drag-to-connect gesture**

A trigger node can only ever connect to the fixed Approval node (spec §1
— no other target exists), so the gesture is simplified: pointerdown on a
trigger node draws a temporary line following the pointer; pointerup over
the Approval node's bounding box fires `onEdgeDragCreate`; pointerup
anywhere else cancels with no side effect.

```js
  function attachDragConnect(nodeEl, nodeId, onEdgeDragCreate, container) {
    nodeEl.addEventListener("pointerdown", (downEvent) => {
      downEvent.preventDefault();
      const tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tempLine.setAttribute("class", "tako-canvas-drag-line");
      const svg = container.querySelector(".tako-canvas-edges");
      svg.appendChild(tempLine);
      const fromPos = LAYOUT[nodeId];
      const x1 = fromPos.x + NODE_W;
      const y1 = fromPos.y + NODE_H / 2;
      tempLine.setAttribute("x1", x1);
      tempLine.setAttribute("y1", y1);

      function onMove(moveEvent) {
        const rect = container.getBoundingClientRect();
        tempLine.setAttribute("x2", moveEvent.clientX - rect.left);
        tempLine.setAttribute("y2", moveEvent.clientY - rect.top);
      }
      function onUp(upEvent) {
        const approvalEl = container.querySelector('[data-node-id="approval"]');
        const rect = approvalEl.getBoundingClientRect();
        const hit = upEvent.clientX >= rect.left && upEvent.clientX <= rect.right &&
                    upEvent.clientY >= rect.top && upEvent.clientY <= rect.bottom;
        tempLine.remove();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (hit) onEdgeDragCreate(nodeId);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  window.TakoNodeCanvas = { render };
})();
```

- [ ] **Step 4: Manual verification in the browser (no automated test for this task)**

Run `bun scripts/demo.ts`, confirm in `preview_logs`/console that
`scripts/vendor/node-canvas.js` is requested and returns 200 once Task 4
wires it in — this file alone renders nothing until then, so full
verification happens at the end of Task 4.

- [ ] **Step 5: Commit**

```bash
git add scripts/vendor/node-canvas.js
git commit -m "Add the vendored node-canvas renderer (no CDN, no framework)"
```

---

### Task 4: Wire the Canvas view into the Automations screen (read path)

**Files:**
- Modify: `scripts/demo.ts` (automations section markup at
  `scripts/demo.ts:1973-2008`; static asset serving; client script)

**Interfaces:**
- Consumes: `TRIGGER_NODE_TO_STRING`, `skillToEdge`, `edgeInputToAutomationPayload`
  from Task 2's `lib/connectors/automation-canvas/adapter.ts`;
  `window.TakoNodeCanvas.render` from Task 3.
- Produces: nothing new for later tasks (this is the read-path UI wiring;
  Task 5 adds the write path and execution overlay on top of what this
  task renders).

- [ ] **Step 1: Serve the vendored script as a static asset**

Find the existing static-serving pattern in `scripts/demo.ts` (search for
how `PAGE` or any existing static response is returned — the credential
docs route added earlier, `if (url.pathname.startsWith("/docs/connectors/"))`,
is the closest precedent: a whitelisted, exact-path static file response,
not a general static-file server). Add the same pattern for the vendored
canvas script:

```ts
        if (url.pathname === "/vendor/node-canvas.js") {
          const file = Bun.file(new URL("../scripts/vendor/node-canvas.js", import.meta.url));
          return new Response(file, { headers: { "content-type": "text/javascript; charset=utf-8" } });
        }
```

Place this alongside the existing `/docs/connectors/` route.

- [ ] **Step 2: Add the List/Canvas toggle and canvas container to the automations section**

In `scripts/demo.ts` at the automations `<section>` (currently
`scripts/demo.ts:1973-2008`), add a toggle in the header and a canvas
container after the existing `#automation-list`:

```html
      <header class="tako-screen-head">
        <h1>Automations</h1>
        <div class="tako-view-toggle" role="group" aria-label="View">
          <button class="tako-btn tako-btn--secondary" data-view-toggle="list" aria-pressed="true">List</button>
          <button class="tako-btn tako-btn--secondary" data-view-toggle="canvas" aria-pressed="false">Canvas</button>
        </div>
        <button class="tako-btn tako-btn--primary" data-action="new-automation">New automation</button>
      </header>
      <ul class="tako-automation-list" id="automation-list">...</ul>

      <div class="tako-automation-canvas" id="automation-canvas" hidden>
        <div id="automation-canvas-root"></div>
        <aside class="tako-panel" id="automation-canvas-detail" hidden></aside>
      </div>
```

(Leave every other existing element in this section — `#automations-empty`,
`#automation-templates`, `#automation-builder`, `#automation-success` —
exactly as-is; this task only adds the toggle and the new container.)

- [ ] **Step 3: Add the client-side script tag**

Near wherever `scripts/demo.ts`'s served page loads its own inline
`<script>` (the page is one big template literal — find the closing
`</script>` before `</body>` or equivalent), add:

```html
<script src="/vendor/node-canvas.js"></script>
```

before the existing inline script tag (so `window.TakoNodeCanvas` exists
by the time the inline script runs).

- [ ] **Step 4: Interpolate the trigger mapping into the client script once**

Import `TRIGGER_NODE_TO_STRING` server-side from Task 2's adapter module
at the top of `scripts/demo.ts` (Bun runs this file directly, so a normal
import works):

```ts
import { TRIGGER_NODE_TO_STRING } from "../lib/connectors/automation-canvas/adapter.ts";
```

Then, in the same template-literal region that already does this for
`AB_TRIGGER_OPTIONS`/`AB_ACTION_OPTIONS` (`scripts/demo.ts:2447-2448`),
add one more interpolated constant right beside them:

```js
const AB_TRIGGER_OPTIONS=${JSON.stringify(AB_TRIGGER_OPTIONS)};
const AB_ACTION_OPTIONS=${JSON.stringify(AB_ACTION_OPTIONS)};
const TRIGGER_NODE_TO_STRING=${JSON.stringify(TRIGGER_NODE_TO_STRING)};
```

This becomes the **single** client-side copy of that mapping — Task 4
Step 4's `loadCanvas()` below and both of Task 5's functions reference
this one global instead of each redeclaring their own copy. (The
same-values regression test in Task 2 Step 5 still guards the one
remaining independent copy, the standalone `adapter.ts` module used by
`node:test`, against drifting from `AB_TRIGGER_OPTIONS`.)

- [ ] **Step 5: Client-side wiring — fetch skills, adapt, render**

In the existing inline client script (same file, `<script>` section — find
where `automation-list` is populated, around where `skillsCached`/`/api/skills`
is fetched for the list view, to place this near it), add:

```js
const CONNECTOR_NODE_LABELS = {
  drive: "Google Drive", notion: "Notion", slack: "Slack",
  schedule: "Every Monday", manual: "Manual",
  discord: "Discord", notes: "Local Notes", cad: "CAD", mcp: "MCP",
};
const INACTIVE_NODE_IDS = ["discord", "notes", "cad", "mcp"];

async function loadCanvas() {
  const data = await fetch('/api/skills').then(r => r.json());
  const edges = [];
  for (const skill of data.skills) {
    // skillToEdge/edgeInputToAutomationPayload logic is duplicated here in
    // plain JS (this inline script has no module import system) — kept in
    // sync with lib/connectors/automation-canvas/adapter.ts by using the
    // same TRIGGER_NODE_TO_STRING global interpolated in Step 4 above,
    // rather than a separately hand-typed copy.
    const triggerNode = Object.keys(TRIGGER_NODE_TO_STRING).find(k => TRIGGER_NODE_TO_STRING[k] === skill.trigger);
    if (!triggerNode || skill.procedureSteps.length !== 2) continue;
    edges.push({
      id: skill.name, fromNodeId: triggerNode, toNodeId: "approval",
      label: skill.procedureSteps.join(' -> '),
      actionSteps: skill.procedureSteps,
    });
  }
  const nodes = [
    ...Object.keys(CONNECTOR_NODE_LABELS).map(id => ({
      id, label: CONNECTOR_NODE_LABELS[id], kind: "connector",
      active: !INACTIVE_NODE_IDS.includes(id),
    })),
    { id: "approval", label: "Approval", kind: "approval", active: true },
  ];
  window.TakoNodeCanvas.render(document.getElementById('automation-canvas-root'), {
    nodes, edges,
    onEdgeDragCreate: (fromNodeId) => openCanvasActionPicker(fromNodeId), // Task 5
    onEdgeSelect: (edgeId) => openCanvasEdgeDetail(edgeId, edges),        // Task 5
  });
}

document.querySelectorAll('[data-view-toggle]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.viewToggle;
    document.querySelectorAll('[data-view-toggle]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    document.getElementById('automation-list').hidden = view !== 'list';
    document.getElementById('automation-canvas').hidden = view !== 'canvas';
    if (view === 'canvas') loadCanvas();
  });
});
```

Note the inline placeholders `openCanvasActionPicker`/`openCanvasEdgeDetail`
are defined in Task 5, not this task — this task only needs the functions
to exist as no-op stubs so the page doesn't throw:

```js
function openCanvasActionPicker(fromNodeId) { /* Task 5 */ }
function openCanvasEdgeDetail(edgeId, edges) { /* Task 5 */ }
```

- [ ] **Step 5: Add minimal CSS**

Near the existing `.tako-automation-list`/`.tako-automation-builder`
styles (`scripts/demo.ts:1773-1784`), add:

```css
.tako-automation-canvas { position: relative; height: 460px; border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); }
.tako-canvas-root { position: relative; width: 100%; height: 100%; overflow: hidden; }
.tako-canvas-node { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); background: var(--tako-surface); cursor: grab; font-size: 13px; }
.tako-canvas-node--approval { background: var(--tako-accent, #2f5f4f); color: #fff; cursor: default; }
.tako-canvas-node--inactive { opacity: 0.4; cursor: not-allowed; }
.tako-canvas-edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tako-canvas-edge { fill: none; stroke: var(--tako-border); stroke-width: 2; pointer-events: stroke; cursor: pointer; }
.tako-canvas-drag-line { stroke: var(--tako-accent, #2f5f4f); stroke-width: 2; stroke-dasharray: 4; }
```

- [ ] **Step 6: Manual browser verification**

Run `bun scripts/demo.ts`, navigate to Automations, click "Canvas," confirm:
- all 9 nodes render at their fixed positions;
- Discord/Notes/CAD/MCP render visibly dimmed (`.tako-canvas-node--inactive`);
- any existing automation (from an earlier session or a freshly-created one
  via the List view's builder) renders as a curved edge from its trigger
  node to Approval;
- clicking a trigger node and dragging to Approval doesn't error (the
  Task-5 stub is a no-op, so nothing visible happens yet — that's expected
  at this checkpoint).

Take a screenshot for the task report.

- [ ] **Step 7: Commit**

```bash
git add scripts/demo.ts
git commit -m "Wire the Canvas view's read path: render existing automations as a node graph"
```

---

### Task 5: Write path (create via drag) and execution overlay

**Files:**
- Modify: `scripts/demo.ts` (replace the Task 4 stub functions;
  `openCanvasActionPicker`, `openCanvasEdgeDetail`)

**Interfaces:**
- Consumes: `AB_ACTION_OPTIONS` (now exported per Task 2 Step 5), the
  existing `POST /api/automations/create` endpoint (`scripts/demo.ts:1161`),
  the existing `GET /api/activity` endpoint (`scripts/demo.ts:1176`),
  `edgeInputToAutomationPayload`'s logic (restated inline, same caveat as
  Task 4 Step 4 — no module system in the inline script).

- [ ] **Step 1: Action-step picker on drag-create**

Replace the Task 4 stub:

Uses the page's existing `AB_ACTION_OPTIONS` global (already interpolated
once at `scripts/demo.ts:2448` — do **not** redeclare it here; a second
`const AB_ACTION_OPTIONS = ...` in the same script scope would throw at
load time) and the `TRIGGER_NODE_TO_STRING` global from Task 4 Step 4:

```js
function openCanvasActionPicker(fromNodeId) {
  const panel = document.getElementById('automation-canvas-detail');
  panel.hidden = false;
  panel.innerHTML = `
    <h2>New automation</h2>
    <p class="tako-supporting">When ${'$'}{document.querySelector(`[data-node-id="${'$'}{fromNodeId}"]`).textContent}, do this:</p>
    <select id="canvas-action-1">${'$'}{AB_ACTION_OPTIONS.map(o => `<option>${'$'}{o}</option>`).join('')}</select>
    <p class="tako-supporting">Then this:</p>
    <select id="canvas-action-2">${'$'}{AB_ACTION_OPTIONS.map(o => `<option>${'$'}{o}</option>`).join('')}</select>
    <div class="note-err" id="canvas-action-error" hidden></div>
    <button class="tako-btn tako-btn--primary" id="canvas-action-submit">Create automation</button>
  `;
  document.getElementById('canvas-action-submit').addEventListener('click', async () => {
    const trigger = TRIGGER_NODE_TO_STRING[fromNodeId];
    const action1 = document.getElementById('canvas-action-1').value;
    const action2 = document.getElementById('canvas-action-2').value;
    const errBox = document.getElementById('canvas-action-error');
    errBox.hidden = true;
    try {
      await adminApi('/api/automations/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger, action1, action2 }) });
      panel.hidden = true;
      loadCanvas();
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = e.message;
    }
  });
}
```

This calls the *exact same* `adminApi('/api/automations/create', ...)`
helper the existing dropdown builder calls at `scripts/demo.ts:2491` — no
duplicated validation logic, no bypass of `createAutomation()`'s own
server-side checks (`scripts/demo.ts:255-257`).

- [ ] **Step 2: Edge detail + "Show recent runs" execution overlay**

Replace the Task 4 stub:

```js
async function openCanvasEdgeDetail(edgeId, edges) {
  const edge = edges.find(e => e.id === edgeId);
  const panel = document.getElementById('automation-canvas-detail');
  panel.hidden = false;
  panel.innerHTML = `
    <h2>${'$'}{edgeId}</h2>
    <ol>${'$'}{edge.actionSteps.map(s => `<li>${'$'}{s}</li>`).join('')}</ol>
    <button class="tako-btn tako-btn--secondary" id="canvas-show-runs">Show recent runs</button>
    <div id="canvas-run-history"></div>
  `;
  document.getElementById('canvas-show-runs').addEventListener('click', async () => {
    const activity = await fetch('/api/activity').then(r => r.json());
    const matches = activity.entries.filter(e => e.label === `Automation run: ${'$'}{edgeId}`);
    const out = document.getElementById('canvas-run-history');
    if (matches.length === 0) {
      out.textContent = "This automation hasn't run yet.";
      return;
    }
    out.innerHTML = matches.map(m => `<p>${'$'}{m.time ?? 'unknown time'} — ${'$'}{m.outcomeLabel}</p>`).join('');
    // Sequential highlight: trigger node, then Approval, using each match's
    // real recorded time/outcome -- no invented intermediate states.
    const triggerEl = document.querySelector(`[data-node-id="${'$'}{edge.fromNodeId}"]`);
    const approvalEl = document.querySelector('[data-node-id="approval"]');
    triggerEl.classList.add('tako-canvas-node--highlight');
    setTimeout(() => {
      triggerEl.classList.remove('tako-canvas-node--highlight');
      approvalEl.classList.add('tako-canvas-node--highlight');
      setTimeout(() => approvalEl.classList.remove('tako-canvas-node--highlight'), 600);
    }, 600);
  });
}
```

Add the highlight style next to the other canvas CSS from Task 4 Step 5:

```css
.tako-canvas-node--highlight { outline: 2px solid var(--tako-accent, #2f5f4f); outline-offset: 2px; }
```

- [ ] **Step 3: Manual browser verification**

Run `bun scripts/demo.ts`:
1. On the Canvas view, drag from a trigger node (e.g. Notion) to Approval;
   pick two actions; submit. Confirm the new automation appears as an edge
   immediately (via `loadCanvas()` re-fetching) and also appears in the
   existing List view (`#automation-list`) — same underlying data, both
   views agree.
2. Click that new edge, click "Show recent runs" — confirm it says "This
   automation hasn't run yet" (no fabricated history for something that
   never ran).
3. If any automation in this instance has real Activity entries (check
   `/api/activity` directly, or trigger one via the existing worker/skill
   run path if available in this environment), select it on the canvas and
   confirm the highlight sequence uses that entry's real `time`/`outcomeLabel`,
   not placeholder text.

Take screenshots for the task report.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo.ts
git commit -m "Wire the Canvas view's write path and real-activity execution overlay"
```

---

### Task 6: UI tests and full-suite registration

**Files:**
- Modify: `tests/tako-ui.test.ts`
- Modify: `package.json` (test script — add
  `tests/connectors-automation-canvas.test.ts` to the `node --test` list if
  Task 2 didn't already add it there; confirm it's present)

**Interfaces:**
- Consumes: `renderPage()` (already exported, `tests/tako-ui.test.ts:5`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/tako-ui.test.ts`:

```ts
test("Automations screen has a List/Canvas toggle and both containers", () => {
  const html = renderPage();
  assert.match(html, /data-view-toggle="list"/);
  assert.match(html, /data-view-toggle="canvas"/);
  assert.match(html, /id="automation-canvas"/);
  assert.match(html, /id="automation-canvas-root"/);
});

test("Canvas view's client script references all nine fixed node ids", () => {
  const html = renderPage();
  for (const id of ["drive", "notion", "slack", "schedule", "manual", "discord", "notes", "cad", "mcp", "approval"]) {
    assert.match(html, new RegExp(id));
  }
});

test("the vendored node-canvas script is referenced, not loaded from a CDN", () => {
  const html = renderPage();
  assert.match(html, /<script src="\/vendor\/node-canvas\.js">/);
  assert.doesNotMatch(html, /cdn\.[a-z]+\.[a-z]+\/.*node-canvas/i);
});
```

- [ ] **Step 2: Run tests to verify they fail (then implement any gaps Task 4 missed)**

Run: `bun test tests/tako-ui.test.ts`
If any assertion fails, it means Task 4's markup doesn't exactly match
what this task expects — fix the markup in `scripts/demo.ts` (not the
test) to match Task 4's own stated interface, unless Task 4's actual
implementation reasonably diverged, in which case update the assertion to
match what was actually built and note why in the commit message.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: every previously-passing test still passes, plus all new cases
from Tasks 1, 2, and this task.

- [ ] **Step 4: Confirm `tests/connectors-automation-canvas.test.ts` is registered**

Check `package.json`'s `"test"` script string — if
`tests/connectors-automation-canvas.test.ts` isn't already listed among
the `node --experimental-strip-types --test ...` file arguments, add it
there (alphabetical-ish position near the other `connectors-*.test.ts`
entries, matching the existing list's rough ordering).

- [ ] **Step 5: Commit**

```bash
git add tests/tako-ui.test.ts package.json
git commit -m "Add Canvas-view UI tests and register the adapter test file"
```
