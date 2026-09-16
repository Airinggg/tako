# Aletheia Dataset Annotation Handbook v0.1

Last updated: 2026-08-20  
Scope: Japanese SME proposals, internal reports, and customer-facing documents.

## What counts as a completed dataset record

A record is usable for evaluation only when it contains the document purpose, audience, publication scope, sensitivity, source facts available at generation time, generated output, atomic claims, evidence labels, issue category, severity, correction, required approver, and split assignment.

The synthetic seed corpus uses `seed_author_review_required`. It must not be described as human gold data until two independent reviewers agree or a third reviewer adjudicates the disagreement.

## Evidence labels

- `supported`: the cited passage directly supports the claim and its conditions.
- `contradicted`: an approved source conflicts with the claim.
- `unverifiable`: the claim is checkable, but no approved evidence supports or contradicts it.
- `not_applicable`: the sentence is instruction, opinion, or connective text rather than a factual claim.

## Severity

- `critical`: publication stops. Examples: exposed personal data, fabricated evidence, wrong customer commitment, prohibited use, or missing mandatory approval.
- `high`: correction and named approver are required before release.
- `medium`: material clarity or completeness issue; correct before normal approval.
- `low`: style improvement that does not change the decision or obligation.

## Annotation steps

1. Read purpose, audience, and publication scope before judging wording.
2. Split the output into the smallest independently checkable claims.
3. Identify the exact approved evidence and its version.
4. Assign evidence label, error category, and severity separately.
5. Write a correction that preserves supported content and removes unsupported certainty.
6. Identify the person or role required to approve the correction.
7. Record reviewer ID, time, and rationale.
8. For critical cases, require a second blind review. Send disagreements to adjudication.

## Split and leakage rules

- Split by synthetic or participating company, not by paragraph.
- Keep `locked_test` invisible during prompt and threshold development.
- Do not copy near-duplicate corrected outputs across splits.
- Never place one company’s internal rules or operational facts in another company’s record.
- Version every data, label, prompt, and evidence change.

## Quality checks

- Every critical finding has an exact evidence passage or explicit policy rule.
- Percentages reconcile with their numerator and denominator where available.
- Dates, prices, units, product names, and source versions are copied exactly.
- Personal data in red-team examples is synthetic and unmistakably non-real.
- A safe control output accompanies controlled-error templates, preventing the evaluator from learning that every document must receive a warning.

## Current seed-corpus limitation

Version 0.1 is an original, controlled synthetic benchmark for making the review workflow executable. It is not enough to establish production accuracy and is not approved for general-model fine-tuning. The next data milestone is partner-authorized, redacted documents with dual human review.
