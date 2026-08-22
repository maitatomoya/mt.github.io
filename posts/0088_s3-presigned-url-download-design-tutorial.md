---
id: 88
title: "S3署名付きURLでファイルDL機能を作る — 架空サービス『PhotoFox』で学ぶ AWS とセキュリティ用語"
tags: [AWS, S3, セキュリティ, presigned URL, IAM, CloudFront, CSRF, IDOR, 設計]
create: "2026-06-16 12:00"
---

## はじめに

「ユーザーが自分のファイルをダウンロードできるようにする」という、一見シンプルに見える機能。実はその裏には **S3 / IAM / 署名付きURL / CSRF / IDOR / Content-Disposition / CloudFront** といった、サーバーサイドとセキュリティの基礎用語がぎっしり詰まっている。

この記事では、架空の写真納品 SaaS 「**PhotoFox**」を題材に、新人エンジニアの**あなた**がダウンロード機能を 1 から設計していくストーリー形式で、これらの用語と意思決定を順に学んでいく。実在のサービス設計から構造だけを抜き出して再構成しているので、現場でそのまま応用できる。

> **想定読者**: AWS や Web セキュリティの基礎を、用語だけでなく「なぜそれが必要なのか」から理解したい新人〜中堅エンジニア。

---

## 舞台設定: PhotoFox とは

PhotoFox は、結婚式やイベント撮影を請け負うフォトグラファー向けの **写真納品 SaaS**。

- フォトグラファーがクライアントごとのフォルダに撮影写真をアップロード
- フォトグラファーは管理画面の「写真一覧」から
  - 1 枚ずつダウンロード（個別 DL リンク）
  - 複数選択して一括ダウンロード（チェックボックス + 一括 DL ボタン）

すでにフロントエンドの UI は別チームが実装済み。あなたに任されたのは「バックエンドのダウンロード API を設計・実装すること」だ。

---

## 第 1 幕: ナイーブな実装と、その落とし穴

最初に思いつくのはこんな実装だ。

```
[ブラウザ] → GET /api/photos/123/download → [APIサーバー]
                                                    ↓
                                            S3 から写真を取得
                                            ↓
[ブラウザ] ← 写真のバイナリをそのまま返す
```

API サーバーが S3 からファイルを取り出して、レスポンスとしてバイナリをそのまま返す方式。一見シンプルだが、本番運用を考えると 3 つの問題がある。

1. **サーバー帯域が消費される**: 写真 1 枚 5 MB、100 枚一括 DL すると 500 MB がサーバーを経由する。同時に 100 人が一括 DL したら…
2. **サーバープロセスが長時間ふさがる**: 大きなファイルの転送中、ワーカーが他のリクエストを処理できない
3. **スケールしない**: トラフィックが増えるたびにアプリサーバーを増やす羽目になる

ファイル本体は S3 にあるのだから、**ブラウザを S3 に直接アクセスさせれば** サーバーは認可判定だけで済む。これを可能にするのが **署名付き URL（presigned URL）** だ。

---

## 第 2 幕: 署名付き URL（presigned URL）の登場

### 用語: S3（Amazon S3）

そもそも **S3（Simple Storage Service）** は AWS のオブジェクトストレージ。「フォルダ」と「ファイル」のような構造（実際は **キー** という文字列）で、画像・動画・ログなど任意のバイナリデータを格納できる。安価・高耐久・容量無制限が特徴で、Web サービスのファイル保管庫としては事実上の標準だ。

PhotoFox では、写真は次のような S3 キーで保存されている。

```
photos/{tenant_id}/{photo_id}.jpg
```

### 用語: presigned URL（署名付き URL）

S3 のオブジェクトは、デフォルトでは外部からアクセスできない。ところが S3 には「**特定のオブジェクトに、一時的に、誰でもアクセスできる URL を発行する**」機能がある。これが **presigned URL** だ。

```
https://photofox-bucket.s3.ap-northeast-1.amazonaws.com/photos/42/9001.jpg
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=...
  &X-Amz-Date=20260616T030000Z
  &X-Amz-Expires=300
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=abc123...
```

ポイントは次の 3 つ。

