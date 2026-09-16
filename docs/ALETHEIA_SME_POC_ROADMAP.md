# Aletheia SME PoC — Evidence-Grounded Review Roadmap

Last updated: 2026-08-20  
Status: Active product roadmap  
Purpose: Keep product, dataset, evaluation, and SME trial work aligned with Aletheia's lean canvas.

## Recommendation

For the SME PoC, Aletheia should **not train a new general-purpose language model yet**. It should become an evidence-grounded review system that:

1. Breaks an AI-generated document into checkable claims.
2. Links every important claim to company-approved evidence.
3. Checks company rules, METI guidance, privacy, and prohibited wording.
4. Explains problems and proposes corrections.
5. Sends high-risk decisions to a human approver.
6. Records who approved what and why.

This aligns with the lean canvas's Intent–Merit Review and “approved content only” proposition.

## Product principles

- A high overall score must never override a critical safety or evidence failure.
- Aletheia may recommend; a named person must approve high-risk use and external publication.
- Every material finding should show the source, source version, evidence passage, severity, and required action.
- Company information must remain tenant-separated and must not be reused for model training by default.
- The first PoC optimizes the review workflow and evidence layer, not the size of the model.
- Japanese business communication must be evaluated with Japanese SME users, not only translated English benchmarks.

## Proposed Aletheia review metrics

Aletheia should show separate dimensions rather than only one potentially misleading score.

| Review dimension | Weight | What Aletheia checks |
| --- | ---: | --- |
| Evidence and factuality | 25% | Claims, numbers, names, and dates are supported by approved sources |
| Harm and privacy | 20% | Personal data, confidential information, discriminatory wording, and harmful advice |
| Policy compliance | 15% | METI guidance, company rules, approval requirements, and prohibited uses |
| Intent fit | 15% | The document fulfils its purpose and is suitable for its audience |
| Merit and completeness | 15% | Required sections, conditions, limitations, and next actions are present |
| Japanese communication quality | 10% | Clarity, structure, terminology, politeness, and unnecessarily difficult expressions |

### Hard publication gates

The following conditions block publication regardless of the total score:

- [ ] No unsupported critical claims.
- [ ] No unapproved personal or confidential information.
- [ ] No fabricated or misleading citations.
- [ ] No prohibited use or missing mandatory approval.
- [ ] No customer-facing publication before human approval.

### Core measurable indicators

- **Claim support rate:** supported verifiable claims / all verifiable claims.
- **Citation coverage:** important claims with evidence / all important claims.
- **Citation correctness:** whether the cited passage actually supports the claim.
- **Required-content recall:** whether mandatory document elements are present.
- **Serious-issue recall:** expert-identified serious problems detected by Aletheia.
- **Warning precision:** valid warnings / all warnings, used to control alert fatigue.
- **Correction acceptance rate:** suggested corrections accepted by reviewers.
- **Review-time reduction:** time with Aletheia compared with the current process.
- **Critical escape rate:** serious problems missed and released after review.
- **Human override rate:** Aletheia decisions reversed by an authorized reviewer.

## Review priorities by document type

| Document type | Most important checks |
| --- | --- |
| Sales proposal | Price, specifications, delivery promises, comparison claims, and contractual wording |
| Management report | Numerical consistency, source coverage, omitted risks, and evidence-supported conclusions |
| Customer document | Confidentiality, accuracy, tone, understandable Japanese, and approval status |
| Meeting summary | Decisions, owners, deadlines, unresolved points, and faithful representation |
| HR document | Privacy, discriminatory wording, consistent criteria, and human oversight |

## Evaluation architecture

Do not depend entirely on an LLM judge. Use three complementary layers:

1. **Deterministic checks**
   - Dates, prices, percentages, quantities, product codes, prohibited terms, PII, and required fields.
2. **Evidence checks**
   - Claim extraction, retrieval, entailment or contradiction detection, citation coverage, and source version checks.
3. **Human-calibrated rubric**
   - Intent, completeness, clarity, tone, business usefulness, and approval readiness.

The LLM judge must be tested for position bias, verbosity preference, self-preference, and inconsistent scoring. It is an assistant to evaluation, not the ground truth.

## Authoritative knowledge library

The first PoC knowledge foundation should contain:

