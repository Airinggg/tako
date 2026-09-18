# Meeting “Publish to Tako” Inbox — Implementation Plan

> **Execution rule:** implement this plan task-by-task with tests written first.
> Stop at every named security gate. Do not resume or merge anything from the
> stopped Graflow experiment.

**Goal:** Let a named person deliberately publish a locally transcribed meeting
into a Tako-controlled inbox, validate and index its transcript as internal
evidence, generate locally grounded decision/action/follow-up drafts, and send
those drafts through Tako’s existing human review model before they become
approved company knowledge.

**Architecture:** The transcriber and Tako remain independent programs. The
transcriber writes a small, atomic, integrity-digested package to a local inbox.
Tako claims and validates that package, writes one canonical meeting evidence
page, performs local-only structured extraction, and creates a normal
`ReviewItem`. A reconciler materializes only approved selections and records
rejections as visible append-only audit status. Nothing posts to Slack, email or
a calendar.

**Technology:** Python 3/Tkinter/OpenAI Whisper/Swift ScreenCaptureKit in the
transcriber; Bun/TypeScript/node:test/Ollama/gbrain in Tako. No new hosted API,
telemetry service or package dependency is required.

**Approved design:**
`docs/superpowers/specs/2026-09-18-meeting-publish-inbox-architecture.md`

---

## Execution boundaries

### Repositories and branches

- Tako work begins from `main` on a dedicated feature branch. The planning
  branch is `design/meeting-publish-inbox-plan`; implementation should use a
  separate branch such as `feat/meeting-publish-inbox` after this plan is
  approved.
- Do not implement on `experiment/graflow-local-orchestration` and do not copy
  its Python/Graflow work into this feature.
- `/Users/khewailing/Downloads/Alethia STAPS 2026/Local Meeting Transcriber`
  is **not currently a Git repository**. No transcriber source may be edited
  until the user chooses an approved private version-control destination or
  explicitly authorizes initializing a local repository. This is Gate 0.
- The generated `.app` is a build artifact, not the editing source of truth.
  Edit root Python/Swift sources, rebuild deterministically, then verify bundled
  resource hashes match the roots.

### Fixed product decisions

- Meeting classification is `internal` only. The UI does not offer `public`,
  `confidential`, or personal/highly restricted.
- The publisher is a named person and personally affirms consent. Until member
  authentication exists, the identity is explicitly “asserted, not verified.”
- Any reviewer may pick up the item from the existing queue. There is no
  meeting-specific reviewer role and no self-review-only path.
- A rejection remains visible in append-only audit status.
- `processed/` is a seven-day recovery/undo buffer with `0700` directories and
  `0600` files. It is not the 90-day content-retention policy.
- Transcript segments and metadata are the only evidence. The existing local
  extractive summary may be displayed as supplementary material but is never
  sent to the extraction model and never cited for decisions/actions.

### Test discipline

- Tako: add every new test file to the explicit `npm test` command in
  `package.json`; run the focused test first and `npm test` before each commit.
- Transcriber: use Python standard-library `unittest` and `unittest.mock`; do
  not add pytest or another package solely for this work.
- Fixtures contain synthetic Japanese/English meeting content only—no customer
  transcript, token, email, path, or recorded audio.
- Tests must not access the internet, the real Whisper cache, the real inbox,
  the real gbrain home, or the user’s transcriber outputs.

---

## Task 0: Establish clean implementation baselines and transcriber source control

**Files:**
- No product source changes.
- Verify: Tako `AGENTS.md`, both repositories’ status, current source hashes.

- [ ] **Step 1: Confirm the Tako implementation base**

From the eventual implementation worktree:

```bash
git branch --show-current
git status --short
git log -1 --oneline
npm test
```

Expected: the branch is based on current `main`; all 216 existing tests pass;
no Graflow files appear in the diff.

- [ ] **Step 2: Resolve transcriber version control before editing**

Check:

```bash
git -C "/Users/khewailing/Downloads/Alethia STAPS 2026/Local Meeting Transcriber" rev-parse --is-inside-work-tree
```

Current expected result: non-zero; it is not a repository.

Stop here until the user selects one of:

1. create a new private repository for the standalone app; or
2. initialize a local-only repository now and choose a remote later.

Do not silently copy the transcriber into Tako; the approved architecture keeps
the applications separate.

- [ ] **Step 3: Define the transcriber ignore set before its first commit**

Ignore at minimum:

```text
.DS_Store
__pycache__/
*.pyc
*.log
Aletheia Meeting Transcriber.app/
build/
dist/
```

Do not commit `~/.cache/whisper`, any model, audio, transcript or local output.

- [ ] **Step 4: Capture the clean source baseline**

