---
id: 95
title: "Webパフォーマンス最適化ガイド — 計測から改善まで体系的アプローチ"
tags: [パフォーマンス, Web, フロントエンド, バックエンド]
create: "2026-06-27 21:30"
---

## はじめに

Webパフォーマンスはユーザー体験とビジネス成果に直結する。Googleの調査によれば、ページ読み込みが1秒から3秒に遅延するとバウンス率が32%増加する。本記事では、計測→ボトルネック特定→改善→検証のサイクルを体系的に解説する。

## パフォーマンス指標（Core Web Vitals + α）

| 指標 | 正式名 | 良好の基準 | 測定対象 |
|:---|:---|:---|:---|
| TTFB | Time to First Byte | ≤ 800ms | サーバー応答速度 |
| FCP | First Contentful Paint | ≤ 1.8s | 最初のコンテンツ描画 |
| LCP | Largest Contentful Paint | ≤ 2.5s | 最大コンテンツ描画 |
| CLS | Cumulative Layout Shift | ≤ 0.1 | レイアウトのずれ |
| INP | Interaction to Next Paint | ≤ 200ms | インタラクション応答性 |

LCP・CLS・INPがCore Web Vitalsであり、SEOランキングにも影響する。TTFBはサーバーサイドの健全性指標、FCPは体感速度の初期指標として併用する。

## 計測ツール

### Lab Data（開発時計測）

**Lighthouse**

```bash
# CLI実行（ヘッドレス）
npx lighthouse https://example.com --output=json --output-path=./report.json

# 特定カテゴリのみ
npx lighthouse https://example.com --only-categories=performance
```

Lighthouseスコアは75以上を最低ライン、90以上を目標とする。

**WebPageTest**

WebPageTest（webpagetest.org）は実際のネットワーク条件でのテストが可能である。3G回線・途上国サーバーからのテストでワーストケースを把握する。Waterfall Chartでリソース読み込み順を可視化できる。

**Chrome DevTools Performance Panel**

1. DevTools → Performance → Record
2. ユーザー操作を再現
3. Main threadのlong task（50ms超）を特定
4. Bottom-Up / Call Treeで関数単位の実行時間を確認

### Field Data（実ユーザー計測 / RUM）

Real User Monitoring（RUM）はweb-vitalsライブラリで実装できる。

```javascript
import { onLCP, onCLS, onINP } from 'web-vitals';

onLCP(metric => sendToAnalytics('LCP', metric));
onCLS(metric => sendToAnalytics('CLS', metric));
onINP(metric => sendToAnalytics('INP', metric));
```

p75値を基準にアラートを設定し、p95/p99でテールレイテンシを監視する。

## サーバーサイド最適化

### DBクエリ最適化

**N+1問題の検出と解決**

N+1問題は、1件の親クエリに対してN件の子クエリが発行されるアンチパターンである。

```sql
-- 悪い例：記事一覧で著者名を取得する際にN+1が発生
SELECT * FROM articles;           -- 1クエリ
SELECT * FROM users WHERE id = 1; -- N回繰り返し
SELECT * FROM users WHERE id = 2;
...

-- 良い例：JOINまたはIN句で1-2クエリに集約
SELECT a.*, u.name AS author_name
FROM articles a
JOIN users u ON a.user_id = u.id;
```

ORMを使用する場合はEager Loading（Railsなら`includes`、Laravelなら`with`）を適用する。

**EXPLAINによるクエリ分析**

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42 AND status = 'pending';
```

確認ポイント:
- `Seq Scan`（フルスキャン）が大規模テーブルで発生していないか
- `rows`の見積もりと実際の乖離
- `Sort`がメモリ内で完了しているか

**インデックス設計**

```sql
-- 複合インデックス（カーディナリティの高い列を先頭に）
CREATE INDEX idx_orders_user_status ON orders (user_id, status);

