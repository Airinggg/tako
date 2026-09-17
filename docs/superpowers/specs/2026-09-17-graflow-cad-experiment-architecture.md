# Graflow Local-Orchestration Experiment — Architecture Specification (Phase 1)

**Status:** Documentation only. No implementation code, no dependency
installation. Amends and supersedes nothing — this is the first written
architecture doc for the experiment; the Phase 0 report lives only in the
session transcript.

**Experiment branch:** `experiment/graflow-local-orchestration`
**Base:** `main` at `2e55800`
**Reference:** `docs/GRAFLOW_FUTURE_INTEGRATION.md` (prior decision note, preserved)

## 0. Objective and non-goals

**Objective:** determine, with evidence rather than assertion, whether
Graflow provides enough unique operational value over a small native
TypeScript alternative to justify introducing Python into this project, using
the smallest possible harness (the CAD connector) as the test vehicle.

**Non-goals (unchanged from Phase 0):** no Redis, no distributed workers, no
cloud/serverless deployment, no hosted models, no hosted tracing/telemetry,
no notification integrations, no replacement of Tako's review/approval state
machine, no Python rewrite of any TypeScript connector, no multi-tenant
operation, no production migration. Nothing in this document authorizes
Phase 2 work.

**Explicit framing per management's Phase 0 review:** CAD is approved as a
safety/fault-injection harness. It is *not* yet accepted as a business
justification for adding Graflow. Section 9 (decision matrix) and Section 10
(go/no-go) are written to be falsifiable — this document does not start from
"Graflow proceeds" and work backward.

## 1. Current-state execution matrix

Five operations exist today. They are not five implementations of the same
thing — they cover disjoint subsets of connector-pull, gbrain-sync, and
embedding work, and only one of them writes provenance.

| Operation | Fetches from connector | Writes source files | Prunes stale files | Records provenance (`sync-log.jsonl`) | Runs `gbrain sync` | Embeds inline (gated) | Runs explicit `embed --all` | Stops/restarts serve | Updates retry/schedule state |
|---|---|---|---|---|---|---|---|---|---|
| 1. `omnibrain connect <name>` → `lib/connectors/<name>/run.ts` | ✅ | ✅ | ✅ (`pruneStale`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 2. `connectors:all` → `scripts/run-connectors.ts` | ✅ (per connector, sequential) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 3. `omnibrain sync` → `bin/omnibrain:56-64` | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (gated, see §2) | ✅ (unconditional, `bin/omnibrain:61`) | ✅ (`stopAlethiaServe`/`restartAlethiaServe`) | ❌ |
| 4. `sync-daemon.ts` (`--watch`/`--once`) → `scripts/sync-daemon.ts:113-160` | ✅ | ✅ | ✅ | ❌ | ✅ (`--working-tree`) | ✅ (gated, see §2) | ✅ (unconditional, `scripts/sync-daemon.ts:139`) | ✅ | ✅ (`lib/sync/schedule.ts` backoff, `lib/sync/state.ts`) |
| 5. `POST /api/connectors/sync` (demo UI) → `scripts/demo.ts:710-744` | ✅ | ✅ | ✅ | ✅ (`appendSyncLog`, before/after diff) | ✅ (`--working-tree`) | ✅ (gated, see §2) | ❌ | ❌ | ❌ |

Notes:
- Only path 5 writes to `config/sync-log.jsonl`. This is a **pre-existing
  coverage gap**, not something this experiment fixes (see §12.3).
- Only path 4 updates the exponential-backoff scheduling state
  (`lib/sync/state.ts`). Path 5 (the UI trigger) has no scheduling state at
  all — every click is an independent, unscheduled attempt.
- Path 3 has no connector-fetch step whatsoever — it operates purely on
  whatever is already on disk in `brain-sources/`.

## 2. gbrain embedding semantics (read from `packages/brain/src/commands/sync.ts`, not assumed)

Two independent gates decide whether a `gbrain sync` call embeds inline:

1. **A hard file-count threshold**, universal to every `sync` invocation:
   `const noEmbed = opts.noEmbed || totalChanges > 100;` (`sync.ts:2230`).
   Above 100 changed files, the sync logs `"Large sync (N files). Importing
   text, deferring embeddings."` (`sync.ts:2231-2233`) and skips embedding for
   that call regardless of any flag.
2. **A single-source cost gate**, specific to `gbrain sync --source <id>`
   (not `--all`): `resolveSingleSyncEmbedPlan` (`sync.ts:5094-5117`) can set
   `opts.noEmbed = true` before the threshold above is even reached, based on
   an estimated embedding cost and whether the invocation is interactive
   (TTY) with `--yes`. Comment at `sync.ts:5084-5091` states this gate was
   added in v0.42.42.0 specifically so a non-interactive/cron invocation
   above a cost floor "AUTO-DEFERS" rather than either silently spending or
   blocking on a prompt that will never be answered.

When neither gate defers, embedding happens **inline, within the same
`sync` call**, for pages actually affected by that sync
(`if (!noEmbed && embedSlugs.length > 0 && pagesAffected.length <= 100)`,
`sync.ts:3773`).

**Local backfill behaviour**: when a sync *did* defer, the code's own
guidance (`sync.ts:3785-3786, 3790-3791`) is to run `gbrain embed --stale`
afterward — a targeted re-embed of only stale/un-embedded chunks, not a full
re-scan.

**Why do `sync-daemon.ts` and `bin/omnibrain` run an *additional*, explicit
`embed --all` after every `sync` call, unconditionally?** Both call
`embed --all`, never `embed --stale` (`bin/omnibrain:61`,
`scripts/sync-daemon.ts:139`). Reading the code, this is a belt-and-suspenders
safety net against the *possibility* that inline embedding didn't happen (either
gate could have deferred it) — but it is strictly more expensive than
necessary: `embed --all` re-scans and re-embeds every page across the whole
brain, not just what this sync just touched or left stale, every single sync
cycle. **This is a pre-existing architectural inefficiency, not a Graflow
concern, and this document does not change it.** It is recorded as
Newly-Discovered-Gap #4 in §12.

