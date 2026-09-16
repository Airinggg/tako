# Model Decision Record 001 — Do Not Fine-Tune Yet

Date: 2026-08-20  
Status: Active decision  
Owner: Aletheia PoC development team

## Decision

Do not fine-tune a general-purpose language model, Japanese classifier, or evidence reranker at this stage.

Continue with versioned retrieval, deterministic checks, prompt-based review, locked regression tests, and human approval. Revisit a smaller classifier or reranker only after independent evaluation demonstrates a stable residual failure that these methods cannot address.

## Evidence considered

- The current corpus contains 60 synthetic packages and 120 paired outputs.
- The locked synthetic split contains 20 outputs across one held-out fictional company.
- The deterministic engine passes all ten controlled scenario templates.
- The review rules and scenario templates were co-developed, so this result measures regression coverage, not generalization.
- Seed expectations have not completed two-person independent review.
- There are no partner-authorized naturally occurring AI outputs yet.
- Review-time reduction, human overrides, cross-company leakage, and correction acceptance have not been measured in an SME trial.

## Why fine-tuning now would be misleading

Fine-tuning on repeated synthetic templates may teach template wording rather than transferable evidence review. It would also make it harder to distinguish gains from data leakage, retrieval, deterministic rules, prompt changes, or the model itself.

## Reconsideration gates

Reopen this decision only when all of the following are true:

1. Several thousand claim-level examples have completed dual review and adjudication.
2. Company-held-out and time-held-out test sets contain partner-authorized, naturally occurring outputs.
3. The error taxonomy and annotation handbook are stable.
4. Retrieval, deterministic rules, and prompt changes have been evaluated first.
5. A specific residual task has enough examples and a clear metric.
6. The proposed tuned component improves serious-issue recall or warning precision on the locked test without weakening privacy, evidence, or approval gates.
7. Tenant data rights explicitly allow the proposed training use.

## First component to consider

If the gates are met, evaluate a small Japanese issue classifier or evidence reranker before considering end-to-end model fine-tuning. Keep factual evidence, company rules, and approval decisions outside model weights and in versioned, auditable systems.
