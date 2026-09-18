# Meeting “Publish to Tako” Inbox — Architecture Specification (Phase 1)

**Status:** Approved for implementation planning on 2026-09-18. No
implementation code or dependency installation is authorized by this document.

**Decision already made:** use an explicit local publish boundary:

```text
Local Meeting Transcriber
  → user confirms title, workspace, consent and classification
  → atomic local meeting package
  → Tako-controlled import inbox
  → validation and policy checks
  → local extraction and human review
  → gbrain
```

Plain Notes-connector reuse is rejected because it would index the transcript,
summary and ChatGPT prompt as duplicate content. Tako invoking the transcriber
as a subprocess is rejected because it couples a server process to a macOS GUI,
ScreenCaptureKit permissions, an arm64 Whisper environment and inherited
process credentials.

## 0. Objective and non-goals

### Objective

Define a local-only, fail-closed contract that lets a person deliberately
publish one completed meeting from the standalone transcriber into the correct
Tako workspace. The feature must:

1. preserve the transcript as evidence;
2. ask Tako’s local model to extract candidate decisions and open actions;
3. create an evidence-backed question about whether another meeting is useful;
4. suggest the shape and timing window of a follow-up only when unresolved work
   justifies one;
5. require a named person to approve derived claims before they become an
   approved meeting record or trigger any external action.

### Non-goals

- No automatic meeting cancellation, rescheduling or invitation creation.
- No Slack, email, calendar or hosted-model delivery.
- No speaker diarization or participation scoring.
- No employee-performance scoring.
- No inference that a quiet attendee did not contribute.
- No audio ingestion into Tako.
- No import of the transcriber’s ChatGPT prompt file.
- No network share, iCloud, Dropbox or other hosted transfer mechanism.
- No change to the stopped Graflow experiment.
- No claim that current Tako provides per-member source isolation. It does not.

## 1. System boundary

The transcriber and Tako remain separate applications. Neither imports the
other’s runtime or starts the other as a child process.

The only integration surface is a local filesystem inbox configured and owned
by the Tako operator. The transcriber receives only a publish destination and
the workspace choices that the operator has made available. It receives no
Notion, Slack, Drive, Discord, gbrain or Tako administration credentials.

The v1 contract assumes both applications run for the same customer on the
same customer-controlled macOS machine, or on storage mounted directly from a
customer-controlled local system. Moving packages between unrelated machines
is out of scope until a separately reviewed authenticated transport exists.

## 2. Directory and state model

Tako owns one root that is not inside the source repository:

```text
<meetingInboxRoot>/
  staging/       # transcriber writes here; importer never reads it
  ready/         # complete packages visible to importer
  processing/    # importer has atomically claimed the package
  processed/     # accepted package retained briefly for recovery/audit
  quarantine/    # rejected/conflicting package plus non-sensitive reason
```

Required permissions:

- inbox root and every state directory: `0700`;
- package directories: `0700`;
- files: `0600`;
- no symlinks or hard-linked files;
- the inbox root must be a canonical, operator-configured absolute path;
- browser input must never choose or override this path.

Package lifecycle:

```text
staging/.<meetingId>.<nonce>.partial
  → fsync every file
  → write and fsync manifest.json last
  → fsync staging directory
  → atomic rename on the same filesystem
ready/<meetingId>.meeting
  → atomic importer claim
processing/<meetingId>.meeting
  → validate and ingest
processed/<meetingId>.meeting

invalid or conflicting package
  → quarantine/<meetingId>.<timestamp>.meeting
```

The transcriber must refuse to publish when `staging` and `ready` are not on
the same filesystem, because a cross-device move is not atomic.

The importer reads only names ending in `.meeting` inside `ready`. It ignores
partial, dot-prefixed and unknown entries. It opens files relative to an
already-opened package directory, rejects path traversal, and rechecks file
identity and metadata before moving the package to `processed` so a validation
check cannot be separated from the bytes actually imported.

## 3. Operator configuration

Proposed local configuration, written owner-only with Tako’s existing atomic
private-file pattern:

```json
{
  "schemaVersion": "1.0",
  "inboxRoot": "/absolute/customer-controlled/path/tako-meeting-inbox",
  "processedRecoveryDays": 7,
  "workspaces": [
    {
      "id": "engineering",
      "label": "Engineering",
      "sourceId": "engineering-meetings",
      "classification": "internal",
      "retentionDays": 90,
      "enabled": true
    }
  ]
}
```

Proposed path: `config/meeting-inbox.json`, mode `0600`, ignored by Git.

`workspace.id` is a lookup key, never a filesystem path. `sourceId` is selected
server-side from this configuration; the manifest cannot invent a gbrain
source. Workspace IDs must match `^[a-z0-9][a-z0-9-]{0,62}$` and be unique.

### Current source-authorization limitation

Tako’s current authenticated-user design does not enforce source permissions
per member. Meeting packages therefore accept **`internal` only** in v1. The
publish UI does not offer `public`: meeting content has no genuine public-use
case and offering that choice would invite misclassification. `confidential`
and `personal-or-highly-restricted` remain excluded until real per-member
source isolation and the stricter controls in `docs/COMPANY_SECURITY_BASELINE.md`
exist. Every other classification is quarantined.

Creating a separate gbrain source per workspace improves provenance but does
not, by itself, provide member isolation. The UI and setup documentation must
say this plainly.

## 4. Exact inbox package contract

### 4.1 Allowed files

An accepted v1 package contains exactly:

```text
<meetingId>.meeting/
  manifest.json
  transcript.jsonl
  local-summary.md       # optional, non-authoritative supplementary material
```

Audio, subtitle files, Whisper’s raw JSON, absolute source paths, log files and
`ChatGPT summary prompt.txt` are forbidden. Unknown files fail validation
rather than being silently ignored.

Limits:

| Item | Limit |
|---|---:|
| `manifest.json` | 64 KiB |
| `transcript.jsonl` | 10 MiB |
| `local-summary.md` | 1 MiB |
| complete package | 12 MiB |
| transcript segments | 20,000 |
| one segment’s UTF-8 text | 16 KiB |
| participants | 500 |

All text must be valid UTF-8 without NUL bytes.

### 4.2 `manifest.json`

```ts
type MeetingPackageManifestV1 = {
  schemaVersion: "1.0";
  packageType: "tako.meeting";

  meeting: {
    id: string;                    // "mtg_" + lowercase UUIDv7
    title: string;                 // human-confirmed, 1–200 Unicode chars
    workspaceId: string;           // must resolve through operator config
    classification: "internal";   // the only accepted v1 meeting class
    startedAt: string;             // RFC 3339 with numeric offset or Z
    endedAt: string;               // RFC 3339, strictly after startedAt
    timezone: string;              // IANA name, e.g. "Asia/Tokyo"
    organizer?: PersonRef;         // only when supplied, never inferred
    participants?: PersonRef[];    // only known invitees/confirmed attendees
    recurrence?: {
      seriesId?: string;           // opaque local/customer calendar reference
      cadenceLabel?: string;       // display only, never parsed into scheduling
    };
  };

  publisher: {
    memberId?: string;             // reserved for future named-user auth
    displayName: string;           // required named person, 1–120 chars
    email?: string;                // optional until member auth exists
  };

  consent: {
    affirmedByPublisher: true;      // false/missing is an unconditional reject
    affirmedAt: string;            // RFC 3339
    statementVersion: "1.0";       // exact affirmation copy presented in UI
    note?: string;                 // optional, 0–500 chars
  };

  capture: {
    mode: "file" | "live";
    transcriberVersion: string;
    whisperModel: string;
    whisperModelSha256: string;     // "sha256:" + 64 lowercase hex chars
    language: string;               // BCP 47 where known, otherwise "und"
    outputMode: "transcribe" | "translate-to-english";
    completedAt: string;            // RFC 3339
  };

  artifacts: {
    transcript: ArtifactRef & { mediaType: "application/x-ndjson" };
    localSummary?: ArtifactRef & { mediaType: "text/markdown" };
  };

  analysisRequest: {
    schemaVersion: "1.0";
    targets: [
      "candidate-decisions",
      "candidate-open-actions",
      "meeting-necessity-review",
      "follow-up-need"
    ];
  };

  package: {
    createdAt: string;              // RFC 3339
    createdBy: string;              // local transcriber identity/version
    nonce: string;                  // 128-bit random base64url value
  };
};

type PersonRef = {
  displayName: string;              // 1–120 chars
  email?: string;                   // optional; normalized only after validation
  externalId?: string;              // opaque; no provider token or URL
};

type ArtifactRef = {
  path: string;                     // exact allowlisted basename only
  bytes: number;
  sha256: string;                   // "sha256:" + 64 lowercase hex chars
};
```

