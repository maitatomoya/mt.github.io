---
id: 90
title: "WAI-ARIA APG パターン比較: status / alert / tooltip の使い分け"
tags: [accessibility, aria, wai-aria, apg, frontend]
create: "2026-06-26 11:15"
---

## はじめに

Webアプリケーションでユーザーに情報を伝える場面は多い。「保存しました」「エラーです」「このボタンは○○です」——これらは視覚的には実装できていても、スクリーンリーダー利用者に適切に伝わっているだろうか。

WAI-ARIA APG（Authoring Practices Guide）では、通知系のパターンとして `status`、`alert`、`tooltip` の3つを定義している。本記事ではそれぞれの違いと使い分けを整理する。

---

## 3パターンの比較表

| 項目 | status | alert | tooltip |
|------|--------|-------|---------|
| 目的 | 控えめな通知 | 緊急の通知 | 補足説明 |
| role属性 | `status` | `alert` | `tooltip` |
| aria-live（暗黙値） | `polite` | `assertive` | なし |
| aria-atomic（暗黙値） | `true` | `true` | - |
| フォーカス移動 | しない | しない | しない |
| 表示トリガー | DOM変更 | DOM変更 | フォーカス/ホバー |
| 自動消去 | NG | NG | ホバー/フォーカス外れで消える |

最大の違いは **aria-live の値** である。これがスクリーンリーダーの読み上げタイミングを決定する。

---

## status（role="status"）

ユーザーの作業を中断せずに、状態の変化を控えめに伝えるパターン。

### 暗黙のプロパティ

- `aria-live="polite"` — スクリーンリーダーは現在の読み上げを終えてから通知する
- `aria-atomic="true"` — 変更部分だけでなくコンテナ全体を読み上げる

### ユースケース

- 検索結果件数の更新
- フォームの保存完了メッセージ
- ショッピングカートの合計金額更新
- ファイルアップロード進捗

### 実装例

```html
<div role="status">5件の結果が見つかりました</div>
```

HTML5の `<output>` 要素は暗黙的に `role="status"` を持つ。

```html
<output>計算結果: 42</output>
```

### 注意点

- 自動的に消えるメッセージにしてはいけない（WCAG 2.2.3 違反）
- ページロード時に既に存在する status は読み上げられない。動的に変更されたもののみ対象

---

## alert（role="alert"）

緊急性の高い情報を即座にユーザーに伝えるパターン。

### 暗黙のプロパティ

- `aria-live="assertive"` — 現在の読み上げを中断して即座に通知する
- `aria-atomic="true"`

### ユースケース

- バリデーションエラー
- ネットワーク接続の切断
- セッションタイムアウト警告
- 重要なシステムメッセージ

### 実装例

```html
<div role="alert">メールアドレスの形式が正しくありません</div>
```

### 注意点

- フォーカスは移動しない（フォーカスを移動させたい場合は `alertdialog` を使う）
- 頻繁に発火させるとユーザー体験を著しく損なう（WCAG 2.2.4）
- こちらも自動消去NG

### alert と alertdialog の違い

| | alert | alertdialog |
|--|-------|-------------|
| フォーカス移動 | なし | ダイアログに移動 |
| ユーザーの応答 | 不要 | 必要（確認ボタン等） |
| モーダル | No | Yes |

「エラーがあります」と伝えるだけなら `alert`。「本当に削除しますか？」のように応答が必要なら `alertdialog` を使う。

---

## tooltip（role="tooltip"）

要素に対する補足情報をポップアップで表示するパターン。

### 特徴

- ライブリージョンではない（`aria-live` なし）
- スクリーンリーダーはトリガー要素にフォーカスした時点で `aria-describedby` 経由で読み上げる
- フォーカスまたはホバーで表示、Escape で閉じる

### 実装例

```html
<button aria-describedby="save-tip">💾</button>
<div role="tooltip" id="save-tip">ファイルを保存する</div>
```

### キーボード操作

- **Escape**: ツールチップを閉じる
- フォーカスがトリガー上にある間は表示維持
- フォーカスが外れると非表示

### 注意点

- tooltip内にリンクやボタンなどフォーカス可能な要素を入れてはいけない
- フォーカス可能な内容が必要な場合は non-modal dialog を使う
- APG公式ではまだ「work in progress」（正式な実装例なし）

