# Aletheia Company Security Baseline v0.1

Last updated: 2026-08-20  
Scope: SME proof-of-concept handling company documents and AI-generated business content.

## Security objective

Aletheia must prevent one company’s information from being disclosed to another company, an unauthorized employee, an AI provider, or the public. It must preserve evidence of who accessed, changed, reviewed, approved, exported, and deleted each document.

## Non-negotiable architecture rules

1. Every document, source, retrieval index, log, encryption key, export, and backup belongs to exactly one tenant.
2. Authorization is checked on the server for every read and write; hiding a button is not access control.
3. SME content is not used for vendor or Aletheia model training unless a separate, explicit agreement names the data and purpose.
4. Confidential and personal information is redacted or pseudonymized before development access.
5. External publication is disabled by default and requires a named human approver.
6. Every model call records provider, model version, purpose, retrieved source IDs, policy configuration, and result without unnecessarily logging sensitive content.
7. Uploaded files and retrieved text are untrusted input. Embedded instructions cannot change system rules, permissions, or tool access.
8. Retention, export, legal hold, and deletion are tenant-configurable and testable.
9. Secrets and encryption keys are never stored in source code, browser storage, prompts, or application logs.
10. A security incident can stop processing for one tenant without exposing or deleting another tenant’s data.

## Data classification

| Class | Examples | Default handling |
| --- | --- | --- |
| Public | Published catalogues, approved website text | May use approved external AI after terms review |
| Internal | Procedures, meeting notes, internal templates | Company-approved environment only; no public sharing |
| Confidential | Prices, contracts, designs, customer lists, forecasts | Tenant-isolated encrypted storage; restricted roles; external AI blocked unless specifically approved |
| Personal or highly restricted | Employee/customer personal data, HR decisions, credentials, regulated data | Do not upload by default; require documented purpose, minimal fields, specialist review, and stricter retention |

## Required controls before a real-document PoC

### Identity and access

- SSO or managed identities with MFA for administrators and reviewers.
- Tenant membership resolved on the server.
- Roles for employee, approver, administrator, developer/support, and security auditor.
- Least privilege, access review, immediate offboarding, and break-glass procedure.

### Tenant isolation and encryption

- Separate tenant identifiers on every row/object and enforced authorization policies.
- Tenant-scoped retrieval indexes, caches, queues, logs, and exports.
- Encryption in transit and at rest; managed key service with rotation and restricted key administrators.
- Automated cross-tenant access tests and backup-restore isolation tests.

### Data lifecycle

- Collection purpose, lawful basis/contract, data owner, sensitivity, and retention recorded at ingestion.
- Redaction before developer access and synthetic data for red-team tests.
- Tested tenant export and deletion, including derived text, embeddings, logs, and backups according to policy.
- No model training by default; training permission separated from service-processing permission.

### AI and file-processing safety

- Enterprise/API provider configuration with no-training and retention settings verified contractually and technically.
- File type/size limits, malware scanning, OCR isolation, decompression limits, and parser sandboxing.
- Prompt-injection separation: document text is quoted as data and cannot grant tools or override policy.
- Allowlisted tools and outbound destinations; no arbitrary URL fetch from uploaded documents.
- Evidence citations and model outputs treated as untrusted until human approval.

### Monitoring and incident response

- Immutable audit events for access, upload, retrieval, model call, finding, correction, approval, export, and deletion.
- Alerts for repeated denied access, bulk export, unusual retrieval, privilege changes, and cross-tenant test failures.
- Named incident commander, severity levels, containment steps, evidence preservation, notification assessment, and recovery verification.
- Regular vulnerability scanning, dependency updates, penetration testing before broader release, and incident exercises.

## Prototype status

Currently true:

- The document review demo processes pasted text in the browser and does not send it to an LLM API.
- It does not collect AI subscription credentials or API keys.
- Automatic external publication is disabled.
- Public dataset documents, companies, facts, and contact details are synthetic.
- Prompt-injection and personal-information scenarios exist in the locked regression corpus.

Not yet technically enforced:

- Persistent tenant-separated storage, indexes, logs, backups, and encryption keys.
- Server-side SSO, MFA, RBAC, audit logging, retention, deletion, export, and incident containment.
- Secure upload, malware scanning, OCR sandboxing, provider connections, and vendor controls.

Therefore, real company documents must not be uploaded to the current public prototype.

## Go/no-go gate

A real-document SME PoC is `NO-GO` until the unfinished controls above have implementation evidence, negative security tests, an assigned owner, and an approved exception process. A checklist or policy statement alone is not evidence that a control works.