The manifest deliberately excludes the original file’s absolute path. It also
does not contain a speaker identity or per-person contribution measure because
the current capture pipeline cannot support either claim. The publisher is a
named person who personally makes the consent affirmation; v1 does not invent
a separate consent-confirmer role. Until per-member authentication is built,
this is an asserted identity rather than a cryptographically verified login,
and the UI must state that limitation. The `publisher` object can later bind to
an authenticated `memberId` without migrating existing meeting records.

### 4.3 `transcript.jsonl`

One JSON object per line, ordered by time:

```ts
type TranscriptSegmentV1 = {
  schemaVersion: "1.0";
  id: string;                  // seg_000001, monotonically increasing
  startMs: number;             // integer >= 0
  endMs: number;               // integer > startMs
  text: string;                // non-empty UTF-8
  language: string;            // BCP 47 or "und"
  partial: false;              // incomplete live chunks cannot be published
};
```

Rules:

- segment IDs and timestamps must be strictly ordered;
- overlap greater than two seconds is rejected unless a later schema explicitly
  defines overlapping channels;
- `endMs` cannot exceed meeting duration by more than 30 seconds;
- blank/silence segments are omitted;
- no `speaker`, `participantId` or inferred ownership field exists in v1;
- a transcript must contain at least one valid segment.

## 5. Human publish confirmation

“Save transcript” and “Publish to Tako” are different actions. Saving never
publishes implicitly.

Before publishing, the transcriber presents one confirmation form containing:

1. meeting title;
2. workspace selected from the operator allowlist;
3. fixed classification `Internal` (displayed, not user-selectable);
4. start/end time and timezone;
5. organizer and participants, explicitly marked optional;
6. the named publisher’s identity and personal consent affirmation;
7. a disclosure that transcript and metadata will be copied into Tako and
   become searchable under that workspace’s current access model;
8. a disclosure that Tako will generate review drafts, not automatic judgments.

The publish button remains disabled until a workspace is selected, the named
publisher personally affirms consent and all required fields validate. The
affirmation and its wording version are stored in the manifest; checking the
box is not presented as legal advice or proof that every jurisdictional
requirement has been satisfied.

## 6. Fail-closed Whisper model preflight

The current transcriber calls Whisper by model name. OpenAI Whisper can download
a model when the named cache file is absent. That behavior is incompatible with
the local-only guarantee.

Phase 2 must introduce one shared preflight used by both file and live modes:

```text
selected model name
  → resolve through a fixed local allowlist
  → canonical cache path
  → lstat: regular file, not symlink
  → owner/read permissions check
  → size check
  → SHA-256 verification against the pinned allowlist digest
  → load Whisper from the exact local file path, never from the model name
```

Required behavior:

- If the selected model is not cached, unreadable, symlinked, truncated or has
  the wrong digest, transcription refuses to start.
- The error says which model is unavailable and directs the operator to the
  separate, deliberate installation procedure.
- The meeting UI contains no automatic-download fallback.
- `whisper.load_model()` receives the verified absolute `.pt` file path. It
  must not receive a symbolic model name that invokes Whisper’s downloader.
- Supported model names and expected digests are pinned in product-owned local
  configuration or code; the transcriber never fetches this allowlist.
- The selected model path and verified digest are recorded in memory, but only
  the model name and digest enter the meeting manifest.
