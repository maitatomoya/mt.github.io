# Cloudflareへの移行手順

Vercelで運用しているこのブログを、Cloudflare Pagesへ移行するための手順書。

## 移行の動機

- **Vercel Hobbyプランの商用利用制限を回避するため**。このブログを個人ブランディングの親サイトとして運用する構想があり、Hobbyプランのままでは規約上の制約に触れる可能性がある
- **Cloudflareの無料枠には商用利用の制限がない**。静的サイトの配信は無料で、帯域による課金も発生しない

## 方式の選定

**Cloudflare Pagesを使う**（Workersではない）。

一度はWorkers（Static Assets）で構築したが、公開URLの形が理由でPagesに切り替えた。

| 観点             | Pages                              | Workers（Static Assets）                            |
| ---------------- | ---------------------------------- | --------------------------------------------------- |
| 公開URL          | `<プロジェクト名>.pages.dev`       | `<Worker名>.<アカウントのサブドメイン>.workers.dev` |
| 名前の取り方     | プロジェクト単位でグローバルに一意 | アカウントの名前空間の下にWorkerが並ぶ              |
| このサイトの場合 | `mt-dev-io.pages.dev`              | `mt-github-io.mt114r-an.workers.dev`                |

Cloudflareは新規プロジェクトについてPagesではなくWorkers Static Assetsを推奨しており、Pagesは「サポートは継続するが新機能の投資先ではない」という位置づけにある。ただしこのサイトは`output: 'export'`による完全な静的サイトで、APIルートもサーバー機能も使っていない。Pagesの機能で過不足なく、URLが1段短くなる利点の方が大きいと判断した。

同一アカウントで別プロジェクト（`pixsmith`）を既にPagesで運用しており、管理画面が揃うことも理由のひとつ。

## 運用方針：無料枠のみを使う

Cloudflareの無料枠の範囲内だけで運用する。有料プランへのアップグレードは行わない。

### 無料プランの上限と現状

| 項目                       | 無料プラン上限 | 有料プラン | 現状        |
| -------------------------- | -------------- | ---------- | ----------- |
| サイトのファイル数         | 20,000         | 100,000    | 7,119       |
| 個別ファイルサイズ         | 25MiB          | 25MiB      | 最大2.94MB  |
| カスタムドメイン数         | 100            | 250        | 0           |
| Cloudflare側でのビルド回数 | 500回/月       | 5,000回/月 | 0回（後述） |

帯域とリクエスト数に制限はない。静的アセットの配信で課金されることはない。

ファイル数の上限は無料プランのみ据え置きで、2026年1月に有料プランだけが100,000へ引き上げられた。記事が増えて20,000に近づいた場合は、有料化ではなくビルド出力の削減で対応する。上限を超えた場合はデプロイが失敗するだけで、課金は発生しない。

### ビルド回数の制限を受けない理由

「Cloudflare側でのビルド回数（500回/月）」は、GitリポジトリをCloudflareに繋いでCloudflare上でビルドさせる方式（Git統合）にのみ適用される。

本構成はGitHub Actionsでビルドし、成果物だけを`wrangler pages deploy`でアップロードする**Direct Upload方式**を採るため、この制限の対象外となる。デプロイ回数を気にする必要はない。

### 課金につながるため避ける変更

