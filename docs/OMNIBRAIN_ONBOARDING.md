# OmniBrain onboarding flow — target UX

Source: owner's walkthrough of the OmniBrain product (2026-08-29). This is the
flow to build. `scripts/console.ts` today ≈ screens 5-6; screens 1-4 are new.

## Positioning

The enterprise gbrain. **Federate** (crawl SharePoint / Notion / Drive / Slack /
Confluence in place — read-only, credentials vaulted, nothing migrates).
**Scope** (owner splits the index into need-to-know scopes, each with an explicit
view of what it CANNOT see). **Extract skills** (processes distilled from
docs+comms into skills that declare the data access they assume — reviewed once,
receipted per step). **Provision** (each employee: an email → scoped MCP URL +
the omnibrain CLI; gbrain-compatible where it counts; revocable any time).
Dev workflow: swap `gbrain` for `omnibrain` in GStack.

## Screens

### 1. Create your brain
Org name + **data region** → "Create brain".
→ gbrain: `gbrain init` (region only meaningful for a hosted deploy; local = the
machine). Store org name + region in brain config.

### 2. Connect sources
Tabs: Google Drive · Notion · Confluence · SharePoint. Each has **Connect** →
OAuth ("Choose an account · continue to omnibrain-dev.web.app") → back → a
**Continue** button once ≥1 source is connected.
→ ours: hosted OAuth apps per source, credential vault. Interim: the token-based
connectors we already have (`lib/connectors/*`). This screen wraps them.