- **署名（Signature）が URL に埋め込まれている**: サーバーが「あなたはこのオブジェクトにアクセスして OK」と証明書を発行したようなもの
- **有効期限がある**: 上記の `X-Amz-Expires=300` は「発行から 300 秒（= 5 分）有効」を意味する
- **URL を 1 文字でも書き換えると署名が無効になる**: パスを別のオブジェクトに書き換えたり、Expires を伸ばしたりはできない

### 新しい設計

```
[ブラウザ] → POST /api/photos/download → [APIサーバー]
                                              ↓
                                      1. 認証・認可チェック
                                      2. S3 presigned URL を生成
                                              ↓
[ブラウザ] ← JSON { downloads: [{ id, url, filename }] }
    ↓
ブラウザが URL に直接アクセスして DL
```

これでサーバーは「**認可判定して URL を返すだけ**」になり、ファイル本体は **S3 → ブラウザ** という最短経路で流れる。サーバーの帯域もワーカー時間もほぼ消費しない。

---

## 第 3 幕: ブラウザに「再生」ではなく「ダウンロード」させる

ここで実装してテストしてみると、写真の URL をクリックするとブラウザが「画像を表示」してしまう。ユーザーが欲しいのはダウンロードなのに。

### 用語: Content-Disposition

**Content-Disposition** はレスポンスヘッダーの一種で、ブラウザに「このコンテンツをどう扱うか」を伝える。

```
Content-Disposition: attachment; filename="wedding_001.jpg"
```

`attachment` を指定すると、ブラウザは「ページ内表示」ではなく「ダウンロードとして保存」を選ぶ。

### S3 から Content-Disposition を返させる

presigned URL を生成するとき、`ResponseContentDisposition` というパラメータを付ければ、S3 がレスポンス時に上記ヘッダーを返してくれる。

```php
// AWS SDK v3 (PHP) の例
$cmd = $s3->getCommand('GetObject', [
    'Bucket' => $bucket,
    'Key'    => "photos/{$tenantId}/{$photoId}.jpg",
    'ResponseContentDisposition' => 'attachment; filename="wedding_001.jpg"',
]);
$request = $s3->createPresignedRequest($cmd, '+5 minutes');
$url = (string) $request->getUri();
```

### 用語: `<a download>`

フロントエンド側はこんな HTML だ。

```html
<a href="{presigned_url}" download="wedding_001.jpg">ダウンロード</a>
```

`download` 属性付きの `<a>` タグは、「クリックしてもページ遷移せず、リンク先のリソースをダウンロードする」挙動をブラウザに指示する。**Content-Disposition: attachment** と **`<a download>`** の二重で、確実にダウンロード扱いになる。

> 一括 DL の場合は、フロントで `<a download>` を複数生成して 100〜200ms 間隔で `.click()` を発火する。ブラウザのダウンロードキューに順次入り、ZIP にまとめなくても複数ファイルをスムーズに DL できる。

---

## 第 4 幕: セキュリティ — ブロックすべき 5 つのシナリオ

ここからが本番だ。「写真を DL する」という機能の裏に、攻撃シナリオはいくつも潜んでいる。

### シナリオ 1: 未ログインユーザーのアクセス

#### 用語: セッション認証

ログイン時にサーバーがランダムな **セッション ID** を発行し、ブラウザの **Cookie** に保存する。以降のリクエストでこの Cookie が送られてくることで、サーバーは「誰がアクセスしているのか」を識別する。これがセッション認証。

DL API は、セッションから取れる `tenant_id`（フォトグラファーの ID）が**必須**。なければ即 **401 Unauthorized** を返す。

```
未ログイン → 401 Unauthorized
セッション切れ → 401 Unauthorized
```

### シナリオ 2: 他人の写真を DL（IDOR）

#### 用語: IDOR（Insecure Direct Object Reference）

直訳すると「**安全でない、直接的なオブジェクト参照**」。要するに「**ID を推測・改ざんして他人のリソースにアクセスする攻撃**」のこと。

PhotoFox の例:

- 自分の photo_id=100 を知っている攻撃者が、photo_id=101 を指定してリクエスト
- もしサーバーが「指定された photo_id を S3 から取ってくる」だけの実装なら、**他人の写真が DL できてしまう**

これは「URL が推測できる時点で攻撃可能になる」典型例で、特に**連番 ID** を使うサービスでは必ず対策が必要。