- [x] METI AI Business Guidelines 1.2 represented in the prototype.
- [ ] METI checklist, worksheet, appendices, and version history stored as separate versioned sources.
- [x] Personal Information Protection Commission notice represented in the versioned PoC source registry with an official link and content-status note.
- [ ] Each SME's internal AI policy.
- [ ] Approved product specifications, prices, and service conditions.
- [ ] Approved document templates and brand terminology.
- [ ] Approval matrix defining who reviews each document and risk type.
- [x] Source owner, version, effective date, expiry/check date, tenant scope, and content-status note represented in the PoC source registry.
- [ ] Replacement history and approved update workflow persisted outside application code.

## Realistic document dataset

### Initial PoC scope

- Three document use cases.
- 150–300 redacted source-document packages.
- 500–1,000 generated outputs from several models and prompts.
- At least 1,500–3,000 individually labelled claims.
- A locked test set of approximately 100 complete documents.
- Two reviewers for critical examples, with a third person resolving disagreements.

These are planning ranges for the PoC, not universal scientific minimums.

### Current dataset reality (v0.1)

- [x] 60 original synthetic document packages across six fictional Japanese SMEs.
- [x] 120 generated outputs: 60 controlled-error versions and 60 corrected controls.
- [x] Company-held-out split: 80 train, 20 validation, and 20 locked-test outputs.
- [x] Three initial document types: sales proposals, internal reports, and customer documents.
- [x] Downloadable JSONL, machine-readable summary, source/reuse catalogue, and annotation handbook.
- [x] Blind-review JSONL that removes seed-author expectations and release decisions from the reviewer view.
- [ ] Independent dual human review of the seed expectations.
- [ ] 150–300 partner-authorized, redacted source-document packages.
- [ ] Naturally occurring outputs from several models and employee prompts.

The synthetic seed is complete for workflow and regression development. It is **not** a claim of production accuracy and is not sufficient for fine-tuning a general-purpose model.

### Required record schema

Each document package should contain:

- Document ID, company/tenant ID, department, document type, and creation date.
- Document purpose, intended audience, and external/internal publication scope.
- Sensitivity classification and types of information handled.
- Source documents available at generation time.
- Generated document and generating model/prompt configuration.
- Extracted atomic claim.
- Supporting or contradicting evidence passage.
- Evidence label: supported, contradicted, unverifiable, or not applicable.
- Error category and severity.
- Applicable company rule, METI principle, or privacy requirement.
- Human correction and correction rationale.
- Required approver, final decision, reviewer identity, and timestamps.

### Difficult and adversarial examples

The dataset must deliberately include:

- [ ] Changed prices, percentages, dates, names, quantities, and delivery periods.
- [ ] Unsupported “best,” “guaranteed,” safety, savings, and performance claims.
- [ ] Missing limitations, assumptions, or contract conditions.
- [ ] Outdated or conflicting source documents.
- [ ] Personal, customer, employee, and confidential information.
- [ ] Biased hiring or employee-evaluation wording.
- [ ] Poor OCR from scanned Japanese documents.
- [ ] Tables containing units, footnotes, merged cells, and conflicting totals.
- [ ] Instructions hidden in uploaded documents that attempt to manipulate the reviewer.
- [ ] Japanese ambiguity caused by omitted subjects, unclear responsibility, or indirect expressions.

### Dataset splitting rules

- Split by company and time period, not by random paragraphs from the same document.
- Keep the final test set hidden from prompt development and threshold calibration.
- Maintain a company-held-out set to test whether Aletheia generalizes without leaking company-specific facts.
- Keep naturally occurring AI errors; do not rely only on synthetically corrupted text.
- Track dataset and label versions so every result can be reproduced.

## Japanese evaluation

The Japanese evaluation set must cover:

- Appropriate politeness and keigo.
- Clear actors, responsibility, and approval ownership.
- Ambiguous pronouns and omitted subjects.
- Long or bureaucratic sentences.
- Company-specific terminology.
- Japanese dates, currencies, counters, units, and percentages.
- Text mixed with tables, English product names, and scanned PDFs.
- Whether employees across the SME age range understand the required action.

JGLUE may be used as a general Japanese NLU reference, but it is not sufficient as a Japanese SME business-writing benchmark.

## Data protection and tenant isolation

- [ ] Signed data-processing and PoC participation terms.
- [ ] No vendor model training on SME data by default.
- [ ] Tenant-separated retrieval indexes, storage, logs, and encryption keys.
- [ ] Role-based access for employees, administrators, reviewers, and developers.
- [ ] Redaction or pseudonymization before development access.
- [ ] Defined retention, deletion, export, and incident-response procedures.
- [ ] Audit log for document access, findings, corrections, approvals, and exports.
- [ ] Synthetic PII and confidential information used for red-team tests.
- [ ] Automatic external publication disabled throughout the PoC.

