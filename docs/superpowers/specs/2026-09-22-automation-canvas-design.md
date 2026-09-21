# Automation Canvas — Architecture Specification

**Status:** Design approved in chat; written up for review before an
implementation plan. No implementation code is authorized by this document.

**Spec:** this file. No prior spec exists for this feature — the existing
"When this happens / Do this / Then this" builder
(`scripts/demo.ts:1992-1997`, `createAutomation()` at `scripts/demo.ts:250`)
is unspecified legacy code this design builds alongside, not on top of.

## 0. Objective and non-goals

### Objective

Give tako's Automations screen a second, visual way to see and build
automations — a canvas of draggable nodes and connecting lines, matching the
"floating boxes connected to each other" mental model of tools like Kintone,
Zapier, or n8n — **without visually claiming that tako executes more than it
actually does today.**

### Non-goals

- Not a new automation data model. The canvas reads and writes the exact
  same `trigger`/`action1`/`action2` shape `createAutomation()` already
  validates and persists as a `SKILL.md` (`scripts/demo.ts:250-289`). List
  view and Canvas view are two renderings of one underlying record; nothing
  here forks that record shape.
- Not the real execution engine. Per the meeting-integration Phase 0
  discovery on this same codebase, creating an automation today writes a
  `SKILL.md` description; the separate worker system that runs scheduled
  skills stops at a local approval queue and **never delivers output
  anywhere** (no Slack post, no email, no external write). This spec does
  not change that. See §2 for how the node graph stays honest about it.
- Not a replacement for the dropdown builder. Per the approved design, this
  is an additional view (a "List / Canvas" toggle on the existing
  Automations screen), not a retirement of `#automation-builder`.
- Not a new decision/classification engine. A local fast-classifier model
  (evaluated separately, e.g. for trigger-condition evaluation) is out of
  scope for this spec entirely; noted once in §7 as a future consideration
  only.
- Not a framework migration. No React, no build step. Approach B from the
  approved design: a small, dependency-light vanilla-JS node-editor,
  vendored into the repo (see §3), consistent with `scripts/demo.ts` being
  a single server-rendered file with inline client script today.

## 1. Correction from the in-chat design: what an edge can honestly represent

The in-chat design described an automation as a path **"source connector →
Approval → destination connector."** Re-checking that against the actual
`createAutomation()` code before writing this spec surfaced a problem with
that phrasing: there is no destination-connector delivery step to point an
edge at. `AB_ACTION_OPTIONS` (`scripts/demo.ts:243`) is:

```
["Summarize the content", "Draft a notification", "Run the decision audit",
 "Post to Slack", "Notify the team channel", "Send an email digest"]
```