Record hashes for the three source files and confirm bundled Python resources
currently match their root copies. Commit only source, README and launcher after
the user-authorized repository exists.

**Gate 0:** no later transcriber task begins until its source is recoverable in
version control.

---

## Task 1: Pin the approved contract as pure Tako types and validators

**Files:**
- Create: `lib/connectors/meetings/schema.ts`
- Create: `tests/connectors-meetings-schema.test.ts`
- Create: `tests/__fixtures__/meetings/valid/manifest.json`
- Create: `tests/__fixtures__/meetings/valid/transcript.jsonl`
- Modify: `package.json`

**Purpose:** Make the package contract executable without touching the
filesystem, gbrain or Ollama.

- [ ] **Step 1: Write failing schema tests**

Cover:

- valid schema `1.0` package;
- exact package type `tako.meeting`;
- meeting ID format `mtg_<lowercase UUIDv7>`;
- title, workspace, RFC 3339 timestamps and IANA timezone;
- `classification` must equal `internal`—`public`, `confidential`, and
  `personal-or-highly-restricted` all fail;
- required named `publisher.displayName`;
- `consent.affirmedByPublisher === true` and statement version `1.0`;
- optional organizer/participants are accepted but never inferred;
- required four analysis targets in the exact canonical set;
- exact allowlisted artifact basenames;
- SHA-256, byte-count, participant and string bounds;
- transcript JSONL segment ordering, monotonic IDs, timestamps, overlap limit,
  duration tolerance, `partial:false`, valid UTF-8 and no NUL bytes;
- `speaker`/`participantId` fields are rejected in v1 rather than silently
  trusted.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
node --experimental-strip-types --test tests/connectors-meetings-schema.test.ts
```

- [ ] **Step 3: Implement pure parsing/validation**

Export explicit types and results:

```ts
export type MeetingPackageManifestV1 = { /* approved spec exactly */ };
export type TranscriptSegmentV1 = { /* approved spec exactly */ };
export type ValidationError = { path: string; code: string; message: string };

export function validateMeetingManifest(value: unknown):
  { ok: true; value: MeetingPackageManifestV1 } |
  { ok: false; errors: ValidationError[] };

export function parseTranscriptJsonl(text: string, meetingDurationMs: number):
  { ok: true; segments: TranscriptSegmentV1[] } |
  { ok: false; errors: ValidationError[] };
```

Reject unknown keys in security-sensitive objects. Return every bounded
validation error so an operator can fix a package without leaking its content.

- [ ] **Step 4: Add the test file to `npm test` and run the full suite**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/meetings/schema.ts tests/connectors-meetings-schema.test.ts tests/__fixtures__/meetings package.json
git commit -m "Define the meeting inbox package contract"
```

---

## Task 2: Implement the secure inbox filesystem boundary

**Files:**
- Create: `lib/connectors/meetings/inbox.ts`
- Create: `lib/connectors/meetings/state.ts`
- Create: `tests/connectors-meetings-inbox.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing filesystem tests**

Use a fresh temporary root per test. Cover:

- root/state directories are canonical absolute paths and mode `0700`;
- files must be regular, owner-readable, mode no broader than `0600`, link
  count exactly one;
- symlinked package/file, hard link, FIFO, device, traversal, unexpected file,
  nested directory and oversized package all fail closed;
- importer ignores `.partial`, dot-files and names not ending `.meeting`;
- atomic `ready → processing` claim allows only one claimant;
- byte counts and SHA-256 match bytes actually read;
- file metadata is rechecked after open/read to catch replacement races;
- manifest is limited before JSON parsing and duplicate JSON keys fail;
- safe quarantine stores only ID/digest/reason code, never transcript text;
- state files and receipts use atomic temp-write/fsync/rename and mode `0600`;
- same meeting ID + digest is a no-op; changed digest is a conflict; identical
  transcript under another ID is `possible-duplicate`.

- [ ] **Step 2: Run focused test and confirm failure**

```bash
node --experimental-strip-types --test tests/connectors-meetings-inbox.test.ts
```

- [ ] **Step 3: Implement narrowly scoped filesystem primitives**

Suggested public surface:

```ts
export function ensureMeetingInbox(config: MeetingInboxConfig): Promise<void>;
export function listReadyPackages(root: string): Promise<string[]>;
export function claimPackage(root: string, name: string): Promise<ClaimedPackage>;
export function validateClaimedPackage(claim: ClaimedPackage, config: MeetingInboxConfig): Promise<ValidatedMeetingPackage>;
export function finishPackage(claim: ClaimedPackage): Promise<void>;
export function quarantinePackage(claim: ClaimedPackage, reason: SafeReason): Promise<void>;
```

Never construct a source path from `workspaceId`; resolve it through validated
operator config. Do not log `Error` objects from raw filesystem reads when they
may contain sensitive paths; translate them to bounded reason codes.

- [ ] **Step 4: Run focused and full tests**

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/meetings/inbox.ts lib/connectors/meetings/state.ts tests/connectors-meetings-inbox.test.ts package.json
git commit -m "Add the fail-closed local meeting inbox"
```

