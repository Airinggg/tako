# OmniBrain demo — breakdown and how to reach parity

Source: youtube.com/watch?v=6MAAA1QW0zw ("Omnibrain Demo (Fixed Audio)", Xpress
AI, July 2026). 90 s. Watched frame-by-frame 2026-08-28. There is no public
OmniBrain repo — it's a hosted product built on gbrain/gstack. This is what it
shows and how each piece maps to what we can build.

## What the video shows

**Positioning slides (0–35 s)**
- "OmniBrain — gbrain, for the enterprise. Agents can only emulate work they've
  been taught. OmniBrain extracts **how work is done here — the process and the
  data access it assumes — and provisions it to your agents. Without migrating a
  single document.**"
- Why gbrain worked: agents need compounding memory; ~90k GitHub stars; "a brain
  turns scattered exhaust into an execution layer."
- Why enterprise is hard: **Scattered** (truth split across every system),
  **Permissioned** (who-sees-what matters; a brain that ignores it is
  unshippable), **Always Changing** (schemas/tools/workflows shift monthly).

**Product UI demo (35–90 s)**
1. **Create brain** wizard with a **Data region** selector ("Japan
   (asia-northeast) — your index is stored and searched only in this region").
2. **Connect sources via OAuth** — Google Drive, Notion, Slack (hosted OAuth
   consent screens, not manual tokens).
3. **Live ingestion feed** — files stream in ("meeting_saved_closed_caption.txt",
   "image (78).png", "… just now", "2 sources syncing").
4. **Department brains as cards** — e.g. *Engineering* (3,736 documents · **12
   skills**, Members 14, **Rules 4**, Updated just now, 2 sources syncing);
   *Finance* (1,842 docs · 3 skills, Members 5, Rules 2, Up to date). Button:
   "Open Brain". "Next: share Engineering with your team →".
5. **Invite modal** — pick employees, tick which brains (**Scopes**: Engineering,
   All-hands, Finance). "Selected agents will be able to search 12,532 documents
   across 2 scopes. **Nothing else.**" They receive an invitation → Accept.
6. **Members table** — per person: Scopes, Status (Active / Invited), **API key
   `sk_live_…` shown once, to its owner only**, Last active. "Rotate or revoke
   here at any time — changes apply within seconds."

## Parity map

| OmniBrain feature | Status here | How to reach it |
|---|---|---|
| gbrain engine | ✅ vendored `packages/brain` | — |
| One brain per department + strict scopes | ❌ single brain | `gbrain sources add <dept> --path brain-sources/<dept>`; per-person clients with `--source` + `--federated-read` (company-brain tutorial Part 3 + 5) |
| Connectors: Notion, Slack | ✅ `lib/connectors/{notion,slack}` | done (manual token) |
| Connector: Google Drive | ❌ | 4th connector, same git-backed-source pattern |
| Connector: local notes | ✅ `lib/connectors/notes` | done |
| OAuth connect (one-click) vs manual token | ⚠️ manual tokens | build hosted OAuth apps per source, or keep manual tokens for self-host |
| Live ingestion feed | ⚠️ connectors run manually | `gbrain sync --watch` or a cron per source; already visible in the admin Jobs / Request Log |
| **Skills** per brain ("12 skills") | ❌ | `gbrain skillify scaffold <name>` per department — the "extract how work is done" differentiator; deterministic collect + LLM-judgment enrichment |
| **Rules** per brain ("4 rules") | ❌ | the `_*-rules.md` convention files at the skills root (tutorial Part 7): filing rules, output rules, excluded-people privacy gate, operating rules |
| Department-brain cards + members table UI | ❌ (gbrain admin has Agents/Dashboard/RequestLog, not this view) | extend the copied admin (`apps/console/`) or a small Next.js page over `/admin/api/*` |
| Invite → pick scopes → accept → key on first sign-in | ⚠️ `gbrain agent register` documented, no invite UX | thin wrapper over `gbrain auth register-client`: choose people + scopes, email an accept link, reveal key once |
| Members table: scopes / status / key / last-active / rotate / revoke | ✅ mostly (admin Agents page) | add "Invited" status + "key shown once"; `gbrain auth revoke-client`, token TTL |
| Data region selection | N/A local (PGLite = the user's machine) | hosted only: deploy gbrain on Postgres in a chosen region |

## Roadmap to parity (in order)

1. **Multi-brain / scopes.** `gbrain sources add` per department, per-person
   `gbrain auth register-client --source X --federated-read X,Y`. Verify
   isolation with a thin-client acting as each person (tutorial Part 5).
2. **Google Drive connector** — 4th `lib/connectors/` module.
3. **Continuous sync** — `gbrain sync --watch` (or cron) + `gbrain autopilot`;
   the live feed is then the admin Jobs / Request Log.
4. **Rules** — add `brain-sources/<dept>/skills/_*-rules.md` (filing, output,
   excluded-people, operating). Cheap, high-leverage.
5. **Skills** — `gbrain skillify scaffold` per department for the recurring
   procedures. This is the actual OmniBrain differentiator ("provision how work
   is done"), not just retrieval.
6. **Invite flow + department dashboard** — the custom UI layer: department-brain
   cards, invite modal, members table. Build on the copied admin or a Next.js
   page against `/admin/api/*`.
7. **(Hosted only)** OAuth-based source connect + data-region selection — needed
   only if this is offered as a SaaS rather than self-hosted.

Items 1–3 are gbrain-native config + one connector. Items 4–5 are the
differentiator. Items 6–7 are product packaging.
