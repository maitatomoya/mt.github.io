---
id: 97
title: "GitHubリポジトリの名前は後から変えられる — リネームの手順・自動リダイレクトの仕組み・落とし穴を実例で解説"
tags: [GitHub, Git, ghコマンド, リポジトリ管理, 開発環境]
create: "2026-08-15 09:26"
---

## はじめに

開発を進めていると、「リポジトリの名前、やっぱり変えたい」という場面が意外とよく訪れる。

- 作り始めた後にサービス名が正式決定した
- リポジトリの命名規則を統一したくなった（`myname-アプリ名`のようなプレフィックス方式に揃えるなど）
- 単純にタイポしていた

私も先日、開発初期のリポジトリ名でGitHubにpushした後にサービス名が決まり、リポジトリ名を変更した。このとき「リネームって安全にできるのか？」「既にpush済みだけど大丈夫か？」を調べて実行したので、手順と注意点を記事にまとめる。

結論から言うと、**GitHubのリポジトリ名はいつでも変更でき、旧URLへのアクセスは自動でリダイレクトされる**。ただしいくつか知っておくべき落とし穴がある。読み終わる頃には、公式ドキュメントの該当ページがスムーズに読めるようになるはずだ。

---

## 前提知識：リモートとorigin

本題の前に、この記事で登場する用語を整理しておく。すでに知っている人はスキップしてよい。

| 用語 | 意味 |
|---|---|
| リモート（remote） | 手元のリポジトリから見た、ネットワーク上のリポジトリの登録情報。実体はURLに名前を付けたもの |
| origin | リモートに付ける名前のデファクトスタンダード。`git clone`すると自動で`origin`という名前でクローン元URLが登録される |
| gh CLI | GitHub公式のコマンドラインツール。ターミナルからリポジトリ作成・PR操作・API呼び出しなどができる |

ここで重要なのは、**ローカルのリポジトリはリモートを「URL文字列」で覚えている**という点だ。GitHub側でリポジトリ名を変えると、このURLと実体がズレる。リネーム作業とは「GitHub側の名前変更」と「ローカル側のURL更新」の2つをセットで行うことだと理解しておくと迷わない。

---

## GitHub側のリネーム方法

### 方法1：Web UIから変更する

一番簡単な方法。

1. 対象リポジトリのページを開く
2. 「Settings」タブをクリック
3. 一番上の「Repository name」欄に新しい名前を入力
4. 「Rename」ボタンをクリック

これだけで完了する。管理者権限（自分のリポジトリなら当然ある）が必要だ。

### 方法2：gh CLIから変更する