---

## Task 3: Render one canonical transcript evidence page

**Files:**
- Create: `lib/connectors/meetings/render.ts`
- Create: `tests/connectors-meetings-render.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing rendering tests**

Assert that rendering:

- always produces `meetings/<meetingId>.md` under the server-selected source;
- includes stable `seg_000001` anchors and timestamps;
- stamps meeting/workspace/package/transcript hashes and `internal` class;
- states that the transcript is machine-generated evidence and analysis is
  pending human review;
- includes named publisher/consent timestamp but not participant email in
  frontmatter;
- includes optional local summary only under “Supplementary, not evidence”;
- never places local summary text in a machine-readable evidence section;
- contains no original absolute path, audio, ChatGPT prompt or speaker claim;
- is deterministic for the same validated package.

- [ ] **Step 2: Implement `renderMeetingEvidence()`**

```ts
export function renderMeetingEvidence(pkg: ValidatedMeetingPackage): {
  relativePath: string;
  markdown: string;
};
```

Use existing `yamlString` helpers. Escape/normalize titles and metadata without
rewriting transcript evidence.

- [ ] **Step 3: Run tests and commit**

```bash
git add lib/connectors/meetings/render.ts tests/connectors-meetings-render.test.ts package.json
git commit -m "Render canonical meeting transcript evidence"
```

---

## Task 4: Add meeting inbox configuration, setup and doctor checks

**Files:**
- Create: `config/meeting-inbox.example.json`
- Modify: `.gitignore`
- Modify: `lib/connectors/shared/config.ts`
- Modify: `lib/cli/setup.ts`
- Modify: `lib/cli/doctor.ts`
- Modify: `scripts/doctor.ts`
- Modify: `tests/cli-setup.test.ts`
- Modify: `tests/cli-doctor.test.ts`
- Create: `tests/connectors-meetings-config.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing config/setup/doctor tests**

Test exact config behavior:

- absolute canonical inbox root only;
- `processedRecoveryDays` fixed/defaulted to seven with a bounded override only
  if a future policy explicitly allows it; for this implementation, reject
  values other than seven to preserve the approved decision;
- workspace IDs/labels/source IDs unique and path-safe;
- every workspace class exactly `internal`;
- source directory is server-owned config, never manifest input;
- setup scaffolds the example without overwriting a real config;
- doctor reports missing config as advisory before enablement, but invalid
  permissions/model/inbox state as failure when the feature is enabled;
- doctor never prints the absolute inbox path or publisher identity.

- [ ] **Step 2: Implement config and catalog projection**

Create a non-secret, owner-only projection at
`<inboxRoot>/workspace-catalog.json` containing only schema version, workspace
ID, label, fixed `internal` classification and catalog update time. The
transcriber reads this file; it never reads Tako’s full config.

- [ ] **Step 3: Extend setup/doctor without hosted checks**

Do not make doctor contact Whisper/GitHub. The model preflight lives in the
transcriber. Tako doctor verifies only local inbox/config/directory properties.

- [ ] **Step 4: Run full tests and commit**

```bash
git add .gitignore config/meeting-inbox.example.json lib/connectors/shared/config.ts lib/cli/setup.ts lib/cli/doctor.ts scripts/doctor.ts tests/cli-setup.test.ts tests/cli-doctor.test.ts tests/connectors-meetings-config.test.ts package.json
git commit -m "Add meeting inbox setup and local prerequisite checks"
```

---

## Task 5: Build the dedicated meetings connector/import command

**Files:**
- Create: `lib/connectors/meetings/run.ts`
- Create: `lib/connectors/meetings/import.ts`
- Modify: `lib/connectors/registry.ts`
- Modify: `lib/cli/dispatch.ts`
- Modify: `bin/omnibrain`
- Modify: `package.json`
- Create: `tests/connectors-meetings.test.ts`
- Modify: `tests/connectors-registry.test.ts`
- Modify: `tests/cli-dispatch.test.ts`

- [ ] **Step 1: Write a failing end-to-end importer test with temp paths**

Given one synthetic ready package, prove the importer:

1. claims once;
2. validates consent, class and hashes;
3. resolves workspace to configured source;
4. evaluates a local read with `lib/govern/policy.ts`;
5. writes exactly one canonical Markdown file atomically;
6. records bounded import + existing sync provenance;
7. moves package to `processed` with original `0700`/`0600` controls;
8. enqueues analysis state but performs no Slack/email/calendar operation;
9. is an idempotent no-op on retry.