## Proposed SME trial

Run a 6–8 week paid PoC with 3–5 SMEs and no automatic publication.

### Phase 1 — Preparation

- Select three document use cases.
- Redact and organize historical documents.
- Define approved sources and company rules.
- Create the annotation handbook.
- Label and adjudicate the first evaluation set.

### Phase 2 — Shadow testing

- Aletheia reviews documents without showing results to employees.
- Compare findings with the existing human review process.
- Calibrate thresholds and identify critical misses and noisy warnings.

### Phase 3 — Assisted review

Employees and approvers see:

- Overall status: ready, needs confirmation, or stop.
- Findings ranked by severity.
- Exact evidence for each finding.
- Suggested correction.
- Required approver and next action.

### Phase 4 — Evaluation

Proposed PoC success criteria:

- [ ] Serious-issue recall of at least 95%.
- [ ] Zero known critical privacy or fabricated-evidence misses in the release test.
- [ ] Citation coverage of at least 95% for important factual claims.
- [ ] Warning precision of at least 75%.
- [ ] Review-time reduction of at least 30%.
- [ ] Suggested-correction acceptance of at least 60%.
- [ ] Reviewer agreement of at least 0.70 during calibration.
- [ ] No cross-company information leakage.

Higher-risk customer commitments and HR decisions require stricter gates.

## Model and integration strategy

### PoC approach

- Use retrieval, deterministic rules, and prompt-based review first.
- Use a participating company's approved enterprise/API endpoint or a locally hosted model for automated review.
- Do not automate a backend by reusing consumer subscription browser sessions or credentials.
- Treat MCP as an integration channel for supported AI tools, not as the reviewer model or training method.
- Preserve model name, version, parameters, prompt version, retrieved sources, and evaluation result for reproducibility.

### When to fine-tune

Fine-tune only after Aletheia has:

- A stable error taxonomy.
- Several thousand adjudicated claim-level examples.
- Evidence that prompting, rules, and retrieval cannot solve the remaining failures.
- A company-held-out and time-held-out test set.
- A repeatable improvement on serious-issue recall or warning precision without weakening hard gates.

The first fine-tuned component should probably be a smaller Japanese issue classifier or evidence reranker, not the complete language model.

## Research basis

