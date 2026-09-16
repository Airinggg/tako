# tako Visual/IA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `scripts/demo.ts` — the customer-facing tako demo surface — into the sidebar-navigated, 8-screen product described in the spec, on top of the existing, unchanged functional engine.

**Architecture:** `scripts/demo.ts` is a single Bun.serve file mixing view-generation functions, an HTTP router, and one giant HTML/CSS/JS template string (`PAGE`). This plan does not restructure that pattern wholesale — it extracts three new, focused modules the existing file didn't have a reason to have before (design tokens, the mascot, and a page-render entry point safe to import in tests), then modifies `demo.ts` screen-by-screen in place, following its existing per-section structure.

**Tech Stack:** Bun (`Bun.serve`), TypeScript, vanilla DOM JS (no framework — matches the existing file), `node:test` + `node:assert/strict` (matches the existing test suite's convention of importing real exported functions and asserting on their output, not spinning up a live server).

**Spec:** `docs/superpowers/specs/2026-09-11-tako-rebrand-design.md` — read this in full before starting; every color, copy string, and rule below is copied from it verbatim. This plan implements it; it does not restate its reasoning.

## Global Constraints

Copied verbatim from the spec — every task's output must satisfy all of these:

- **Colors** (exact hex, no others for these roles): canvas `#F3F5F1` · primary surface `#FFFFFF` · main text `#1E2925` · secondary text `#66716C` · primary action `#286653` · selected state `#DCEBE4` · information `#527E8A` · tako amber `#D49A55` · tako cream `#F2D5A7` · error `#B85D55` · border `#DDE2DE`.
- **Never** white body text over `#D49A55`. Amber is for Tako/warm moments only — not every CTA.
- **Typography:** Inter, fallback SF Pro (macOS) / Segoe UI (Windows). Product hero 44–52px max, page title 30–36px, section title 20–24px, body 15–17px, supporting 13–14px, labels 12–13px. No 60–90px headings on operational screens.
- **Spacing:** 8-point system, 12–16px card radii, restrained shadows.
- **Copy:** headlines ~2–6 words, page titles 1–2 words, supporting copy one short sentence, no paragraphs above operational interfaces, button verbs are direct ("Connect," "Create," "Approve," "Retry"). Never expose "iPaaS," "API," "MCP," "token," "frontmatter," "runtime," "source slug," or "rollup" to a non-admin screen.
- **One interface language visible at a time** — do not show a complete duplicate JA+EN translation of the same sentence on screen simultaneously (the current file does this throughout; this plan removes it screen by screen).
- **Mascot:** amber body `#D49A55`, cream details `#F2D5A7`, exactly eight short rounded arms, two small charcoal eyes, small ear fins, teal integration nodes, calm expression. Never redesign proportions. Prominent only on: onboarding, Home empty states, connection setup, automation templates, success/recovery. Sparing on: Ask, Tasks, Activity. Never beside: sensitive info, permission changes, high-risk warnings, approval decisions, legal/security text — small mark or nothing there instead.
- **Motion:** interface feedback 120–200ms, panel/layout changes 180–280ms, mascot gestures 280–500ms, ambient transitions ≤800ms. Actions never wait for animation. Respect `prefers-reduced-motion`.
- **Accessibility:** WCAG 2.2 AA — keyboard nav, visible focus states, 4.5:1 body-text contrast, reduced motion, status communicated beyond color alone.
- **Out of scope, do not touch:** `lib/connectors/`, `lib/govern/`, `packages/brain/`, `lib/eval/` — the functional engine is unchanged. `config/connectors.json`'s plaintext token storage is a known, separately tracked issue — do not fix it here, and do not write copy that implies it's already solved.
- **`npm test` must stay green after every task.** Add `tests/tako-ui.test.ts` to the test list in `package.json`'s `"test"` script in Task 1 — it does not run until you do.

---

## File Structure

- **Create** `scripts/tako/tokens.ts` — exports the CSS custom-properties block and a plain-object color map, so both the served page and tests read the same values.
- **Create** `scripts/tako/mascot.ts` — exports the mascot SVG (one canonical markup, per state) and the placement-rule data structure (prominent/sparing/never lists), so placement is a testable fact, not a convention someone can silently drift from.
- **Modify** `scripts/demo.ts` — guarded server start, sidebar nav, all 9 screens' markup and copy, motion/accessibility CSS. This file stays the single render target; it does not get split into 9 files, matching its existing one-file-per-surface convention.
- **Create** `tests/tako-ui.test.ts` — imports `renderPage()`, `TAKO_COLORS`, and the mascot placement data directly; asserts on their content. No HTTP calls, no live server, no port to conflict with (this is exactly the problem Task 1 exists to avoid).
- **Modify** `package.json` — add the new test file to the `"test"` script's file list.

---

## Task 1: Make `demo.ts` safely importable, and add its test file

Today, importing `scripts/demo.ts` starts a real HTTP server as a side effect (`Bun.serve` runs unconditionally at the top level). This has already caused real port conflicts this session. Every later task in this plan needs to import pieces of this file in a test without that happening.

**Files:**
- Modify: `scripts/demo.ts:628-712` (the `Bun.serve(...)` call and the three `console.log` lines after it)
- Modify: `package.json` (the `"test"` script)
- Test: `tests/tako-ui.test.ts` (new)

**Interfaces:**
- Produces: `export function renderPage(): string` — returns the full HTML document (today's bare `PAGE` constant, unchanged content for this task). Later tasks modify what it returns; this task only makes it importable.
- Produces: `import.meta.main` guard around the existing `Bun.serve` block — behavior when run as `bun scripts/demo.ts` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/tako-ui.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { renderPage } from "../scripts/demo.ts";

test("renderPage returns the full HTML document without starting a server", () => {
  const html = renderPage();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<\/html>/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — `renderPage` is not exported (or the import hangs/binds a port if `Bun.serve` isn't guarded yet — if it hangs, kill it with Ctrl-C; that confirms exactly the problem this task fixes).

- [ ] **Step 3: Guard the server start and export `renderPage`**

In `scripts/demo.ts`, find:

```ts
Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 240,
  async fetch(req) {
```

Change the declaration so the whole block is a named function, guarded, and `PAGE`'s access is wrapped:

```ts
export function renderPage(): string {
  return PAGE;
}

if (import.meta.main) {
  Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    idleTimeout: 240,
    async fetch(req) {
```

Then find the closing of that block:

```ts
      return new Response("not found", { status: 404 });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
});

console.log(`\n  tako demo  →  http://localhost:${PORT}`);
console.log(`  model: ${MODEL}   ·   default source: ${DEFAULT_SOURCE}   ·   GBRAIN_HOME=${gbrainHome()}`);
console.log(`  local only — retrieval and synthesis both run on Ollama, nothing leaves this machine\n`);
```

Change to close the `if` block:

```ts
      return new Response("not found", { status: 404 });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
  });

  console.log(`\n  tako demo  →  http://localhost:${PORT}`);
  console.log(`  model: ${MODEL}   ·   default source: ${DEFAULT_SOURCE}   ·   GBRAIN_HOME=${gbrainHome()}`);
  console.log(`  local only — retrieval and synthesis both run on Ollama, nothing leaves this machine\n`);
}
```

Leave the "Pre-warm the blocking reads" line and anything after it alone unless it also assumes the server started — check the next 5 lines after this block and move them inside the `if (import.meta.main)` block too if they call `overviewCached()`-style warmers meant only for a running server.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS, and the process exits on its own (no hanging server).

- [ ] **Step 5: Confirm `bun scripts/demo.ts` still works unchanged**

Run: `PORT=4402 bun scripts/demo.ts` — expect the same three startup log lines as before, server reachable at `http://localhost:4402`. Stop it (Ctrl-C) once confirmed.

- [ ] **Step 6: Add the new test file to `npm test` and run the full suite**

In `package.json`, find the `"test"` script's file list and add `tests/tako-ui.test.ts` to it (anywhere in the list — order doesn't matter to the runner).

Run: `npm test`
Expected: all existing tests plus the new one pass (154 total, up from 153).

- [ ] **Step 7: Commit**

```bash
git add scripts/demo.ts package.json tests/tako-ui.test.ts
git commit -m "Guard demo.ts server start so it can be safely imported in tests"
```

---

## Task 2: Design tokens module

**Files:**
- Create: `scripts/tako/tokens.ts`
- Modify: `scripts/demo.ts` (the `<style>` block's `:root` color declarations)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: nothing new (pure module).
- Produces: `export const TAKO_COLORS: Record<string, string>` (role name → hex) and `export const TAKO_CSS_TOKENS: string` (a `:root { --tako-... }` CSS block built from `TAKO_COLORS`) — later tasks' CSS should reference `var(--tako-canvas)` etc., never a bare hex, so a future palette change has one place to happen.

- [ ] **Step 1: Write the failing test**

Add to `tests/tako-ui.test.ts`:

```ts
import { TAKO_COLORS, TAKO_CSS_TOKENS } from "../scripts/tako/tokens.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — module `scripts/tako/tokens.ts` does not exist.

- [ ] **Step 3: Write the tokens module**

Create `scripts/tako/tokens.ts`:

```ts
/** Design tokens for tako. Every screen references these by CSS variable —
 * never a bare hex — so the palette has exactly one source of truth. */

export const TAKO_COLORS = {
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
} as const;

export const TAKO_TYPE_SCALE = {
  hero: "44px",       // 44-52px range; served value picked at the low end for
                       // operational screens per "no 60-90px headings" rule.
  pageTitle: "32px",  // 30-36px
  sectionTitle: "22px", // 20-24px
  body: "16px",       // 15-17px
  supporting: "13.5px", // 13-14px
  label: "12.5px",    // 12-13px
} as const;

export const TAKO_SPACING_UNIT = 8; // 8-point spacing system

export const TAKO_RADIUS = {
  card: "14px", // 12-16px range
} as const;

export const TAKO_MOTION = {
  feedbackMs: 160,   // 120-200ms
  panelMs: 220,      // 180-280ms
  mascotMs: 360,     // 280-500ms
  ambientMaxMs: 800,
} as const;

const cssVarName = (key: string) =>
  "--tako-" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

export const TAKO_CSS_TOKENS = `:root {
  --tako-font: Inter, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
${Object.entries(TAKO_COLORS).map(([k, v]) => `  ${cssVarName(k)}: ${v};`).join("\n")}
  --tako-radius-card: ${TAKO_RADIUS.card};
  --tako-space-1: ${TAKO_SPACING_UNIT}px;
  --tako-space-2: ${TAKO_SPACING_UNIT * 2}px;
  --tako-space-3: ${TAKO_SPACING_UNIT * 3}px;
  --tako-space-4: ${TAKO_SPACING_UNIT * 4}px;
  --tako-space-6: ${TAKO_SPACING_UNIT * 6}px;
  --tako-hero: ${TAKO_TYPE_SCALE.hero};
  --tako-page-title: ${TAKO_TYPE_SCALE.pageTitle};
  --tako-section-title: ${TAKO_TYPE_SCALE.sectionTitle};
  --tako-body: ${TAKO_TYPE_SCALE.body};
  --tako-supporting: ${TAKO_TYPE_SCALE.supporting};
  --tako-label: ${TAKO_TYPE_SCALE.label};
  --tako-feedback-ms: ${TAKO_MOTION.feedbackMs}ms;
  --tako-panel-ms: ${TAKO_MOTION.panelMs}ms;
  --tako-mascot-ms: ${TAKO_MOTION.mascotMs}ms;
}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tokens into `demo.ts`'s served CSS**

In `scripts/demo.ts`, find the top of the `<style>` block (search for the first `:root{` or the file's existing color-variable declarations near the start of the CSS). Import the tokens and splice them in:

```ts
import { TAKO_CSS_TOKENS } from "./tako/tokens.ts";
```

Replace the existing hardcoded `:root{...}` color block with:

```ts
const PAGE = /* html */ `<!doctype html>...
<style>
${TAKO_CSS_TOKENS}
/* existing non-color CSS continues below, unchanged for this task */
...
```

Do not yet change any rule that *uses* a color — this task only replaces the token declarations. A later per-screen task updates each rule to reference `var(--tako-...)` instead of the old hardcoded hex as that screen is rewritten; leaving old hex references in not-yet-rewritten screens temporarily is expected and fine.

- [ ] **Step 6: Add the shared component stylesheet**

Every screen task from Task 4 onward introduces markup using the class names below. Define all of them now, in one place, so no later task invents styling ad hoc or leaves a class undefined. Add this block directly after `${TAKO_CSS_TOKENS}` in the `<style>` section:

```css
h1 { font-size: var(--tako-page-title); font-weight: 700; margin: 0 0 4px; color: var(--tako-text); }
h2 { font-size: var(--tako-section-title); font-weight: 600; margin: 0 0 12px; color: var(--tako-text); }
.tako-supporting { font-size: var(--tako-supporting); color: var(--tako-text-secondary); margin: 0 0 var(--tako-space-3); }
body { font-family: var(--tako-font); font-size: var(--tako-body); color: var(--tako-text); background: var(--tako-canvas); }

/* Sidebar nav */
.tako-app-shell { display: flex; min-height: 100vh; }
.tako-sidebar { width: 240px; flex: 0 0 240px; background: var(--tako-surface); border-right: 1px solid var(--tako-border); padding: var(--tako-space-4) var(--tako-space-3); }
.tako-wordmark { font-size: 22px; font-weight: 700; color: var(--tako-text); margin-bottom: var(--tako-space-4); }
.tako-nav-group { margin-bottom: var(--tako-space-4); }
.tako-nav-group-label { font-size: var(--tako-label); text-transform: uppercase; letter-spacing: 0.06em; color: var(--tako-text-secondary); padding: 0 var(--tako-space-2); margin-bottom: var(--tako-space-1); }
.tako-nav-item { display: block; width: 100%; text-align: left; background: none; border: none; border-radius: 8px; padding: var(--tako-space-2); font-size: var(--tako-body); color: var(--tako-text); cursor: pointer; }
.tako-nav-item:hover { background: var(--tako-canvas); }
.tako-nav-item[aria-current="true"] { background: var(--tako-selected); font-weight: 600; }
.tako-nav-footer { margin-top: auto; padding-top: var(--tako-space-4); border-top: 1px solid var(--tako-border); }
.tako-main { flex: 1; padding: var(--tako-space-6); max-width: 1200px; }

/* Screen shell — visibility toggling (.section{display:none} and
   .section[data-active]{display:block}) already exists in demo.ts at
   lines 789-790; do not redefine it here, only add what's missing: */
.tako-screen-head { margin-bottom: var(--tako-space-4); }
.tako-actions { display: flex; gap: var(--tako-space-2); margin-top: var(--tako-space-3); }

/* Buttons */
.tako-btn { font-size: var(--tako-body); font-weight: 600; padding: 10px 18px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.tako-btn--primary { background: var(--tako-primary); color: var(--tako-surface); }
.tako-btn--primary:hover { background: #1f4f40; }
.tako-btn--secondary { background: var(--tako-surface); color: var(--tako-text); border-color: var(--tako-border); }
.tako-btn--secondary:hover { background: var(--tako-canvas); }

/* Cards, generically reused by stats, app tiles, list rows */
.tako-card { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }

/* Home */
.tako-stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--tako-space-3); margin: var(--tako-space-4) 0; }
.tako-stat { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }
.tako-stat-value { display: block; font-size: var(--tako-hero); font-weight: 700; }
.tako-stat-label { display: block; font-size: var(--tako-supporting); color: var(--tako-text-secondary); }
.tako-home-composition { display: flex; align-items: center; gap: var(--tako-space-4); background: var(--tako-surface); border-radius: var(--tako-radius-card); padding: var(--tako-space-4); margin-bottom: var(--tako-space-4); }
.tako-app-tiles { display: flex; gap: var(--tako-space-2); }
.tako-app-tile { background: var(--tako-canvas); border: 1px solid var(--tako-border); border-radius: 10px; padding: var(--tako-space-2) var(--tako-space-3); font-size: var(--tako-supporting); }
.tako-home-lists { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tako-space-4); }
.tako-home-lists ul { list-style: none; margin: 0; padding: 0; }

/* Automations */
.tako-automation-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-automation-list li { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-3); }
.tako-automation-builder { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: var(--tako-radius-card); padding: var(--tako-space-4); display: flex; flex-direction: column; gap: var(--tako-space-3); }
.tako-builder-step { display: flex; align-items: center; gap: var(--tako-space-2); }
.tako-builder-label { font-size: var(--tako-label); color: var(--tako-text-secondary); min-width: 140px; }

/* Connected Apps */
.tako-advanced { margin-top: var(--tako-space-3); border-top: 1px solid var(--tako-border); padding-top: var(--tako-space-3); }
.tako-advanced summary { cursor: pointer; font-size: var(--tako-supporting); color: var(--tako-text-secondary); }

/* Tasks */
.tako-filter-row { display: flex; gap: var(--tako-space-2); margin-bottom: var(--tako-space-3); }
.tako-filter { background: var(--tako-surface); border: 1px solid var(--tako-border); border-radius: 999px; padding: 6px 14px; font-size: var(--tako-supporting); cursor: pointer; }
.tako-filter[aria-pressed="true"] { background: var(--tako-selected); border-color: var(--tako-primary); }

/* Activity */
.tako-activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--tako-space-2); }
.tako-badge { display: inline-block; font-size: var(--tako-label); font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.tako-badge--success { background: var(--tako-selected); color: var(--tako-primary); }
.tako-badge--warning { background: var(--tako-cream); color: #7A5A2A; }
.tako-badge--error { background: #F4E1DF; color: var(--tako-error); }

/* Approvals */
.tako-approval-actions { display: flex; gap: var(--tako-space-2); margin-top: var(--tako-space-3); }

/* Team & Permissions */
.tako-panel { position: fixed; top: 0; right: 0; height: 100%; width: 360px; background: var(--tako-surface); border-left: 1px solid var(--tako-border); padding: var(--tako-space-4); overflow-y: auto; }

/* Empty states */
.tako-empty { text-align: center; padding: var(--tako-space-6) var(--tako-space-4); }
.tako-empty p:first-child { font-weight: 600; margin-bottom: 4px; }

/* Mascot */
.tako-mark { vertical-align: middle; }
.tako-scene { width: 140px; flex: 0 0 140px; }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass. Visually confirm nothing broke by loading the page (see Task 1's manual check) — colors may look identical or slightly different where old hex values differed from the new tokens; that's expected and will be resolved screen-by-screen.

- [ ] **Step 8: Commit**

```bash
git add scripts/tako/tokens.ts scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add tako design tokens and shared component stylesheet"
```

---

## Task 3: Mascot module

**Files:**
- Create: `scripts/tako/mascot.ts`
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `TAKO_COLORS` from `scripts/tako/tokens.ts` (Task 2).
- Produces: `export type MascotState = "resting" | "connecting" | "pointing" | "settled"`; `export function mascotMark(size?: "small" | "large"): string` (the static wordmark-adjacent icon, no state); `export function mascotScene(state: MascotState): string` (the fuller illustrated mascot for a specific approved behavior); `export const MASCOT_PLACEMENT: { prominent: string[]; sparing: string[]; never: string[] }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/tako-ui.test.ts`:

```ts
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
```

Note: the third test's exact call signature depends on how you choose to enforce this — see Step 3's guidance below; adjust the test to match the guard you actually implement, but do not delete the intent (a mascot call must be impossible to place on a "never" screen without an explicit, visible override).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the mascot module**

Create `scripts/tako/mascot.ts`:

```ts
import { TAKO_COLORS } from "./tokens.ts";

export type MascotState = "resting" | "connecting" | "pointing" | "settled";

/** Where the full mascot may appear, per the spec's placement rules. Screen
 * ids here are the same ids used in demo.ts's nav/section data — keep them
 * in sync when a screen is renamed. */
export const MASCOT_PLACEMENT = {
  prominent: ["onboarding", "home-empty", "connect-setup", "automation-templates", "success-recovery"],
  sparing: ["ask", "tasks", "activity"],
  never: ["approvals", "permissions"],
} as const;

type PlacementScreen =
  | typeof MASCOT_PLACEMENT.prominent[number]
  | typeof MASCOT_PLACEMENT.sparing[number];

/** The eight-armed body, exactly as specified: amber body, cream underside
 * detail, two charcoal eyes, small ear fins, teal integration nodes. Do not
 * change arm count, arm length, fin size, or add suction-cup detail. */
function bodySvg(): string {
  const arm = (rotation: number) => `
    <path class="tako-arm" transform="rotate(${rotation} 60 70)"
      d="M60 70 q-6 14 -2 22 q4 6 10 2 q4-8 2-20 z"
      fill="${TAKO_COLORS.amber}" stroke="${TAKO_COLORS.cream}" stroke-width="1.5" />`;
  const arms = [-70, -50, -25, -8, 8, 25, 50, 70].map(arm).join("");
  return `
  <svg viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="tako">
    ${arms}
    <ellipse cx="60" cy="55" rx="34" ry="30" fill="${TAKO_COLORS.amber}" />
    <ellipse cx="60" cy="60" rx="24" ry="18" fill="${TAKO_COLORS.cream}" opacity="0.5" />
    <path d="M32 40 q-6-10 2-14 q8-2 8 8 z" fill="${TAKO_COLORS.cream}" />
    <path d="M88 40 q6-10 -2-14 q-8-2 -8 8 z" fill="${TAKO_COLORS.cream}" />
    <circle cx="48" cy="52" r="4" fill="#3A3A38" />
    <circle cx="72" cy="52" r="4" fill="#3A3A38" />
  </svg>`;
}

/** The compact mark used beside sensitive/restrained screens — no body, no
 * expression, just enough shape to be recognizable as tako's icon. */
export function mascotMark(size: "small" | "large" = "large"): string {
  const px = size === "small" ? 20 : 32;
  return `<span class="tako-mark" style="display:inline-block;width:${px}px;height:${px}px" aria-hidden="true">${bodySvg()}</span>`;
}

/** A node it connects to, for the "connecting two apps" and similar approved
 * behaviors. Teal per the spec's "teal integration nodes." */
function nodeSvg(x: number, y: number): string {
  return `<circle cx="${x}" cy="${y}" r="7" fill="${TAKO_COLORS.info}" opacity="0.85" />`;
}

/**
 * The full illustrated mascot in one of its approved behavior states.
 * Throws if asked to render on a screen in MASCOT_PLACEMENT.never — this is
 * a structural guard, not just a convention, per the spec's explicit rule
 * that the mascot must never appear beside sensitive/approval content.
 */
export function mascotScene(state: MascotState, screen?: PlacementScreen | (typeof MASCOT_PLACEMENT.never)[number]): string {
  if (screen && (MASCOT_PLACEMENT.never as readonly string[]).includes(screen)) {
    throw new Error(`tako must not appear on "${screen}" — use mascotMark() or nothing there instead`);
  }
  const connectingNodes = state === "connecting" ? nodeSvg(20, 30) + nodeSvg(100, 30) : "";
  return `<div class="tako-scene tako-scene--${state}" aria-hidden="true">${connectingNodes}${bodySvg()}</div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS. If the arm-count test fails, count the `arm(...)` calls in the `arms` array — there must be exactly 8 rotation values.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expect all green.

```bash
git add scripts/tako/mascot.ts tests/tako-ui.test.ts
git commit -m "Add tako mascot module with structurally-enforced placement rules"
```

---

## Task 4: Sidebar navigation (IA restructure)

Replaces the current 8-item horizontal top nav (`ホーム・概要・接続・質問・スキル・作業メモリ・レビュー・アクセス`) with the grouped sidebar from the spec. This is the first task that changes what a user sees in the main chrome on every screen — do it once, correctly, before touching individual screen content.

**Files:**
- Modify: `scripts/demo.ts` (the nav HTML/CSS near the top of `PAGE`, and the client-side JS that switches visible sections)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `TAKO_CSS_TOKENS` (Task 2).
- Produces: an exported nav structure so tests (and later tasks) can check it without parsing HTML: `export const NAV_GROUPS: { group: string; items: { id: string; label: string }[] }[]` in `scripts/demo.ts`, matching the spec exactly.

- [ ] **Step 1: Write the failing test**

Add to `tests/tako-ui.test.ts`:

```ts
import { NAV_GROUPS, renderPage } from "../scripts/demo.ts";

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
  for (const forbidden of ["iPaaS", "MCP", "frontmatter", "source slug", "rollup"]) {
    assert.doesNotMatch(html, new RegExp(forbidden, "i"), `found forbidden term: ${forbidden}`);
  }
});

test("Overview is not a separate nav destination", () => {
  const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!ids.includes("overview"), "Overview must be merged into Home, not its own nav item");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — `NAV_GROUPS` is not exported yet, and the jargon test likely fails against the current page (it says "INTENT-MERIT REVIEW" today, which is fine to still fail at this point — that gets fixed in Task 10).

- [ ] **Step 3: Add `NAV_GROUPS` and replace the nav markup**

In `scripts/demo.ts`, near the top (with the other exported constants), add:

```ts
export const NAV_GROUPS = [
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
] as const;

function renderSidebarNav(): string {
  const groups = NAV_GROUPS.map((g) => `
    <div class="tako-nav-group">
      <div class="tako-nav-group-label">${g.group}</div>
      ${g.items.map((item) => `<button class="tako-nav-item" data-name="${item.id}">${item.label}</button>`).join("")}
    </div>`).join("");
  return `
  <nav class="tako-sidebar" aria-label="Main">
    <div class="tako-wordmark">tako</div>
    ${groups}
    <div class="tako-nav-footer">
      <button class="tako-nav-item" data-name="settings">Settings</button>
      <button class="tako-nav-item" data-name="help">Help</button>
    </div>
  </nav>`;
}
```

Replace the file's existing top-nav HTML (search for the current `<nav` element rendering `ホーム`, `概要`, etc.) with a call to `renderSidebarNav()`. Replace the surrounding layout CSS so the page uses a left-sidebar + main-content-area layout (`display:flex` on the outer wrapper, `.tako-sidebar{width:240px}`, `.tako-main{flex:1}`) instead of the current top-bar layout. Use `var(--tako-...)` tokens for every color in this new CSS — do not introduce a new hardcoded hex.

The existing toggle mechanism does not change — reuse it exactly:

```ts
$$('.section').forEach(s => s.dataset.name === name
  ? s.setAttribute('data-active', '')
  : s.removeAttribute('data-active'));
```

(This function already exists around `scripts/demo.ts:1475` — find it and confirm this is its current body before wiring anything to it, in case it has evolved since this plan was written.) Wire each `.tako-nav-item` button's click handler to call this existing function with the new `name` values (`home`, `ask`, `automations`, `connect`, `tasks`, `activity`, `approvals`, `permissions`) instead of the old ones (`overview`, `skills`, `memory`, `review`, `access`). Update every existing `<section class="section" data-name="...">` wrapper's `data-name` value to match the new id — do not rename the `section` class or the `data-name` attribute itself, only the id values they carry.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: `NAV_GROUPS` and "Overview is not a separate nav destination" pass. The jargon test may still fail until later tasks remove "INTENT-MERIT REVIEW" and similar strings — note which strings still fail and confirm they're addressed by name in Tasks 5-11 below; do not suppress the test.

- [ ] **Step 5: Manual visual check**

Start the server on an unused port and load it:

```bash
PORT=4403 bun scripts/demo.ts
```

Open `http://localhost:4403`. Confirm: sidebar renders on the left with three grouped sections and the `tako` wordmark at top; clicking each nav item switches the visible content area (content itself is still the old screens at this point — that's expected, only the nav shell changed). Stop the server (Ctrl-C) once confirmed.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test` — expect all tests green except the still-expected jargon-string failures tracked above.

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Replace top nav with grouped sidebar per tako information architecture"
```

---

## Task 5: Home screen

**Files:**
- Modify: `scripts/demo.ts` (the `home`/former-root section's markup, and the former `概要`/Overview content — merge it in here per the spec, do not leave Overview as reachable content anywhere)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS` (Task 4), `mascotScene` (Task 3), the existing `overviewCached()` / `overview()` function (already in `demo.ts`) for the four status numbers.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/tako-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — current Home copy is 「何を調べますか？」 / "What do you need to find out?", not "Work, connected."

- [ ] **Step 3: Rewrite the Home section**

Find the `home` section's markup in `scripts/demo.ts` (currently the first/default visible section) and replace its content with:

```html
<section class="section" data-name="home">
  <header class="tako-screen-head">
    <h1>Work, connected.</h1>
    <p class="tako-supporting">Tako handles the handoffs between your team's tools.</p>
    <div class="tako-actions">
      <button class="tako-btn tako-btn--primary" data-action="create-automation">Create automation</button>
      <button class="tako-btn tako-btn--secondary" data-action="open-ask">Ask Tako</button>
    </div>
  </header>

  <div class="tako-stat-row">
    <div class="tako-stat"><span class="tako-stat-value" id="home-stat-active">–</span><span class="tako-stat-label">Active automations</span></div>
    <div class="tako-stat"><span class="tako-stat-value" id="home-stat-connected">–</span><span class="tako-stat-label">Connected apps</span></div>
    <div class="tako-stat"><span class="tako-stat-value" id="home-stat-completed">–</span><span class="tako-stat-label">Completed today</span></div>
    <div class="tako-stat"><span class="tako-stat-value" id="home-stat-approval">–</span><span class="tako-stat-label">Needs approval</span></div>
  </div>

  <div class="tako-home-composition">
    ${mascotScene("connecting", "home-empty")}
    <div class="tako-app-tiles" aria-hidden="true">
      <div class="tako-app-tile">Drive</div>
      <div class="tako-app-tile">Slack</div>
      <div class="tako-app-tile">Notion</div>
    </div>
  </div>

  <div class="tako-home-lists">
    <div>
      <h2>Recent activity</h2>
      <ul id="home-recent-activity"></ul>
    </div>
    <div>
      <h2>Needs attention</h2>
      <ul id="home-needs-attention"></ul>
    </div>
  </div>
</section>
```

Add `mascotScene` to the file's imports:

```ts
import { mascotScene, mascotMark } from "./tako/mascot.ts";
```

Wire the four stat spans and the two lists to real data on page load using the existing `/api/overview` endpoint and `overview()` function already in this file — locate the client-side JS that currently populates the old Overview screen's numbers and repoint it at `#home-stat-active`, `#home-stat-connected`, `#home-stat-completed`, `#home-stat-approval`, `#home-recent-activity`, `#home-needs-attention` using the same fetched data shape. If the current `overview()` function doesn't yet distinguish "needs approval" as its own count, add that field to its return value using data already available from `reviewsView()` (already in this file) rather than inventing a new data source.

Remove the old standalone Overview section's markup entirely (search for `data-name="overview"` or the former `概要` section) — its content is now inside Home; there must be no remaining way to navigate to a separate Overview screen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check**

`PORT=4403 bun scripts/demo.ts`, open Home. Confirm the four stat tiles show real numbers (not "–"), the mascot renders connecting to three app tiles, and both list sections populate. Stop the server.

- [ ] **Step 6: Run the full suite and commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Home: work-connected headline, four stats, merged Overview content"
```

---

## Task 6: Automations screen (with builder)

Renames and redesigns the current Skills screen. This is called out in the spec as the primary product screen — give it the most care.

**Files:**
- Modify: `scripts/demo.ts` (the `スキル`/Skills section, using the existing `skillsView()` function as the data source)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: existing `skillsView()` (already in `demo.ts`), `NAV_GROUPS` id `"automations"`, `mascotScene` (Task 3) — this task is the spec's "automation-templates" mascot placement moment.
- Produces: nothing new consumed elsewhere.

Add to the file's imports (if not already present from an earlier task):

```ts
import { mascotScene, mascotMark } from "./tako/mascot.ts";
```

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — current section says "スキル" and technical receipt language.

- [ ] **Step 3: Rewrite the Automations section**

Replace the Skills section's markup (its `data-name` value updated to `"automations"` per Task 4's nav wiring) with a list view driven by `skillsView()`'s existing `skills` array:

```html
<section class="section" data-name="automations">
  <header class="tako-screen-head">
    <h1>Automations</h1>
    <button class="tako-btn tako-btn--primary" data-action="new-automation">New automation</button>
  </header>
  <ul class="tako-automation-list" id="automation-list"></ul>
</section>
```

In the client-side JS, render each item from `skillsView().skills` as one card. Each card must show, per the spec: trigger, actions, connected apps, status, last run, owner, approval requirement — map these from whatever fields `skillsView()` already returns (its existing shape has purpose/reads/state per the codebase's SkillView type; if a required field like "last run" or "owner" isn't in the current shape, add it to `skillsView()`'s return object in `demo.ts`, sourcing it from data already read by that function — do not fabricate a value with no backing data). Render the trigger/action as a plain sentence, e.g.:

```ts
const sentenceFor = (skill: SkillView) => `When ${skill.trigger}, ${skill.actionSummary}.`;
```

(Add `trigger` and `actionSummary` fields to `skillsView()`'s per-skill object if they don't exist yet, derived from the skill's existing declared `reads`/purpose data — keep the derivation simple and honest: if the underlying skill file doesn't state a trigger, render "Manual" rather than inventing one.)

"New automation" must show templates first, not a blank builder (per the spec: "Do not begin with a blank technical canvas"). This is also the spec's "automation-templates" mascot moment — one of only five places the mascot is marked prominent — so render it here explicitly:

```html
<div class="tako-automation-templates" id="automation-templates" hidden>
  <h2>Start from a template</h2>
  ${mascotScene("resting", "automation-templates")}
  <ul class="tako-template-list" id="template-list"></ul>
  <button class="tako-btn tako-btn--secondary" data-action="start-from-scratch">Start from scratch</button>
</div>

<div class="tako-automation-builder" id="automation-builder" hidden>
  <h2>New automation</h2>
  <div class="tako-builder-step"><span class="tako-builder-label">When this happens</span><select id="ab-trigger"></select></div>
  <div class="tako-builder-step"><span class="tako-builder-label">Do this</span><select id="ab-action-1"></select></div>
  <div class="tako-builder-step"><span class="tako-builder-label">Then this</span><select id="ab-action-2"></select></div>
  <button class="tako-btn tako-btn--secondary" data-action="back-to-templates">Choose a template instead</button>
</div>
```

Populate `#template-list` with a small fixed set of common patterns (e.g. "Summarize new Drive files to Slack," "Notify on a new Notion page") — plain `<li>` entries with a "Use this" button each; clicking one pre-fills the builder's three selects and reveals `#automation-builder`. "New automation" shows `#automation-templates` first; "Start from scratch" hides it and reveals `#automation-builder` directly; "Choose a template instead" (inside the builder) reverses that.

Wire "New automation" to show templates/guided creation first (per the spec: "Do not begin with a blank technical canvas"), not this bare builder directly — a simple approach: show a small template list first, and only reveal `#automation-builder` when the user picks "Start from scratch" within that template list.

Rename any visible "per-step receipt" language to "Run details" — search the file for that exact string and replace it in both the Automations list and wherever execution history is shown for a given automation.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check**

Load the page, open Automations. Confirm existing skills render as plain-language sentences with all seven required fields, and "New automation" leads to a template choice before any builder UI. Stop the server.

- [ ] **Step 6: Run the full suite and commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Automations: plain-language list, template-first builder"
```

---

## Task 7: Connected Apps screen

**Files:**
- Modify: `scripts/demo.ts` (the `接続`/Connect section, using the existing `connectorsView()` and `saveConnector()` functions)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: existing `connectorsView()`, `saveConnector()` (both already in `demo.ts`), `NAV_GROUPS` id `"connect"`, `mascotScene` (Task 3).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Connected Apps does not ask an ordinary user for a token directly on the main grid", () => {
  const html = renderPage();
  const connectSection = html.split('data-name="connect"')[1]?.split("</section>")[0] || "";
  // Token inputs must live behind an explicit "Advanced" disclosure, not be
  // the first thing visible on the card grid.
  assert.match(connectSection, /Advanced/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — the current Connect screen shows the token field immediately on card click, with no Advanced gate.

- [ ] **Step 3: Rewrite the Connected Apps section**

Keep the existing card grid and `connectorsView()` data source. Change the per-card interaction: clicking a card shows a simple summary panel (app name, connection status, account/workspace, access level, last synchronized, a "Manage" button) instead of immediately exposing the token field. Move the actual token/folder-ID/subdir inputs (the fields `saveConnector()` already handles) behind a collapsed `<details>` labeled "Advanced":

```html
<details class="tako-advanced">
  <summary>Advanced</summary>
  <!-- existing token/folder-id/subdir fields and Save/Test buttons move here, unchanged -->
</details>
```

Do not change `saveConnector()`'s behavior or its API contract — this task only changes when its inputs become visible, not what they do or how they're stored (the plaintext-storage issue is explicitly out of scope for this plan).

Add a small `mascotScene("connecting", "connect-setup")` shown briefly after a successful save/test (per the spec: "A small Tako animation may connect the selected application to the workspace after successful setup") — trigger it in the existing save-success JS branch, not on every page load.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check**

Load the page, open Connected Apps, click a configured card — confirm the summary shows first and the token field is hidden behind "Advanced." Save a test value in Advanced and confirm the existing save/test flow still works exactly as before (this must not regress — it's the same code path proven working earlier this session).

- [ ] **Step 6: Run the full suite and commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Connected Apps: summary-first cards, tokens behind Advanced"
```

---

## Task 8: Ask Tako screen

**Files:**
- Modify: `scripts/demo.ts` (the `質問`/Ask section)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: the existing `/api/ask` endpoint and its handler (already in `demo.ts`), `NAV_GROUPS` id `"ask"`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Ask Tako hides the model name from the main view", () => {
  const html = renderPage();
  const askSection = html.split('data-name="ask"')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(askSection, /qwen/i, "model name must not appear on the main Ask screen");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL if the current section renders `MODEL` anywhere visibly (check first; if it already doesn't, this test passes immediately and you can skip to confirming the rest of the screen's copy instead — do not delete the test, note in the commit message if it passed on first write).

- [ ] **Step 3: Update the Ask section**

Update the page title/supporting copy to:

```html
<header class="tako-screen-head">
  <h1>Ask Tako</h1>
  <p class="tako-supporting">Find answers across your connected apps.</p>
</header>
```

Confirm (and fix if not already true) that the question field, a search-location selector, suggested questions, the answer, its sources, related documents, and next actions all remain — this task is a copy/chrome update, not a removal of existing functional pieces. Ensure no model-name string (`MODEL`, `qwen2.5:3b-instruct`, etc.) renders in the main answer view; if the current code interpolates it into visible text, move that interpolation behind an admin-only "Details" disclosure instead of deleting the information entirely.

Do not add any mascot animation while an answer is being read (per the spec) — if `mascotScene`/`mascotMark` is used here at all, it should be static and only shown before a question is asked (matching the "sparing" placement rule from `MASCOT_PLACEMENT.sparing` including `"ask"`), never animating during or after the answer renders.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

Confirm the existing ask-a-question flow still works end to end (type a question, get a cited answer) — this is the same `/api/ask` code path, unchanged.

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Update Ask Tako copy and hide model name from the main view"
```

---

## Task 9: Tasks screen

Renames and redesigns the current Working Memory screen.

**Files:**
- Modify: `scripts/demo.ts` (the `作業メモリ`/Working Memory section, using the existing `tasksView()` function)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: existing `tasksView()` (already in `demo.ts`), `NAV_GROUPS` id `"tasks"`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Tasks uses plain-language filters and never calls content noise", () => {
  const html = renderPage();
  const tasksSection = html.split('data-name="tasks"')[1]?.split("</section>")[0] || "";
  for (const label of ["Needs attention", "Active", "Ready to archive", "Excluded"]) {
    assert.match(tasksSection, new RegExp(label));
  }
  assert.doesNotMatch(html, /\bnoise\b/i);
  assert.doesNotMatch(html, /\bidle \d+d\b/i);
  assert.doesNotMatch(html, /\brollup\b/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — current filters are hot/warm/cold/noise-derived language, per the codebase's `triage` naming.

- [ ] **Step 3: Rewrite the Tasks section**

Replace the four filter labels with the spec's plain-language set, mapped from the existing `tasksView()` triage tiers (hot→"Needs attention", warm→"Active", cold→"Ready to archive", noise→"Excluded"):

```html
<div class="tako-filter-row">
  <button class="tako-filter" data-filter="needs-attention">Needs attention</button>
  <button class="tako-filter" data-filter="active">Active</button>
  <button class="tako-filter" data-filter="ready-to-archive">Ready to archive</button>
  <button class="tako-filter" data-filter="excluded">Excluded</button>
</div>
```

In the client-side JS mapping filter clicks to `tasksView()`'s tiers, map `"needs-attention"→"hot"`, `"active"→"warm"`, `"ready-to-archive"→"cold"`, `"excluded"→"noise"` — the underlying `tasksView()` function and its tier names in `demo.ts` do not need to change; only the UI-facing labels and copy do.

Each task card must show: task, owner, due date, status, source, and why it needs attention (from `tasksView()`'s existing per-task fields — add any missing field to that function's return object using data it already has access to, per the same rule as Task 6).

Replace any visible "idle 14d"-style string with "No activity for 14 days," and any "rollup" action label with "Summarize and archive." Search the section's markup and its supporting JS for these exact patterns and change them at the source (the underlying scoring/decay logic in `tasksView()` itself does not change — only the string shown to the user).

Move any scoring-formula or mention-count explanation behind a `<details>` labeled with a plain description (e.g. "Why this is grouped here"), not the raw field names.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

Confirm each filter still returns the correct set of tasks from the existing data, just under the new labels.

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Tasks: plain-language filters, no noise/idle/rollup copy"
```

---

## Task 10: Activity screen

**Files:**
- Modify: `scripts/demo.ts` (whatever section currently shows execution/run history — if there is no dedicated Activity section yet, this task creates one from data already available via the existing skill-run/receipt data used by Automations)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS` id `"activity"`, existing skill-run/receipt data already read elsewhere in `demo.ts`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Activity shows outcome-first entries with a retry action on failure", () => {
  const html = renderPage();
  const activitySection = html.split('data-name="activity"')[1]?.split("</section>")[0] || "";
  assert.match(activitySection, /Retry/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — no `data-name="activity"` exists yet.

- [ ] **Step 3: Build the Activity section**

```html
<section class="section" data-name="activity">
  <header class="tako-screen-head"><h1>Activity</h1></header>
  <ul class="tako-activity-list" id="activity-list"></ul>
</section>
```

Populate `#activity-list` from the same run-history data already read for Automations' "Run details" (Task 6) — do not create a second, parallel data source. Each entry shows: time, automation, apps involved, result, duration, initiator, approval state. Use a clear label (not color alone) for success/warning/failure — e.g. a text badge `<span class="tako-badge tako-badge--error">Failed</span>` alongside any color styling. A failed entry additionally shows what happened, what was affected, what the user can do, and a "Retry" button wired to re-invoke the same automation run path already used elsewhere in the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add Activity screen with outcome-first entries and retry on failure"
```

---

## Task 11: Approvals screen

Renames and redesigns Review Desk. The spec is explicit this screen stays visually restrained — no mascot here at all (it's on `MASCOT_PLACEMENT.never`).

**Files:**
- Modify: `scripts/demo.ts` (the `レビュー`/Review section, using the existing `reviewsView()` and `submitReview()` functions)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: existing `reviewsView()`, `submitReview()` (already in `demo.ts`), `NAV_GROUPS` id `"approvals"`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Approvals uses plain-language decision vocabulary, not academic terms", () => {
  const html = renderPage();
  const approvalsSection = html.split('data-name="approvals"')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(html, /INTENT-MERIT REVIEW/i);
  for (const action of ["Approve", "Request changes", "Reject", "Ask administrator"]) {
    assert.match(approvalsSection, new RegExp(action));
  }
  assert.match(approvalsSection, /Protect sensitive information/);
});

test("Approvals never renders the mascot", () => {
  const html = renderPage();
  const approvalsSection = html.split('data-name="approvals"')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(approvalsSection, /tako-scene|tako-mark/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — current section literally contains "INTENT-MERIT REVIEW."

- [ ] **Step 3: Rewrite the Approvals section**

Two-column layout: review queue on the left (from `reviewsView()`'s existing list), selected item detail on the right. Replace vocabulary throughout this section's rendering (search for and replace each): Intent→Purpose, Merit→Usefulness, Harm→Safety, Evidence→Sources, Policy→Company rules. Replace the four decision buttons with:

```html
<div class="tako-approval-actions">
  <button class="tako-btn tako-btn--primary" data-decision="approve">Approve</button>
  <button class="tako-btn tako-btn--secondary" data-decision="request-changes">Request changes</button>
  <button class="tako-btn tako-btn--secondary" data-decision="reject">Reject</button>
  <button class="tako-btn tako-btn--secondary" data-decision="ask-admin">Ask administrator</button>
</div>
```

Wire these to whatever decision-recording path `submitReview()`/the existing review-decision handler already uses — do not change the underlying data model or governance logic, only the four labels and which four actions are offered (if the current code has different decision states, map them 1:1 to these four rather than inventing new backend states).

Rename the masking feature's label to "Protect sensitive information," and move the masking *test* tool (the redact-preview textarea already in this file) into its own secondary area below or beside the queue — not above it, per the spec.

Do not call `mascotMark()` or `mascotScene()` anywhere in this section. Keep the visual treatment plain: no large illustration, no card shadows beyond the existing restrained default.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

Confirm an existing pending review still shows correctly and all four decision buttons still record a real decision via the existing backend path.

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Approvals: plain vocabulary, four decisions, no mascot"
```

---

## Task 12: Team & Permissions screen

Renames and redesigns Access. Also on `MASCOT_PLACEMENT.never`.

**Files:**
- Modify: `scripts/demo.ts` (the `アクセス`/Access section, using whatever existing scope/member data function is already in this file — check for `accessCached`/`skillsView`'s `scopes` field, already seen in this file's exports)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: existing access/scope data source already in `demo.ts` (`accessCached`), `NAV_GROUPS` id `"permissions"`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
test("Team & Permissions uses plain-language access vocabulary", () => {
  const html = renderPage();
  const permsSection = html.split('data-name="permissions"')[1]?.split("</section>")[0] || "";
  assert.match(permsSection, /Control what each person can access/);
  assert.doesNotMatch(permsSection, /\bScope\b/);
});

test("Team & Permissions never renders the mascot", () => {
  const html = renderPage();
  const permsSection = html.split('data-name="permissions"')[1]?.split("</section>")[0] || "";
  assert.doesNotMatch(permsSection, /tako-scene|tako-mark/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — current section is titled around "Access"/"scope" terminology.

- [ ] **Step 3: Rewrite the Team & Permissions section**

```html
<section class="section" data-name="permissions">
  <header class="tako-screen-head"><h1>Control what each person can access.</h1></header>
  <div id="permissions-members"></div>
</section>
```

Populate from the existing `accessCached` data (members, roles, connected content, access groups, recent permission changes, potential access problems — map from whatever fields that function already returns; add missing fields to it using data it already has access to, same rule as prior tasks). Apply the vocabulary swap throughout this section's rendering: Scope→Access group, Source→Connected content, Can read→Can access, Granted→Assigned. Detailed per-member permissions open in a side panel (`<aside class="tako-panel" hidden>`) rather than inline in the main list; keep any administrator-only actions (e.g. revoking a client) visually and structurally separated from the member list itself (a distinct "Administration" section below or beside it).

Do not call `mascotMark()` or `mascotScene()` anywhere in this section.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Redesign Team & Permissions: plain vocabulary, no mascot"
```

---

## Task 13: Loading, empty, and error states

Applies the spec's cross-cutting rules consistently now that all screens exist, rather than piecemeal per screen.

**Files:**
- Modify: `scripts/demo.ts` (client-side fetch/render logic for each screen built in Tasks 5-12)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `mascotScene` (Task 3) — this task is the spec's "success-recovery" mascot placement moment, the last of the five prominent placements not yet covered by an earlier task.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL — no empty-state markup exists yet for Automations.

- [ ] **Step 3: Add empty/loading/error states**

For each screen with a fetched or computed list (Home's two lists, Automations, Tasks, Activity, Approvals' queue): add a skeleton placeholder shown immediately on load (a simple pulsing gray block, using `var(--tako-border)`), replaced by real content or, if empty, a specific empty-state block naming what's missing and offering one action. For Automations specifically:

```html
<div class="tako-empty" id="automations-empty" hidden>
  <p>No automations yet</p>
  <p class="tako-supporting">Connect two apps to create your first automation.</p>
  <button class="tako-btn tako-btn--primary" data-action="new-automation">Create automation</button>
</div>
```

Show `#automations-empty` (and hide the list) when `skillsView().skills` is empty; otherwise the reverse. Apply the same immediate-skeleton → specific-status → retry-on-failure pattern to any screen whose data fetch can fail (wrap existing `fetch(...)` calls' `.catch` handlers to show a retry button rather than leaving a screen blank or stuck on "Loading…").

Add a brief success confirmation shown after a new automation is saved from the Task 6 builder — this is the spec's "success-recovery" mascot moment:

```html
<div class="tako-empty" id="automation-success" hidden>
  ${mascotScene("settled", "success-recovery")}
  <p>Automation created</p>
  <p class="tako-supporting">It will run the next time its trigger happens.</p>
</div>
```

Show `#automation-success` briefly (e.g. 2-3 seconds, well under the spec's 800ms-ambient-transition ceiling for the reveal itself, though the confirmation stays visible longer than that) after a successful save, then return to the automation list. Add `import { mascotScene } from "./tako/mascot.ts";` to the file's imports if Task 6 hasn't already added it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual visual check and commit**

Confirm no screen can be left showing "Loading…" indefinitely by simulating a slow/failed fetch (e.g. temporarily point one fetch URL at a wrong path, reload, confirm a retry button appears rather than a stuck spinner) — then revert the temporary change.

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add consistent loading, empty, and error states across screens"
```

---

## Task 14: Motion, accessibility, and final verification

**Files:**
- Modify: `scripts/demo.ts` (global CSS: transitions, focus states, reduced-motion query)
- Test: `tests/tako-ui.test.ts`

**Interfaces:**
- Consumes: `TAKO_MOTION` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
test("motion respects prefers-reduced-motion", () => {
  const html = renderPage();
  assert.match(html, /prefers-reduced-motion/);
});

test("interactive elements have a visible focus style", () => {
  const html = renderPage();
  assert.match(html, /:focus-visible/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: FAIL if neither pattern exists yet in the current CSS — confirm by checking, since some `:focus` styling may already exist under a different selector; if so, this step's real job is upgrading it to `:focus-visible` with sufficient contrast, not adding from nothing.

- [ ] **Step 3: Add motion and accessibility CSS**

Add near the top of the `<style>` block, after `TAKO_CSS_TOKENS`:

```css
.tako-nav-item, .tako-btn, .tako-filter, .tako-app-tile {
  transition: background-color var(--tako-feedback-ms) ease, transform var(--tako-feedback-ms) ease;
}
.tako-panel, .section { transition: opacity var(--tako-panel-ms) ease; }
.tako-scene { transition: transform var(--tako-mascot-ms) ease; }

:focus-visible {
  outline: 2px solid var(--tako-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Confirm every interactive element (buttons, nav items, links) is a real `<button>` or `<a>` (not a bare `<div onclick>`) so `:focus-visible` and keyboard activation work without extra ARIA — spot-check the nav, filters, and decision buttons added in earlier tasks; fix any that used a non-interactive element.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Full manual walkthrough**

`PORT=4403 bun scripts/demo.ts`. Using only the keyboard (Tab/Shift-Tab/Enter/Space), reach and activate: a nav item, "Create automation," a Connected Apps card's "Advanced" disclosure, an Approvals decision button. Confirm a visible focus ring appears at every stop. In the OS or browser's reduced-motion setting, confirm transitions become effectively instant. Stop the server.

- [ ] **Step 6: Run the complete test suite one final time**

Run: `npm test`
Expected: every test in the suite passes (the original 153 plus everything added in this plan).

- [ ] **Step 7: Final commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add motion timing tokens, reduced-motion support, and visible focus states"
```

- [ ] **Step 8: Sync main**

```bash
git checkout main
git merge --ff-only feat/brain-foundation
git push origin main
git checkout feat/brain-foundation
git push origin feat/brain-foundation
```

---

## Explicitly not covered by this plan

- The plaintext credential storage in `config/connectors.json` — a real, separately tracked issue, not touched here.
- `scripts/console.ts` (the internal operator/admin department view) and `scripts/ask.ts` (a standalone dev utility) — the spec describes the customer-facing demo only; these keep their existing, already-renamed-in-text, unredesigned appearance.
- The config-scaffolding "wizard" (paused, separate thread) — will need re-skinning to this system once built.
- Any change to `lib/connectors/`, `lib/govern/`, `packages/brain/`, `lib/eval/` — the functional engine.