Also prove rejection paths never write under `brain-sources`.

- [ ] **Step 2: Register the connector**

Add `meetings` as a tokenless, local connector with a conservative cadence.
Wire:

```text
omnibrain connect meetings
npm run connectors:meetings
connectors:all
sync-daemon
```

The connector performs package import only. The existing sync paths remain
responsible for `gbrain sync`; do not invoke a second hidden embedding path.

- [ ] **Step 3: Implement import receipts**

Persist owner-only append/atomic state under `config/meeting-import-state.json`
and `config/meeting-import-receipts.jsonl`. Receipts follow the approved bounded
schema and never include transcript, email, notes or filesystem paths.

- [ ] **Step 4: Run tests and commit**

```bash
git add lib/connectors/meetings lib/connectors/registry.ts lib/cli/dispatch.ts bin/omnibrain package.json tests/connectors-meetings.test.ts tests/connectors-registry.test.ts tests/cli-dispatch.test.ts
git commit -m "Import validated local meeting packages"
```

---

## Task 6: Add fail-closed local Whisper model resolution in the transcriber

**Files (transcriber repository):**
- Create: `whisper_local.py`
- Create: `tests/test_whisper_local.py`
- Modify: `meeting_transcriber.py`
- Modify: `live_transcribe_worker.py`

- [ ] **Step 1: Write failing unit tests before changing launch paths**

Test:

- model name resolves only through a fixed allowlist;
- cache path is canonical, regular, non-symlink and owner-readable;
- expected byte size and SHA-256 must match;
- missing/truncated/wrong/symlinked model fails without calling Whisper;
- the loader receives the exact verified `.pt` path, never `small` or another
  symbolic name;
- the subprocess environment contains only the explicit allowlist and excludes
  `OPENAI_API_KEY`, connector tokens, proxy variables and unrelated parent vars;
- the UI can list only verified local models;
- error messages name the model, not the user’s cache path.

- [ ] **Step 2: Pin verified model metadata**

Obtain model digests from the already-installed files and independently compare
them to the official Whisper model URL digest encoded by the installed Whisper
package. Do not invent or copy a digest from an unverified web page. Record only
supported models the product has actually tested.

- [ ] **Step 3: Replace both symbolic load paths**

- File CLI: pass `--model <verified-absolute-pt-path>`.
- Live worker: replace `--model` with explicit `--model-name` plus
  `--model-path`; revalidate inside the child, then call
  `whisper.load_model(model_path)`.
- Remove the fallback that returns `("small",)` when no cache exists.
- Disable Start when no verified model exists and show the separate deliberate
  installation guidance.

- [ ] **Step 4: Run an offline negative test**

Patch socket connection attempts to fail and use an empty temporary cache.
Assert the program returns the missing-model error and no connection was
attempted. This is the release gate for the “no automatic download” claim.

- [ ] **Step 5: Commit in the transcriber repository**

```bash
python3 -m unittest discover -s tests -v
git add whisper_local.py meeting_transcriber.py live_transcribe_worker.py tests/test_whisper_local.py
git commit -m "Fail closed when a local Whisper model is unavailable"
```

---

## Task 7: Build the transcriber’s pure atomic package writer

**Files (transcriber repository):**
- Create: `meeting_package.py`
- Create: `tests/test_meeting_package.py`
- Modify: `meeting_transcriber.py`
- Modify: `live_transcribe_worker.py`

- [ ] **Step 1: Write failing package-writer tests**

Using temporary directories, assert:

- generated meeting ID is `mtg_` + lowercase UUIDv7;
- manifest matches the approved schema and always uses `internal`;
- publisher name and personal consent affirmation are required;
- timestamp, timezone, organizer and known participants are preserved;
- file-mode Whisper JSON segments become ordered JSONL;
- live worker events are retained as structured segments, not only rendered
  strings;
- incomplete/partial segments cannot be published;
- no absolute source path, audio, subtitle, raw Whisper JSON, log or ChatGPT
  prompt enters the package;
- optional local summary is marked supplementary in the manifest;
- summary bytes never become transcript bytes or evidence hashes;
- every file is `0600`, directory `0700`;
- manifest is written/fsynced last and rename to `ready` is atomic;
- cross-device publish refuses before leaving a partial ready package;
- retry preserves meeting ID/nonce for the same logical publish attempt.

- [ ] **Step 2: Implement pure builder and writer layers**

Keep data construction testable without Tkinter:

```py
def build_manifest(...): ...
def segments_from_whisper_result(...): ...
def write_atomic_package(inbox_root, manifest, segments, local_summary=None): ...
```