-- カバリングインデックス（SELECT対象列を含める）
CREATE INDEX idx_orders_covering ON orders (user_id, status) INCLUDE (total, created_at);
```

インデックスは書き込み性能とトレードオフである。UPDATE/INSERTが多いテーブルでは不要なインデックスを定期的に棚卸しする。

### キャッシュ戦略

**Redis（アプリケーションキャッシュ）**

```python
import redis

r = redis.Redis(host='localhost', port=6379)

def get_user_profile(user_id):
    cache_key = f"user:profile:{user_id}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)
    
    profile = db.query_user_profile(user_id)
    r.setex(cache_key, 300, json.dumps(profile))  # TTL 5分
    return profile
```

キャッシュ戦略の選択:
- **Cache-Aside**: 読み取り頻度が高く、更新頻度が低いデータ
- **Write-Through**: データ整合性が重要な場合
- **TTL設計**: アクセス頻度と許容される古さのバランス

**CDN（静的アセット + API応答）**

```
# nginx設定例
location /static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location /api/public/ {
    add_header Cache-Control "public, max-age=60, stale-while-revalidate=300";
}
```

**HTTP Cache-Control設計**

| リソース種別 | Cache-Control | 理由 |
|:---|:---|:---|
| ハッシュ付き静的アセット | `public, max-age=31536000, immutable` | ファイル名にハッシュがあるため永続キャッシュ可能 |
| HTML | `no-cache` | 常に再検証し最新を返す |
| API（公開データ） | `public, max-age=60, s-maxage=300` | CDNで5分、ブラウザで1分 |
| API（個人データ） | `private, no-store` | キャッシュ禁止 |

### レスポンス圧縮

```nginx
# nginx.conf
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml;
gzip_min_length 1024;

# Brotli（gzipより15-20%高圧縮率）
brotli on;
brotli_types text/plain text/css application/json application/javascript;
brotli_comp_level 6;
```

Brotliは静的アセットの事前圧縮に最適である。動的レスポンスではCPUコストとのバランスでレベル4-6を選択する。

```bash
# 事前圧縮（ビルド時）
brotli -q 11 dist/main.js  # 最高圧縮率で事前生成
```

### 外部API呼び出しの並列化

直列呼び出しは各APIのレイテンシが累積する。独立したAPI呼び出しは並列化する。

```javascript
// 悪い例：直列（合計レイテンシ = A + B + C）
const userProfile = await fetchUserProfile(userId);
const orders = await fetchOrders(userId);
const recommendations = await fetchRecommendations(userId);

// 良い例：並列（合計レイテンシ = max(A, B, C)）
const [userProfile, orders, recommendations] = await Promise.all([
  fetchUserProfile(userId),
  fetchOrders(userId),
  fetchRecommendations(userId),
]);
```

タイムアウトとフォールバックも設定する。

```javascript
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))]);

const profile = await withTimeout(fetchUserProfile(userId), 3000);
```

## フロントエンド最適化

### バンドルサイズ削減

**Tree Shaking**

ES Modulesの`import/export`構文を使用し、未使用コードをビルド時に除去する。

```javascript
// 悪い例：名前空間全体をインポート
import _ from 'lodash';
_.debounce(fn, 300);

// 良い例：必要な関数のみインポート
import debounce from 'lodash/debounce';
debounce(fn, 300);
```

バンドルサイズの確認:

```bash
# webpack
npx webpack-bundle-analyzer dist/stats.json

# vite
npx vite-bundle-visualizer
```

**Code Splitting + Dynamic Import**

```javascript
// ルートベースの分割（React）
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

初期バンドルは200KB（gzip後）以下を目標とする。

### 画像最適化

**次世代フォーマット（WebP / AVIF）**

| フォーマット | 圧縮率（JPEGの比） | ブラウザ対応 |
|:---|:---|:---|
| WebP | 25-35%削減 | 97%+ |
| AVIF | 50%削減 | 92%+ |

