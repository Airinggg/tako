# Evaluation report: synthetic

Generated with local Ollama models in an ephemeral GBrain home.

## Metrics

| Metric | Value |
| --- | ---: |
| owner_accuracy | 1.000 |
| stage_accuracy | 1.000 |
| overdue_precision | 0.667 |
| overdue_recall | 0.800 |
| dropped_recall | 0.800 |
| decided_not_executed_recall | 0.600 |
| grounding | 0.841 |
| latency_p50 | 48905 ms |
| latency_p95 | 86646 ms |

## Projects

### さくら市民ポータル

No exact field differences.

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | 佐藤 | 佐藤 |
| Stage | in_progress | in_progress |
| Overdue | - モバイル画面のワイヤーフレーム | - モバイル画面のワイヤーフレーム |
| Dropped | - 紙の申込書を残す案 | - 紙の申込書を残す案 |
| Decided, not executed | - 検索基盤はMeilisearchを採用する | - 検索基盤はMeilisearchを採用する |

Citations: `notion/projects/sakura-portal`, `slack/product/1754000001`

<details><summary>Raw local-model answers</summary>

```text
Owner: 佐藤 [notion/projects/sakura-portal]

Stage: STAGE in_progress [notion/projects/sakura-portal]

Overdue:
- モバイル画面のワイヤーフレーム [slack/product/1754000001]

Dropped:
- 紙の申込書を残す案 [slack/product/1754000001]

Decided, not executed:
- 検索基盤はMeilisearchを採用する [slack/product/1754000001]

(notion/projects/sakura-portal, slack/product/1754000001, notion/projects/atlas-search, notion/projects/hokkyokusei-app, notion/projects/greenfield-onboarding, notion/projects/orbit-billing)

--- decision-log-audit ---
Stranded decisions (no follow-up found):
```
</details>

### Orbit Billing

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Maya Chen | Maya Chen |
| Stage | blocked | blocked |
| Overdue | - payment-provider sandbox approval | - Payment-provider sandbox approval (2026-08-05) |
| Dropped | - annual-plan launch | - Annual-plan launch |
| Decided, not executed | - Use Stripe Tax for EU VAT | - Use Stripe Tax for EU VAT<br>- DECISION |

Citations: `notion/projects/orbit-billing`, `slack/finance/1754000002`, `slack/customer-success/1754000003`, `slack/data/1754000005`, `slack/product/1754000001`

<details><summary>Raw local-model answers</summary>

```text
Owner: Maya Chen [notion/projects/orbit-billing]

Stage: blocked [notion/projects/orbit-billing]

Overdue:
- Payment-provider sandbox approval (2026-08-05) [slack/finance/1754000002]

Dropped:
- Annual-plan launch [slack/customer-success/1754000003]

Decided, not executed:
- Use Stripe Tax for EU VAT [slack/finance/1754000002]

--- decision-log-audit ---
Stranded decisions (no follow-up found):  
- DECISION [slack/finance/1754000002]  
- DECISION [slack/customer-success/1754000003]  
- DECISION [slack/data/1754000005]  
- DECISION [slack/product/1754000001]
```
</details>

### Greenfield Onboarding

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Liam Osei | Liam Osei |
| Stage | review | review |
| Overdue | - security questionnaire | - security questionnaire |
| Dropped | — | - annual-plan launch |
| Decided, not executed | — | - drop mobile screen wireframes<br>- DECISION  - 音声入力機能は初期スコープから dropped（中止）。期限超過のタスクはない。 |

Citations: `notion/projects/greenfield-onboarding`, `slack/customer-success/1754000003`, `notion/projects/sakura-portal`, `notion/projects/hokkyokusei-app`

<details><summary>Raw local-model answers</summary>

```text
Owner: Liam Osei [notion/projects/greenfield-onboarding]

Stage: review [notion/projects/greenfield-onboarding]

Overdue:
- security questionnaire [slack/customer-success/1754000003]

Dropped:
- annual-plan launch [notion/projects/greenfield-onboarding]

Decided, not executed:
- drop mobile screen wireframes [notion/projects/sakura-portal]

(notice: There are no tasks marked as dropped or decisions not executed in the provided source pages for the "Greenfield Onboarding" project.)

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [notion/projects/hokkyokusei-app] - 音声入力機能は初期スコープから dropped（中止）。期限超過のタスクはない。
```
</details>