ターミナルで完結させたい場合はgh CLIを使う。未インストールの場合は[公式サイト](https://cli.github.com/)からインストールできる（macOSなら`brew install gh`、初回は`gh auth login`で認証する）。リポジトリのディレクトリ内で実行すると、**ローカルのリモートURLも自動で更新してくれる**ので実は一番楽だ。

```bash
cd ~/path/to/your-repo
gh repo rename new-repo-name
```

リポジトリの外から実行する場合は`-R`で対象を指定する（この場合ローカルのURL更新は自分で行う必要がある）。

```bash
gh repo rename new-repo-name -R your-account/old-repo-name
```

### 方法3：GitHub APIを直接叩く

スクリプトに組み込みたい場合や、ghの対話プロンプトを避けたい場合はAPIを直接呼べる。リポジトリの更新は`PATCH`メソッドで行う。

```bash
gh api -X PATCH repos/your-account/old-repo-name -f name=new-repo-name --jq '.full_name'
```

成功すると新しいフルネーム（`your-account/new-repo-name`）が返ってくる。私は今回この方法を使った。確認プロンプトなしで確実に実行でき、結果もJSONで検証できるためだ。

---

## ローカル側の追随作業

GitHub側の名前を変えたら、ローカルも合わせる。

### 1. ディレクトリ名の変更（任意）

ディレクトリ名はGitと無関係なので変えなくても動くが、揃えたほうが混乱しない。

```bash
mv ~/Develop/old-repo-name ~/Develop/new-repo-name
```

### 2. リモートURLの更新

```bash
cd ~/Develop/new-repo-name

# HTTPS形式の場合
git remote set-url origin https://github.com/your-account/new-repo-name.git

# SSH形式の場合
git remote set-url origin git@github.com:your-account/new-repo-name.git
```

自分がどちらの形式を使っているかは`git remote -v`で確認できる。

### 3. 動作確認

```bash
git remote -v
git fetch origin
```

`git remote -v`で新URLが表示され、`git fetch`がエラーなく通れば完了だ。

---

## 自動リダイレクトの仕組み

「旧URLでアクセスしている人がいたら壊れるのでは？」という心配に対して、GitHubは**旧名から新名への自動リダイレクト**を用意している。

- ブラウザで旧URLを開くと新URLに転送される
- `git push`や`git pull`などのGit操作も旧URLのまま動き続ける
- つまり、リモートURLを更新し忘れた古いクローンも当面は壊れない

この仕組みのおかげで、リネームは見た目より安全な操作になっている。

### ただしリダイレクトには寿命がある

ここが最大の落とし穴で、**誰かが（自分自身を含めて）旧名と同じ名前のリポジトリを新規作成した瞬間、リダイレクトは無効になる**。公式ドキュメントにも明記されている仕様だ。

「昔のリポジトリ名を再利用して新しいプロジェクトを作る」といった操作をすると、旧URLを参照していた古いクローンやリンクは、意図せず新しい別リポジトリを指すようになる。旧名の再利用は避けるのが無難だ。

---

## リネーム時に確認すべきチェックリスト

自動リダイレクトがあるとはいえ、以下は自動では直らない。リネーム後に見直そう。

| 確認対象 | 何が起きるか |
|---|---|
| README内のバッジ・リンク | 旧URLのまま。リダイレクトで動くが、いずれ更新すべき |
| CI/CD（GitHub Actions以外の外部サービス） | 連携設定がリポジトリ名で紐づいている場合は再設定が必要なことがある |
| GitHub Actionsの他リポジトリ参照 | ワークフロー内で`uses: your-account/old-repo-name/.github/workflows/ci.yml@main`のように名前で参照している箇所は手動更新が必要 |
| デプロイ連携（Cloudflare Pages、Vercelなど） | 多くはリポジトリIDで追随するが、リネーム後に一度デプロイが通るか確認する |
| GitHub PagesのURL | `your-account.github.io/リポジトリ名`形式の場合、公開URL自体が変わる |
| ドキュメントやブログからのリンク | 外部に貼ったリンクは手動更新が必要 |
| クローン済みの他マシン | リダイレクトで動くが、`git remote set-url`で更新しておくのが安全 |

逆に言うと、**外部にリンクを貼る前・公開前のリネームはほぼノーコスト**だ。名前に迷いがあるなら、公開前が最後の楽なタイミングだと覚えておきたい。

---

## ハンズオン：一連の流れをまとめて実行する

実際に私が行った手順を、仮の名前でまとめる。`old-repo-name`を`new-repo-name`に変える例だ。

```bash
# 1. GitHub側をリネーム（API方式）
gh api -X PATCH repos/your-account/old-repo-name -f name=new-repo-name --jq '.full_name'

# 2. ローカルディレクトリをリネーム
mv ~/Develop/old-repo-name ~/Develop/new-repo-name

# 3. リモートURLを更新
cd ~/Develop/new-repo-name
git remote set-url origin https://github.com/your-account/new-repo-name.git

# 4. 確認
git remote -v
git fetch origin

# 5. リポジトリの状態を確認（URL・公開設定・デフォルトブランチ）
gh repo view your-account/new-repo-name --json url,visibility,defaultBranchRef
```

所要時間は1分もかからない。ついでにREADMEやドキュメント内に旧名の記載が残っていないかも確認しておくとよい。

```bash
grep -rn "old-repo-name" README.md docs/
```

---

## 実務でよくあるケース

### ケース1：サービス名が後から決まった

開発初期は仮名で始めて、リリース前に正式名称へリネームするパターン。私の場合もこれで、「リポジトリ名は管理用の名前、サービス名は別」と割り切る選択肢もある。実際、リポジトリ名とデプロイ先のプロジェクト名（公開URL）は別々に設定できるサービスが多い。

### ケース2：命名規則の統一

個人開発でアプリを量産していく場合、`myname-app1`、`myname-app2`のようにプレフィックスを揃えると、リポジトリ一覧が「自分のプロダクトの棚」として機能する。後から規則を導入するときにリネームが発生する。

### ケース3：organizationへの移管と合わせて

リポジトリの「Transfer ownership」（所有者の移管）と同時に名前を整理するケース。移管でも同様のリダイレクトが張られる。

---

## まとめ

- GitHubのリポジトリ名は**いつでも変更できる**。Web UI、`gh repo rename`、APIの3つの方法がある
- 旧URLへのWebアクセスとGit操作は**自動リダイレクト**されるので、既存のクローンはすぐには壊れない
- ただし**旧名で新しいリポジトリを作るとリダイレクトは無効化される**。旧名の再利用は避ける
- ローカルは`git remote set-url`でURLを更新し、`git fetch`で確認する
- 外部リンク・CI・デプロイ連携は自動では直らないのでチェックリストで見直す
- 公開前・リンクを貼る前のリネームはほぼノーコスト。名前の迷いは公開前に解消しておくのが一番楽

## 参考リンク

- [リポジトリの名前を変更する - GitHub Docs](https://docs.github.com/ja/repositories/creating-and-managing-repositories/renaming-a-repository)
- [gh repo rename - GitHub CLI Manual](https://cli.github.com/manual/gh_repo_rename)
- [git-remote - Git公式ドキュメント](https://git-scm.com/docs/git-remote)
- [リポジトリを移譲する - GitHub Docs](https://docs.github.com/ja/repositories/creating-and-managing-repositories/transferring-a-repository)
