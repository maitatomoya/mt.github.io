---
id: 87
title: "HTML5 video の autoplay が突然動かない — muted 属性とブラウザのポリシーを理解する"
tags: [HTML, JavaScript, ブラウザ, フロントエンド, アクセシビリティ]
create: "2026-06-04 18:00"
---

## はじめに

「ローカルで動いていた `<video autoplay>` が本番で再生されない」「JavaScript の `video.play()` を呼んだら `NotAllowedError` で reject された」という経験はないだろうか。

これはブラウザ側の **Autoplay Policy（自動再生ポリシー）** によるブロックである。本記事では、なぜ自動再生がブロックされるのか、`muted` 属性が何をするのか、そして `play()` の Promise が reject されたときにどう振る舞うべきかを整理する。

---

## まずは現象を再現する

以下の HTML を用意して、シークレットウィンドウで開いてみる。

```html
<video src="sample.mp4" autoplay controls></video>
```

期待としては再生が始まりそうだが、多くのブラウザでは何も起きない。コンソールには次のような警告が出る。

```
DOMException: play() failed because the user didn't interact with the document first.
```

これは、ユーザーが一度もクリックやタップ等のジェスチャーを行っていないページで音声付き動画を自動再生しようとしたために、ブラウザがブロックした、という意味である。

---

## なぜブロックされるのか — Autoplay Policy

Chrome / Safari / Firefox のいずれも、近年「**ユーザーの同意なしに音が鳴る Web 体験**」を減らすためにポリシーを段階的に強化してきた。

### Chrome の場合

[Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay/) によると、`<video>` の自動再生が許可されるのは以下のいずれかの条件を満たすときに限られる。

1. `muted` 属性がついている（常に許可）
2. ユーザーがそのドメインで過去に十分インタラクションしている（MEI: Media Engagement Index が閾値超え）
3. PWA としてホーム画面に追加されている
4. iframe の場合、親が `allow="autoplay"` を付与している

つまり「初回訪問のユーザーに対して音付き自動再生を成功させる方法はほぼない」と思っておいたほうがよい。

### Safari の場合

Safari、特に iOS Safari はより厳しい。

- iOS: `muted` **かつ** `playsinline` の両方が必須。片方欠けても自動再生されない。
- macOS Safari: デフォルトで音声付き自動再生はブロックされる。サイトごとの設定で例外あり。

### Firefox の場合

`muted` があれば許可。なければ `media.autoplay.blocking_policy` 設定に依存する。

### 共通の安全策

つまりどのブラウザでも安心して自動再生したければ、**`muted` を付ける** のが現実解である。

```html
<video src="sample.mp4" autoplay muted playsinline></video>
```

`playsinline` は iOS Safari で全画面表示にせず、インラインで再生するためのオプションである。動画一覧のサムネ的に使うなら必ず付ける。

---

## 「自動再生したいけど muted にしたくない」場合

これは要件として成立しない。ユーザーの操作なしで音を鳴らすことは、ブラウザが許してくれない。

現実的な妥協案は次のいずれか。

### 案 A: muted で自動再生 → ユーザーが手動でアンミュート

YouTube などの多くのプラットフォームが採用しているパターン。
ユーザーは「音を聞きたければ自分でミュート解除する」という前提に立つ。

### 案 B: 自動再生をやめてユーザータップで再生

最初は再生せず、ポスター画像と▶ボタンを表示。タップで `play()` を呼ぶ。
このときユーザージェスチャー由来の `play()` なので、`muted` がなくても再生できる。

```html
<video id="player" src="sample.mp4" controls></video>
<button id="play-btn">再生する</button>

<script>
  document.getElementById('play-btn').addEventListener('click', () => {
    document.getElementById('player').play(); // 音付きで再生される
  });
</script>
```

### 案 C: muted で自動再生して、ユーザーアクション時にアンミュート

```js
const video = document.getElementById('player');
video.muted = true;
video.play();

// ユーザーが何かしらクリック・タップしたタイミングでアンミュート
document.addEventListener('click', () => {
  video.muted = false;
}, { once: true });
```

このパターンも有効。「初回は muted、ジェスチャー後は音あり」という流れ。

---

## play() の Promise を必ずハンドルする

ブラウザによっては `play()` が Promise を返す。これを無視すると、ブロックされたケースで「無音のコンソールエラー」状態になる。

### NG: play() の戻り値を無視する

```js
video.play(); // ブロックされても無視される
```

### OK: NotAllowedError をキャッチしてフォールバック

```js
async function attemptAutoplay(video) {
  try {
    await video.play();
    // 自動再生に成功
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      // autoplay policy で拒否された
      // → ユーザーに手動再生を促す UI を表示
      showManualPlayButton();
    } else if (err.name === 'AbortError') {
      // load 中などで中断された(無害なケースが多い)
      showManualPlayButton();
    } else {
      // 動画読み込み失敗など本当のエラー
      showErrorMessage();
    }
  }
}
```

