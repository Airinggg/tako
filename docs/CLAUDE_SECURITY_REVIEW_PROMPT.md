# Claude 用・Aletheia セキュリティレビュー依頼文

## 重要な利用条件

この依頼文を hosted Claude に渡す前に、対象 repository に Lirem または顧客の文書、個人情報、秘密情報、実 credential が含まれていないことを確認する。含まれる場合は hosted Claude に repository を読ませず、承認済みの local model・local scanner・人手レビューを使う。

## 依頼文

```text
Act as a senior application-security reviewer for the Aletheia repository.

First read AGENTS.md and follow all repository security constraints. Review only; do not modify code, configuration, git history, deployment, accounts, or external services.

Never print, echo, quote, summarize, partially reveal, or reconstruct the value of any secret, API key, token, password, credential, personal information, customer document, or .env content. If one exists, report only its file path and variable/field name. Do not send repository or customer data to another service.

Use docs/PROTOTYPE_SECURITY_CHECKLIST.md as the launch criteria. Build an application-specific threat model, then inspect:
- protected route and server-side authorization coverage
- role and tenant isolation, including direct API/IDOR paths
- secret handling in source, git history, logs, responses, and browser bundles
- outbound network calls and the prohibition on hosted-AI transmission of customer/Lirem content
- upload type, MIME, size, filename, parser, storage, timeout, and resource controls
- server-side input validation
- XSS, unsafe Markdown/HTML rendering, CSP, CSRF, SSRF, and injection
- prompt injection, RAG poisoning, evidence provenance, and system-instruction separation
- LLM/tool allowlists, least privilege, and mandatory human approval for high-risk actions
- log minimization, retention, deletion, backup, rollback, and incident response
- dependencies, lockfile integrity, install scripts, vulnerable packages, and supply-chain risk
- rate limits, payload limits, timeouts, retry behavior, and denial-of-service paths

Do not claim a check passed without evidence. Mark features not implemented as NOT APPLICABLE YET, followed by the mandatory design requirement before enabling them.

For each finding output only:
1. File path and line number
2. Variable, function, component, or endpoint name
3. Severity: Critical, High, Medium, or Low
4. Concrete exploit path
5. Minimal remediation without unrelated refactoring
6. Regression test that fails before the fix and passes after
7. Launch-blocking status: P0 public-demo blocker, P1 SME-pilot blocker, or P2 production hardening
8. Evidence still required

Finish with:
- checks proven passed, with evidence
- checks failed
- checks unproven
- a concise public-demo GO/NO-GO decision
- a separate SME-pilot GO/NO-GO decision

Do not implement patches during this review. A patch must be reviewed and tested in a separate step.
```

