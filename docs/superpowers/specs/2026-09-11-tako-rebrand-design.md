# tako — Redesign Spec

Date: 2026-09-11
Status: Approved — the name rename (34 files) is executed; the visual/IA
redesign described below moves to an implementation plan next
Author: brief by the owner, organized and mapped to the codebase by Claude

## Scope

This redesigns the **existing desktop demo UI** — its navigation, screens,
copy, and visual system — as a new product identity, `tako`. It sits on top
of the same functional engine already built: connectors (`lib/connectors/`),
the governance gate (`lib/govern/`), the vendored knowledge-brain
(`packages/brain/`), and the evaluation harness (`lib/eval/`) are **unchanged**
by this spec. This is a rebrand + information-architecture + visual-system
pass on `scripts/demo.ts` and its supporting screens, not a rewrite of the
underlying platform.

**Named exception, not part of the design work but a stated prerequisite:**
`config/connectors.json` stores Notion/Slack/Drive/Discord tokens as literal
plain-text strings today — no encryption, no OS keychain integration. The
owner has explicitly said this must be resolved before the product is
described as production-ready for enterprise use, and that hiding or
soft-pedaling the warning is not acceptable. This is tracked here as a named,
separate backend security task — see "Open items" below.

## Product principle

> Complex work, calmly connected.

Design `tako` as a dependable professional tool with a warm personality — not
a playful toy, a technical console, or a generic AI dashboard. A person
without IT knowledge must understand what to do without knowing terms such as
iPaaS, API, MCP, token, frontmatter, runtime, source slug, or rollup.

## Design philosophy

- Content comes before decoration.
- One clear purpose per screen.
- One primary action per view.
- Familiar controls before creative metaphors.
- Progressive disclosure for advanced information.
- Animation must explain cause and effect.
- Whitespace should create hierarchy, not emptiness.
- The mascot should support the task, not compete with it.
- Security should feel understandable and reassuring.
- Every action should provide immediate feedback.
- Important actions should be reversible where possible.

Do not fill every empty area with a card, headline, illustration, or
decorative shape.

## Copy rules

Keep interface copy exceptionally concise.

- Headlines: approximately 2–6 words.
- Page titles: usually one or two words.
- Supporting copy: one short sentence.
- Avoid paragraphs above operational interfaces.
- Buttons use direct verbs: "Connect," "Create," "Approve," "Retry."
- Show one interface language at a time. Do not repeat complete Japanese and
  English translations on the same screen.
- Technical explanations go inside "Details" or administrator documentation.
- Explain outcomes instead of implementation.

**Use:** "Work, connected." · "Create automation" · "Connected apps" ·
"Ask Tako" · "Needs approval" · "Hide sensitive information" · "Ready to
archive"

**Avoid:** "All-in-one intelligent enterprise knowledge federation" ·
"Governed processing pathway" · "Intent–Merit Review" · "Read-only slice of
organizational knowledge" · "Per-step execution receipt" · "Working-memory
rollup candidate"

## Brand

- Product name displays as `tako`, lowercase, always.
- Wordmark: simple, compact, typographic. No elaborate logo lockup, no
  slogan beside it throughout the application.
- Positioning: "Work, connected."
- Supporting sentence: "Tako moves information between the tools your team
  already uses." Do not show this on every page.

## Mascot

Canonical mascot: the supplied amber dumbo-octopus image. Preserve exactly:

- Warm amber body, based on `#D49A55`
- Cream details, around `#F2D5A7`
- Small, understated ear fins
- Compact round body
- Two small charcoal eyes
- Exactly eight short, rounded arms
- Teal integration nodes
- Calm, friendly expression

Do not redesign its proportions, enlarge its fins, lengthen its arms, or add
detailed suction cups. The mascot represents one calm coordinator handling
several connections.

### Placement

**Prominent:** first-time onboarding · Home empty states · connection setup ·
automation templates · success and recovery moments.

**Sparing:** Ask · Tasks · Activity.

**Never beside:** sensitive company information · permission changes ·
high-risk warnings · approval decisions · legal or security explanations. On
these screens: the small Tako mark only, or no mascot.

### Behavior

**Approved:** pass a document between two apps · connect two abstract nodes ·
retrieve an automation template · point toward a recoverable problem · rest
quietly while work succeeds · settle when Focus Mode is enabled.

**Avoid:** waving, bouncing, celebrating routine actions, looking distressed,
demanding attention.

## Color system

| Token | Hex |
| --- | --- |
| Canvas | `#F3F5F1` |
| Primary surface | `#FFFFFF` |
| Main text | `#1E2925` |
| Secondary text | `#66716C` |
| Primary action | `#286653` |
| Selected state | `#DCEBE4` |
| Information | `#527E8A` |
| Tako amber | `#D49A55` |
| Tako cream | `#F2D5A7` |
| Error | `#B85D55` |
| Border | `#DDE2DE` |

