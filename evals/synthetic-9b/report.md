# Evaluation report: synthetic-9b

Generated with local Ollama models in an ephemeral GBrain home.

## Metrics

| Metric | Value |
| --- | ---: |
| owner_accuracy | 1.000 |
| stage_accuracy | 1.000 |
| overdue_precision | 0.500 |
| overdue_recall | 0.600 |
| dropped_recall | 0.400 |
| decided_not_executed_recall | 0.600 |
| grounding | 0.891 |
| latency_p50 | 163094 ms |
| latency_p95 | 325758 ms |

## Projects

### さくら市民ポータル

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | 佐藤 | 佐藤 |
| Stage | in_progress | in_progress |
| Overdue | - モバイル画面のワイヤーフレーム | - モバイル画面のワイヤーフレーム |
| Dropped | - 紙の申込書を残す案 | - 紙の申込書を残す案 |
| Decided, not executed | - 検索基盤はMeilisearchを採用する | - 検索基盤は Meilisearch を採用する<br>- DECISION |

Citations: `notion/projects/sakura-portal`, `slack/product/1754000001`

<details><summary>Raw local-model answers</summary>

```text
Owner: 佐藤 [notion/projects/sakura-portal]
Stage: in_progress [notion/projects/sakura-portal]

Overdue:
- モバイル画面のワイヤーフレーム [notion/projects/sakura-portal]

Dropped:
- 紙の申込書を残す案 [notion/projects/sakura-portal]

Decided, not executed:
- 検索基盤は Meilisearch を採用する [slack/product/1754000001]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/product/1754000001]
```
</details>

### Orbit Billing

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Maya Chen | Maya Chen |
| Stage | blocked | blocked |
| Overdue | - payment-provider sandbox approval | - The payment-provider sandbox approval was due 2026-08-05 and remains incomplete (overdue)<br>- The security questionnaire was due 2026-08-10 and is still awaiting review (overdue) |
| Dropped | - annual-plan launch | - The annual-plan launch was dropped from this release |
| Decided, not executed | - Use Stripe Tax for EU VAT | - Decision: Use Stripe Tax for EU VAT. No later task, code change, or completion message references this decision.<br>- 決定：検索基盤は Meilisearch を採用する。以後、この決定に対応するタスクや実装報告はない。<br>- DECISION |

Citations: `notion/projects/orbit-billing`, `notion/projects/greenfield-onboarding`, `slack/finance/1754000002`, `slack/product/1754000001`

<details><summary>Raw local-model answers</summary>

```text
Owner: Maya Chen [notion/projects/orbit-billing]
Stage: blocked [notion/projects/orbit-billing]

Overdue:
- The payment-provider sandbox approval was due 2026-08-05 and remains incomplete (overdue) [notion/projects/orbit-billing]
- The security questionnaire was due 2026-08-10 and is still awaiting review (overdue) [notion/projects/greenfield-onboarding]

Dropped:
- The annual-plan launch was dropped from this release [notion/projects/orbit-billing]

Decided, not executed:
- Decision: Use Stripe Tax for EU VAT. No later task, code change, or completion message references this decision. [slack/finance/1754000002]
- 決定：検索基盤は Meilisearch を採用する。以後、この決定に対応するタスクや実装報告はない。 [slack/product/1754000001]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/product/1754000001]
- DECISION [slack/finance/1754000002]
```
</details>

### Greenfield Onboarding

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Liam Osei | Liam Osei |
| Stage | review | review |
| Overdue | - security questionnaire | - The security questionnaire was due 2026-08-10 and is still awaiting review |
| Dropped | — | — |
| Decided, not executed | — | - DECISION |

Citations: `notion/projects/greenfield-onboarding`, `greenfield-onboarding`, `orbit-billing`, `sakura-portal`, `hokkyokusei-app`, `harbor-migration`, `maple-campaign`

<details><summary>Raw local-model answers</summary>

```text
Owner: Liam Osei [notion/projects/greenfield-onboarding]
Stage: review [notion/projects/greenfield-onboarding]

Overdue:
- The security questionnaire was due 2026-08-10 and is still awaiting review [notion/projects/greenfield-onboarding]

Dropped:

Decided, not executed:

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [greenfield-onboarding]
- DECISION [orbit-billing]
- DECISION [sakura-portal]
- DECISION [hokkyokusei-app]
- DECISION [harbor-migration]
- DECISION [maple-campaign]
```
</details>