- Child processes receive an explicit environment allowlist. Connector tokens,
  hosted-model keys and unrelated parent environment variables are not copied.
- An automated offline test must deny network access, clear the test cache and
  prove that a missing model fails without any connection attempt.
- A second offline test supplies a valid local fixture/model seam and proves
  both file and live paths use that exact local path.

Model installation remains an explicit operator task outside a meeting. The
installation guide must disclose that downloading a model is a network action;
ordinary transcription remains offline.

## 7. Import validation and fail-closed behavior

Validation order is fixed:

1. claim package by atomic rename from `ready` to `processing`;
2. validate directory/file type, ownership, permissions, link count and names;
3. enforce file-count and byte limits before reading content;
4. parse manifest with duplicate-key rejection;
5. require exactly schema `1.0` and package type `tako.meeting`;
6. validate every field, timestamp, enum and cross-field invariant;
7. require `consent.affirmedByPublisher === true` and a named publisher;
8. resolve workspace through server-owned configuration;
9. enforce that workspace’s classification allowlist;
10. verify artifact byte counts and SHA-256 digests;
11. parse every transcript line and validate ordering/duration;
12. compute a package digest over canonical manifest plus artifact digests;
13. check idempotency/conflicts;
14. evaluate the local read against Tako’s policy boundary;
15. write the canonical evidence page atomically;
16. record provenance and invoke the normal gbrain sync path;
17. enqueue local analysis;
18. move the claimed package to `processed`.

No transcript content appears in an error response or log. Quarantine records
only package ID, package digest, failure code, timestamp and operator-safe
summary.

### Idempotency

Importer state keys on `meeting.id`:

- same meeting ID + same package digest: idempotent no-op;
- same meeting ID + different digest: quarantine as `meeting-id-conflict`;
- different meeting ID + identical transcript digest: quarantine as
  `possible-duplicate` for human review, never silently merge;
- crash before evidence-page rename: safe retry from `processing`;
- crash after page write but before state update: reconcile page hash and
  package digest, then complete without a duplicate page.

Importer state and receipts are owner-only atomic JSON initially. If Tako is
ever run as multiple processes, this storage must move to a transactional
shared store before enabling concurrent importers.

## 8. Canonical gbrain representation

One stable page per meeting avoids the Notes connector’s duplication problem:

```text
brain-sources/<sourceId>/meetings/<meetingId>.md
```

Initial accepted page:

```markdown
---
source: meetings
meeting_id: mtg_...
workspace: engineering
classification: internal
title: ...
started_at: ...
ended_at: ...
consent_confirmed: true
package_sha256: ...
analysis_status: pending_review
---

# <human-confirmed title>

> This transcript is locally generated evidence. Names, wording and assignments
> may contain transcription errors. Derived decisions and actions are not yet
> approved.

## Meeting details
...

## Transcript

<a deterministic rendering of transcript segments with stable segment anchors>
```

The raw transcript becomes searchable evidence after consent, workspace and
classification validation. Candidate decisions/actions are not added to the
approved page at this point. `local-summary.md`, when present, is shown only as
non-authoritative supplementary material. It is excluded from the local-model
extraction prompt and cannot support a decision, action, necessity signal or
follow-up recommendation; only transcript segments may be cited as evidence.

After human approval, the same stable page is atomically updated with:

```markdown
## Approved decisions
## Approved open actions
## Meeting-cadence review
## Follow-up recommendation
## Approval record
```

Each derived bullet cites one or more transcript segment IDs. Updating the same
page preserves meeting identity and prevents a second, conflicting copy from
entering retrieval.

## 9. Local extraction result contract

Tako’s local model produces a draft with this logical shape:

```ts
type MeetingAnalysisDraftV1 = {
  schemaVersion: "1.0";
  meetingId: string;
  generatedAt: string;
  model: string;                    // local model identifier
  transcriptSha256: string;

  candidateDecisions: Array<{
    id: string;
    statement: string;
    status: "candidate";
    evidence: EvidenceRef[];
    confidence: "low" | "medium" | "high";
  }>;

  candidateOpenActions: Array<{
    id: string;
    task: string;
    owner?: string;                 // only if explicitly stated in evidence
    dueAt?: string;                 // only if explicitly stated
    status: "candidate";
    evidence: EvidenceRef[];
    confidence: "low" | "medium" | "high";
  }>;

  meetingNecessityReview: {
    question: "この会議を継続する必要があるか確認しますか？";
    recommendation:
      | "insufficient-evidence"
      | "review-recurring-cadence"
      | "consider-async-update"
      | "follow-up-discussion-may-be-useful";
    signals: Array<{
      type:
        | "no-explicit-agenda"
        | "no-explicit-decision"
        | "no-explicit-open-action"
        | "information-sharing-only"
        | "repeated-unresolved-topic";
      explanation: string;
      evidence: EvidenceRef[];
    }>;
    limitations: string[];
  };

  followUpNeed: {
    needed: "yes" | "no" | "unclear";
    rationale: string;
    evidence: EvidenceRef[];
    agendaCandidates: string[];
    requiredRoles: string[];        // roles, not invented people
    preconditions: string[];
    dateWindow?: { earliest: string; latest: string };
  };
};

type EvidenceRef = {
  segmentId: string;
  startMs: number;
  endMs: number;
  excerpt: string;                  // short bounded quote from that segment
};
```

Every candidate decision/action and every positive meeting-necessity signal
requires at least one valid evidence reference. Missing evidence produces no
claim. An explicit “no decision was stated” signal may be generated only after
the extraction examined the complete transcript and must be phrased as an
absence in the transcript, not proof that no decision existed elsewhere.

The parser rejects invented segment IDs, timestamp mismatch, excerpts not found
in the cited segment, output beyond configured limits, and owners/dates not
supported by cited text.

## 10. Why meeting necessity is a review question

The current transcriber mixes system and microphone audio and has no reliable
speaker attribution. It therefore cannot know:

- who spoke;
- whether a quiet attendee contributed through chat, preparation or a decision;
- whether the meeting satisfied a legal, customer or cultural obligation;
- whether a discussion was valuable despite producing no formal action;
- whether Japanese communication norms made an indirect conclusion meaningful.

For these reasons Tako must never emit “this meeting is unnecessary” as a
factual judgment. It asks a meeting owner to review whether the cadence or
format remains useful and shows the evidence that prompted the question.

Forbidden signals:

- individual speaking time or silence;
- transcript length alone;
- emotion, seniority, nationality, language fluency or communication style;
- inferred employee productivity;
- attendee count alone;
- an unsupported comparison across teams.

No automated action may be connected to the necessity recommendation.

## 11. Governance integration

### 11.1 Ingestion policy

Package import is a local `read` operation. Before content is read into the
brain, a meeting source, workspace and classification must be present in the
server-owned scope passed to `lib/govern/policy.ts`. Out-of-scope workspaces or
classifications fail closed.

The existing policy engine does not validate filesystem packages, consent or
classification configuration by itself; the meeting importer owns those checks
and records their result in its receipt.

### 11.2 Review item

The analysis draft becomes a `ReviewItem` in `lib/review/model.ts`:

- `id`: deterministic from meeting ID, transcript digest and analysis schema;
- `title`: “Meeting record review — <meeting title>”;
- `intent`: help the meeting owner verify decisions/actions and decide whether
  a follow-up or recurring cadence remains useful;
- `audience`: the existing review queue; any authorized reviewer who picks up
  the item follows the same review path as every other AI-assisted output;
- `body`: bounded structured draft, including the necessity question;
- `sources`: canonical meeting page plus cited segment anchors;
- `submittedBy`: local meeting-analysis worker identity;
- checks: intent, merit, harm, evidence and policy start unapproved and are
  evaluated through the existing review flow;
- decisions remain append-only and attributed to the named reviewer.

`canApprove()` already requires all checks, no blocker, evidence marked `ok`
and at least one source. Meeting work must not add a bypass.