### 北極星アプリ

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | 鈴木 | 鈴木 |
| Stage | not_started | not_started |
| Overdue | — | - モバイル画面のワイヤーフレーム |
| Dropped | - 音声入力機能 | - 音声入力機能<br>- 紙の申込書を残す案 |
| Decided, not executed | - 初期版はiOSのみで公開する | - 初期版はiOSのみで公開する<br>- 検索基盤はMeilisearchを採用する<br>- Atlas Searchの関連性基準は2026-08-15に完了<br>- DECISION |

Citations: `notion/projects/hokkyokusei-app`, `notion/projects/sakura-portal`, `slack/product/1754000001`, `slack/search/1754000007`

<details><summary>Raw local-model answers</summary>

```text
Owner: 鈴木 [notion/projects/hokkyokusei-app]

Stage: STAGE not_started [notion/projects/hokkyokusei-app]

Overdue:  
- モバイル画面のワイヤーフレーム [notion/projects/sakura-portal]

Dropped:  
- 音声入力機能 [notion/projects/hokkyokusei-app]
- 紙の申込書を残す案 [notion/projects/sakura-portal]

Decided, not executed:  
- 初期版はiOSのみで公開する [slack/product/1754000001]
- 検索基盤はMeilisearchを採用する [slack/product/1754000001]
- Atlas Searchの関連性基準は2026-08-15に完了 [slack/search/1754000007]

--- decision-log-audit ---
Stranded decisions (no follow-up found):
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
| Dropped | - legacy CSV export | — |
| Decided, not executed | — | - Atlas Search architecture decision  - The decision to keep the synonym service self-hosted has no subsequent deployment task or implementation evidence. |

Citations: `notion/projects/harbor-migration`, `slack/search/1754000007`

<details><summary>Raw local-model answers</summary>

```text
Owner: Ana Silva [notion/projects/harbor-migration]

Stage: STAGE done [notion/projects/harbor-migration]

Overdue:  
- None

Dropped:  
- None

Decided, not executed:  
- Atlas Search architecture decision [slack/search/1754000007] - The decision to keep the synonym service self-hosted has no subsequent deployment task or implementation evidence.

--- decision-log-audit ---
Stranded decisions (no follow-up found):
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
| Decided, not executed | - LPのCTAは無料相談に統一する | - ライフサイクルのCTAを無料相談に統一する<br>- DECISION |

Citations: `notion/projects/maple-campaign`, `orbit-billing-tax-decision`

<details><summary>Raw local-model answers</summary>

```text
Owner: 高橋 [notion/projects/maple-campaign]

Stage: blocked [notion/projects/maple-campaign]

Overdue:
- 法務レビュー

Dropped:
- インフルエンサー施策

Decided, not executed:
- ライフサイクルのCTAを無料相談に統一する

--- decision-log-audit ---
Stranded decisions (no follow-up found):  
- DECISION [orbit-billing-tax-decision]
```
</details>

### Atlas Search

**Gold and prediction differ; inspect the fields below.**

| Field | Gold | Predicted |
| --- | --- | --- |
| Owner | Noah Williams | Noah Williams |
| Stage | in_progress | in_progress |
| Overdue | - relevance benchmark | - The relevance benchmark (due 2026-08-15) is incomplete. |
| Dropped | — | - The sound input feature was dropped from the initial scope. |
| Decided, not executed | - Keep the synonym service self-hosted | - The decision to keep the synonym service self-hosted (slack/search/1754000007) has no subsequent deployment task or implementation evidence.<br>- DECISION |

Citations: `notion/projects/atlas-search`, `slack/finance/1754000002`

<details><summary>Raw local-model answers</summary>

```text
Owner: Noah Williams [notion/projects/atlas-search]

Stage: STAGE in_progress [notion/projects/atlas-search]

Overdue:  
- The relevance benchmark (due 2026-08-15) is incomplete.

Dropped:  
- The sound input feature was dropped from the initial scope.

Decided, not executed:  
- The decision to keep the synonym service self-hosted (slack/search/1754000007) has no subsequent deployment task or implementation evidence.

--- decision-log-audit ---
Stranded decisions (no follow-up found):
- DECISION [slack/finance/1754000002]
```
</details>

## Limitations

This small synthetic dataset cannot establish production accuracy. Results depend on the configured local model size and decoding behavior; PDF extraction can add substantial latency; labels involve judgment about task equivalence and whether follow-up is sufficient; and seven invented projects do not represent the language, ambiguity, or source distribution of real customer work.