### 北極星アプリ

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | 鈴木 | 鈴木 |
| Stage | not_started | not_started |
| Overdue | — | — |
| Dropped | - 音声入力機能 | - 音声入力機能は初期スコープから dropped（中止） |
| Decided, not executed | - 初期版はiOSのみで公開する | - 初期版は iOS のみで公開する<br>- 検索基盤は Meilisearch を採用する<br>- synonym service を self-hosted にする<br>- DECISION |

Citations: `notion/projects/hokkyokusei-app`, `slack/mobile/1754000004`, `slack/product/1754000001`, `slack/search/1754000007`

<details><summary>Raw local-model answers</summary>

```text
Owner: 鈴木 [notion/projects/hokkyokusei-app]
Stage: not_started [notion/projects/hokkyokusei-app]

Overdue:
- None

Dropped:
- 音声入力機能は初期スコープから dropped（中止） [notion/projects/hokkyokusei-app]

Decided, not executed:
- 初期版は iOS のみで公開する [slack/mobile/1754000004]
- 検索基盤は Meilisearch を採用する [slack/product/1754000001]
-  synonym service を self-hosted にする [slack/search/1754000007]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/mobile/1754000004]
- DECISION [slack/product/1754000001]
- DECISION [slack/search/1754000007]
```
</details>

### Harbor Data Migration

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Ana Silva | Ana Silva |
| Stage | done | done |
| Overdue | — | — |
| Dropped | - legacy CSV export | - Migration is complete. The legacy CSV export was dropped after the API import passed validation. |
| Decided, not executed | — | - DECISION |

Citations: `notion/projects/harbor-migration`, `slack/search/1754000007`

<details><summary>Raw local-model answers</summary>

```text
Owner: Ana Silva [notion/projects/harbor-migration]
Stage: done [notion/projects/harbor-migration]

Overdue:
Dropped:
- Migration is complete. The legacy CSV export was dropped after the API import passed validation. [notion/projects/harbor-migration]

Decided, not executed:

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/search/1754000007]
```
</details>

### Maple相談キャンペーン

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | 高橋 | 高橋 |
| Stage | blocked | blocked |
| Overdue | - 法務レビュー | - 法務レビュー |
| Dropped | - インフルエンサー施策 | - インフルエンサー施策 |
| Decided, not executed | - LPのCTAは無料相談に統一する | - LP の CTA は無料相談に統一する<br>- DECISION |

Citations: `notion/projects/maple-campaign`, `slack/marketing/1754000006`, `notion/projects/sakura-portal`, `slack/product/1754000001`, `slack/finance/1754000002`

<details><summary>Raw local-model answers</summary>

```text
Owner: 高橋 [notion/projects/maple-campaign]
Stage: blocked [notion/projects/maple-campaign]

Overdue:
- 法務レビュー [notion/projects/maple-campaign]

Dropped:
- インフルエンサー施策 [notion/projects/maple-campaign]

Decided, not executed:
- LP の CTA は無料相談に統一する [slack/marketing/1754000006]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/marketing/1754000006]
- DECISION [notion/projects/sakura-portal]
- DECISION [slack/product/1754000001]
- DECISION [slack/finance/1754000002]
```
</details>

### Atlas Search

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Noah Williams | Noah Williams |
| Stage | in_progress | in_progress |
| Overdue | - relevance benchmark | - The relevance benchmark |
| Dropped | — | — |
| Decided, not executed | - Keep the synonym service self-hosted | - Keep the synonym service self-hosted<br>- Use Stripe Tax for EU VAT<br>- DECISION |

Citations: `notion/projects/atlas-search`, `slack/search/1754000007`, `slack/finance/1754000002`, `slack/product/1754000001`, `slack/mobile/1754000004`

<details><summary>Raw local-model answers</summary>

```text
Owner: Noah Williams [notion/projects/atlas-search]
Stage: in_progress [notion/projects/atlas-search]

Overdue:
- The relevance benchmark [notion/projects/atlas-search]

Dropped:

Decided, not executed:
- Keep the synonym service self-hosted [slack/search/1754000007]
- Use Stripe Tax for EU VAT [slack/finance/1754000002]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/search/1754000007]
- DECISION [slack/product/1754000001]
- DECISION [slack/finance/1754000002]
- DECISION [slack/mobile/1754000004]
```
</details>

## Limitations

This small synthetic dataset cannot establish production accuracy. Results depend on the configured local model size and decoding behavior; PDF extraction can add substantial latency; labels involve judgment about task equivalence and whether follow-up is sufficient; and seven invented projects do not represent the language, ambiguity, or source distribution of real customer work.