**A single canonical pipeline that avoids duplicate full embedding, proposed
for the experiment only** (not a change to existing paths 3/4): run
`gbrain sync --source cad --working-tree` once, then run `gbrain embed
--stale` (not `--all`) as the backfill step, matching the code's own
documented recovery guidance rather than the broader unconditional pattern
paths 3/4 currently use. For CAD specifically, file counts are always small
(a handful of exported parts/assemblies) and comfortably under the 100-file
threshold, so in practice the inline embed at `sync.ts:3773` will almost
always fire and the `embed --stale` step will almost always be a fast no-op —
this is stated as an expectation to verify in Phase 2's fault-injection
tests, not asserted as guaranteed.

## 3. Governance boundary, precisely (no generic claims)

For the CAD connector specifically, tracing each concern to its actual
enforcing function (or the absence of one):

| Concern | Enforced by | For CAD? |
|---|---|---|
| Process execution permission | OS process boundary + explicit argv (no shell string interpolation) — a design choice for this experiment, not existing code | To be built, §5 |
| Connector allowlisting | A new, experiment-local allowlist containing only `"cad"` — **not** `lib/connectors/registry.ts`'s general `isConnectorName()`, which accepts every registered connector | To be built, §5 |
| Connector configuration scope | `loadDriveConfig`-style loader pattern (`lib/connectors/shared/config.ts`), read server-side; the workflow never accepts a connector config or file path from its caller | Existing pattern, reused |
| Member/source authorization | **None exists.** No per-member auth, no source-level ACL (confirmed empirically in Phase 0: no `lib/auth/`, no `config/users.json`). Every trigger request is administrator-token-gated, undifferentiated between administrators | Explicit gap, §12.2 |
| Content redaction | `lib/govern/redact.ts` — **only wired into the MCP connector's read path** (`lib/connectors/mcp/govern.ts:100-149`). CAD's `run.ts` does not import anything from `lib/govern/` | **Not present for CAD.** This experiment inherits CAD's existing (no) redaction posture; it does not add any | Explicit gap, §12.1 |
| Prompt-injection handling | N/A to a read-only, non-LLM sync workflow — no prompt is constructed anywhere in this pipeline | Not applicable |
| Provenance logging | `lib/govern/sync-log.ts`'s `appendSyncLog`/`diffGitStatus` — currently only called from `scripts/demo.ts`'s UI path | To be reused, §7 |
| Human approval | `lib/review/model.ts` — **not applicable to this workflow.** A read-only sync into the local index is not an outbound/publishing action; Tako's own governed path (質問→検索→下書き→フィルタ→人間の承認) gates *outputs*, not *ingestion* | Not applicable, stated explicitly rather than silently omitted |