### 3. First crawl
"Building your index / nothing is shared with anyone yet." Per-source progress
tabs (`Google Drive — 100 documents — crawl complete`) + a **Skills** tab
("distilled from repeatable workflows the crawl finds; skills inherit the same
boundaries as documents — a scope only grants skills it can see").
→ ours: run the connector(s) + `gbrain sync` + `npm run skills:extract`, stream
progress. Skills = `scripts/extract-skills.ts` drafts.

### 4. Create your first scope   ← the differentiator
- **Left**: source tree with counts, drillable:
  ```
  google drive 4712
    engineering 1692 · design 324 · finance 1842 · people ops 842
  notion 1156
    eng wiki 946 · company home 210
  slack 8344
    #platform 774 · #general 1138 · #finance 388
  ```
- **Middle**: scope name (e.g. "engineering"), "what is this scope for?", rules.
- **Right**: explicit **Included / Excluded** preview — what this scope can and
  cannot see. This is the "explicit view of what each scope cannot see".
- → **Create scope**.

**gbrain reality:** read-scoping is *source-granular* (`--federated-read
<source-ids>`), not folder-granular. Folder-level picking (engineering 1692
inside google drive 4712) means the connector must write those folders into a
**separate source** (`brain-sources/<scope>/…`) that gets its own
`gbrain sources add`. So "create scope" = (a) name it, (b) map the picked
sub-trees to a source id, (c) `gbrain sources add <scope>`, (d) record the
include/exclude set. The Excluded preview = every other source + a note that
sibling folders in a shared source are visible to everyone on that source.

**Implemented local planner:**

```bash
npm run scope:build              # http://localhost:4341
```

The scope builder reads `gbrain sources status --json` and `gbrain list
--source <id>` through the vendored CLI, then persists reviewed definitions in
the gitignored `config/scopes.json`. It never runs a brain mutation. Its
realisation plan prints the exact commands for the owner to review and run:

```bash
# Whole-source selections become source IDs in a person's read grant.
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain
bun src/cli.ts auth register-client <person> --scopes "read" \
  --source <primary-source> --federated-read <source-a>,<source-b>

# Partial selections first become their own Git-backed source. The generated
# plan includes the mkdir/rsync/git commits, followed by:
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain
bun src/cli.ts sources add <scope> \
  --path "<absolute-repo>/brain-sources/<scope>" --name "<scope>"
bun src/cli.ts sync --source <scope>
```

The right-hand preview names both included and excluded subtrees. An amber
warning appears whenever those two sets still share one GBrain source, because
folder selection alone does not restrict members of that source.

### 5. Scopes overview
Tab per scope: `engineering — 3736 documents · 12 skills · members 14 · rules 4 ·
updated just now · 2 sources syncing`. `finance — … · up to date`.
next: "share Engineering with your team → [Open People]".
→ **built:** `npm run console:serve` loads `config/scopes.json`, calculates
document, fully-covered skill, visible-rule and member counts, aggregates source
sync state, and opens a scope-preselected People / invite panel from each card.
When no scopes exist it preserves the raw source cards and links the operator to
`npm run scope:build`.

### 6. People / invite
Employee list → choose who → **Invite** → popup: employee email + tick which
scopes → **Send invite**.
→ ours: `gbrain auth register-client <name> --source <scope> --federated-read
<scopes>` per person. The console now captures email and supports multi-scope
selection; actual email delivery remains the screen-6 follow-up.

## Build order (for us, incremental)

1. **Scope builder page** (screen 4) — highest value, achievable now against
   real `gbrain list` data. See the Codex task in `cowork/handoff/`.
2. [x] Fold `scripts/console.ts` into a scopes-overview card view (screen 5).
3. People/invite email (screen 6) — small delta on console.ts's form.
4. Create-brain + connect-sources wizard (screens 1-2) — needs hosted OAuth;
   defer to the hosted/SaaS phase.
5. Crawl-progress screen (screen 3) — wrap `connectors:all` + `sync` + `skills:extract`.

## Gap analysis — what we have vs OmniBrain (2026-08-29)

### Critical (core to the value prop)

1. **Scope builder + "what this scope CANNOT see" view.** We have the plumbing
   (`gbrain sources add` + `--federated-read`, source-granular) but: no UI to
   build a scope, no folder-level granularity, no explicit exclude preview. This
   is OmniBrain's headline differentiator.
2. **Skills declare the data access they assume + per-step receipts.** Our
   extracted skills carry `mutating` / `writes_pages` / `extracted_from` but not
   an explicit "reads sources X, Y" declaration, and there is no per-step
   execution receipt. "Reviewed once, receipted per step" is a governance claim
   that ties straight to Tako's DNA — we do the review (drafts), not the
   declaration or the receipts. gbrain's Request Log is per-query, not per-step.
3. **Credential vault.** Tokens sit in plaintext `config/connectors.json`
   (gitignored). OmniBrain vaults OAuth credentials. For a product about not
   leaking data this is a real weakness.

### Important (product completeness)

4. **Invite email.** `gbrain agent register` mints the scoped MCP URL + token and
   `scripts/console.ts` has an invite form, but nothing is emailed — just a
   copyable block. No people-list, no email field, no multi-scope tick in one popup.
5. **Setup wizard.** Screens 1-3 (create brain with org + region → connect
   sources → first-crawl progress) don't exist; we `gbrain init` and run
   `connectors:all` by hand.
6. **Continuous managed crawl.** We have `npm run sync:watch` / `connectors:all`,
   but it's a script you start, not an always-on service with per-source sync
   status surfaced in the UI.
7. **`omnibrain` CLI + branding.** "Swap `gbrain` for `omnibrain` in GStack" —
   no drop-in shim, no rebrand. It is still `gbrain`.
8. **Per-scope skills.** OmniBrain shows "12 skills" per scope. Ours: 3
   hand-written skills in `brain-sources/shared/skills/` + a draft extractor —
   not per-scope, not distilled at that volume (needs real crawl data).

### Deferred (hosted / SaaS phase)

9. **SharePoint + Confluence connectors.** Not built (have Drive, Notion, Slack,
   Discord, local notes).
10. **OAuth source-connect** (one-click, "continue to omnibrain-dev.web.app").
    Needs hosted OAuth apps. We use manual tokens.
11. **Data region selector.** Meaningless for a local deploy.

### Where we are AT OR AHEAD of OmniBrain

- **Local-only / option A** as a hard guarantee (OmniBrain is hosted).
- **Evidence-linking / citations** on every answer.
- **An evaluation harness with measured results** (3b baseline, 3b-vs-9b) —
  OmniBrain advertises none.
- **Cross-tool person resolution** (`config/people.json`).
- **A local chat page** (`npm run ask`) — OmniBrain's query path is the
  employee's own agent over MCP; ours adds a no-agent option.