Use exclusive creation, explicit modes, file fsync, directory fsync and
same-filesystem rename. Never follow symlinks.

- [ ] **Step 3: Preserve structured live segments**

Change the live panel from only `self.lines` to a structured segment list plus
a derived display. Saving the normal local transcript remains backward
compatible; publishing uses structured segments.

- [ ] **Step 4: Run tests and commit**

```bash
python3 -m unittest discover -s tests -v
git add meeting_package.py meeting_transcriber.py live_transcribe_worker.py tests/test_meeting_package.py
git commit -m "Write atomic local meeting packages for Tako"
```

---

## Task 8: Add the explicit “Publish to Tako” confirmation UI

**Files (transcriber repository):**
- Create: `tako_publish.py`
- Create: `tests/test_tako_publish.py`
- Modify: `meeting_transcriber.py`
- Modify: `README.md`

- [ ] **Step 1: Test the UI-independent publish form model**

Test catalog parsing, field validation and disclosure text separately from
Tkinter widgets:

- reads only `<inboxRoot>/workspace-catalog.json`;
- rejects unknown workspace or catalog class other than `internal`;
- requires publisher display name and personal affirmation;
- classification displays “Internal” but is not selectable;
- optional organizer/participants are never auto-filled from transcript text;
- disclosure states searchable scope and asserted-not-verified identity;
- Save and Publish remain distinct operations;
- no publish occurs until the final confirmation call.

- [ ] **Step 2: Add local publish configuration**

Store only the canonical inbox root and optional publisher profile in:

```text
~/Library/Application Support/Aletheia Meeting Transcriber/tako-publish.json
```

Create it as `0600`. It contains no Tako token. Validate that the selected root
contains the expected owner-only catalog and staging/ready directories.

- [ ] **Step 3: Build the dialog**

Add “Publish to Tako” after a completed file or live transcript. The modal
shows title, workspace, Internal classification, start/end/timezone, optional
organizer/participants, publisher, consent statement and copy/retention
disclosures. The final button calls the pure Task 7 writer.

Do not delete the original transcript. Show the user that the original remains
under the transcriber’s Outputs directory and is governed separately.

- [ ] **Step 4: Tests, manual keyboard check and commit**

```bash
python3 -m unittest discover -s tests -v
git add tako_publish.py meeting_transcriber.py README.md tests/test_tako_publish.py
git commit -m "Add explicit human-confirmed publishing to Tako"
```

Manual check: tab order, readable Japanese/English disclosure, disabled final
button until required fields are present, and no background publish.

---

## Task 9: Make the macOS application bundle reproducible

**Files (transcriber repository):**
- Create: `scripts/build_app.sh`
- Create: `scripts/verify_bundle.sh`
- Modify: `README.md`
- Build artifact: `Aletheia Meeting Transcriber.app` (not committed unless the
  user explicitly chooses release-artifact tracking)

- [ ] **Step 1: Script the existing manual bundle shape**

The build must:

- create the bundle directories;
- copy all Python modules required by the GUI/worker;
- compile `live_audio_capture.swift` for arm64 with the existing frameworks;
- copy launcher and `Info.plist` permission descriptions;
- never copy tests, models, transcripts, logs or config;
- fail on a compiler/copy error.

- [ ] **Step 2: Verify resource identity**

`verify_bundle.sh` compares SHA-256 for every root Python file against its
bundled copy, confirms binary architecture, checks plist keys and ensures no
forbidden file is present.

- [ ] **Step 3: Build and smoke-test**

Run unit tests first, build, then launch with network unavailable. Verify file
and live modes show only verified cached models and missing models never start a
download.

- [ ] **Step 4: Commit scripts/docs, not generated secrets/content**

```bash
git add scripts/build_app.sh scripts/verify_bundle.sh README.md
git commit -m "Make the local transcriber app bundle reproducible"
```

**Gate 1:** do not start Tako’s model extraction work until a real package
produced by the rebuilt app passes Tako’s schema/inbox validator offline.

---

## Task 10: Implement local transcript analysis and evidence verification

**Files:**
- Create: `lib/meetings/analysis.ts`
- Create: `lib/meetings/prompt.ts`
- Create: `tests/meetings-analysis.test.ts`
- Create: `tests/__fixtures__/meetings/japanese-decisions.jsonl`
- Create: `tests/__fixtures__/meetings/japanese-no-evidence.jsonl`
- Create: `tests/__fixtures__/meetings/prompt-injection.jsonl`
- Modify: `package.json`

- [ ] **Step 1: Write failing pure parser/verifier tests**

Assert:

- strict `MeetingAnalysisDraftV1` parse with bounded arrays/strings;
- only transcript segment IDs exist in evidence;
- timestamps match cited segments;
- normalized excerpt is actually contained in cited segment text;
- owner/due date is dropped unless explicitly present in cited evidence;
- no evidence means no candidate claim;
- local summary is absent from every prompt input;
- transcript instructions cannot alter schema, approve a review, call tools or
  generate a state mutation;
- necessity question is exactly human-review language, never a declaration
  that a meeting is unnecessary;
- forbidden speaking-time, silence, emotion, nationality, fluency, seniority or
  productivity signals are rejected;
- `repeated-unresolved-topic` requires a recurrence ID plus cited prior
  approved meeting evidence; otherwise it cannot be emitted.

- [ ] **Step 2: Implement bounded transcript chunking**

Never send the maximum 10 MiB transcript in one prompt. Split on segment
boundaries to a configured character/token budget with small overlap. Each
chunk returns candidate findings with segment IDs. Validate every chunk before
merge; deduplicate only when normalized claim + overlapping evidence match.

Run a final local pass over the bounded, validated candidate set for the
necessity question/follow-up shape. The final pass sees candidate summaries and
segment excerpts—not unchecked local-summary text.

- [ ] **Step 3: Use explicit system/document separation**

Reuse the principles in `buildAnswerPrompt`: transcript is untrusted data. Use
the existing local `ollamaAnswer` seam with temperature zero and a strict JSON
request. Do not expose model output to approval or mutation functions.

- [ ] **Step 4: Test with a fake model function**

Make model invocation injectable. Unit tests must not run Ollama. Add one
manual local-model evaluation later under Gate 3, not to the default suite.

- [ ] **Step 5: Commit**

```bash
git add lib/meetings tests/meetings-analysis.test.ts tests/__fixtures__/meetings package.json
git commit -m "Extract evidence-backed meeting review drafts locally"
```

---

## Task 11: Bridge meeting drafts into the existing append-only review queue

**Files:**
- Create: `lib/review/store.ts`
- Create: `lib/meetings/review.ts`
- Create: `lib/meetings/review-state.ts`
- Create: `tests/meetings-review.test.ts`
- Modify: `scripts/demo.ts`
- Modify: `tests/tako-ui.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Extract a safe shared review store first**

Write tests that preserve all current review behavior while moving
read/modify/write out of `scripts/demo.ts`. The store must use a single-process
mutex plus `writePrivateFileAtomic`/equivalent mode `0600`; it cannot regress
append-only decisions or allow stale verdicts.

- [ ] **Step 2: Test deterministic meeting review creation**

One validated analysis draft creates one `ReviewItem`:

- deterministic ID from meeting ID + transcript hash + analysis schema;
- purpose/audience/body as specified;
- sources include canonical meeting page + segment anchors;
- `submittedBy` identifies the local meeting-analysis worker;
- checks begin in normal unapproved state;
- no auto-approval, special reviewer or self-review rule;
- rerun is idempotent and never duplicates the queue item.

- [ ] **Step 3: Store structured candidates outside free-form review body**

Use owner-only `config/meeting-review-state.json` keyed by review ID. Store
candidate IDs and reviewer selections. The `ReviewItem.body` is a human-readable
projection, not the source parsed back for materialization.

- [ ] **Step 4: Add reviewer selection support**

Before approval, the existing Approvals detail view may include/exclude
candidate decisions/actions and accept/decline the necessity/follow-up draft.
Every selection update requires the same admin/named-reviewer gate as the
decision endpoint and appends a bounded audit event. Approval applies only the
current selection. “Request changes” publishes nothing.

- [ ] **Step 5: Preserve rejection visibly**

On `rejected`, keep the named append-only decision and set meeting analysis
audit status to `rejected`; do not copy rejected claims into approved content.
Expose the status in the queue/history without hiding the item.

- [ ] **Step 6: Run tests and commit**

```bash
git add lib/review/store.ts lib/meetings scripts/demo.ts tests/meetings-review.test.ts tests/tako-ui.test.ts package.json
git commit -m "Route meeting analyses through the existing review queue"
```

---

## Task 12: Reconcile review decisions into the canonical meeting page

**Files:**
- Create: `lib/meetings/reconcile.ts`
- Create: `tests/meetings-reconcile.test.ts`
- Modify: `lib/connectors/meetings/render.ts`
- Modify: `lib/connectors/meetings/run.ts`
- Modify: `package.json`

- [ ] **Step 1: Write state-transition tests**

Cover:

- pending/revise/escalated: transcript stays, no approved derived sections;
- approved: only selected evidence-valid candidates materialize;
- rejected: visible audit status and reviewer/timestamp, no rejected claims;
- repeat reconciliation is byte-identical/idempotent;
- transcript/package hash mismatch blocks reconciliation;
- a citation invalidated after draft creation blocks publication and marks an
  operator-safe failure;
- page update is atomic and provenance records the new content hash;
- gbrain sync failure never reports successful publication.

- [ ] **Step 2: Implement a reconciler, not an HTTP side effect**

The review-decision route writes the decision and returns normally. A separate
idempotent reconciliation step reads terminal review decisions and updates the
page. This avoids a half-committed HTTP request where the review is saved but
the page write/sync fails.

Run reconciliation in the meetings connector pass and expose a focused CLI
command for recovery. Do not add delivery.

- [ ] **Step 3: Commit**

```bash
git add lib/meetings/reconcile.ts lib/connectors/meetings/render.ts lib/connectors/meetings/run.ts tests/meetings-reconcile.test.ts package.json
git commit -m "Materialize only approved meeting findings"
```

---

## Task 13: Add the real meeting workflow to Tako’s UI without pretending it delivers

**Files:**
- Modify: `scripts/demo.ts`
- Modify: `tests/tako-ui.test.ts`
- Optionally modify: `scripts/tako/mascot.ts` only if separately approved; the
  mascot replacement is not required for this meeting feature.

- [ ] **Step 1: Add failing UI contract tests**

Assert the customer-facing UI:

- shows “Local meeting review” as a built-in workflow only after its importer
  and analysis path exist;
- reports inbox status, last import, pending analysis/review and failures;
- labels classification “Internal”; no Public/Confidential choice;
- never asks for an API token;
- explains publisher identity is asserted until member login exists;
- Approvals shows transcript evidence links and candidate selection;
- necessity copy is a question for review;
- rejection remains visible in history;
- there is no “Send,” “Post,” “Schedule,” “Cancel meeting,” or delivery-success
  claim;
- no participant-speaking metrics appear.

- [ ] **Step 2: Add bounded read/status endpoints**

Read routes return counts/status only. Mutating routes—manual import, selection
change, retry—remain behind existing administration protection and rate limits.
Use `safeErrorResponse`; never return a filesystem path, transcript in an error,
or raw local-model output.

- [ ] **Step 3: Do not misuse the generic template builder**

The current builder writes only `SKILL.md` and does not run or deliver. Present
meeting review as a product-owned local workflow backed by the real importer,
not as another decorative template. A generic template can be added only after
the automation system itself can instantiate this concrete runner honestly.

- [ ] **Step 4: Run tests, visual check and commit**

```bash
npm test
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Expose the governed local meeting review workflow"
```

---

## Task 14: Enforce the seven-day recovery buffer and bounded cleanup

**Files:**
- Create: `lib/meetings/retention.ts`
- Create: `tests/meetings-retention.test.ts`
- Modify: `lib/connectors/meetings/run.ts`
- Modify: `docs/DATA_RETENTION.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing retention tests**