**The honest security boundary for this experiment, stated plainly (per
management's own framing)**: administrator-only trigger; server-side
allowlist containing only `cad`; server-derived configuration; no
client-supplied filesystem path anywhere in the request; local fixture input
for automated tests; **no claim of per-member authorization**; **no claim of
universal content-governance enforcement** — CAD's existing lack of
redaction is inherited, not introduced, by this experiment, and remains true
of paths 1–4 today regardless of Graflow.

## 4. Runtime selection

**Pinned runtime: Python 3.12**, not the locally-installed 3.14. Graflow's
`pyproject.toml` states `requires-python = ">=3.10"`; its GitHub Actions
matrix (confirmed via the repo) tests through 3.13; its own `CLAUDE.md`
states "Python 3.11+" as the stated dev target. 3.12 sits inside all three
ranges and is a widely-available LTS-track version for SME deployment
(available via `python.org` installers, Homebrew, and most Linux package
managers without needing the newest point release) — 3.14 was rejected
specifically because "it happens to be installed on this developer's laptop"
is not a deployment plan.

- **Installation**: a project-local virtual environment (`python3.12 -m venv
  .graflow-venv` under the experiment directory, never the system Python),
  created by a setup script the same way `omnibrain doctor`/`omnibrain setup`
  already establish local, documented prerequisites for Bun/Ollama.
- **Version check**: extend the existing `lib/cli/doctor.ts` pattern (which
  already checks Bun version, Ollama reachability, and pulled models) with
  a new, experiment-only check for `python3.12 --version` — reported the
  same honest pass/fail-with-fix-instructions way, not silently assumed.
- **Environment isolation**: the venv directory is gitignored and entirely
  disposable; nothing outside it is modified. No `pip install --user`, no
  system-wide package installation.
- **Dependency locking**: `pip-compile` (from `pip-tools`) or `uv pip
  compile` to produce a fully pinned, hash-locked `requirements.lock` from a
  minimal `requirements.in` containing only `graflow==0.1.9` (bare, no
  extras). Hashes are verified on install (`pip install --require-hashes`).
- **Deployment without touching system Python**: the venv is created and
  activated only by the experiment's own invocation wrapper; Tako's own
  Bun/TypeScript runtime and startup path are entirely unaffected whether or
  not the venv exists.
- **Removal**: delete the venv directory and the experiment directory. No
  system-level uninstall step, no registry/PATH entries to undo.
- **Failure when Python/the venv/Graflow is unavailable**: the TypeScript
  invocation wrapper (§5) checks for the venv's existence and the pinned
  interpreter version *before* attempting to spawn anything, and returns a
  structured, honest failure (`{status: "failed", reason:
  "graflow_runtime_unavailable"}`) rather than a raw spawn error with a
  stack trace — consistent with the existing `safeErrorResponse` pattern in
  `lib/util/http-security.ts`. **The direct, non-experimental sync paths
  (1–5 above) are completely unaffected by this failure mode** — this is the
  central removal/fallback guarantee (see §11).

## 5. Structured subprocess protocol

Recommended boundary (unchanged from Phase 0, restated with detail):
**argument-array subprocess, no listening port, no shell string
construction.**

**Invocation** (TypeScript → Python), one process per workflow run, no
persistent daemon:

```
<venv>/bin/python3.12 -m graflow_experiment.cad_sync_workflow \
  --workflow-id <server-generated UUID> \
  --actor operator \
  --config-path <server-resolved absolute path to the CAD system's exportFile> \
  --attempt <integer>
```

- `--workflow-id`: generated server-side (`crypto.randomUUID()`), never
  accepted from any external caller. Used only to name this run's own
  checkpoint/receipt files (§6) — never used to look up or resume a
  *different* prior run's checkpoint in this first skeleton (resume is
  disabled entirely, see §6.9).
- `--config-path`: resolved server-side from `config/connectors.json`'s
  existing `cad` block via the existing config-loading pattern — **never**
  accepted as a request parameter. This directly satisfies "do not accept an
  export path from the browser or workflow payload."
- Environment: an explicit allowlist only (§8) — not `...process.env`.
- Timeout: a hard wall-clock cap (proposed: 60s, generous for a small local
  file read + `gbrain sync` call, matching the existing 120s cap used
  elsewhere in `scripts/demo.ts` for connector operations, but tighter since
  CAD has no network round-trip).
- Cancellation: `SIGTERM` first, `SIGKILL` after a 5s grace period if the
  child hasn't exited — the same two-step pattern already implicit in
  Node's `child_process` API and consistent with "terminate child processes
  cleanly on cancellation."

**Response** (stdout, single final JSON line — not parsed human text):

```json
{
  "workflowId": "…",
  "status": "completed" | "failed" | "cancelled" | "action_required",
  "attempt": 1,
  "startedAt": "…", "endedAt": "…",
  "changedPaths": ["engineering/cad/…"],
  "deletedPaths": [],
  "embedded": true,
  "reason": null,
  "receiptPath": "…"
}
```

Progress/diagnostic lines during execution are separate, prefixed
newline-delimited JSON (mirroring `scripts/sync-daemon.ts`'s existing
`log()` convention exactly, rather than inventing a second event-stream
format) — only the final line is authoritative for the caller's state
transition.

## 6. Workflow state model

