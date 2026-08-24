---
id: 93
title: "DBレコードのライフサイクル管理 — 論理削除・物理削除・アーカイブの設計パターン"
tags: [データベース, 設計パターン, 運用]
create: "2026-06-27 21:30"
---

## はじめに

データベースのレコードは「作成して終わり」ではない。作成→更新→無効化→削除→アーカイブという一連のライフサイクルを持ち、各段階で適切な設計と運用が求められる。

本記事では、レコードのライフサイクル管理における設計パターンと実装手法を、SQLサンプルを交えて整理する。

## レコードのライフサイクルとは

CRUDの4操作に加え、実務では以下の状態遷移が発生する。

```
作成(Create) → 更新(Update) → 論理削除(Soft Delete) → 物理削除(Hard Delete) → アーカイブ(Archive)
```

各段階の意味を整理する。

| 段階 | 意味 | データの所在 |
|:-----|:-----|:------------|
| 作成 | レコード挿入 | メインテーブル |
| 更新 | 属性値の変更 | メインテーブル |
| 論理削除 | 無効化フラグ付与 | メインテーブル（非表示） |
| 物理削除 | レコード削除 | どこにもない or アーカイブ |
| アーカイブ | 長期保存領域へ移動 | アーカイブテーブル/外部ストレージ |

重要なのは、すべてのレコードがこの全段階を経るわけではないという点である。ビジネス要件に応じて、論理削除を経ずに物理削除する場合もあれば、アーカイブせずに完全消去する場合もある。

## 論理削除 vs 物理削除

### 比較表

| 観点 | 論理削除 | 物理削除 |
|:-----|:---------|:---------|
| データ復旧 | 容易（フラグ戻し） | 困難（バックアップ必要） |
| ストレージ | 増加し続ける | 解放される |
| クエリ性能 | WHERE条件追加が必須 | テーブルサイズが小さく保てる |
| 参照整合性 | 外部キーに影響なし | カスケード削除の考慮必要 |
| 監査要件 | 満たしやすい | 別途監査ログが必要 |
| 実装コスト | 全クエリに条件追加 | 削除処理のみ |
| UNIQUE制約 | 工夫が必要 | 自然に機能する |

### 使い分けの指針

論理削除が適するケース:
- 法令で一定期間のデータ保持が求められる（会計データ等）
- ユーザーが「元に戻す」操作を行う可能性がある
- 削除後も関連データから参照される

物理削除が適するケース:
- 個人情報の完全消去が法的に求められる（GDPR等）
- 一時データ（セッション、OTP等）
- ストレージコストが問題になる大量データ

## ステータス遷移パターン

単純な削除フラグではなく、`status`列による状態管理を行うパターンである。

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_status CHECK (status IN ('active', 'suspended', 'cancelled', 'deleted'))
);
```

状態遷移図:

```
active → suspended → active（復帰可能）
active → cancelled（キャンセル確定、復帰不可）
cancelled → deleted（物理削除待ち）
suspended → deleted（一定期間後に自動遷移）
```

遷移を行うSQLの例:

```sql
-- キャンセル処理
UPDATE orders
SET status = 'cancelled', updated_at = NOW()
WHERE id = :order_id AND status = 'active';

-- 不正な遷移を防ぐため、現在のstatusを条件に含める
-- affected_rows = 0 なら遷移不可として処理する
```

## 論理削除の実装パターン

### パターン1: deleted_at（タイムスタンプ型）

最も一般的なパターン。削除日時が記録されるため、「いつ削除されたか」がわかる。

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 論理削除
UPDATE users SET deleted_at = NOW() WHERE id = :user_id;

-- 復元
UPDATE users SET deleted_at = NULL WHERE id = :user_id;

-- 通常のSELECT（削除済みを除外）
SELECT * FROM users WHERE deleted_at IS NULL;
```

UNIQUE制約との両立（削除済みレコードが制約に干渉しないようにする）:

```sql
-- PostgreSQL: 部分インデックス
CREATE UNIQUE INDEX idx_users_email_active
ON users (email) WHERE deleted_at IS NULL;

-- MySQL: deleted_atをUNIQUEに含める
ALTER TABLE users ADD UNIQUE INDEX idx_users_email_deleted (email, deleted_at);
```

### パターン2: is_deleted（ブーリアン型）

シンプルだが、削除日時がわからない欠点がある。

```sql
ALTER TABLE users ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- 論理削除
UPDATE users SET is_deleted = TRUE, updated_at = NOW() WHERE id = :user_id;

-- 通常のSELECT
SELECT * FROM users WHERE is_deleted = FALSE;
```

### パターン3: statusカラム（列挙型）

前述のステータス遷移パターンと組み合わせる。削除が複数段階ある場合に有効である。

```sql
-- ステータスによるフィルタリング
SELECT * FROM users WHERE status NOT IN ('deleted', 'archived');
```

### 推奨: deleted_at + ビュー

アプリケーション側で毎回`WHERE deleted_at IS NULL`を書くのは漏れやすい。ビューで隠蔽するのが堅実である。