---

## 使い分けフローチャート

```
ユーザーに情報を伝えたい
  │
  ├── ユーザーの応答が必要？
  │     └── Yes → alertdialog（モーダル）
  │
  ├── 緊急性が高い？（エラー、警告）
  │     └── Yes → alert
  │
  ├── 状態変化の通知？（保存完了、件数更新）
  │     └── Yes → status
  │
  └── 要素の補足説明？（アイコンの意味、入力ヒント）
        └── Yes → tooltip
```

---

## よくある誤り

| 誤り | 問題 | 正しい実装 |
|------|------|-----------|
| 保存完了に `role="alert"` | 緊急ではないのに読み上げを中断する | `role="status"` を使う |
| エラーメッセージに role なし | スクリーンリーダーに通知されない | `role="alert"` を付ける |
| tooltip 内にリンクを配置 | フォーカス不可能で操作できない | non-modal dialog にする |
| `aria-live="polite"` を明示的に書く | 冗長（status は暗黙で持つ） | role だけ指定すれば十分 |
| 通知を3秒後に自動消去 | WCAG 2.2.3 違反 | 消去しないか、ユーザー操作で消す |

---

## aria-live の値と挙動まとめ

| 値 | 挙動 | 対応 role |
|----|------|-----------|
| `off` | 通知しない（デフォルト） | - |
| `polite` | アイドル時に読み上げ | status, log |
| `assertive` | 即座に割り込み読み上げ | alert |

`aria-live` を直接指定するのではなく、適切な role を使うことで暗黙的に設定されるのがベストプラクティスである。

---

## まとめ

- **status**: 控えめ。ユーザーの手が空いたら伝える。保存完了や件数更新に最適
- **alert**: 緊急。今すぐ伝える。エラーや警告に限定して使う
- **tooltip**: 通知ではない。要素の補足説明。`aria-describedby` で紐付ける

3つとも**フォーカスを移動しない**点は共通している。フォーカス移動が必要なら `alertdialog` か `dialog` を検討する。

---

## デモ（CodePenで試す）

以下の「Edit on CodePen」ボタンをクリックすると、CodePen上でコードを編集・実行できる。スクリーンリーダー（macOSならVoiceOver: Cmd+F5）を有効にして動作の違いを体感してほしい。

### Demo 1: role="status" — 保存完了通知

<form action="https://codepen.io/pen/define" method="POST" target="_blank">
<input type="hidden" name="data" value='{"title":"APG Demo: role=status","html":"<h2>role=\"status\" デモ</h2>\n<p>ボタンをクリックすると、保存完了メッセージが表示される。<br>スクリーンリーダーは現在の読み上げを終えてから通知する（polite）。</p>\n\n<button id=\"save-btn\">保存する</button>\n<div role=\"status\" id=\"status-msg\" class=\"message\"></div>","css":"body { font-family: sans-serif; padding: 20px; }\nbutton { padding: 10px 20px; font-size: 16px; cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 6px; }\nbutton:hover { background: #1d4ed8; }\n.message { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 14px; }\n.message:not(:empty) { background: #d1fae5; border: 1px solid #6ee7b7; color: #065f46; }","js":"document.getElementById(\"save-btn\").addEventListener(\"click\", () => {\n  const msg = document.getElementById(\"status-msg\");\n  msg.textContent = \"✓ 変更を保存しました（\" + new Date().toLocaleTimeString() + \"）\";\n});"}'>
<button type="submit" style="padding:8px 16px;background:#1e1f26;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Edit on CodePen — status</button>
</form>

### Demo 2: role="alert" — バリデーションエラー

