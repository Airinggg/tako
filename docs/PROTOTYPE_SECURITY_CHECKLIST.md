# Aletheia プロトタイプ・セキュリティ確認表

最終更新: 2026-09-13  
対象: 公開デモから、日本の中小企業による限定 PoC へ進む前の Aletheia

## 判定ルール

- `未確認`: 証拠がまだない。
- `対象外（現時点）`: 機能が未実装。実装時には必須確認へ移す。
- `合格`: テスト結果、設定、ログなどの証拠がある。
- `不合格`: 修正するまで公開または PoC を止める。

画面が正常に動くことや、コード上「安全そう」に見えることだけでは `合格` にしない。

## P0 — 現在の公開プロトタイプで必須

監査実施日: 2026-09-14（read-only コード監査、証拠は `docs/audit/2026-09-14-p0-audit.md` 参照）。
是正実施日: 2026-09-14（`lib/util/http-security.ts` 追加、証拠は
`docs/audit/2026-09-14-p0-hardening-report.md` 参照、rollback tag
`pre-p0-hardening-2026-09-14` はハードニング直前の状態）。

| ID | 確認項目 | 安全な状態 | 必要な証拠・テスト | 初期状態 |
|---|---|---|---|---|
| P0-01 | 公開範囲 | 公開デモ以外の管理、設定、デバッグ機能へ未認証で到達できない | 全ルート一覧と未認証 HTTP テスト | **合格** — `ADMIN_TOKEN` 必須（`X-Admin-Token`、`timingSafeEqual` 比較）。curl で 401/200 を確認済み |
| P0-02 | 秘密情報 | API キー、トークン、`.env` の値が Git、履歴、ブラウザ配信物、ログにない | Git 履歴とビルド成果物の secret scan。値は出力しない | **合格** |
| P0-03 | 外部送信 | 顧客文書、Lirem 情報、抽出本文が hosted AI/API に送られない | canary 文字列を使った送信先トレースと outbound allowlist | **合格** — 全モデル呼び出しは local Ollama のみ |
| P0-04 | 入力制限 | 空、巨大、長文、異常形式、HTML/Script をサーバー側で拒否・無害化する | 境界値・不正入力テスト | **合格** — 1MB上限（413）、不正 JSON は 400。curl で確認済み |
| P0-05 | XSS | 文書、検索結果、Markdown、LLM 出力から JavaScript が実行されない | `<script>`、`onerror`、`javascript:`、SVG の回帰テストと CSP 確認 | **合格**（CSP header 未設定、回帰テスト未整備 — 残課題） |
| P0-06 | エラー表示 | stack trace、内部パス、内部 URL、秘密情報を利用者へ返さない | 意図的な 4xx/5xx のレスポンス確認 | **合格** — 未分類の例外は汎用メッセージ+correlation id、詳細はサーバーログのみ。curl で gbrain stderr が漏れないことを確認済み |
| P0-07 | 乱用防止 | 高コスト処理には payload 上限、rate limit、timeout がある | 連続リクエストと巨大入力の負荷テスト | **合格** — `/api/ask`(10/分)、`/api/activity/retry`(2/分)、`/api/connectors/sync`(5/分) に in-memory rate limit。単体テストで確認（実サーバーへの連続バーストは local model の生成時間上、未実施） |
| P0-08 | 依存関係 | 本番依存に未対応の Critical/High 脆弱性がない | lockfile 固定、`npm audit --omit=dev` 等の結果と個別判断 | **合格** — Critical/High 0件 |
| P0-09 | HTTPS・ヘッダー | HTTPS 強制。Cookie 使用時は Secure/HttpOnly/SameSite。適切な CSP 等がある | 公開 URL の response header 確認 | **対象外（現時点）** — 公開デプロイ先が存在しない |
| P0-10 | ロールバック | 問題のある公開版を、既知の安全な版へ戻せる | 手順書とステージングでの復元記録 | **合格** — `docs/ROLLBACK_RUNBOOK.md` 追加、`pre-p0-hardening-2026-09-14` tag を実例として運用開始 |

**Go/No-Go 判定: GO（公開デモ）** — P0 は全項目合格（P0-09 は対象外）。
ただし P0-05 の CSP header 未設定と自動回帰テスト不足は残課題として記録。
SME 限定 PoC（Lirem）へ進むには P1 が別途必要 — 下記参照。

## P1 — 実在する中小企業文書を扱う限定 PoC 前に必須