```sql
CREATE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL;

-- アプリケーションからはビュー経由でアクセス
SELECT * FROM active_users WHERE email = 'test@example.com';
```

## 物理削除の安全な実行手順

物理削除は取り返しがつかない。以下の手順で安全に実行する。

### ステップ1: 削除対象の特定と確認

```sql
-- 削除対象の件数確認
SELECT COUNT(*) AS target_count
FROM users
WHERE deleted_at < NOW() - INTERVAL 90 DAY;

-- サンプルデータの目視確認
SELECT id, email, deleted_at
FROM users
WHERE deleted_at < NOW() - INTERVAL 90 DAY
ORDER BY deleted_at ASC
LIMIT 20;
```

### ステップ2: バックアップ

```sql
-- 削除前に対象レコードをエクスポート
CREATE TABLE users_backup_20260627 AS
SELECT * FROM users
WHERE deleted_at < NOW() - INTERVAL 90 DAY;

-- 件数一致確認
SELECT COUNT(*) FROM users_backup_20260627;
```

### ステップ3: バッチ削除

一度に大量削除するとロックが長時間保持され、サービスに影響が出る。バッチ分割が鉄則である。

```sql
-- 1000件ずつ削除するバッチ処理
DELETE FROM users
WHERE deleted_at < NOW() - INTERVAL 90 DAY
ORDER BY id ASC
LIMIT 1000;

-- affected_rows が 0 になるまで繰り返す
```

シェルスクリプトでの自動化例:

```bash
#!/bin/bash
BATCH_SIZE=1000
TOTAL_DELETED=0

while true; do
  DELETED=$(mysql -N -e "
    DELETE FROM users
    WHERE deleted_at < NOW() - INTERVAL 90 DAY
    ORDER BY id ASC
    LIMIT ${BATCH_SIZE};
    SELECT ROW_COUNT();
  " mydb)

  TOTAL_DELETED=$((TOTAL_DELETED + DELETED))
  echo "Deleted: ${DELETED}, Total: ${TOTAL_DELETED}"

  if [ "$DELETED" -eq 0 ]; then
    break
  fi

  sleep 1  # レプリカ遅延を考慮した待機
done
```

### ステップ4: 実行後の確認

```sql
-- 削除後の件数確認
SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL;

-- バックアップテーブルは一定期間後に削除
-- DROP TABLE users_backup_20260627;  -- 1週間後に実行
```

## アーカイブ戦略

### パターン1: アーカイブテーブルへの移動

同一DB内に構造が同じテーブルを作り、レコードを移動する。

```sql
-- アーカイブテーブル作成（本テーブルと同構造）
CREATE TABLE users_archive LIKE users;

-- アーカイブ実行（トランザクションで原子性を保証）
BEGIN;

INSERT INTO users_archive
SELECT * FROM users
WHERE deleted_at < NOW() - INTERVAL 365 DAY;

DELETE FROM users
WHERE deleted_at < NOW() - INTERVAL 365 DAY;

COMMIT;
```

### パターン2: 外部ストレージ退避

大量データの場合、RDBに保持するコスト自体が問題になる。S3等のオブジェクトストレージにParquet/CSV形式で退避する。

```sql
-- PostgreSQLの場合: COPYコマンドでエクスポート
COPY (
  SELECT * FROM users
  WHERE deleted_at < NOW() - INTERVAL 365 DAY
) TO '/tmp/users_archive_20260627.csv' WITH CSV HEADER;

-- エクスポート後に削除
DELETE FROM users WHERE deleted_at < NOW() - INTERVAL 365 DAY;
```

S3へのアップロードとAthenaでのクエリを想定した運用が可能である。

### パターン3: パーティションによる分離

日付ベースのパーティションを利用し、古いパーティションを丸ごとデタッチ・アーカイブする。

```sql
-- PostgreSQL: レンジパーティション
CREATE TABLE events (
    id BIGINT,
    event_type VARCHAR(50),
    created_at TIMESTAMP NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2025 PARTITION OF events
FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE events_2026 PARTITION OF events
FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- 古いパーティションをデタッチ
ALTER TABLE events DETACH PARTITION events_2025;

-- デタッチしたテーブルは独立してダンプ・削除可能
```

## 関連レコードの整合性

### 外部キー制約がある場合

親レコードを削除すると子レコードが孤児になる。対策は3つある。

```sql
-- 方式1: CASCADE DELETE（親削除時に子も削除）
ALTER TABLE order_items
ADD CONSTRAINT fk_order
FOREIGN KEY (order_id) REFERENCES orders(id)
ON DELETE CASCADE;

-- 方式2: SET NULL（親削除時に子のFKをNULLに）
ALTER TABLE comments
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE SET NULL;

-- 方式3: RESTRICT（子が存在する場合は親の削除を拒否）
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE RESTRICT;
```

### 論理削除時の整合性

論理削除では外部キー制約は機能し続けるが、「削除済みの親を参照している」状態が生まれる。

```sql
-- 問題: 削除済みユーザーの注文を表示してしまう
SELECT o.*, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'active';
-- → u.deleted_at IS NOT NULL のレコードが含まれる可能性

-- 対策: JOINにも削除条件を含める
SELECT o.*, u.name
FROM orders o
JOIN users u ON o.user_id = u.id AND u.deleted_at IS NULL
WHERE o.status = 'active';
```

