# Cloudflareへの移行手順

Vercelで運用しているこのブログを、Cloudflare Workers（Static Assets）へ移行するための手順書。

## 方式の選定

**Cloudflare Workers の Static Assets を使う**（Cloudflare Pagesではない）。

| 観点             | 内容                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Cloudflareの推奨 | 新規プロジェクトはPagesではなくWorkers Static Assetsが推奨。Pagesはサポート継続中だが新機能の投資先ではない  |
| 料金             | 静的アセットへのリクエストは無料かつ無制限。Workerスクリプトを持たない構成なので、リクエスト課金は発生しない |
| 無料枠の上限     | 1バージョンあたり20,000ファイル、1ファイル25MiBまで                                                          |
| このサイトの実測 | 7,119ファイル / 合計106MB / 最大ファイル2.9MB → 無料枠に収まる                                               |

このサイトは`output: 'export'`による完全な静的サイトで、APIルートもサーバー機能も使っていないため、Workerスクリプトなしのアセット配信のみで動作する。

## 運用方針：無料枠のみを使う

このブログはCloudflareの無料枠の範囲内だけで運用する。有料プラン（Workers Paid）へのアップグレードは行わない。

### 課金が発生しない理由

`wrangler.jsonc`に`main`（Workerスクリプトのエントリポイント）を書いていないため、この構成にはWorkerスクリプトが存在しない。公式の料金ページに明記されている通り、**静的アセットへのリクエストは無料かつ無制限**であり、リクエスト数による課金もアクセス数の上限もない。

無料プランの「1日100,000リクエスト」という制限はWorkerスクリプトの実行回数に対するもので、アセット配信のみの構成では消費されない。

### 課金につながるため避ける変更