Amber is for Tako and warm product moments — not every call-to-action.
Botanical green (`#286653`) for primary actions and healthy connections.
Muted blue (`#527E8A`) for neutral information. Avoid large saturated
backgrounds, purple gradients, cold corporate blue, excessive gray. Never
white body text over `#D49A55`.

## Typography

Inter, with native fallbacks to SF Pro (macOS) and Segoe UI (Windows).

| Level | Size |
| --- | --- |
| Product hero | 44–52px max |
| Page title | 30–36px |
| Section title | 20–24px |
| Body | 15–17px |
| Supporting information | 13–14px |
| Labels | 12–13px |

No 60–90px headings inside operational screens. Use strong weight
selectively — not every heading extra-bold. Body lines ~55–75 characters
wide.

## Layout

Desktop widths ~1280–1920px.

- Collapsible left sidebar
- Compact top toolbar
- Spacious central workspace
- Optional contextual right panel
- 8-point spacing system
- 12–16px card radii
- Restrained shadows
- Clear keyboard focus

Avoid excessive pill-shaped controls — reserve pills for statuses, filters,
compact selections.

## Navigation

Replaces the current crowded horizontal nav (currently 8 items:
ホーム・概要・接続・質問・スキル・作業メモリ・レビュー・アクセス in
`scripts/demo.ts`) with a grouped sidebar:

**Workspace** — Home · Ask Tako
**Automate** — Automations · Connected Apps · Tasks · Activity
**Govern** — Approvals · Team & Permissions

Settings, Help, and the user profile at the bottom.

### Renames (current → new)

| Current (`scripts/demo.ts`) | New |
| --- | --- |
| 概要 / Overview | merged into Home — no separate screen unless it gains a genuinely different task |
| スキル / Skills | Automations |
| 作業メモリ / Working Memory | Tasks |
| レビュー / Review Desk | Approvals |
| アクセス / Access | Team & Permissions |
| 接続 / Connect | Connected Apps |
| 質問 / Ask | Ask Tako |

Do not expose "iPaaS" as a navigation term anywhere.

## Screen specs

### Home

- Headline: "Work, connected."
- Supporting: "Tako handles the handoffs between your team's tools."
- Primary action: "Create automation." Secondary: "Ask Tako."
- Four status summaries: Active automations · Connected apps · Completed
  today · Needs approval.
- Recent activity + items requiring attention. No decorative metrics without
  an actionable purpose.
- Tako beside the main product area, connecting three or four application
  tiles. Open, controlled composition.
- The question box must not be the only feature on Home — that positions
  Tako as a search tool, not an automation product.

### Automations (the primary product screen)

- Automations shown as plain-language sentences, e.g. "When a file is added
  to Drive, summarize it and post it to Slack."
- Each shows: trigger · actions · connected apps · status · last run · owner
  · approval requirement.
- Primary action: "New automation."
- Builder: simple vertical sequence — "When this happens → Do this → Then
  this." Offer templates and guided creation first; no blank technical
  canvas by default. Advanced users may switch to a visual canvas.
- Execution detail = a timeline called "Run details," not "per-step
  receipts."

### Connected Apps

- Searchable grid, recognizable official app icons.
- Each card: app name · connection status · account/workspace · access level
  · last synchronized · manage action.
- Flow: Choose app → Sign in → Choose access → Confirm.
- Ordinary users never paste tokens or edit config files. API keys, MCP
  sources, and custom-server connections move to an Advanced area for
  administrators.
- **The plaintext credential storage must actually be fixed before this
  screen can honestly claim enterprise-ready** — not hidden, resolved. See
  "Open items."
- A small Tako animation may connect the app to the workspace after
  successful setup.

### Ask Tako

- Page title: "Ask Tako." Supporting: "Find answers across your connected
  apps."
- Shows: question field · search location selector · suggested questions ·
  answer · sources · related documents · useful next actions.
- Sources attach to relevant claims; source detail opens in a side panel.
  "Ask," not "Write to register."
- Model names (e.g. Qwen) hidden from normal users — advanced system
  settings only.
- No Tako animation while the user is reading.

### Tasks (replaces "working memory" internally)

- Four filters: Needs attention · Active · Ready to archive · Excluded.
- Each task: task · owner · due date · status · source · why it needs
  attention.
- Scoring formulas, mention counts, inactivity rules go inside an expandable
  explanation. Use "No activity for 14 days," not "idle 14d." Use "Summarize
  and archive," not "rollup." Never call customer content "noise."
- A small illustration may show Tako sorting task cards into trays; data
  stays primary.

### Activity

- Shows: time · automation · apps involved · result · duration · initiator ·
  approval state.
- Clear success/warning/failure labels — not color alone.
- Failures show: what happened · what was affected · what the user can do ·
  retry action. No raw technical logs by default.

### Approvals (replaces "Review Desk")

