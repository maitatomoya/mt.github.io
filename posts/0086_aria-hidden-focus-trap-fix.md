---
id: 86
title: "aria-hidden=\"true\" とフォーカス可能な要素の罠 — コンソールエラーの正体と正しい対処法"
tags: [アクセシビリティ, WAI-ARIA, HTML, フロントエンド]
create: "2026-04-24 10:00"
---

## はじめに

ブラウザのコンソールに以下のエラーが出たことはないだろうか。

```
Blocked aria-hidden on an element because its descendant retained focus.
The focus must not be hidden from assistive technology users.
```

これは WAI-ARIA 仕様違反の警告で、Chrome 128 以降で表示されるようになった。本記事では、なぜこのエラーが起きるのか、なぜ単純に `aria-hidden` を消すだけでは不十分なのか、そしてどう対処すべきかを整理する。

---

## aria-hidden="true" とは

`aria-hidden="true"` は「この要素をスクリーンリーダーから隠す」ことを意味する属性である。

```html
<!-- スクリーンリーダーはこの要素を読み上げない -->
<div aria-hidden="true">装飾用のアイコン</div>
```

装飾用のアイコンや、視覚的にのみ意味を持つ要素に対して使うのが正しい用途である。

---

## 何が問題なのか

### フォーカス可能な要素に aria-hidden を付けてはいけない

```html
<!-- NG: ボタンはフォーカス可能 -->
<button aria-hidden="true" type="button">
  続きを読む
</button>
```

この状態では以下の矛盾が発生する。

| ユーザー | 認識 |
|---------|------|
| 晴眼ユーザー | ボタンが見えている、クリックできる |
| スクリーンリーダーユーザー | Tab キーでフォーカスは当たるが、ボタンの名前も役割も読み上げられない。「何もない場所にフォーカスしている」状態になる |

ブラウザはこの矛盾を検知し、`aria-hidden` を **無視** してコンソールエラーを出す。

### WAI-ARIA 仕様の該当箇所

> Authors MUST NOT set `aria-hidden="true"` on a focused element or on an ancestor of a focused element.
> — [WAI-ARIA 1.2 Specification](https://w3c.github.io/aria/#aria-hidden)

---

## 実際のケース: 「続きを読む」ボタン

テキストが長い場合に省略表示し、「続きを読む」ボタンで展開する UI パターンを考える。

```html
<p class="truncate">
  長いテキストがここに入る...
</p>
<button
  aria-hidden="true"
  type="button"
  aria-expanded="false"
>
  <span>続きを読む</span>
  <span class="hidden">閉じる</span>
</button>
```

### なぜ aria-hidden を付けたかったのか

ここには合理的な理由がある。

**スクリーンリーダーは CSS の `text-overflow: ellipsis` を無視する。** つまりスクリーンリーダーユーザーにとっては、テキストは最初から全文読み上げられる。「続きを読む」ボタンを押す必要がそもそもない。

だから開発者は `aria-hidden="true"` でボタンをスクリーンリーダーから隠そうとした。意図としては正しいが、手段が WAI-ARIA 仕様に違反していた。

---

## 段階的な対処法

### Step 1: aria-hidden="true" を削除する

```diff
 <button
-  aria-hidden="true"
   type="button"
   aria-expanded="false"
 >
```

コンソールエラーは解消する。しかし、これだけでは新たな問題が生まれる。

### Step 1 の問題点

`aria-hidden` を消すと「続きを読む」がスクリーンリーダーに読み上げられるようになる。しかし、スクリーンリーダーユーザーは既に全文読めている。ボタンを押しても「続き」は出てこない。

**期待と結果が一致しない** 状態になる。

### Step 2: aria-label で正確な役割を伝える

```html
<button
  type="button"
  aria-expanded="false"
  aria-label="表示を切り替え"
>
  <span>続きを読む</span>
  <span class="hidden">閉じる</span>
</button>
```

`aria-label` を付けると、スクリーンリーダーは子要素のテキスト（「続きを読む」）ではなく `aria-label` の値を読み上げる。

| 読み上げ（修正前） | 読み上げ（修正後） |
|-------------------|-------------------|
| 「続きを読む、ボタン」 | 「表示を切り替え、ボタン、折りたたみ」 |

`aria-expanded="false"` / `"true"` の切り替えと合わせて、スクリーンリーダーユーザーにも正確な状態が伝わる。

---

## まとめ

| 手段 | コンソールエラー | スクリーンリーダーの挙動 |
|------|----------------|----------------------|
| `aria-hidden="true"`（元の実装） | 発生する | フォーカスは当たるが読み上げられない（矛盾状態） |
| `aria-hidden` 削除のみ | 解消 | 「続きを読む」と読み上げられるが、押しても続きは出ない |
| `aria-hidden` 削除 + `aria-label` | 解消 | 「表示を切り替え」と読み上げられ、役割が正確に伝わる |

### ポイント

1. **`aria-hidden="true"` はフォーカス可能な要素に使ってはいけない** — `<button>`, `<a>`, `<input>` など
2. **コンソールエラーを消すだけでは不十分** — スクリーンリーダーユーザーにとっての体験まで考える
3. **スクリーンリーダーは CSS のトランケートを無視する** — 視覚的な表示とスクリーンリーダーの読み上げは異なることを常に意識する
4. **`aria-label` と `aria-expanded` の組み合わせ** で、状態を持つボタンの役割を正確に伝えられる

---

## 参考

- [WAI-ARIA 1.2 — aria-hidden](https://w3c.github.io/aria/#aria-hidden)
- [Chrome 128 リリースノート — aria-hidden エラーの追加](https://developer.chrome.com/blog/aria-hidden-focus)
- [MDN — aria-hidden 属性](https://developer.mozilla.org/ja/docs/Web/Accessibility/ARIA/Attributes/aria-hidden)