```html
<picture>
  <source srcset="hero.avif" type="image/avif">
  <source srcset="hero.webp" type="image/webp">
  <img src="hero.jpg" alt="Hero image" width="1200" height="600">
</picture>
```

**Lazy Loading + レスポンシブ画像**

```html
<img
  src="placeholder.jpg"
  srcset="image-400w.webp 400w, image-800w.webp 800w, image-1200w.webp 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1024px) 800px, 1200px"
  loading="lazy"
  decoding="async"
  alt="Description"
  width="1200"
  height="600"
>
```

LCP対象の画像は`loading="lazy"`を付けないこと。代わりに`fetchpriority="high"`を指定する。

```html
<img src="hero.webp" fetchpriority="high" alt="Hero" width="1200" height="600">
```

### Critical Rendering Path最適化

**リソースヒント**

```html
<head>
  <!-- DNS事前解決 -->
  <link rel="dns-prefetch" href="https://cdn.example.com">
  <!-- 接続の事前確立 -->
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <!-- 重要リソースの事前読み込み -->
  <link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
  <!-- 次ページの事前取得 -->
  <link rel="prefetch" href="/next-page.js">
</head>
```

**CSSの最適化**

```html
<!-- Critical CSSをインライン化 -->
<style>
  /* Above-the-fold に必要な最小限のCSS */
  body { margin: 0; font-family: system-ui; }
  .header { height: 64px; background: #fff; }
</style>

<!-- 残りのCSSは非同期読み込み -->
<link rel="stylesheet" href="main.css" media="print" onload="this.media='all'">
```

### JavaScript実行コスト削減

**Long Taskの分割**

50msを超えるタスクはメインスレッドをブロックし、INPを悪化させる。

```javascript
// 重い処理をyieldで分割
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function processLargeList(items) {
  for (let i = 0; i < items.length; i++) {
    processItem(items[i]);
    if (i % 100 === 0) {
      await yieldToMain(); // 100件ごとにメインスレッドに制御を返す
    }
  }
}
```

**Web Workerによるオフロード**

```javascript
// worker.js
self.onmessage = (e) => {
  const result = heavyComputation(e.data);
  self.postMessage(result);
};

// main.js
const worker = new Worker('/worker.js');
worker.postMessage(largeDataset);
worker.onmessage = (e) => updateUI(e.data);
```

**サードパーティスクリプトの制御**

```html
<!-- 遅延読み込み（DOMContentLoaded後） -->
<script src="analytics.js" defer></script>

<!-- ユーザー操作後に読み込み -->
<script>
  document.addEventListener('scroll', () => {
    import('./chat-widget.js');
  }, { once: true });
</script>
```

## p99レスポンスタイムの改善アプローチ

p99（99パーセンタイル）は100リクエスト中最も遅い1件の応答時間を示す。平均値では見えないテールレイテンシの問題を捉える。

### p99が悪化する典型的原因

1. **GC（ガベージコレクション）停止**: ヒープサイズの肥大化
2. **コネクションプール枯渇**: DB接続待ちのキューイング
3. **外部APIのタイムアウト待ち**: リトライ無しの同期呼び出し
4. **ロック競合**: 排他制御による待機
5. **コールドスタート**: コンテナ/Lambda初期化

### 改善手法

```yaml
# コネクションプール設定例（HikariCP）
maximumPoolSize: 20
minimumIdle: 5
connectionTimeout: 3000   # 3秒でタイムアウト
idleTimeout: 600000       # 10分でidle接続を回収
```

外部APIには必ずタイムアウトとCircuit Breakerを設定する。

```javascript
// Circuit Breaker パターン（概念）
const breaker = new CircuitBreaker(fetchExternalAPI, {
  timeout: 3000,        // 3秒タイムアウト
  errorThreshold: 50,   // エラー率50%でOpen
  resetTimeout: 30000,  // 30秒後にHalf-Open
});
```