### 削除順序の制御

関連テーブルが多い場合、削除順序を間違えると制約違反が発生する。依存関係の逆順で削除する。

```sql
-- 正しい削除順序（子 → 親）
BEGIN;
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = :user_id);
DELETE FROM orders WHERE user_id = :user_id;
DELETE FROM users WHERE id = :user_id;
COMMIT;
```

## 運用手順書の作り方

サービス運用において、削除・アーカイブ作業を安全に実行するための手順書テンプレートである。

### 手順書に含めるべき項目

```markdown
## 作業概要
- 作業名: 退会済みユーザーの物理削除
- 対象環境: 本番
- 実行条件: deleted_atが90日以上前のレコード
- 想定件数: 約5,000件
- 実行予定時刻: 平日 02:00-04:00（低トラフィック帯）

## 事前確認
1. 削除対象件数の確認SQL
2. 関連テーブルへの影響確認SQL
3. バックアップ取得手順

## 実行手順
1. バックアップ取得
2. バッチ削除実行（1000件/回、1秒間隔）
3. 実行後の件数確認

## ロールバック手順
1. バックアップテーブルからのリストア手順
2. リストア後の整合性確認

## 完了確認
1. 対象テーブルの件数確認
2. アプリケーションの正常動作確認
3. 監視アラートの確認
```

### 確認SQL集

```sql
-- 事前確認: 削除対象の集計
SELECT
    DATE(deleted_at) AS deleted_date,
    COUNT(*) AS record_count
FROM users
WHERE deleted_at < NOW() - INTERVAL 90 DAY
GROUP BY DATE(deleted_at)
ORDER BY deleted_date;

-- 事前確認: 関連レコードの存在チェック
SELECT
    'orders' AS table_name,
    COUNT(*) AS related_count
FROM orders
WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < NOW() - INTERVAL 90 DAY
)
UNION ALL
SELECT
    'comments' AS table_name,
    COUNT(*) AS related_count
FROM comments
WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < NOW() - INTERVAL 90 DAY
);

-- 事後確認: 孤児レコードがないことの確認
SELECT COUNT(*)
FROM orders o
LEFT JOIN users u ON o.user_id = u.id
WHERE u.id IS NULL;
```

## アンチパターン

### 1. 削除フラグの乱用

すべてのテーブルに一律`deleted_at`を追加するのは思考停止である。

```sql
-- アンチパターン: ログテーブルに論理削除
-- ログは追記専用であり、削除の概念がない
CREATE TABLE access_logs (
    id BIGINT PRIMARY KEY,
    path VARCHAR(255),
    deleted_at TIMESTAMP NULL  -- ← 不要
);
```

テーブルごとに「このデータは復元が必要か？」を問い、必要な場合のみ論理削除を導入する。

### 2. 孤児レコードの放置

親レコードを物理削除した後、子レコードが参照先を失ったまま残る。

```sql
-- 孤児レコードの検出
SELECT c.id, c.user_id
FROM comments c
LEFT JOIN users u ON c.user_id = u.id
WHERE u.id IS NULL;
```

対策: 外部キー制約を設定するか、定期的な孤児レコード検出バッチを組む。

### 3. 参照整合性の破壊

論理削除済みレコードのIDを再利用する、あるいは論理削除済みのマスタをJOINで無視してしまうケース。

```sql
-- アンチパターン: 削除済みカテゴリに紐づく商品が表示不能になる
SELECT p.name, c.name AS category_name
FROM products p
JOIN categories c ON p.category_id = c.id
WHERE c.deleted_at IS NULL;
-- → カテゴリが論理削除されると商品が検索結果から消える

-- 対策: LEFT JOINにして、削除済みカテゴリ名も表示する
SELECT p.name, COALESCE(c.name, '(削除済みカテゴリ)') AS category_name
FROM products p
LEFT JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL;
```

### 4. UNIQUE制約の未考慮

```sql
-- アンチパターン: 論理削除後に同じemailで再登録できない
-- UNIQUE(email) があると、deleted_atがNULLでないレコードも制約対象

-- 対策（再掲）: 部分インデックスを使用
CREATE UNIQUE INDEX idx_users_email_active
ON users (email) WHERE deleted_at IS NULL;
```

### 5. N+1的な削除チェック

アプリケーション側で毎回`IF deleted THEN skip`のような処理を書くのは保守の地獄である。ビューやORMのデフォルトスコープで一元管理する。

## まとめ

レコードのライフサイクル管理で重要なのは以下の3点である。

1. テーブルごとに削除戦略を明示的に決定する（論理/物理/アーカイブ）
2. 物理削除は必ず「確認→バックアップ→バッチ実行→事後確認」の手順を踏む
3. 関連レコードの整合性を常に意識し、孤児レコードの発生を防ぐ

削除は「作る」より難しい。設計段階でライフサイクルを定義し、運用手順を整備しておくことが、長期的なシステムの健全性を保つ鍵である。