- [FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation](https://aclanthology.org/2023.emnlp-main.741/)
- [RAGAs: Automated Evaluation of Retrieval Augmented Generation](https://aclanthology.org/2024.eacl-demo.16/)
- [QAFactEval: Improved QA-Based Factual Consistency Evaluation for Summarization](https://aclanthology.org/2022.naacl-main.187/)
- [G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment](https://arxiv.org/abs/2303.16634)
- [HELM: Holistic Evaluation of Language Models](https://arxiv.org/abs/2211.09110)
- [JGLUE: Japanese General Language Understanding Evaluation](https://aclanthology.org/2022.lrec-1.317/)
- [METI AI Business Guidelines 1.2](https://www.meti.go.jp/shingikai/mono_info_service/ai_shakai_jisso/20260331_report.html)
- [Japan Personal Information Protection Commission — Generative AI notice](https://www.ppc.go.jp/news/careful_information/230602_AI_utilize_alert/)
- [NIST AI RMF Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)

## Build tracker

### Completed in the current prototype

- [x] Separate employee, administrator, and developer workspaces.
- [x] Persistent major-function navigation.
- [x] METI Guidance Library with role filtering, search, source version, and plain-Japanese actions.
- [x] “Use with Your AI” prompt handoff with sensitive-information warning.
- [x] AI Document Review Desk prototype.
- [x] Six weighted review dimensions.
- [x] Hard publication gate displayed independently of the total score.
- [x] Claim-level findings with evidence, severity, correction, and approval route.
- [x] Realistic Document Dataset workspace prototype.
- [x] Dataset targets, document coverage, source categories, sample records, and claim labels.
- [x] Developer-only PoC workspace and role separation.
- [x] Device-local accessibility and safety settings.
- [x] Versioned PoC authoritative-source registry for official, internal-policy, and operational evidence.
- [x] Developer retrieval-testing page showing matched source, version, locator, evidence text, and relative match score.
- [x] Executable deterministic review prototype for delivery-period conflicts, unsupported guarantee wording, conditional savings claims, email/phone exposure, and required sales approval.
- [x] Review findings link back to their registered evidence source.
- [x] User-editable review text with recalculated findings, hard gate, metrics, and evidence-link counts.
- [x] Downloadable synthetic seed corpus v0.1 with 60 packages and 120 paired controlled-error/corrected outputs.
- [x] Company-held-out train, validation, and locked-test split for the seed corpus.
- [x] Machine-readable source catalogue that records provenance, usefulness, reuse status, and training approval.
- [x] Annotation handbook covering evidence labels, severity, dual review, adjudication, leakage, and quality checks.
- [x] Public dataset workspace reports measured seed counts instead of unverified PoC progress or accuracy figures.
- [x] Readable browser for all 60 packages showing source facts, paired outputs, expected issue, correction, and split assignment.
- [x] Reproducible evaluation runner using the same deterministic review engine as the product.
- [x] Developer evaluation dashboard for serious-issue recall, warning precision, citation coverage, hard-gate sensitivity/specificity, clean-control rate, category coverage, and split counts.
- [x] Locked synthetic regression split covering ten controlled error categories, with explicit disclosure that template-bound results are not production accuracy.
- [x] Formal evidence-based decision record not to fine-tune yet.
- [x] Company security baseline covering classification, tenant isolation, server-side access, encryption, lifecycle, audit, file/AI safety, vendor controls, and incident response.
- [x] Security-readiness workspace distinguishes currently true prototype safeguards from controls that are not technically enforced and keeps real-document PoC status at NO-GO.
- [x] Device-local two-reviewer and adjudication workspace with independent reviewer views, disagreement routing, agreement statistics, and JSON audit export.
- [x] Company-facing UI terminology separates general business functions (quality management, evaluation documents, review calibration, quality evaluation, safety management) from internal dataset versions, counts, and build-phase terminology.
- [x] Separate employee AI-use check route; employee actions no longer open the administrator workflow.
- [x] Administrator review card no longer permits one-click approval while evidence remains unresolved; it routes to the evidence-grounded review desk.

### Next implementation milestones

- [ ] File-based authoritative-source ingestion, OCR, persistent version history, and tenant-scoped retrieval. *(The in-code versioned registry and keyword retrieval prototype are complete.)*
- [ ] Real document upload with tenant isolation, redaction, retention, and deletion.
- [ ] Implement and negatively test the company security baseline. *(The baseline and readiness gate are documented; persistent tenant isolation, SSO/MFA/RBAC, encryption, lifecycle, audit, secure upload, vendor controls, and incident containment remain NO-GO requirements.)*
- [ ] Dual-review and adjudication workflow. *(The working device-local workflow, blind-review data, agreement calculation, and export are complete; authenticated reviewer identity, immutable history, and actual completion by two independent reviewers remain.)*
- [ ] Model-assisted atomic-claim extraction and semantic evidence-linking service. *(Sentence-level deterministic extraction and source linking are implemented.)*
- [ ] Complete deterministic numeric, date, entity, prohibited-term, and PII test suite. *(Delivery weeks, savings percentages, guarantee terms, email, phone, and approval routing are implemented.)*
- [ ] Review result persistence and immutable approval log.
- [ ] Company rule and approval-matrix administration.
- [ ] Complete Japanese business-writing evaluation set. *(The synthetic seed includes unclear action, missing responsibility/deadline, Japanese dates, percentages, and business wording; keigo, OCR, tables, units, and age-range comprehension remain.)*
- [ ] Complete locked regression and adversarial test suite. *(A company-held-out synthetic locked split with ten categories is executable; independently authored, OCR, table, and partner-document cases remain.)*
- [ ] Complete evaluation dashboard including human overrides and review time. *(Automated regression metrics are implemented; trial workflow metrics remain.)*
- [ ] Shadow-mode SME trial workflow.
- [ ] Assisted-review SME trial workflow and feedback collection.
- [ ] Go/no-go report against the PoC acceptance criteria.
- [x] Initial evidence-based model decision: do not fine-tune yet; reconsider only after dual-reviewed partner data and a demonstrated residual failure. See `docs/FINE_TUNING_DECISION_001.md`.

## Change-control rule

Every meaningful Aletheia feature should update this file by:

1. Linking the feature to one or more roadmap requirements.
2. Marking an item complete only after the feature works and is validated.
3. Recording new risks or dependencies instead of silently changing the target.
4. Preserving hard publication gates and human approval as non-negotiable PoC constraints.