<form action="https://codepen.io/pen/define" method="POST" target="_blank">
<input type="hidden" name="data" value='{"title":"APG Demo: role=alert","html":"<h2>role=\"alert\" デモ</h2>\n<p>空のまま送信すると、エラーメッセージが即座にスクリーンリーダーに通知される（assertive）。</p>\n\n<form id=\"demo-form\" novalidate>\n  <label for=\"email\">メールアドレス</label><br>\n  <input type=\"email\" id=\"email\" placeholder=\"example@example.com\" style=\"padding:8px;width:250px;margin:8px 0;\">\n  <br>\n  <button type=\"submit\">送信</button>\n</form>\n<div role=\"alert\" id=\"error-msg\" class=\"message\"></div>","css":"body { font-family: sans-serif; padding: 20px; }\nbutton { padding: 10px 20px; font-size: 16px; cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 6px; margin-top: 8px; }\nbutton:hover { background: #1d4ed8; }\n.message { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 14px; }\n.message:not(:empty) { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; }","js":"document.getElementById(\"demo-form\").addEventListener(\"submit\", (e) => {\n  e.preventDefault();\n  const email = document.getElementById(\"email\").value;\n  const msg = document.getElementById(\"error-msg\");\n  if (!email) {\n    msg.textContent = \"⚠ メールアドレスを入力してください\";\n  } else if (!email.includes(\"@\")) {\n    msg.textContent = \"⚠ メールアドレスの形式が正しくありません\";\n  } else {\n    msg.textContent = \"\";\n    alert(\"送信しました（デモ）\");\n  }\n});"}'>
<button type="submit" style="padding:8px 16px;background:#1e1f26;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Edit on CodePen — alert</button>
</form>

### Demo 3: role="tooltip" — アイコンの補足説明

<form action="https://codepen.io/pen/define" method="POST" target="_blank">
<input type="hidden" name="data" value='{"title":"APG Demo: role=tooltip","html":"<h2>role=\"tooltip\" デモ</h2>\n<p>ボタンにフォーカスまたはホバーすると、ツールチップが表示される。<br>Escapeキーで閉じる。aria-describedby で紐付いているため、フォーカス時にスクリーンリーダーが説明を読み上げる。</p>\n\n<div class=\"toolbar\">\n  <button class=\"icon-btn\" aria-describedby=\"tip-save\" data-tooltip=\"tip-save\">💾</button>\n  <div role=\"tooltip\" id=\"tip-save\" class=\"tooltip\">ファイルを保存する</div>\n\n  <button class=\"icon-btn\" aria-describedby=\"tip-delete\" data-tooltip=\"tip-delete\">🗑️</button>\n  <div role=\"tooltip\" id=\"tip-delete\" class=\"tooltip\">選択した項目を削除する</div>\n\n  <button class=\"icon-btn\" aria-describedby=\"tip-share\" data-tooltip=\"tip-share\">🔗</button>\n  <div role=\"tooltip\" id=\"tip-share\" class=\"tooltip\">リンクを共有する</div>\n</div>","css":"body { font-family: sans-serif; padding: 20px; }\n.toolbar { display: flex; gap: 16px; margin-top: 16px; }\n.icon-btn { position: relative; font-size: 24px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; }\n.icon-btn:hover, .icon-btn:focus { background: #f0f9ff; outline: 2px solid #2563eb; }\n.tooltip { position: absolute; background: #1e293b; color: white; padding: 6px 12px; border-radius: 4px; font-size: 13px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.15s; transform: translateY(4px); margin-top: 4px; }\n.tooltip.visible { opacity: 1; }","js":"document.querySelectorAll(\".icon-btn\").forEach(btn => {\n  const tipId = btn.dataset.tooltip;\n  const tip = document.getElementById(tipId);\n  // Position tooltip below button\n  const show = () => { tip.style.position = \"absolute\"; tip.style.left = btn.offsetLeft + \"px\"; tip.style.top = (btn.offsetTop + btn.offsetHeight + 4) + \"px\"; tip.classList.add(\"visible\"); };\n  const hide = () => tip.classList.remove(\"visible\");\n  btn.addEventListener(\"mouseenter\", show);\n  btn.addEventListener(\"mouseleave\", hide);\n  btn.addEventListener(\"focus\", show);\n  btn.addEventListener(\"blur\", hide);\n  btn.addEventListener(\"keydown\", (e) => { if (e.key === \"Escape\") hide(); });\n});"}'>
<button type="submit" style="padding:8px 16px;background:#1e1f26;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Edit on CodePen — tooltip</button>
</form>

---

## 参考

- [APG Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)
- [APG Tooltip Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
- [ARIA22: Using role=status to present status messages](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22.html)
- [MDN: ARIA status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/roles/status_role)