代表的なエラー名:

| エラー名 | 意味 | 対応 |
|---|---|---|
| `NotAllowedError` | autoplay policy で拒否された | ユーザー手動再生にフォールバック |
| `AbortError` | 再生開始処理が中断された(別の load 等) | 無害だが、保険でフォールバック表示 |
| `NotSupportedError` | コーデック or ソースが対応外 | エラー表示 |

`NotAllowedError` と `AbortError` は「異常系」ではなく「**Web 仕様の許容範囲**」なので、エラーメッセージを表示するのではなくユーザーが操作できる UI を見せるのが正しい。

---

## テスト方法 — autoplay policy を強制的に切り替える

開発中に「拒否されたときの挙動」を確認したい場合、Chrome DevTools で強制できる。

### Chrome DevTools

1. DevTools を開く (`F12`)
2. 右上の「︙」→「More tools」→「Rendering」
3. 「Emulate autoplay policy」のドロップダウン
   - `Default` — 通常
   - `User gesture required` — ジェスチャーなしでは拒否する（テスト用に強制）
   - `No user gesture required` — 常に許可する（自動再生される）
4. ページをリロード

これで `NotAllowedError` 経路を確実に踏める。フォールバック UI が正しく出るか、計測タグが拒否経路でも飛ぶかを検証できる。

### Chrome の設定で永続的に切り替える

`chrome://settings/content/sound` から、特定のドメインの音声をブロック / 許可できる。テスト用環境では「ブロック」にしておくと一貫した挙動でテストできる。

### iOS Safari の場合

iOS では autoplay policy 自体を切り替える UI はないが、

- **Low Power Mode（省電力モード）** をオンにすると、Safari の autoplay が制限される
- これで実機検証時に「拒否された場合」の挙動を再現できる

---

## ありがちなハマりどころ

### 1. `muted` 属性の付け忘れ

複数の `<video>` を扱うコードで、ある場所だけ `muted` を付け忘れて「ローカルでは動くけど本番だけ自動再生されない」という現象になりやすい。

```html
<!-- グリッド表示用（OK） -->
<video src="..." muted playsinline></video>

<!-- 詳細表示用（NG: muted がない） -->
<video src="..." playsinline controls></video>
<!-- このまま play() しても拒否される -->
```

レビューでは `<video>` 要素を全て grep して、自動再生される側に muted が付いているか必ず確認する。

### 2. `controls` 属性なしで拒否経路

`<video>` に `controls` を付けていないと、拒否されたときにユーザーが再生する手段がない。フォールバック処理として JS で `video.controls = true` を立てる、独自の再生ボタンを表示する、などの設計が必要。

### 3. autoplay と play() を二重に呼ぶ

```html
<video autoplay src="..." muted></video>
<script>
  video.play(); // autoplay 属性 + play() の二重呼び出し
</script>
```

これは AbortError の主要原因。autoplay 属性で勝手に再生プロセスが走っているところに、JS が `play()` を呼ぶと最初の load が中断され `AbortError` になる。

JS で再生制御するなら autoplay 属性は付けず、`play()` だけを使う。

### 4. iframe での autoplay 失敗

埋め込み動画（iframe）の場合、親側で許可していないと autoplay が拒否される。

```html
<iframe src="https://example.com/player" allow="autoplay"></iframe>
```

`allow="autoplay"` を必ず付与する。

---

## まとめ

| 状況 | やること |
|---|---|
| 音付きで自動再生したい | **諦める**。 ユーザーアクションで再生する設計に変える |
| 視覚的に動画を流したい | `muted playsinline` を付ける |
| 拒否経路をテストしたい | DevTools の Rendering → Emulate autoplay policy |
| play() で拒否されたとき | `NotAllowedError` をキャッチして手動再生 UI にフォールバック |
| iframe で埋め込む | 親側で `allow="autoplay"` を付与 |

### ポイント

1. **`muted` 属性は autoplay の「最強のパスポート」** — 付けるだけで全ブラウザで再生許可される
2. **`play()` は Promise を返す** — 必ず `await` か `.catch()` でエラーハンドル
3. **`NotAllowedError` は異常ではなく Web 仕様** — フォールバック UI で対応する
4. **iOS は `muted + playsinline` 両方必須** — 片方欠けても再生されない
5. **テスト時は DevTools で policy を強制切り替え** — 「ローカルでは動く」を信用しない

---

## 参考

- [Chrome Autoplay Policy — developer.chrome.com](https://developer.chrome.com/blog/autoplay/)
- [HTMLMediaElement.play() — MDN](https://developer.mozilla.org/ja/docs/Web/API/HTMLMediaElement/play)
- [Safari New Video Policies for iOS — webkit.org](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- [Cross-browser audio basics — MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