**対策**: API 側で必ず DB を叩き、「**リクエスト者の tenant_id とリソースの所有者 tenant_id が一致するか**」を検証する。

```sql
SELECT photo_id
FROM photos
WHERE tenant_id = :session_tenant_id
  AND photo_id IN (:requested_ids)
```

リクエストされた件数と、DB が返した件数が一致しない場合は「他人の ID が混ざっている」ということ。全体を **403 Forbidden** で拒否する。

> 💡 **エラーメッセージのコツ**: 「photo_id=101 は存在しません」と返すと、「100 と 102 は存在する」という情報が攻撃者に漏れる。「**invalid or not accessible**」のように、存在の有無を区別しない曖昧な文言にする。

### シナリオ 3: 罠サイトからの不正リクエスト（CSRF）

#### 用語: CSRF（Cross-Site Request Forgery）

「**クロスサイトリクエストフォージェリ**」。攻撃者が悪意のあるサイトを用意し、ログイン済みユーザーがそこを踏むと、**ユーザーの Cookie 付きで PhotoFox に勝手にリクエストが送られる**攻撃。

```html
<!-- 罠サイトに仕込まれた HTML -->
<form action="https://photofox.example.com/api/photos/download" method="POST">
  <input name="photo_ids[]" value="1">
  <input name="photo_ids[]" value="2">
  <!-- ... -->
</form>
<script>document.forms[0].submit()</script>
```

Cookie は同一ドメイン宛のリクエストに自動で付くので、PhotoFox から見ると「正規ユーザーがログインした状態でリクエストしてきた」ように見えてしまう。

#### 用語: CSRF トークン

**対策**は **CSRF トークン**。これは「ページ表示時にサーバーがランダム生成して埋め込む文字列」で、リクエスト時に一緒に送ってもらう。

```html
<form method="POST">
  <input type="hidden" name="tk" value="a3f8c91d...">  <!-- CSRFトークン -->
  ...
</form>
```

```
POST /api/photos/download
Body: photo_ids[]=1&photo_ids[]=2&tk=a3f8c91d...
```

罠サイトはこのトークンを知らない（自分のドメインからは PhotoFox の HTML を読めない＝**Same-Origin Policy**）ので、リクエストを偽装できない。サーバー側でトークンを検証し、一致しなければ拒否する。

> 多くのフレームワーク（Laravel, Django, Rails…）には CSRF トークン機構が組み込まれている。自前で実装しなくていいことが多い。

### シナリオ 4: 大量リクエストによる DoS

100 件単位ならいいが、もし 1 リクエストで 100,000 件の photo_id が指定されたら？ DB クエリも S3 への署名処理もすべてサーバー負荷になる。

**対策**: 1 リクエストあたりの上限（PhotoFox では 100 件）を設定し、超過は **400 Bad Request** で拒否する。

### シナリオ 5: 不正な入力値

`photo_id` に文字列、負数、`0`、極端に大きな整数が来たら？

**対策**: バリデーション層で、**正の整数**であり、**1 〜 100 件**であることを必ずチェック。サーバー側で `intval()` 相当の関数を通すだけで多くの攻撃が防げる。

---

## 第 5 幕: 署名付き URL そのもののリスク

セキュリティ対策が終わったように見えるが、実はもう一段ある。「**署名付き URL が漏洩したらどうする？**」という観点だ。

### 対策その 1: 短い TTL

#### 用語: TTL（Time To Live）

「**生存時間**」「**有効期限**」のこと。presigned URL の TTL を 5 分（300 秒）に設定すると、発行から 5 分過ぎた URL でアクセスしても S3 が 403 を返す。

Slack で誰かが URL を共有してしまっても、5 分後には無効になる。「**漏洩しても被害が限定される**」のが TTL の役割。

> ただし「DL **開始**時に署名が検証される」だけなので、DL 中に期限が切れても問題ない。逆に「URL を取得してから DL を始めるまで」が 5 分を超えると失敗する。リトライ可能な設計にしておくと安心。

### 対策その 2: URL をブラウザ履歴・ログに残さない

GET リクエストで `?photo_ids=...&tk=...` のように URL に重要情報を含めると、

- ブラウザの URL バーや履歴に残る
- アクセスログに記録される
- Referer ヘッダーで別サイトに漏れる

これらを避けるため、**DL API は POST にして、署名付き URL は JSON レスポンスのボディで返す**。URL バーには出てこない。