| 変更                                                                            | 何が起きるか                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Pages Functions](https://developers.cloudflare.com/pages/functions/)を追加する | Workersとして課金対象になる（無料プランは1日100,000リクエストで停止） |
| KV / R2 / D1などのバインディング追加                                            | 各サービスの無料枠と課金体系が別途適用される                          |
| 有料プランへのアップグレード                                                    | 月額5ドルが発生する                                                   |

動的な処理が必要になった場合は、Functionsを足す前にこの表を確認する。

## 完了済みの作業

- `next.config.ts`：`output: 'export'`と`images: { unoptimized: true }`を設定
- `wrangler.jsonc`：`pages_build_output_dir`にビルド出力先（`./out`）を指定
- `package.json`：`wrangler`をdevDependencyに追加、`preview`/`deploy`スクリプトを追加
- `src/app/sitemap.ts`、`src/app/layout.tsx`：フォールバックURLを移行先へ更新
- `.gitignore`：`.wrangler`を追加

### デプロイ（完了：2026-08-22）

ローカルから以下を実行して公開済み。

```bash
npx wrangler login
npx wrangler pages project create mt-dev-io --production-branch=main
NEXT_PUBLIC_BASE_URL=https://mt-dev-io.pages.dev npm run deploy
```

公開URL：https://mt-dev-io.pages.dev

デプロイ後の確認結果：

| 検証項目                                            | 結果                           |
| --------------------------------------------------- | ------------------------------ |
| `/`、`/blog/`、`/blog/<slug>/`、`/note/`、`/daily/` | 200                            |
| `/sitemap.xml`、`/favicon.png`                      | 200                            |
| `/blog`（末尾スラッシュなし）                       | 308で`/blog/`へリダイレクト    |
| 存在しないパス                                      | 404                            |
| サイトマップ・OGPの絶対URL                          | pages.devのURLに置き換わり済み |
| ブラウザ表示・コンソールエラー                      | エラーなし                     |

Next.jsの`trailingSlash: true`に対して、Pagesは末尾スラッシュ付きのURLへ308リダイレクトを返す。追加の設定は不要だった。存在しないパスについても、`out/404.html`を自動的に404ページとして扱う。

## 残作業

### 1. GitHub Actionsによる自動デプロイ

設定内容と適用手順は後述の「自動デプロイの設定（未適用）」を参照。

### 2. 独自ドメインの設定（任意）

独自ドメインを使う場合は、Workers & Pages → 対象プロジェクト → Custom domains から設定する。Cloudflare Registrarでドメインを購入すればそのまま接続できる。

設定後、`NEXT_PUBLIC_BASE_URL`と、`src/app/sitemap.ts`・`src/app/layout.tsx`のフォールバック値をそのドメインへ変更して再デプロイする。

なお、Cloudflareは`pages.dev`および`workers.dev`のサブドメインについて「無料ウェブサイト扱いで、ビジネス上重要でない個人・ホビー用途を想定」と位置づけている。商用利用を前提とするなら独自ドメインへの移行を検討する。

### 3. Vercelの停止

新環境が安定して動作することを確認してから実施する。

1. Vercel側のプロジェクトでデプロイを停止、またはプロジェクトを削除
2. 独自ドメインを使っていた場合はVercel側のドメイン設定を解除してからCloudflareへ向ける
3. ローカルの`.vercel`ディレクトリを削除（`.gitignore`済みのためリポジトリには影響しない）

## 自動デプロイの設定

`.github/workflows/deploy-cloudflare.yml`により、mainへのpushでビルドとデプロイが自動実行される。手動実行（workflow_dispatch）も可能。

動作させるには、GitHubリポジトリのSettings → Secrets and variables → Actionsで以下を設定する。

| 種別     | 名前                    | 値                                                                                    |
| -------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | My Profile → API Tokens → Create Token →「Edit Cloudflare Workers」テンプレートで発行 |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | ダッシュボードで確認できるAccount ID                                                  |
| Variable | `NEXT_PUBLIC_BASE_URL`  | `https://mt-dev-io.pages.dev`（末尾スラッシュなし）                                   |

設定内容：

```yaml
name: Deploy to Cloudflare Pages

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
          command: pages deploy out --project-name=mt-dev-io --branch=main
```

### 適用時に詰まった点（2026-08-22）

このワークフローファイルは、GitHubトークンに`workflow`権限がないためしばらくpushできなかった。原因は次の2点が重なっていたこと。同じ問題は他のリポジトリでも起きるため記録しておく。

**1. `.zshrc`の`GITHUB_TOKEN`が優先されていた**

`gh`コマンドは環境変数`GITHUB_TOKEN`を最優先し、keyringに保存された認証情報を無視する。そのため`gh auth refresh`で権限を追加しても反映されなかった。

```
The value of the GITHUB_TOKEN environment variable is being used for authentication.
To have GitHub CLI store credentials instead, first clear the value from the environment.
```

**2. アカウント名の大文字小文字が食い違っていた**

`gh`の設定（`~/.config/gh/hosts.yml`）には`MaitaTomoya`と登録されていたが、GitHubが返す実際のログイン名は`maitatomoya`。`gh auth refresh`は両者を厳密に照合するため、別アカウントとみなして失敗した。

```
error refreshing credentials for MaitaTomoya, received credentials for maitatomoya,
did you use the correct account in the browser?
```

**解決手順**

```bash
# 1. .zshrcのGITHUB_TOKENをコメントアウト（MCPのgithubサーバーは
#    GITHUB_PERSONAL_ACCESS_TOKENを別途使うため影響しない）

# 2. 名前を照合しないgh auth loginでやり直す。refreshでは解決しない
env -u GITHUB_TOKEN gh auth login -h github.com -p https -s workflow -w
```

`✓ Logged in as maitatomoya`と小文字で表示されれば成功。`gh auth status`で`workflow`スコープが付いていることを確認する。

## 補足

- `compatibility_date`は`2026-05-03`を指定している。ローカルのwranglerが同梱するランタイムがそれより新しい日付を受け付けないため。静的配信のみの構成では動作に影響しない
- Node.jsはNext.js 16の要件により20.9.0以上が必要。ローカルで古いバージョンが有効になっている場合はビルドが失敗する（`.nvmrc`は`20`を指定しているため`nvm use`で解決する）
- `npx wrangler`をリポジトリ外で実行すると、devDependencyのwrangler（動作確認済みのバージョン）ではなく最新版が取得され、Node.js 22以上を要求されて失敗する。必ずリポジトリ内で実行する