## ボトルネック特定の手順

### 1. プロファイリング（現状把握）

```bash
# サーバーサイド：レスポンスタイム分布の確認
# アクセスログからp50/p95/p99を算出
awk '{print $NF}' access.log | sort -n | awk '
  {a[NR]=$1}
  END {
    print "p50:", a[int(NR*0.5)];
    print "p95:", a[int(NR*0.95)];
    print "p99:", a[int(NR*0.99)];
  }'
```

フロントエンド:
- Chrome DevTools → Performance → Record → ユーザー操作再現
- Long Taskを特定し、Call Treeで原因関数を追跡

### 2. 仮説立案

データに基づき仮説を立てる。

| 観測事象 | 仮説 | 検証方法 |
|:---|:---|:---|
| TTFBが2秒超 | DBクエリが遅い | Slow Query Logの確認 |
| LCPが4秒超 | 画像が未最適化 | Network panelで画像サイズ確認 |
| INPが500ms超 | JSのLong Task | Performance panelでTask確認 |
| p99のみ悪い | GC or 接続枯渇 | JVMメトリクス / プール状態確認 |

### 3. 検証（A/Bテスト or 段階的リリース）

1. ステージング環境で改善を適用
2. 負荷テストで効果を定量化
3. カナリアリリース（5%→25%→100%）で本番検証
4. RUMデータでp75/p99の変化を確認

```bash
# 負荷テスト（k6）
k6 run --vus 100 --duration 60s load-test.js
```

## 改善施策の優先順位付け

### 効果 × 工数マトリクス

施策を「効果（パフォーマンス改善度）」と「工数（実装コスト）」の2軸で分類する。

```
        効果 大
          │
    ②     │     ①
  重要だが  │  最優先
  要計画   │  （Quick Win）
          │
──────────┼──────────
          │
    ④     │     ③
  後回し   │  余裕があれば
          │
          │
        効果 小
   工数 大         工数 小
```

### 優先度別の施策例

| 優先度 | 施策 | 効果 | 工数 |
|:---|:---|:---|:---|
| ① Quick Win | 画像のWebP変換 | LCP 30-50%改善 | 数時間 |
| ① Quick Win | Cache-Controlヘッダー設定 | TTFB大幅改善 | 数時間 |
| ① Quick Win | gzip/Brotli有効化 | 転送量60-80%削減 | 1時間 |
| ② 計画的実施 | Code Splitting導入 | 初期読み込み50%削減 | 数日 |
| ② 計画的実施 | DBインデックス最適化 | クエリ10-100倍高速化 | 数日 |
| ③ 余裕時 | Web Worker導入 | INP改善 | 数日 |
| ④ 後回し | フレームワーク移行 | 全体改善 | 数週間〜 |

### 実行の原則

1. 計測なき最適化は行わない — 必ずベースラインを取得してから着手
2. 1つずつ変更し効果を測定 — 複数施策を同時適用すると因果関係が不明になる
3. ユーザー影響度で判断 — p75改善はp99改善より多くのユーザーに恩恵がある
4. 自動化で退行を防ぐ — Lighthouse CIをパイプラインに組み込む

```bash
# Lighthouse CI（GitHub Actionsでの実行例）
npx lhci autorun --config=lighthouserc.json
```

## まとめ

Webパフォーマンス最適化は、計測→分析→改善→検証の継続的サイクルである。

- まず計測ツール（RUM + Lighthouse）でベースラインを確立する
- Core Web Vitals（LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms）を目標に設定する
- Quick Win（圧縮・キャッシュ・画像最適化）から着手し、早期に効果を出す
- サーバーサイドはDBクエリとキャッシュ、フロントエンドはバンドルサイズとCritical Pathが主戦場である
- p99の改善にはタイムアウト設定とCircuit Breakerが有効である
- 改善は効果×工数マトリクスで優先順位を付け、1つずつ検証する