- Two-column: review queue (left) · selected item (right).
- Vocabulary replacement: Intent→Purpose, Merit→Usefulness, Harm→Safety,
  Evidence→Sources, Policy→Company rules.
- Decision actions: Approve · Request changes · Reject · Ask administrator.
- Masking called "Protect sensitive information"; the masking *test* tool
  lives separately, not above the approval queue.
- Visually restrained — no large mascot or playful animation beside
  sensitive content.

### Team & Permissions (replaces "Access")

- Headline: "Control what each person can access."
- Shows: members · roles · connected content · access groups · recent
  permission changes · potential access problems.
- Vocabulary: Scope→Access group, Source→Connected content, Can read→Can
  access, Granted→Assigned.
- Detailed permissions open in a side panel; administrator actions clearly
  separated from everyday member actions.

## Visual graphics

Only three major illustrated moments: Home (Tako connecting the workspace) ·
Connected Apps (Tako completing a connection) · Automations (Tako passing
information between tools). Smaller illustrations for empty states/onboarding
only — not every page.

The bookshelf metaphor may appear only in the automation-template area, never
replacing normal navigation. The desk lamp may exist as an optional Focus
Mode interaction with a conventional button always present alongside it —
never the only control.

## Motion

- Interface feedback: 120–200ms
- Panels and layout changes: 180–280ms
- Mascot gestures: 280–500ms
- Ambient transitions: no more than 800ms

Actions never wait for animation to finish. Respect reduced-motion
preferences.

**Avoid:** constant mascot movement · large parallax · bouncing cards ·
confetti · animated gradient backgrounds · motion on every hover · long
staged transitions.

## Loading and empty states

Never leave "Loading…" on screen indefinitely: immediate skeleton structure
→ specific status after a short delay → retry action on failure → short
explanation if data is unavailable.

Empty states name what's missing and offer one next action, e.g.:

> No automations yet
> Connect two apps to create your first automation.
> [Create automation]

## Avoid the "vibe-coded" look

No enormous manifesto headlines · random headline line breaks · gradient
mesh backgrounds · glassmorphism · excessive floating cards · decorative
blobs · sparkle icons · too many pills · arbitrary shadows · emoji as
interface icons · every section centered · repeated explanatory paragraphs ·
fake metrics · inconsistent corner radii · multiple competing accent colors ·
generic AI imagery · an illustration in every empty area.

The design should look intentionally edited. Remove anything that does not
improve understanding, confidence, or task completion.

## Accessibility

Meet WCAG 2.2 AA: keyboard navigation · visible focus states · reduced
motion · 4.5:1 body-text contrast · text resizing · screen-reader labels ·
comfortable targets · status communication beyond color · one-language
presentation · clear error recovery.

## Final deliverables

- Updated information architecture
- Desktop navigation system
- Design tokens
- Component states
- Home, Automations, Automation builder, Connected Apps, Ask Tako, Tasks,
  Activity, Approvals, Team & Permissions
- Onboarding
- Loading, empty, success, and error states
- Mascot placement and motion guidance

Present realistic, implementable product screens — not marketing concept
art. The final product should feel quiet, warm, and deliberate. Tako
provides personality; the interface provides clarity and trust.

## References — do not copy branding or compositions

Use the existing prototype as the functional foundation. Yoom is a reference
only for explaining automation clearly. Apple is a reference only for
restraint, hierarchy, spacing, interaction quality, and attention to detail.
Do not copy either company's branding, components, or page compositions.

## Open items — resolved

1. **"Aletheia" persistence — resolved 2026-09-11: the rename goes all the
   way through.** Executed: 34 files renamed across UI copy, docs, and
   comments (commit `90b43b7`, both `main` and `feat/brain-foundation`).
   Explicitly and deliberately NOT renamed: `~/.aletheia-brain` (the real
   local brain data directory — a data-migration question, not a text edit),
   the `aletheia-ai-adoption-desk` folder path and git remote (literal paths),
   `@aletheia_brain` (a real registered Discord bot name), and
   `aletheia_fusion_export` (a literal filename on disk). Also excluded: the
   parked pre-pivot prototype and 5 `docs/` files describing its own history.
   Whether an actual registered STAPS thesis title changes is outside this
   repo's reach — that's the owner's own action with their institution, not
   something achievable by editing files here.
2. **Credential-storage fix — resolved 2026-09-11: out of scope for this
   effort.** The owner confirmed: "don't touch any functioning thing, just
   the UI itself rename is enough." This redesign proceeds as a copy/IA/
   visual layer only. The plaintext-token-storage fix remains a real,
   separately tracked prerequisite before any "production-ready" claim ships
   anywhere — including this spec's own Connected Apps section, which must
   not soften or hide that gap when implemented.
3. Config scaffolding "wizard" work (in progress, separate thread) will need
   to be re-skinned to this system once built — not a blocker, just noting
   the dependency so it isn't built twice in two different visual languages.

**Both blocking items resolved. Proceeding to implementation planning.**