| 変更                                                                            | 何が起きるか                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `wrangler.jsonc`に`main`を追加してWorkerスクリプトを動かす                      | リクエストが課金・上限の対象になる（無料プランは1日100,000リクエストで停止） |
| [Workers Caching](https://developers.cloudflare.com/workers/cache/)を有効にする | キャッシュ経由の配信が課金対象になり、静的アセットへのリクエストも含まれる   |
| KV / R2 / D1などのバインディング追加                                            | 各サービスの無料枠と課金体系が別途適用される                                 |
| Workers Paidへのアップグレード                                                  | 月額5ドルが発生する                                                          |

動的な処理が必要になった場合は、Workerスクリプトを足す前にこの表を確認する。

### 無料プランの上限と現状

| 項目                     | 無料プラン上限 | 有料プラン | 現状       |
| ------------------------ | -------------- | ---------- | ---------- |
| 静的アセットのファイル数 | 20,000         | 100,000    | 7,835      |
| 個別ファイルサイズ       | 25MiB          | 25MiB      | 最大2.94MB |

ファイル数の上限は無料プランのみ据え置きで、2025年9月に有料プランだけが100,000へ引き上げられた。記事が増えてファイル数が20,000に近づいた場合は、有料化ではなくビルド出力の削減で対応する。上限を超えた場合はデプロイが失敗するだけで、課金は発生しない。

### 使わない機能

- **Workers Builds**：Cloudflare側のCI機能。本構成ではGitHub Actionsでビルドとデプロイを行うため使わない
- **Observability**：Workerのログ収集機能。Workerスクリプトがないため出力するログもない

## 完了済みの作業（コード側）

- `next.config.ts`：`output: 'export'`と`images: { unoptimized: true }`を設定済み
- `wrangler.jsonc`：アセット配信の設定を追加
  - `html_handling: "force-trailing-slash"`（`trailingSlash: true`に合わせ、末尾スラッシュ付きを正規URLとする）
  - `not_found_handling: "404-page"`（Next.jsが生成する`404.html`を404ステータスで返す）
- `package.json`：`wrangler`をdevDependencyに追加、`preview`/`deploy`スクリプトを追加
- `.gitignore`：`.wrangler`を追加

### ローカル検証の結果

`wrangler dev`でビルド成果物を配信し、以下を確認済み（最終確認：2026-08-22）。

| 検証項目                                            | 結果                           |
| --------------------------------------------------- | ------------------------------ |
| `/`、`/blog/`、`/blog/<slug>/`、`/note/`、`/daily/` | 200                            |
| `/sitemap.xml`、`/favicon.png`                      | 200                            |
| `/blog`（末尾スラッシュなし）                       | 307で`/blog/`へリダイレクト    |
| 存在しないパス                                      | 404ステータスで404ページを返す |
| ブラウザ表示・コンソールエラー                      | トップ・記事詳細ともエラーなし |

アセットの規模も無料枠に収まることを確認した。

| 項目               | 実測   | 上限   |
| ------------------ | ------ | ------ |
| ファイル数         | 7,119  | 20,000 |
| 最大ファイルサイズ | 2.94MB | 25MiB  |
| 合計サイズ         | 106MB  | -      |

## 残作業（Cloudflare側の手動設定）

コードからは実行できない、アカウント操作が必要な作業。

### 1. Cloudflareアカウントの準備

1. Cloudflareにログインし、Account IDを控える（ダッシュボード右側、またはWorkers & Pagesの概要画面）
2. My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** テンプレートを使用してトークンを発行する
   - 発行したトークンは一度しか表示されないので確実に控える

### 2. GitHubリポジトリへの登録

Settings → Secrets and variables → Actions で以下を登録する。

| 種別     | 名前                    | 値                                        |
| -------- | ----------------------- | ----------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | 手順1で発行したトークン                   |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | 手順1のAccount ID                         |
| Variable | `NEXT_PUBLIC_BASE_URL`  | 公開する最終的なURL（末尾スラッシュなし） |

`NEXT_PUBLIC_BASE_URL`はサイトマップとOGPの絶対URLに使われる。未設定の場合は`src/app/layout.tsx`と`src/app/sitemap.ts`のフォールバック値（現状はVercelのURL）が使われてしまうため、必ず設定する。

### 3. 初回デプロイ

ローカルから実行する場合：

```bash
npx wrangler login
npm run deploy
```

GitHub Actions経由の場合は、mainへpushするか、Actionsタブから`Deploy to Cloudflare Workers`を手動実行する。

デプロイ後、`https://mt-github-io.<アカウントのサブドメイン>.workers.dev` で公開される。

### 4. 独自ドメインの設定（任意）

独自ドメインを使う場合は、Workers & Pages → 対象Worker → Settings → Domains & Routes → Add → Custom domain から設定する。ドメインのDNSがCloudflareで管理されている必要がある。

設定後、`NEXT_PUBLIC_BASE_URL`をそのドメインに変更して再デプロイする。

### 5. Vercelの停止

新環境が安定して動作することを確認してから実施する。

1. Vercel側のプロジェクトでデプロイを停止、またはプロジェクトを削除
2. 独自ドメインを使っていた場合はVercel側のドメイン設定を解除してからCloudflareへ向ける
3. ローカルの`.vercel`ディレクトリを削除（`.gitignore`済みのためリポジトリには影響しない）

### 6. フォールバックURLの更新

`src/app/sitemap.ts`と`src/app/layout.tsx`のフォールバック値は、現状どちらもVercelのURL（`https://mt-github-io.vercel.app`）になっている。

```ts
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://mt-github-io.vercel.app'
```

GitHub Variablesの`NEXT_PUBLIC_BASE_URL`さえ設定されていれば実害はないが、Vercel停止後に変数が未設定のままビルドされると、存在しないURLがサイトマップとOGPに焼き込まれる。移行先のURLが確定した時点で、このフォールバック値も移行先URLへ更新しておく。

### 自動デプロイの設定（未適用）

GitHub Actionsによる自動デプロイの設定は、**まだリポジトリに入っていない**。

理由は、リポジトリへの書き込みに使っているGitHubのトークンに`workflow`権限がなく、`.github/workflows/`配下のファイルをpushできないため。`gh auth refresh`での権限追加を試みたが、ghの設定に登録されたアカウント名（`MaitaTomoya`）と、GitHubが返す実際のアカウント名（`maitatomoya`）の大文字小文字が食い違っており、照合エラーで完了しなかった。

適用方法は次の2つ。

1. GitHubのWeb UI（Actionsタブ → New workflow → set up a workflow yourself）から、下記の内容を`deploy-cloudflare.yml`として追加する。ブラウザ経由なのでトークンの権限は関係しない
2. ghの認証をやり直して`workflow`権限を付けたうえで、下記をローカルの`.github/workflows/deploy-cloudflare.yml`に置いてコミットする

いずれの場合も、先に「2. GitHubリポジトリへの登録」のSecretsとVariablesを設定しておくこと。

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]
  # 手動実行も可能にする（ロールバックや再デプロイ用）
  workflow_dispatch:

# 同時デプロイを防ぐ。進行中のものはキャンセルせず完了を待つ
concurrency:
  group: deploy-cloudflare
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          # サイトマップとOGPの絶対URLに使用する
          NEXT_PUBLIC_BASE_URL: ${{ vars.NEXT_PUBLIC_BASE_URL }}

      - name: Deploy
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## 補足

- `compatibility_date`は`2026-05-03`を指定している。ローカルの`wrangler dev`が同梱するランタイムがそれより新しい日付を受け付けないため。アセット配信のみの構成では動作に影響しない
- Node.jsはNext.js 16の要件により20.9.0以上が必要。ローカルで古いバージョンが有効になっている場合はビルドが失敗する（`.nvmrc`は`20`を指定しているため`nvm use`で解決する）