Use stored `processedAt`, not mutable file mtime. Prove:

- processed package younger than seven days remains;
- package older than seven days is securely unlinked from the recovery area;
- cleanup never follows links or leaves content in temp files;
- cleanup preserves `0700`/`0600` until deletion;
- quarantine uses its separately documented window;
- canonical page/index is unaffected by processed cleanup;
- audit receipt says recovery-copy purged, not meeting-content deleted;
- canonical meeting deletion removes source page, review draft/state and index
  only through the existing explicitly destructive operator procedure.

- [ ] **Step 2: Run cleanup during each importer pass**

Keep it idempotent and bounded. A cleanup error must not cause a newly ready
package to be accepted without validation, and an import error must not disable
later cleanup.

- [ ] **Step 3: Update retention documentation and commit**

State clearly:

- 7 days = inbox recovery/undo buffer;
- 90 days = current general content-policy default;
- the original transcriber output is a third copy and must be deleted
  separately for complete erasure.

```bash
git add lib/meetings/retention.ts lib/connectors/meetings/run.ts tests/meetings-retention.test.ts docs/DATA_RETENTION.md package.json
git commit -m "Enforce the meeting inbox recovery window"
```

---

## Task 15: Complete operator documentation and security evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/BRAIN_CONNECTORS.md`
- Modify: `docs/BRAIN_SETUP.md`
- Modify: `docs/PROTOTYPE_SECURITY_CHECKLIST.md`
- Modify: `docs/SECURITY_INCIDENT_RUNBOOK.md`
- Modify: `docs/BACKUP_RESTORE_RUNBOOK.md`
- Modify: `docs/DATA_RETENTION.md`
- Create: `docs/MEETING_INBOX_RUNBOOK.md`
- Create: `docs/audit/<date>-meeting-inbox-security-test.md`
- Update the Japanese function catalog used for future product presentations.

- [ ] **Step 1: Document setup without overstating security**

Include:

- same-machine/customer-controlled filesystem requirement;
- Internal-only classification;
- asserted publisher identity limitation until per-member auth;
- exact consent behavior;
- local Whisper installation is a deliberate network action, while meeting use
  is offline and fail-closed;
- no audio/ChatGPT prompt import;
- local summary is supplementary only;
- reviewer workflow and visible rejection audit;
- no automatic delivery/scheduling;
- source-level member isolation remains absent;
- deletion across transcriber output, processed copy, source page/index and
  review state.

- [ ] **Step 2: Add incident procedures**

Cover disabling the meetings connector, moving `ready` to protected quarantine,
preserving receipts without transcript content, model/hash mismatch, accidental
wrong-workspace publication, consent dispute, and complete deletion request.

- [ ] **Step 3: Record executed evidence, not assertions**

The audit document must contain commands/results for the acceptance run in Task
16. Do not mark a checklist row “pass” until that real transcript exists.

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "Document the governed local meeting workflow"
```

---

## Task 16: Full acceptance and pilot gate

**Files:**
- No new product file unless a verified defect requires a separately reviewed
  fix.
- Update: audit transcript from Task 15 with actual results.

- [ ] **Step 1: Run both complete automated suites**

Transcriber:

```bash
python3 -m unittest discover -s tests -v
```

Tako:

```bash
npm test
```

Expected: zero failures. Do not normalize pre-existing failures as acceptable;
the current Tako baseline is 216/216 passing.

- [ ] **Step 2: Run the offline model tests**

With outbound networking denied:

1. empty test model cache → file and live transcription refuse;
2. wrong digest → refuse;
3. verified local model → load exact path and transcribe a synthetic/public
   short sample;
4. prove no DNS/socket attempt occurred.

- [ ] **Step 3: Execute a synthetic Japanese end-to-end meeting**

1. save transcript locally;
2. open Publish to Tako;
3. choose workspace, see fixed Internal class;
4. enter named publisher and affirm consent;
5. inspect package permissions/content;
6. import through real connector;
7. verify one canonical evidence page and gbrain retrieval;
8. generate local candidate decisions/actions with segment citations;
9. verify local summary text was not used;
10. select candidates in Approvals;
11. approve and reconcile;
12. confirm only selected findings appear;
13. repeat with rejection and confirm visible audit status/no derived claims;
14. verify no Slack/email/calendar/network delivery occurred.

- [ ] **Step 4: Execute adversarial cases**

Run actual fixtures for traversal, symlink, hardlink, oversized transcript,
wrong hash, duplicate conflict, prompt injection, invented citation, forbidden
participation reasoning, disallowed class and missing consent. Confirm every one
fails closed with content-free logs.

- [ ] **Step 5: Test crash recovery and retention**

Interrupt after claim, page write, analysis queue and approval decision. Restart
and prove no duplicate page/review. Advance an injected clock beyond seven days
and verify only the processed recovery copy is removed.

- [ ] **Step 6: Inspect secrets and local artifacts**

```bash
git status --short
git diff --check
```

Run the repository’s existing secret scan/audit procedure. Confirm no package,
transcript, model, inbox path, config, gbrain data or app bundle was committed.

- [ ] **Step 7: Final Tako commit and review**

Commit only the executed audit transcript if product code did not change:

```bash
git add docs/audit/<date>-meeting-inbox-security-test.md
git commit -m "Record meeting inbox acceptance evidence"
```

Request independent review before merging. Do not push/merge automatically
unless the user explicitly authorizes it.

---

## Final implementation completion criteria

The feature is complete only when all are true:

- the transcriber source is version-controlled and reproducibly bundles;
- missing/unverified Whisper models cannot cause a download;
- Save and Publish are separate explicit actions;
- package publication is atomic and owner-only;
- only Internal packages with named publisher consent are accepted;
- Tako imports one canonical transcript evidence page;
- local summary is excluded from evidence/extraction;
- every derived claim has verified transcript-segment evidence;
- meeting necessity is a human-review question with forbidden participation
  logic structurally rejected;
- any existing reviewer may approve through the normal append-only queue;
- rejection stays visible and publishes no derived claim;
- automation/worker code sends nothing externally;
- seven-day processed cleanup is proven distinct from content retention;
- deletion/incident/runbook paths are documented and exercised;
- both full suites and all security acceptance cases pass;
- an independent reviewer approves the diff and evidence.

## Explicitly deferred

- Per-member authentication and source-aware authorization.
- Confidential or personal/highly restricted meetings.
- Speaker diarization and participation analysis.
- Calendar/free-busy connection or actual scheduling.
- Slack/email/calendar delivery.
- Hosted transcription or summarization.
- Cross-machine/cloud package transport.
- Automatic deletion of the transcriber’s original output.
- Graflow or any other orchestration runtime.