Approval materializes only the reviewer-approved subset into the canonical
meeting page. `revise`, `rejected` and `escalated` do not publish derived claims.
A rejected analysis remains visibly marked `rejected` in the meeting’s audit
status and its named decision stays in the append-only review history. The
rejected draft content is not promoted into approved decisions or actions.
There is no meeting-specific reviewer role and no self-review-only rule.

### 11.3 Existing automation limitation

Tako’s current automation builder writes a `SKILL.md`; it does not create an
event subscription, runnable worker or delivery action. The worker layer can
queue output but intentionally never delivers it.

Therefore Phase 2 must not claim that adding a meeting template makes this
workflow automatic. A real implementation needs explicit components:

1. local inbox watcher or scheduled importer;
2. local analysis worker;
3. bridge from worker output into a `ReviewItem`;
4. approval handler that atomically updates the canonical meeting page;
5. provenance entry and gbrain sync after the approved update.

There is no Slack/email/calendar delivery in this architecture. If later added:

- creating a new invitation is `create-isolated` and approval-required;
- changing or cancelling an existing meeting is `mutate` and
  approval-required;
- destructive calendar actions remain denied unless a separate, explicitly
  approved policy changes that rule;
- a worker queue item is not authorization to deliver.

## 12. Scheduling boundary

Current meeting evidence can support:

- “a follow-up appears necessary / unnecessary / unclear”;
- a proposed agenda;
- required roles;
- prerequisites;
- a date window based on explicitly stated deadlines.

It cannot select an actual available time because Tako has no calendar or
free/busy connector. Any UI that displays a precise slot before such a source
exists would be fabricated.

A future calendar phase may use read-only free/busy access to propose two or
three slots. It must not read event titles or attendees beyond what is required,
and it must send event creation/modification through approval.

## 13. Local-only and credential guarantees

- Publishing and importing use local filesystem operations only.
- Analysis uses the existing local gbrain/Ollama path only.
- No hosted AI SDK or API is introduced.
- No model is downloaded during transcription or import.
- No connector credentials enter a meeting package.
- No package path, transcript or participant data appears in a browser response
  unless the authenticated application explicitly displays that meeting.
- The transcriber receives a workspace catalog, not Tako administration tokens.
- Import code never launches the transcriber and therefore inherits no
  transcriber environment.
- The ChatGPT prompt remains outside the contract and is rejected if present.

The only new configuration surface is an owner-only inbox path, workspace
mapping and classification/retention policy. This is sensitive operational
configuration, but not a provider credential.

## 14. Retention and deletion

Three copies may exist after publishing:

1. the transcriber’s original output;
2. the short-lived processed inbox package;
3. Tako’s canonical meeting page and gbrain index.

Tako cannot claim complete deletion while the transcriber copy remains. The UI
must disclose this and offer a separate local “open original output” or deletion
instruction; automatic deletion of the original is out of scope because the
user may need it for correction.

Defaults:

- processed package: purge after 7 days. This is explicitly a recovery/undo
  buffer, not meeting-content retention; it remains under the §2 `0700`
  directory and `0600` file requirements for the full seven days;
- quarantined package: purge after 30 days unless investigation requires less;
- canonical page/index: workspace retention policy, default 90 days;
- optional WAV remains in the transcriber only and is never copied to Tako.

Deletion of a meeting must remove the canonical source page, resync gbrain,
remove its pending review/draft state and append a deletion provenance record.
Existing gbrain archive/purge commands remain the underlying index mechanism,
but per-meeting orchestration must be tested before this feature can claim
retention compliance.

## 15. Audit and provenance

Every state transition records a bounded receipt:

```ts
type MeetingImportReceiptV1 = {
  schemaVersion: "1.0";
  meetingId: string;
  packageSha256: string;
  transcriptSha256: string;
  workspaceId: string;
  sourceId: string;
  classification: string;
  outcome:
    | "accepted"
    | "duplicate-noop"
    | "quarantined"
    | "analysis-queued"
    | "analysis-reviewed"
    | "published"
    | "deleted";
  reasonCode?: string;
  actor: string;
  at: string;
};
```