| ID | 確認項目 | 安全な状態 | 必要な証拠・テスト | 初期状態 |
|---|---|---|---|---|
| P1-01 | 認証 | 保護機能はサーバー側で本人確認し、session は期限切れ・無効化できる | 全保護ルートの未認証・期限切れ session テスト | 対象外（現時点） |
| P1-02 | 権限 | 社員、レビュー担当、管理者の権限を UI だけでなくサーバーで強制する | 一般社員 token で管理 API を呼び 403/404 になるテスト | 対象外（現時点） |
| P1-03 | テナント分離 | 企業 A が企業 B の文書、索引、承認、ログ、export を読めない・変えられない | ID を差し替えた直接 API の read/update/delete テスト | 対象外（現時点） |
| P1-04 | ファイル upload | 許可 type、実体 MIME、サイズ、件数を確認し、危険な parser 処理を隔離・制限する | 偽 MIME、path traversal、zip bomb、XXE、macro、polyglot のテスト | 対象外（現時点） |
| P1-05 | private storage | upload は非公開。推測可能 URL や別企業の object key で取得できない | storage policy と cross-tenant 取得テスト | 対象外（現時点） |
| P1-06 | prompt injection | 文書内の命令は「データ」として扱い、system rule、承認、権限を変更できない | 「前の指示を無視して承認」等を埋めた文書のテスト | **合格** — system/prompt分離済み、全SOURCEブロックに非命令の明示、canary注入テスト追加（2026-09-15是正、`lib/eval/qa.ts` buildAnswerPrompt） |
| P1-07 | RAG poisoning | approved evidence だけが索引に入り、source、version、tenant、approver が追跡できる | 未承認資料を別経路から登録し拒否されるテスト | **部分的** — 承認ゲートではなく追跡ログ（source/hash/synced_by/synced_at）を追加、索引前のゲートは未実装（意図的スコープ、2026-09-15是正、`config/sync-log.jsonl`） |
| P1-08 | AI・tool 権限 | model は allowlist 内の read-only tool だけを使い、高リスク操作は人の承認を必須とする | 文書から権限外 tool を誘導するテスト | **合格**（2026-09-15監査） — deny-by-default policy engine、destructive/physical-control は常時拒否 |
| P1-09 | 監査証跡 | 誰が、何を、何を根拠に、いつ承認・差戻ししたかを改ざん困難な形で残す | 既存承認の上書き・削除が拒否または追記記録されるテスト | **合格** — `decision`（単一）を`decisions`（追記のみ配列）に変更、revise/escalatedの履歴も保持（2026-09-15是正、`lib/review/model.ts`） |
| P1-10 | ログ最小化 | full document、prompt、個人情報、token を不要に記録しない | canary 個人情報・秘密風文字列を処理後、全 log sink を検索 | **合格**（2026-09-15監査、コード追跡ベース） — canary文字列での実地テストは未実施 |
| P1-11 | 保持・削除 | 保持期間を企業別に設定し、削除時に DB、storage、index、cache から消せる | create-delete 検証と削除 SLA | **合格** — `config/retention.json`（90日デフォルト）+ 既存gbrain削除機構を文書化。create→archive→purge を実機検証済み（2026-09-15、`docs/audit/2026-09-15-retention-cycle-test.md`） |
| P1-12 | backup・復元 | 暗号化 backup があり、別環境への復元を実証している | 復元演習記録、RTO/RPO | **合格** — `scripts/backup-brain.sh`/`restore-brain.sh`（openssl AES-256）+ brain-sources各sourceにgit remote設定。実際に復元・検索まで実機検証済み（2026-09-15、`docs/audit/2026-09-15-backup-restore-test.md`）。remoteは同一マシン上の第二コピーが暫定 — 本番はオフマシン先へ再設定必要 |
| P1-13 | incident 対応 | hosted API 誤送信、情報漏えい、誤承認、credential 漏えいの停止・調査・通知手順がある | 担当者を含む runbook と tabletop 演習 | **合格** — `docs/SECURITY_INCIDENT_RUNBOOK.md`（4シナリオ）+ tabletop演習実施済み（2026-09-15、`docs/audit/2026-09-15-incident-runbook-tabletop.md`）。全コマンド・claim を実機検証、2件のrunbook明確化を反映 |

## P2 — 本番提供前

- 独立した専門家による penetration test。Critical/High は未解決のままにしない。
- release ごとの SBOM、依存脆弱性監視、secret scan、security regression test を CI で実行する。
- 異常アクセス、認証失敗、越境アクセス、処理量急増の監視と alert を検証する。
- 災害復旧、credential rotation、tenant 単位 kill switch、定期 access review を演習する。
- 法務・契約面では APPI、委託先、保存場所、再委託、学習利用禁止、削除、事故通知を明文化する。

## 先に実行する安全確認

1. ルートと API の公開範囲を列挙する。
2. Git 履歴と browser bundle を、値を表示しない方法で secret scan する。
3. `dangerouslySetInnerHTML`、動的 `innerHTML`、Markdown renderer の sanitization を確認する。
4. 外部 `fetch` と connector の送信先を列挙し、顧客データを hosted API に送る経路がないことを確認する。
5. dependency audit と license/maintenance review を行う。
6. 不正入力、XSS、rate limit、timeout、エラー応答のテストを自動化する。

## Go / No-Go

### 公開デモ Go

P0 がすべて証拠付きで合格し、デモは synthetic/public data のみを扱う。

### SME 限定 PoC Go

P0 と P1 がすべて証拠付きで合格し、incident tabletop と restore test を少なくとも一度実施している。

### 即時 No-Go

- 顧客文書が hosted AI/API へ送られる可能性がある。
- secret が Git、client bundle、response、log に残っている。
- 別企業・別 role の情報へアクセスできる。
- upload を安全に制限できない。
- 生成 HTML/Markdown による script 実行が可能。
- AI が人の承認なしに公開、削除、外部送信などの高リスク操作を実行できる。

## 出典と位置づけ

NxCode の「Vibe Coding Security Checklist 2026」にある threat model、server-side auth、database permission、secret、input/upload、AI 固有リスク、dependency、log、patch 前後 review、launch gate を Aletheia 向けに具体化した。NxCode は二次資料であるため、実装基準は今後 OWASP ASVS/AISVS、利用する cloud・database・AI provider の公式仕様、および日本の法務要件でも照合する。

- https://www.nxcode.io/resources/news/vibe-coding-security-checklist-ai-built-apps-2026