States, restricted to what this one workflow can actually reach (per
management's instruction not to add unreachable states without explaining
why they're reserved):

| State | Reachable by this workflow? | Notes |
|---|---|---|
| `queued` | ✅ | Between HTTP accept and subprocess spawn |
| `running` | ✅ | Subprocess active |
| `completed` | ✅ | Final line reports `status: "completed"` |
| `failed` | ✅ | Non-zero exit, timeout, or `status: "failed"` in the final line |
| `cancelled` | ✅ | Explicit cancel request while `running` |
| `waiting_for_approval` | **Reserved, not reachable in this workflow.** A read-only ingestion sync has no publishing/approval step (§3's governance table) — this state exists in the model for a *future* document-release-style workflow only, per `docs/GRAFLOW_FUTURE_INTEGRATION.md`'s own scope note, not this one |
| `action_required` | **Reserved, not reachable by the CAD experiment specifically**, but kept in the enum (not removed) since a real connector (e.g. Notion) could plausibly reach it on an auth failure requiring operator action — CAD has no such failure mode (no token, no network) |
| `expired` | **Reserved, not reachable.** Only meaningful for a paused/checkpointed workflow with a resume deadline — checkpoint resume is disabled in this skeleton (§6.9), so nothing can expire |

Transitions: `queued → running → {completed | failed | cancelled}`. No
transition graph edge exists into `waiting_for_approval`, `action_required`,
or `expired` for this specific workflow — they are declared, not wired.

### 6.1–6.8: retry, idempotency, timeout/cancellation

- **Retry classification**: only *transient* failures are retryable —
  defined narrowly as: subprocess spawn failure (ENOENT/EACCES on the venv
  interpreter) and timeout. **Validation failures (bad config), the
  allowlist rejection, and any non-zero exit from `gbrain sync` itself are
  terminal, never retried** — matching "permanent validation or
  authorization failures must not be retried."
- **Bounded retries**: maximum 2 retries, fixed 2s/5s backoff (not
  exponential — the workflow is short enough that exponential backoff adds
  complexity without benefit at this scale; this is an explicit, justified
  deviation from `lib/sync/schedule.ts`'s exponential pattern, which exists
  for a *long-running daemon* polling many connectors, a different problem
  shape).
- **Idempotency key**: `<workflow-id>:<attempt>` is recorded in the receipt
  and in each provenance entry (§7) — a retry of the same workflow-id
  reuses the same key prefix so a duplicate provenance write can be detected
  and rejected before appending.
- **Timeout**: 60s wall clock (§5); on timeout, `SIGTERM`→`SIGKILL`,
  workflow state → `failed`, reason `"timeout"`.
- **Cancellation**: an explicit cancel action (new, admin-gated) sends
  `SIGTERM` to the tracked child PID; state → `cancelled`. **No cancellation
  endpoint exists anywhere in Tako today** (confirmed in Phase 0) — this
  would be the first one, scoped only to this experiment's own workflows.

### 6.9: checkpoint and resume — explicit decision

**Resume is disabled in this first skeleton.** Every invocation runs the
full pipeline (validate → collect → attribute changes → provenance →
`gbrain sync` → verify → receipt) start to finish, or fails/cancels
entirely — there is no partial-progress resume path exposed. This is a
direct, stated response to §8's threat-model findings: Graflow's own
checkpoint/resume mechanism is not safe enough to expose without custom
authentication machinery this document does not consider justified for a
workflow this short (see §8.10 and §9).

**Where a checkpoint would occur if resume were ever enabled** (documented
for completeness, not built): between "collection complete" and "`gbrain
sync` not yet run." Analysis of whether resuming from there would actually
be safe:

- Is rerunning CAD deterministic? **Yes** — `lib/connectors/cad/run.ts` has
  no cursor; every run re-reads the complete export (confirmed Phase 0). A
  "resume" that just re-runs collection from scratch is behaviorally
  identical to not resuming at all.
- Is pruning safe to repeat? **Yes**, `pruneStale` (`lib/connectors/shared/
  prune.ts`) is idempotent by construction — it deletes files not in the
  current keep-set, and running it twice with the same keep-set is a no-op
  the second time.
- Would provenance entries duplicate? **Yes, without the idempotency-key
  check in §7** — `appendSyncLog` is a pure append; calling it twice for the
  same actual sync would double the audit trail unless the caller
  deduplicates by `(workflowId, attempt)` before appending, which is exactly
  what §7 specifies.
- Does the original changed-file baseline still exist? Only if `before` was
  itself checkpointed — since CAD's collection is a full re-read each time
  and deterministic, recomputing `before` fresh via `gitStatusFor()` is
  equivalent to restoring a checkpointed one.
- Is `gbrain sync` idempotent? **Believed yes for the case where nothing
  changed between attempts** (a repeat `sync --working-tree` on an unchanged
  working tree should find zero diff and no-op), but this is **not verified
  empirically in Phase 1** — it is a required Phase 2 fault-injection test
  (interrupt after collection, before indexing, then resume/retry, confirm
  no duplicate chunks), not asserted here.
- Would embedding repeat unnecessarily? Only if `embed --all` were used
  again on retry; using `embed --stale` (§2's canonical pipeline) makes a
  repeated embed pass cheap regardless of whether the prior attempt already
  embedded.

Given CAD's own determinism, the *practical* value of Graflow's actual
pickle-based resume mechanism for this workflow is close to zero — a
from-scratch retry is already cheap and safe. This materially weakens the
case for needing Graflow's checkpoint feature at all for this workflow (see
§9).

## 7. Provenance integration (shared boundary, not a second system)

No new provenance mechanism is proposed. The experiment calls the existing
`appendSyncLog`/`gitStatusFor`/`diffGitStatus` functions
(`lib/govern/sync-log.ts`, `scripts/demo.ts:665-702`) directly — the same
before/after git-status diff already fixed for the shared-subdir
misattribution bug (#11).

**`SyncLogEntry`'s shape is not modified in this document** (per explicit
instruction). For the record, if extended in a *future* phase, the fields
that would matter are: `workflowId`, `attempt`, `trigger` (e.g.
`"graflow-experiment"` vs `"ui"` vs `"daemon"`), `actorId`. All four would
need to be **optional** to remain backward-compatible with the many existing
call sites and the committed test fixtures in `tests/govern-sync-log.test.ts`
that construct `SyncLogEntry` literals without them. `result` is not
proposed — a sync's success/failure is already the presence/absence of a
log entry plus the workflow's own receipt file; duplicating it into the
provenance schema would create two sources of truth for the same fact.

**Duplicate-entry prevention on retry**: before calling `appendSyncLog`, the
workflow wrapper checks whether an entry for this exact `(workflowId,
attempt)` pair already exists in `config/sync-log.jsonl` (a linear scan is
acceptable at this log's expected size for a single CAD connector) and skips
the append if so — this is new logic in the *wrapper*, not a change to
`sync-log.ts` itself.

## 8. Checkpoint security analysis

This section evaluates Graflow's *actual* checkpoint mechanism against the
threat list, on the assumption that a future phase might want to enable it
(it is disabled in this skeleton per §6.9) — the analysis exists so the
decision in §9/§10 is evidence-based, not because enabling it is proposed
now.

Confirmed from reading `graflow/core/checkpoint.py` and
`graflow/core/serialization.py` directly (Phase 0):
`CheckpointManager.resume_from_checkpoint(checkpoint_path)` calls
`ExecutionContext.load(pickle_path)`, which resolves to
`cloudpickle.loads(data)` with **no signature, no allowlist, no validation
of any kind**.

| Threat | Exposure if Graflow's native mechanism were used as-is | Required mitigation |
|---|---|---|
| Malicious replacement by another local process as the same OS user | **Full exposure.** Any process running as the same user can overwrite the `.pkl` file between write and read | An isolated service account (not "the same user as everything else"), so "another local process as this user" is a smaller set |
| Symlink/hard-link attacks | **Full exposure.** `open()`/`load()` calls shown follow symlinks; nothing in the read path checks `O_NOFOLLOW` or resolves+validates the real path first | Open with `O_NOFOLLOW` where the OS supports it; reject if the resolved real path leaves the owner-only state directory |
| TOCTOU replacement | **Exposure.** Path is resolved, then read, in two steps with no lock or atomic handle held across both | Open the file descriptor once, `fstat` it, verify ownership/mode on the *open fd*, then read from that same fd — never re-resolve the path between check and use |
| Directory ownership/permissions | Not enforced by Graflow itself | The experiment's own state directory must be created `0700`, owned by the service account, checked before every read |
| Untrusted restore requests | **Full exposure** if any caller can supply `checkpoint_path` | Never accept a path from any request; resume is disabled entirely (§6.9), which is the simplest possible mitigation |
| Checkpoint replay | Not addressed by Graflow — no timestamp/nonce binding | Would need workflow-id + attempt + timestamp bound into an authenticated manifest (below) |
| Checkpoint copied from another workflow | **Full exposure** — nothing binds a `.pkl` file to the workflow ID it was created for beyond the filename convention, which is not verified on load | An authenticated manifest (HMAC over workflow ID + actor + scope + content hash) checked before `loads()` is ever called |
| Workflow ID / actor / scope binding | **Not present in Graflow's own format.** `CheckpointMetadata` (`checkpoint.py`) stores `session_id`, not an authenticated actor/scope | Would need to be added entirely externally — Graflow provides no hook for this |
| Version mismatch after upgrades | cloudpickle's own documented limitation: "can only be used to send objects between the exact same version of Python" — an upgrade can silently produce a corrupt or exception-raising load, not a clean rejection | Record and check the exact Python + Graflow + graflow-experiment version in an unauthenticated-but-checked header before attempting `loads()` |
| DoS via oversized checkpoint | No size cap found in the reviewed source | A maximum checkpoint size enforced by the *wrapper* before reading, not by Graflow |
| Checkpoint verification failure | Graflow's `loads()` simply raises/propagates a Python exception — no defined "fail closed and refuse to resume" contract | Must be built externally: any manifest/HMAC/size check failure → refuse to resume, log the event, do not fall back to running as if no checkpoint existed |

**Conclusion of this section**: every mitigation above is machinery this
document would have to build *around* Graflow, not something Graflow
provides. None of it is exotic (HMAC-authenticated manifests and
owner-only-directory checks are standard practice), but it is a real,
non-trivial amount of custom code whose entire purpose is compensating for
a checkpoint format Graflow ships with no validation at all. **Per
management's own instruction, this counts materially against Graflow in
§9's comparison.**

Given §6.9's finding that CAD's own workflow gains near-zero practical
benefit from resume (because collection is already fully deterministic and
cheap to redo from scratch), building this custom security machinery to
protect a feature this specific workflow doesn't meaningfully need is hard
to justify on its own. This is not proposed as a permanent conclusion about
Graflow in general — a workflow with genuinely expensive, non-idempotent,
long-running steps would change this calculation — but for *this* harness,
it does not.

## 9. LiteLLM concern — mandatory, addressed directly

`litellm` is a core dependency of bare `pip install graflow` (confirmed,
Phase 0). This document does **not** claim "hosted integrations are
disabled" without naming the mechanism, per instruction:

- **Whether importing the modules needed for this experiment imports
  litellm**: `graflow`'s top-level `__init__.py` and its `core.workflow`/
  `core.decorators` modules (the minimum needed for a plain-Python-function
  task graph, no LLM task) were not confirmed line-by-line in Phase 0 — this
  is an **explicit, named Phase 2 verification step**, not assumed either
  way here. The mechanism to verify it: `python3.12 -c "import sys;
  import graflow; print('litellm' in sys.modules)"` run in a clean venv,
  plus `strace`/`dtrace` (or Python's own `-X importtime`) to see the full
  import chain.
- **Whether import/initialization performs network, telemetry, or
  environment discovery**: unverified from source reading alone — some LLM
  SDKs are known to probe environment variables or phone home for
  update-checks at import time. **The required Phase 2 test**: run the
  import inside a network-namespace-isolated or firewall-denied environment
  (e.g. a sandboxed subprocess with all outbound traffic blocked except to
  `127.0.0.1:11434`) and confirm the import and the full CAD workflow both
  complete with zero denied-connection errors. This is the literal
  "acceptance test must demonstrate no unintended outbound traffic"
  requirement from the original task brief, executed for the *dependency
  import itself*, not just the workflow logic.
- **Which hosted-provider environment variables could be inherited**:
  `litellm` conventionally reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `AZURE_API_KEY`, and similar — none of
  which this repository sets today (confirmed: `grep` across `.env.example`
  files and `docs/` found no such variables defined for this project), but
  a developer's own shell environment could have any of these set for
  unrelated reasons.
- **Subprocess environment reduction mechanism**: the Python subprocess is
  spawned with `env={}` merged with an explicit allowlist only —
  `PYTHONPATH` (if needed for the venv), `PATH` (trimmed to the venv's own
  `bin`), and nothing else. No `OPENAI_API_KEY`-shaped variable is ever
  passed through, whether or not it exists in the parent Tako process's
  environment. This is the concrete mechanism satisfying "reduce the
  subprocess environment to an explicit allowlist" — implemented in the
  TypeScript spawn call, not left as a documentation promise.
- **Dependency version/hash locking**: §4's `pip-compile`/hash-locked
  `requirements.lock`, `pip install --require-hashes` — covers `litellm`
  and all of its own transitive dependencies, pinned exactly.
- **Would vendoring out litellm violate the point of evaluating upstream
  Graflow?** **Yes.** Removing or patching out a core dependency to make the
  package "safer" means the experiment is no longer evaluating the actual
  thing that would ship — if litellm's presence is disqualifying, that is a
  finding about Graflow as shipped, not something to route around by
  forking it. This document does not propose vendoring.

## 10. Objective decision matrix

Ten criteria, weighted equally (1–5 scale, 5 = strongly favors that option),
scored from the evidence gathered in Phases 0–1, not from a prior preference
for either option.

| Criterion | Option A: Graflow subprocess | Option B: native TypeScript |
|---|---|---|
| Checkpoint/resume capability *as shipped* | 2 — real feature exists, but unsafe as-is per §8; would need as much custom code as building it natively | 3 — no built-in resume, but the workflow doesn't need it (§6.9) so this is a wash, not a deficit |
| Dependency burden | 1 — first Python runtime in the project; venv, version pinning, hash-locking, doctor-check, all new maintenance surface | 5 — zero new runtime; extends existing TS patterns |
| Mandatory litellm dependency | 1 — unavoidable per §9, unverified import-time network behavior is a real open risk | 5 — not applicable |
| cloudpickle/checkpoint exposure | 1 — confirmed unauthenticated pickle deserialization in the library's own default path (§8) | 5 — a hand-rolled JSON state file with atomic writes has no deserialization-of-arbitrary-objects risk class at all |
| Failure isolation | 3 — subprocess boundary does isolate a crash from the Bun process, same as Option B's child-process model would | 3 — identical isolation properties, since both use OS process boundaries for the actual `gbrain sync`/connector calls |
| Process management | 3 — Graflow's task/retry primitives exist, but this document is not enabling its default checkpoint-based resume, so most of that machinery goes unused for this workflow | 3 — no framework, but the workflow is 4 linear steps; a switch statement plus `lib/sync/schedule.ts`-style state is not a large amount of code |
| Cancellation | 3 — implementable equally in both (this document builds explicit SIGTERM/SIGKILL handling itself either way; Graflow doesn't provide this out of the box for a subprocess-wrapped external command) | 3 — same |
| Deployment/upgrade cost for an SME install | 1 — a second language runtime, its own security patch cadence, its own supply-chain surface (11 transitive core deps plus litellm's own tree) | 5 — ships as part of the existing Bun/TS toolchain already required |
| Benefit for a *future* workflow with real parallel branches or durable human pauses | 4 — this is genuinely Graflow's strength; a multi-branch, long-paused, human-approval-gated workflow is a materially different problem than CAD sync | 2 — native TS would need real design work (a proper state machine, not just a status field) to handle that shape well |
| Evidence maturity / uncertainty remaining | 2 — litellm import behavior and `gbrain sync` idempotency are both still unverified (§9, §6.9) — real unknowns, not resolved by this document | 4 — every piece of the native alternative (atomic JSON writes, `lib/sync/schedule.ts` patterns, child-process timeouts) is code already proven in this exact repo |
| **Total (of 50)** | **21** | **38** |

**Reading the matrix honestly**: Option A only leads on one criterion —
"benefit for a future workflow with real parallel branches or durable human
pauses" — and that workflow does not exist yet in this product. For the
*current* candidate workflow (CAD sync, a short linear pipeline with no
parallelism and no approval pause), the evidence gathered across two phases
does not support Option A.

## 11. Removal and fallback

- Existing direct connector commands (paths 1, 2) are untouched — this
  experiment adds a sixth, separate entry point, it does not modify any
  existing one.
- `sync-daemon.ts`'s scheduled path (4) and `omnibrain sync` (3) are
  untouched.
- A failure anywhere in the Python subprocess (crash, timeout, missing venv)
  is caught by the TypeScript wrapper and reported as a structured failure —
  it cannot corrupt `brain-sources/`, `config/sync-log.jsonl`, or the gbrain
  index beyond whatever partial state the underlying `gbrain sync`/connector
  calls themselves would already leave on any other kind of interruption
  (the same partial-write exposure that exists today, unrelated to Graflow).
- Disabling the experiment is a configuration change (removing/not calling
  the new route or CLI command) — no data migration, since no new persistent
  data format is introduced beyond append-only `SyncLogEntry` rows using
  the existing schema.
- Deleting the experiment's Python directory and venv leaves every existing
  Tako command fully operational, verified by the fact that nothing outside
  the new directory imports from it.
- No Graflow-specific state is ever the sole source of audit truth —
  `config/sync-log.jsonl` (existing, shared) and the workflow's own receipt
  file (new, but a plain JSON file readable without Graflow installed) are
  the durable records; a Graflow checkpoint, if ever enabled in a future
  phase, would be disposable/re-derivable, never authoritative.

## 12. Newly-discovered gaps (recorded, not fixed here)

1. **Universal connector governance/redaction does not exist** — only the
   MCP connector has it. Recommend: **separate GitHub issue**, since this
   affects every connector regardless of Graflow and is unrelated in scope
   to this experiment.
2. **Per-member authentication and source authorization are not
   implemented** — already tracked by the existing, unapproved design spec
   (`docs/superpowers/specs/2026-09-16-per-member-auth-design.md`).
   Recommend: no new issue — the existing spec already covers this; filing
   a duplicate would fragment tracking.
3. **Provenance coverage differs between sync entry points** (only path 5
   writes `sync-log.jsonl`). Recommend: **separate GitHub issue** — this is
   a real, independent gap discovered incidentally by this research, not
   something the experiment needs to fix to proceed, and it affects
   production paths 3/4 today regardless of any Graflow decision.
4. **Embedding behaviour differs/is duplicated across orchestration paths**
   (`embed --all` unconditionally in paths 3/4, vs. gated inline embedding
   plus the documented-but-unused `embed --stale` recovery path).
   Recommend: **separate GitHub issue** — again independent of Graflow,
   real, and low-risk to fix (swap `--all` for `--stale` in two call sites)
   once someone verifies `--stale`'s behavior matches expectations.
5. **No cancellation endpoint exists anywhere in Tako today.** Recommend:
   **no separate issue** — this is being built *as part of* this
   experiment (§6), scoped narrowly to the experiment's own workflows; if
   Phase 2/3 proceeds, generalizing it to the existing sync paths would be
   natural future work, but doesn't need to precede this experiment.

None of the above are fixed in this document, per instruction. Issues are
not filed yet, pending authorization.

## 13. Test strategy

- **TypeScript-side unit tests** (`node --test`, alongside the existing
  suite): allowlist rejection (non-`cad` connector name), path-traversal
  attempt in any identifier accepted from a request, workflow-id validation,
  timeout triggering `SIGTERM`→`SIGKILL`, environment-allowlist
  construction (assert the spawned env object contains only the allowlisted
  keys, never a passthrough of `process.env`), duplicate-provenance
  prevention on a simulated retry.
- **Python-side tests**: run via `pytest` as an entirely separate command
  (never folded into `npm test`), covering only the thin wrapper module
  this experiment writes — not Graflow's own internals, which are upstream's
  responsibility to test.
- **Fault injection** (Phase 2, not this phase): the 15-point list from the
  original task brief (stop-mid-run, duplicate idempotency key, tampered
  checkpoint [not applicable — resume disabled, so this becomes "confirm no
  resume path exists to tamper with"], path-traversal workflow ID,
  non-allowlisted connector, cancel mid-child-process, forced timeout, fake
  token in a simulated connector error confirmed redacted, network-silence
  confirmation for the litellm import, permission checks on state/log
  files, confirmation the direct non-experimental sync paths are unaffected,
  full existing suite green throughout).
- **No network-dependent automated test** is proposed for this phase or
  Phase 2's CAD-specific tests — CAD has none to depend on, which is the
  entire reason it was chosen.

## 14. Go/no-go recommendation

Per the required three-option framework, and reading directly from §10's
scored matrix:

**Recommendation: Option 3 — stop Graflow work on this candidate and
implement the reliability concepts natively in TypeScript**, with a named
condition for reconsideration.

Reasoning, stated plainly: the chosen first workflow — and it was chosen
deliberately as the *smallest, safest* possible harness, which was the
right choice for a Phase 0/1 spike — is exactly the shape
`docs/GRAFLOW_FUTURE_INTEGRATION.md`'s own "Reconsideration trigger" section
already warned about: "a few short linear flows." Every piece of reliability
this workflow actually needs (bounded retry, an idempotency key, atomic
state writes, a timeout, cancellation) is small, already has a proven
pattern elsewhere in this exact codebase (`lib/sync/schedule.ts`,
`lib/util/http-security.ts`'s atomic-write and rate-limit patterns), and
does not require Graflow's DAG/state-machine model at all. Meanwhile,
Graflow brings a confirmed, real security cost (unauthenticated pickle
deserialization as its default checkpoint mechanism, a mandatory
LLM-API-calling dependency with unverified import-time network behavior)
that would need to be substantially re-engineered around — not used as
shipped — to be safe, and a genuine new maintenance burden (the first
Python runtime in an otherwise all-Bun/TypeScript, SME-deployed product).

**This is not a permanent verdict on Graflow.** Section 10 shows it winning
clearly on exactly one axis: workflows with real parallel branches or
durable human-approval pauses, which do not exist in Tako today.

**Named reconsideration trigger** (mirroring `docs/GRAFLOW_FUTURE_INTEGRATION.md`'s
existing one, made concrete): reopen this evaluation if and when Tako has a
workflow that is genuinely non-linear (parallel connector fan-out with
independent failure/retry per branch) or genuinely needs a durable pause
measured in hours/days waiting on a human (e.g., a future document-release
workflow), where the cost of building that specific shape natively in
TypeScript is no longer small. At that point, re-run §8's threat-model
exercise against whatever Graflow version is current then, since the
checkpoint-security findings here are version-specific facts (`graflow==0.1.9`),
not a claim about the project's trajectory.

**If overridden**, the fallback is Option 2 (a strictly time-boxed
technology probe) rather than full Phase 2 production-track work — proceeding
straight to Option 1 is not supported by the evidence in §10 given the two
still-unverified, potentially disqualifying unknowns in §9 (litellm
import-time network behavior) and §6.9 (`gbrain sync` idempotency under
interruption).