### 対策その 3: ブラウザにキャッシュさせない

#### 用語: Cache-Control: no-store

`Cache-Control: no-store` は、レスポンスヘッダーの一種で、「**このレスポンスをキャッシュ（一時保存）してはいけない**」とブラウザやプロキシに指示する。

API レスポンスに含まれる署名付き URL がブラウザのキャッシュやプロキシサーバーに残ると、後から第三者がアクセスして取得できる可能性がある。`no-store` を付けることで、この経路を断つ。

```
HTTP/1.1 200 OK
Cache-Control: no-store
X-Content-Type-Options: nosniff
Content-Type: application/json

{ "downloads": [...] }
```

> ついでに `X-Content-Type-Options: nosniff` も付けておくと、ブラウザが Content-Type を勝手に推測して JSON を HTML として解釈する系の攻撃を防げる。

---

## 第 6 幕: AWS 権限 — IAM ロールとバケットポリシー

ここまでアプリ層の話だったが、AWS 側の権限設計も忘れてはいけない。

### 用語: IAM ロール

**IAM（Identity and Access Management）ロール** は、AWS リソースへのアクセス権限の集合に、名前を付けたもの。

PhotoFox のサーバーには `photofox-api-role` というロールがアタッチされていて、そのロールに「**S3 の photos/ 配下を読み取って OK**」という権限が付与されている。サーバーが S3 にアクセスするとき、このロールの権限で判定される。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::photofox-bucket/photos/*"
  }]
}
```

### 用語: バケットポリシー

**バケットポリシー** は、S3 バケット側で「**誰がどの操作をしていいか**」を定義するルール。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowPhotoFoxApiDownload",
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::123456789012:role/photofox-api-role"
    },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::photofox-bucket/photos/*"
  }]
}
```

### IAM ロール × バケットポリシーの関係

AWS では、**両方で許可されて初めてアクセスできる**（AND 条件）のが基本。片方だけ通っていても、もう片方が許可していなければ拒否される。

```
   IAMロール側で Allow ✅
+) バケットポリシー側で Allow ✅
─────────────────────────────
   アクセスできる ✅

   IAMロール側で Allow ✅
+) バケットポリシー側で （何も書いてない or Deny） ❌
─────────────────────────────
   アクセスできない ❌
```

> 「DL 機能を作るためのリリース手順」では、**バケットポリシーの PR と IAM ロール権限の確認の両方** が必要になる。片方だけ忘れると、本番で「dev では動いたのに prod で 403 になる」みたいなトラブルになる。

### presigned URL と権限の関係

ここが少し直感に反するが大事。

**presigned URL の権限は、URL を発行した IAM 主体（ここでは PhotoFox API のロール）の権限で評価される**。

つまり「ブラウザは認証なしで URL にアクセス」しているように見えても、内部的には「**PhotoFox API ロールの権限で S3 にアクセスしている**」のと同じ扱い。だから「API サーバーのロールに `s3:GetObject` 権限がないと、URL を発行しても DL 失敗」となる。

---

## 第 7 幕: CloudFront との使い分け

PhotoFox には「公開写真ギャラリー」もあり、こちらは別の経路でファイル配信している。

### 用語: CloudFront

**CloudFront** は AWS の **CDN（Content Delivery Network）**。ユーザーに地理的に近いエッジサーバーからキャッシュ済みファイルを配信して、高速化と S3 オリジンの保護を実現する。

```
[ユーザー] → CloudFront エッジ (Tokyo / NY / London...) → (キャッシュなければ) S3
```

### DL 機能では CloudFront を使わない理由

- CloudFront は「**広く公開され、頻繁に読まれる**」コンテンツの配信に最適化されている（キャッシュが効く）
- presigned URL は「**特定の認可済みユーザー向け、短時間有効**」のもの → キャッシュさせたら困る
- CloudFront 経由で署名付きアクセスを実現するには別の仕組み（**CloudFront Signed URL**）が必要で、S3 presigned URL とは別物

PhotoFox では、**閲覧 = CloudFront 経由**、**ダウンロード = S3 presigned URL** と使い分けるのが王道。

---

## 完成版アーキテクチャ

ここまでの学びをまとめると、DL 機能はこんな形になる。

```
[ブラウザ]
   ↓ POST /api/photos/download
   ↓ Body: photo_ids[]=1&photo_ids[]=2&tk=...
[PhotoFox API]
   ├ 1. セッション認証 (tenant_id 取得 / なければ 401)
   ├ 2. CSRF トークン検証 (tk / 不一致なら拒否)
   ├ 3. 入力バリデーション (整数, 1〜100件 / 不正なら 400)
   ├ 4. DB で所有者確認 (tenant_id × photo_id / 不一致なら 403)
   ├ 5. S3 presigned URL 生成
   │    - TTL: 300秒
   │    - ResponseContentDisposition: attachment; filename="..."
   ├ 6. レスポンスヘッダー: Cache-Control: no-store
   └ 7. JSON 応答 + 監査ログ出力
   ↓
[ブラウザ] ← { downloads: [{ id, url, filename }] }
   ↓ <a download> をプログラムで .click()
[S3] ← 直接アクセス（サーバー経由しない）
   ↓
ダウンロード完了 🎉
```

---

## 用語早見表

| 用語 | 一言サマリ |
|------|------|
| **S3 (Amazon S3)** | AWS の汎用オブジェクトストレージ。Web サービスのファイル保管庫として事実上の標準 |
| **presigned URL（署名付き URL）** | S3 のオブジェクトに一時アクセスするための、署名と有効期限付きの URL |
| **TTL（Time To Live）** | 有効期限。presigned URL の TTL=300 秒 なら 5 分で失効 |
| **IDOR** | ID を改ざんして他人のリソースを参照する攻撃。所有者確認で防ぐ |
| **CSRF** | 罠サイト経由でログイン済みユーザーに不正リクエストを送らせる攻撃 |
| **CSRF トークン** | ページ表示時にサーバーが発行するランダム文字列。攻撃者は知り得ないので偽装を防げる |
| **セッション認証** | ログイン時のセッション ID で「誰か」を識別する仕組み。Cookie に保存 |
| **Content-Disposition** | レスポンスヘッダー。`attachment` でブラウザがファイルを保存する |
| **`<a download>`** | リンク先を「表示」ではなく「ダウンロード」させる HTML 属性 |
| **Cache-Control: no-store** | レスポンスをキャッシュさせないヘッダー。署名付き URL の流出経路を断つ |
| **IAM ロール** | AWS リソースへのアクセス権限の集合。サーバーがこのロールの権限で AWS にアクセスする |
| **バケットポリシー** | S3 バケット側で定義するアクセスルール。IAM ロールとの両方で許可されて初めてアクセス可能 |
| **CloudFront** | AWS の CDN。公開コンテンツの高速配信に使う。ダウンロード API では使わない |

---

## まとめ

「ファイルを DL する」という、ユーザー視点ではボタン 1 つの機能の裏に、これだけの設計判断と用語が詰まっている。

- **サーバーを経由させない** → presigned URL でスケーラビリティ確保
- **ブラウザにダウンロードさせる** → Content-Disposition + `<a download>`
- **未ログインを防ぐ** → セッション認証で 401
- **他人のリソースを防ぐ** → DB で所有者確認、IDOR 対策
- **不正リクエストを防ぐ** → CSRF トークン
- **URL 漏洩に備える** → 短い TTL + POST + Cache-Control: no-store
- **AWS 権限は二重チェック** → IAM ロール + バケットポリシー

新人のうちは「言われた API を実装する」で精一杯になりがちだが、**なぜそうするのか** を 1 つずつ言語化できるようになると、設計レビューやセキュリティ議論でも対等に話せるようになる。次に AWS が絡む機能を作るときは、ぜひこの記事を思い出してみてほしい。

---

## 参考リンク

- [AWS S3: Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
- [MDN: Content-Disposition](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Content-Disposition)
- [MDN: HTMLAnchorElement.download](https://developer.mozilla.org/ja/docs/Web/HTML/Element/a#download)
- [OWASP: Insecure Direct Object Reference](https://owasp.org/www-community/Insecure_Direct_Object_Reference)
- [OWASP: Cross-Site Request Forgery (CSRF)](https://owasp.org/www-community/attacks/csrf)
- [AWS IAM: ポリシー評価ロジック](https://docs.aws.amazon.com/IAM/UserGuide/reference_policies_evaluation-logic.html)