Receipts never contain transcript text, participant emails, consent notes,
absolute paths or model output. The existing `sync-log.jsonl` continues to
record the actual page hash added/changed/deleted; the meeting receipt records
why the workflow performed that change.

## 16. Failure and recovery matrix

| Failure | Required outcome |
|---|---|
| Whisper model missing/wrong digest | Refuse before capture/transcription; no download |
| Consent missing/false | Quarantine; do not index or analyze |
| Unknown workspace | Quarantine; do not create a source dynamically |
| Disallowed classification | Quarantine; explain operator policy, not content |
| Hash/size/schema mismatch | Quarantine; do not partially read into gbrain |
| Symlink/hardlink/path traversal | Quarantine and security audit event |
| Duplicate same digest | No-op with receipt |
| Same meeting ID, different digest | Quarantine conflict; human resolution |
| gbrain sync fails | Keep processing state and retry safely; do not report success |
| Local extraction fails | Evidence page remains; analysis status is failed/retryable |
| Evidence validation fails | Reject analysis draft; transcript remains unchanged |
| Human rejects draft | Keep transcript evidence; do not publish derived claims |
| Calendar/Slack/email unavailable | Irrelevant in v1; no delivery attempt exists |

## 17. Phase 2 acceptance tests (not implemented here)

1. Atomic publisher: importer cannot observe a partial package.
2. Offline missing-model test: no network attempt and clear refusal.
3. Offline cached-model test: exact local model path is used in file and live
   modes.
4. Package validator table tests for every required field, limit and enum.
5. Path traversal, symlink, hardlink and TOCTOU tests.
6. Hash mismatch and duplicate/conflict tests.
7. Consent-false and disallowed-classification rejection tests.
8. Workspace mapping test proving the manifest cannot choose a filesystem path
   or arbitrary gbrain source.
9. Japanese transcript fixture with decisions/actions and exact segment
   evidence.
10. Japanese transcript fixture with no evidence: no invented claim.
11. Prompt-injection fixture inside transcript: transcript instructions remain
    untrusted content and cannot approve, publish or mutate anything.
12. Meeting-necessity output test forbidding declarative “unnecessary meeting”
    language and participation-based reasoning.
13. Review-state tests: approval requirements cannot be bypassed; rejection
    never updates approved sections.
14. Worker test proving queueing never sends Slack/email/calendar output.
15. Crash-recovery tests at every directory/page/state transition.
16. Retention test covering processed package, canonical page, index, review
    draft and provenance record.
17. Permission test: directories `0700`, files/config/state `0600`.
18. Log test proving transcripts, excerpts, participant emails and paths are
    absent from errors and receipts.

## 18. Proposed implementation decomposition (for later planning only)

No files in this list are authorized by this Phase 1 document. It defines the
likely ownership boundaries for a later implementation plan:

- Transcriber: local model preflight and explicit publish dialog/package writer.
- Tako `lib/connectors/meetings/`: package schema, validator, renderer and
  importer.
- Tako `lib/meetings/analysis.ts`: local extraction contract and evidence
  verification.
- Tako `lib/meetings/state.ts`: atomic idempotency/import receipts.
- Tako review bridge: draft → `ReviewItem` → approved-page materialization.
- Tako setup/doctor: inbox permissions, workspace config and local-only checks.
- Tests/fixtures: Japanese transcripts, malformed packages and crash seams.

## 19. Resolved decisions for implementation planning

1. V1 accepts `internal` meeting packages only.
2. The publisher is a named person and personally affirms consent; v1 has no
   separate consent-confirmer role.
3. The existing review queue supplies the reviewer; no meeting-specific role
   or self-review-only path is added.
4. Rejections remain visible as append-only audit status but do not promote
   rejected draft claims into the meeting record.
5. `processed/` is retained for seven days as a protected recovery/undo buffer,
   distinct from the 90-day content-retention policy.
6. Transcript segments and metadata are the only evidence. The optional local
   extractive summary is clearly labeled supplementary, is excluded from Tako’s
   extraction prompt and cannot be cited for decisions or actions.

This architecture is approved for an implementation plan. Implementation still
requires review and approval of that plan before code work begins.