Three of these read like they deliver somewhere ("Post to Slack," "Notify
the team channel," "Send an email digest") and three clearly don't
("Summarize the content," "Draft a notification," "Run the decision
audit") — but **none of the six currently deliver anywhere**, per the
non-goals above. "Post to Slack" is exactly as unexecuted as "Summarize the
content" in the code that exists today. Drawing an edge from Approval to a
Slack node for one but not the other would draw a distinction the backend
doesn't make, and would misrepresent "Post to Slack" as more real than it
is.

**Corrected model:** the graph an automation renders as is a single path,
terminal at Approval:

```
[Trigger node] → [Approval node]
```

with `action1` and `action2` shown as two ordered **step labels inside the
Approval node's detail panel** (matching the "1. {action1}  2. {action2}"
procedure list `createAutomation()` already writes into the `SKILL.md`,
`scripts/demo.ts:285-286`) — not as separate connector nodes with their own
edges. If a real delivery mechanism is built later (a genuinely new,
separately-specified feature), *that* is the point where an action step
could legitimately grow its own node and edge past Approval.

## 2. Node set

Trigger nodes are derived from `AB_TRIGGER_OPTIONS`
(`scripts/demo.ts:242`), each mapped to a fixed node:

| Trigger string | Node | Real connector? |
|---|---|---|
| `New file added to Drive` | Drive | yes — `CONNECTOR_SPECS.drive` |
| `New page added to Notion` | Notion | yes — `CONNECTOR_SPECS.notion` |
| `New message in Slack` | Slack | yes — `CONNECTOR_SPECS.slack` |
| `Every Monday morning` | Schedule | no — a fixed pseudo-node, not a connector |
| `Manual` | Manual | no — a fixed pseudo-node, not a connector |

Only three of the five triggers map to an actual `CONNECTOR_SPECS` entry.
Discord, Notes, CAD, and MCP connectors exist in the app but have no
corresponding trigger option today — they render on the canvas as
available-but-unused nodes (see §3), never as part of an existing
automation's path, since no trigger string can select them.

One fixed **Approval** node always terminates every path (§1). It is not
connector-shaped; it renders distinctly (matching the existing Approvals
screen's visual language, not a connector card).

## 3. Canvas rendering

**Library:** a small, dependency-light vanilla-JS node-editor (Approach B,
approved). It must be **vendored into the repo** (e.g.
`scripts/vendor/node-editor.js`), not loaded from a CDN at runtime — tako's
existing security posture is "nothing leaves this machine"
(`docs/PROTOTYPE_SECURITY_CHECKLIST.md`, P0-03), and a CDN `<script src>`
would be a small but real exception to that story every time the page
loads. Vendoring keeps the canvas fully offline like the rest of the app.

**Layout:** all five trigger nodes plus Discord/Notes/CAD/MCP (shown
inactive/greyed — "no trigger available yet," not clickable into a path)
plus the one Approval node render at fixed canvas positions on load — this
is a small, bounded node set (nine total), not a free-form palette, so a
fixed layout is simpler and more legible than force-directed placement.
Existing automations draw as highlighted edges from their trigger node to
Approval. Multiple automations sharing a trigger (e.g. two different
Notion-triggered automations) render as parallel edges, distinguishable on
hover/click (each shows its own action-step labels in the side panel).

**Toggle:** the existing Automations screen (`scripts/demo.ts:1990-2028`)
gains a `List | Canvas` control in its header. Canvas mode replaces the
`#automation-list`/`#automation-templates`/`#automation-builder` block
visually but drives the same underlying `/api/automations/create` endpoint
and the same `AB_TRIGGER_OPTIONS`/`AB_ACTION_OPTIONS` validation — see §4.

## 4. Graph ↔ automation adapter

Two pure functions, the only place graph shape and automation-record shape
meet, so List and Canvas can never drift apart:

```ts
type CanvasEdge = {
  triggerNode: "drive" | "notion" | "slack" | "schedule" | "manual";
  actionSteps: [string, string]; // exactly AB_ACTION_OPTIONS members, ordered
};

function automationToEdge(trigger: string, action1: string, action2: string): CanvasEdge | null;
function edgeToAutomation(edge: CanvasEdge): { trigger: string; action1: string; action2: string };
```

`automationToEdge` returns `null` (and the automation is skipped on the
canvas, not crashed past) for any existing automation whose stored trigger
string doesn't match one of the five known `AB_TRIGGER_OPTIONS` values —
this can only happen if a `SKILL.md` was hand-edited outside the builder,
since `createAutomation()` already rejects unrecognized values
(`scripts/demo.ts:256`), but the adapter must not assume that invariant
holds for every file on disk.

**Creating an automation on the canvas:** the user drags a connection from
a trigger node to the Approval node. This opens the same two action
`<select>` dropdowns the existing builder uses (`AB_ACTION_OPTIONS`,
`scripts/demo.ts:2456-2457`) inside a small panel anchored to the new edge,
not a separate page. Confirming calls `edgeToAutomation()` then the exact
same `POST /api/automations/create` the dropdown builder already calls
(`scripts/demo.ts:2490`) — same server-side validation
(`scripts/demo.ts:250-257`), same slug generation
(`generateAutomationSlug`, `scripts/demo.ts:223-236`), same rejection of
unrecognized trigger/action strings. The canvas never bypasses that
validation by constructing a `SKILL.md` itself.

## 5. Execution overlay — "how the machine works behind"

This must be built from **real, already-logged data**, never a simulated
animation, or it would misrepresent execution the same way §1's original
edge design would have.

Every automation run already produces an `ActivityEntry`
(`scripts/demo.ts:857-871`) with `label: "Automation run: ${skillRun.skill}"`
(seen at the existing call site producing `skillRun.skill`) and a
`sources: string[]` field. Selecting an automation's edge on the canvas and
choosing "Show recent runs":

1. Fetches `/api/activity` (already exists, `scripts/demo.ts:1135`).
2. Filters entries whose `label` matches `Automation run: <this automation's slug>`.
3. For each matching entry, briefly highlights the trigger node, then the
   Approval node, in sequence, using that entry's real `time`, `outcome`,
   and `outcomeLabel` fields — not invented ones — labeled with the actual
   outcome (e.g. "queued for review," "failed") rather than implying
   delivery succeeded.
4. If no matching entries exist yet, the panel says so plainly ("This
   automation hasn't run yet") rather than showing an empty animation that
   could be mistaken for "ran with no activity."

This overlay can only ever show what the existing Activity log already
proves happened — it adds no new tracking, no new instrumentation, and no
claim the log doesn't already support.

## 6. Testing

- **Adapter unit tests** (new `tests/connectors-automation-canvas.test.ts`
  or similar, following the existing `tests/*.test.ts` node:test
  convention): `automationToEdge`/`edgeToAutomation` round-trip for every
  valid `AB_TRIGGER_OPTIONS`/`AB_ACTION_OPTIONS` combination; `null` return
  for an unrecognized trigger string; rejection of a trigger/action pair
  edgeToAutomation would produce that `createAutomation()` itself would
  reject (keeps the two functions' validation assumptions from silently
  diverging).
- **UI test** (extending `tests/tako-ui.test.ts`, the existing `bun test`
  suite): Canvas view renders exactly the nine nodes from §2 with Discord/
  Notes/CAD/MCP visibly inactive; an existing automation (seeded via the
  same fixture pattern already used elsewhere in that file) renders as an
  edge with the right two action-step labels; creating an automation by
  simulating a drag-connect produces a record byte-identical in shape to
  one created through the dropdown builder's existing code path (same
  `POST /api/automations/create` call, same resulting `SKILL.md`).
- **No new server-side test surface** — the adapter and canvas are
  client-side; `createAutomation()` itself is unchanged and already has
  whatever coverage it has today (out of scope to expand here beyond
  confirming the canvas doesn't bypass it).

## 7. Future considerations (explicitly out of scope here)

- **Real delivery engine.** If a future, separately-specified feature adds
  actual Slack/email/calendar delivery (the gap Codex's Phase 0 meeting-
  integration report identified as missing from the automation system
  generally), the corrected model in §1 is exactly where a new node and
  edge would be added past Approval — this spec's node set and adapter are
  deliberately structured so that extension doesn't require reshaping the
  existing graph.
- **A fast local classifier for trigger evaluation.** Raised during
  brainstorming: a non-generative, non-autoregressive text-classification
  model (evaluated by the user separately) could someday replace an Ollama
  round-trip for a simple yes/no trigger condition (e.g. "is this Slack
  message urgent enough to trigger this automation"). This is unrelated to
  the canvas itself — the canvas visualizes trigger/action pairs, it
  doesn't evaluate conditions — and would be its own spec if pursued.
