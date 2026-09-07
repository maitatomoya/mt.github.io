---
id: 85
title: "Gaussian Splatting入門 — 3Dシーンをリアルタイムに描画する新技術とBabylon.jsでの実装方法"
tags: [3D, WebGL, Babylon.js, Gaussian Splatting, NeRF, 3Dレンダリング]
create: "2026-04-15 01:23"
---

## はじめに

「現実世界をそのまま3Dデータにして、ブラウザでリアルタイムに表示できたら...」と思ったことはないだろうか。従来はフォトグラメトリやNeRFといった技術が使われてきたが、2023年に登場した**3D Gaussian Splatting（3DGS）**がこの分野に革命を起こした。

本記事では、Gaussian Splattingの仕組みを初心者でも理解できるように解説し、さらにWebGLフレームワーク**Babylon.js**を使ってブラウザ上でGaussian Splattingを表示する方法を紹介する。読み終わる頃には、公式ドキュメントがスムーズに読めるようになるはずだ。

---

## Gaussian Splattingとは何か

### 一言で言うと

**大量の半透明な楕円（ガウス関数）を空間に配置して、3Dシーンを表現する手法**だ。

従来の3Dモデルが「ポリゴン（三角形の面）」で物体を表現するのに対して、Gaussian Splattingは「色のついた霧のような粒子の集合」で表現する。

### 日常的な例えで理解する

こんなイメージを持つとわかりやすい。

| 従来の3Dモデル | Gaussian Splatting |
|---|---|
| レゴブロックで形を作る | 色のついた綿菓子を大量に並べて形を作る |
| 面（ポリゴン）の集合 | 粒子（ガウス関数）の集合 |
| エッジがくっきり | なめらかで自然 |

それぞれの「粒子」は以下の情報を持っている:

- **位置**: 3D空間のどこにあるか（x, y, z）
- **大きさと向き**: 楕円の形状（共分散行列で定義）
- **色**: 見る角度によって変わる色（球面調和関数で表現）
- **透明度**: どのくらい透けるか

---

## なぜ注目されているのか

### NeRFとの比較

Gaussian Splattingが注目される最大の理由は**圧倒的な速度**だ。同じく3Dシーン再構成技術であるNeRF（Neural Radiance Fields）との比較を見てみよう。

| 項目 | NeRF | 3D Gaussian Splatting |
|---|---|---|
| 学習時間 | 約48時間 | 約35〜45分 |
| レンダリング速度 | 約10秒/フレーム | リアルタイム（60fps以上） |
| データ表現 | ニューラルネットワーク | 点群（ガウス関数の集合） |
| レンダリング方式 | レイマーチング | ラスタライズ |

> 参考: [3D Gaussian Splatting - Wikipedia](https://en.wikipedia.org/wiki/3D_Gaussian_splatting)

### フォトグラメトリとの比較

フォトグラメトリは写真からポリゴンメッシュを生成する技術だ。Gaussian Splattingとの違いはこうなる。

| 項目 | フォトグラメトリ | Gaussian Splatting |
|---|---|---|
| 出力 | ポリゴンメッシュ+テクスチャ | 点群（ガウス関数） |
| 反射・透明の表現 | 苦手 | 得意 |
| データサイズ | 大きい | 比較的小さい |
| リアルタイム性 | 可能（ただしLOD等が必要） | 標準でリアルタイム |

Gaussian Splattingは特に**反射面や透明な物体の表現に強い**。これはガウス関数が半透明の楕円であるため、ガラスや水面のような表現が自然にできるためだ。

---

## Gaussian Splattingの仕組み

### 処理の流れ

```
複数枚の写真 → SfM（カメラ位置推定） → 初期点群生成 → ガウス関数の最適化 → 描画
```

1. **写真の撮影**: 対象物を様々な角度から撮影する（数十〜数百枚）
2. **SfM（Structure from Motion）**: 各写真のカメラ位置を推定し、疎な点群を生成する
3. **初期化**: 各点をガウス関数（位置・サイズ・色・透明度を持つ楕円）として初期化する
4. **最適化**: 元の写真と見比べながら、各ガウス関数のパラメータを調整する
5. **描画**: 最適化されたガウス関数を、前から後ろの順にソートして重ねて描画する

### 各ガウス関数が持つデータ

技術的には、1つのガウス関数（Splat）は以下のパラメータで定義される:

| パラメータ | 内容 | サイズ |
|---|---|---|
| 位置（x, y, z） | 3D空間での中心座標 | Float32 x 3 |
| 共分散行列 | 楕円の大きさと向き | Float32 x 3（スケール+回転で表現） |
| 色（RGBA） | 見た目の色と透明度 | Uint8 x 4 |
| 球面調和関数の係数 | 視点依存の色変化 | 複数のFloat |

> **用語解説 - 共分散行列**: 統計学の用語。ここでは「楕円の形と傾きを数学的に表す行列」と理解すれば十分。円なら正方行列、細長い楕円なら非対称な値になる。

> **用語解説 - 球面調和関数**: 見る角度によって色が変わる現象（例: 光沢のある表面）を数学的に表現する関数。CGの照明計算でよく使われる。

---

## Babylon.jsでGaussian Splattingを使う

ここからは実践編。Babylon.jsを使ってブラウザ上にGaussian Splattingを表示する方法を見ていこう。

### Babylon.jsとは

Babylon.jsはMicrosoftが開発するオープンソースのWebGLフレームワークだ。3Dコンテンツをブラウザ上で表示・操作できる。

> 参考: [Babylon.js 公式サイト](https://www.babylonjs.com/)

### 対応ファイル形式

Babylon.jsは複数のGaussian Splattingファイル形式に対応している。

| 形式 | 説明 | 特徴 |
|---|---|---|
| .ply | 標準的な点群フォーマット | 広く使われている。三角メッシュ版もサポート |
| .splat | JavaScript向けにシリアライズされたPLY | Web向けに最適化 |
| .spz | Niantic Labs開発のフォーマット | 圧縮率が高い |
| .sog / .sogs | Self-Organizing Gaussian形式 | 効率的なデータ構造 |

### 基本的な読み込み方法

最もシンプルな実装はこれだけだ:

```javascript
// シーンにGaussian Splattingファイルを読み込む
const result = await BABYLON.ImportMeshAsync(
  "path/to/scene.splat",
  scene
);

// 読み込まれたメッシュを取得
const mesh = result.meshes[0];
```

たったこれだけで、ブラウザ上にGaussian Splattingのシーンが表示される。

### .spz形式で上下反転を修正する

.spz形式のファイルは上下反転していることがある。`flipY`オプションで修正できる:

```javascript
await BABYLON.ImportMeshAsync(
  "path/to/scene.spz",
  scene,
  { pluginOptions: { splat: { flipY: true } } }
);
```

> **注意**: Gaussian Splattingのファイルには座標系（右手系/左手系）の標準がない。そのため、読み込んだシーンが上下逆だったり左右反転していることがある。必ず目視で確認しよう。

---

## データ構造を理解する

Gaussian Splattingをより深く扱いたい場合、内部のデータ構造を知っておくと役立つ。

### 1 Splatあたり32バイト

Babylon.jsでは、1つのSplatは32バイトの固定長データで表現される:

```
バイト 0-3:   位置X (Float32)
バイト 4-7:   位置Y (Float32)
バイト 8-11:  位置Z (Float32)
バイト 12-23: サイズ (Float32 x 3)
バイト 24:    赤 (Uint8, 0-255)
バイト 25:    緑 (Uint8, 0-255)
バイト 26:    青 (Uint8, 0-255)
バイト 27:    透明度 (Uint8, 0-255)
バイト 28-31: 回転 (Uint8 x 4, 128=0, 255=1)
```

### 手動でSplatデータを作成する

この知識を使えば、プログラムで動的にSplatデータを生成できる:

```javascript
// Gaussian Splattingメッシュを作成（updatable: true）
const gs = new BABYLON.GaussianSplattingMesh(
  "myGS",       // 名前
  undefined,     // URL（手動生成の場合はundefined）
  scene,         // シーン
  true           // updatable（更新可能）
);

// Splatデータを作成（例: 100個のSplat）
const splatCount = 100;
const buffer = new Uint8Array(splatCount * 32);

// 各Splatのデータを設定
const dataView = new DataView(buffer.buffer);
for (let i = 0; i < splatCount; i++) {
  const offset = i * 32;

  // 位置（ランダム配置の例）
  dataView.setFloat32(offset + 0, Math.random() * 10 - 5, true);  // X
  dataView.setFloat32(offset + 4, Math.random() * 10 - 5, true);  // Y
  dataView.setFloat32(offset + 8, Math.random() * 10 - 5, true);  // Z

  // サイズ
  dataView.setFloat32(offset + 12, 0.1, true);
  dataView.setFloat32(offset + 16, 0.1, true);
  dataView.setFloat32(offset + 20, 0.1, true);

  // 色（RGBA）
  buffer[offset + 24] = 255;  // R
  buffer[offset + 25] = 100;  // G
  buffer[offset + 26] = 100;  // B
  buffer[offset + 27] = 200;  // A

  // 回転（デフォルト: 無回転）
  buffer[offset + 28] = 128;
  buffer[offset + 29] = 128;
  buffer[offset + 30] = 128;
  buffer[offset + 31] = 255;
}

// データを適用
gs.updateData(buffer);
```

---

## 応用: 複数パーツの組み合わせ

### addPart / removePartで複数アセットを結合

複数のGaussian Splattingファイルを1つのシーンに組み合わせたい場合、`addPart()`と`removePart()`を使う:

```javascript
// メインのGSメッシュ
const mainGS = await BABYLON.ImportMeshAsync("main.splat", scene);
const mesh = mainGS.meshes[0];

// パーツとして別のファイルを追加
const partData = await fetch("furniture.splat");
const partBuffer = await partData.arrayBuffer();
mesh.addPart(new Uint8Array(partBuffer));
```

パーツごとに表示・非表示を切り替えることもできる:

```javascript
// パーツの透明度を変更（0で非表示、1で完全表示）
part.visibility = 0.5;  // 半透明
```

### 最大パーツ数の確認

GPUの性能によって同時に扱えるパーツ数に上限がある:

```javascript
const maxParts = BABYLON.GetGaussianSplattingMaxPartCount(
  scene.getEngine()
);
console.log(`最大パーツ数: ${maxParts}`);
```

---

## GPUピッキング

Gaussian Splattingのシーンでクリックした場所を特定するには、`GPUPicker`を使う:

```javascript
const gpuPicker = new BABYLON.GPUPicker();
gpuPicker.setPickingList([part1, part2, part3]);

// クリック座標からパーツを特定
const pickResult = await gpuPicker.pickAsync(
  scene.pointerX,
  scene.pointerY
);

if (pickResult) {
  console.log("クリックされたパーツ:", pickResult.mesh.name);
}
```

---

## 影の設定

Gaussian Splattingに影を落とすには、透明度に対応した影の設定が必要だ:

```javascript
const light = new BABYLON.DirectionalLight(
  "light",
  new BABYLON.Vector3(-1, -2, -1),
  scene
);

const shadowGenerator = new BABYLON.ShadowGenerator(1024, light);

// 透明度対応の影を有効にする（これが重要）
shadowGenerator.setTransparencyShadow(true);

// GSメッシュを影のキャスターに追加
shadowGenerator.addShadowCaster(gsMesh);
```

---

## マテリアルプラグインによるカスタマイズ

Gaussian Splattingの描画をカスタマイズしたい場合、`MaterialPluginBase`を継承してシェーダーを拡張できる。

### 使用可能なシェーダー注入ポイント

| 対象 | 注入ポイント | 用途 |
|---|---|---|
| フラグメント | CUSTOM_FRAGMENT_DEFINITIONS | 変数・関数の定義 |
| フラグメント | MAIN_BEGIN | メイン処理の先頭 |
| フラグメント | BEFORE_FRAGCOLOR | 最終色の直前 |
| フラグメント | MAIN_END | メイン処理の末尾 |
| 頂点 | CUSTOM_VERTEX_DEFINITIONS | 変数・関数の定義 |
| 頂点 | MAIN_BEGIN | メイン処理の先頭 |
| 頂点 | UPDATE | 頂点位置の更新 |
| 頂点 | MAIN_END | メイン処理の末尾 |

これにより、色の加工、ポストエフェクト、アニメーションなどの高度な表現が可能になる。

---

## データの書き出し

修正したSplatデータを.splatファイルとしてダウンロードできる:

```javascript
// 現在のSplatデータを取得
const splatsData = gsMesh.splatsData;

// Blobに変換してダウンロード
const blob = new Blob([splatsData], { type: "application/octet-stream" });
BABYLON.Tools.DownloadBlob(blob, "modified-scene.splat");
```

---

## ハンズオン: スマホ+ブラウザでGaussian Splattingを体験する

ここでは、実際に自分の写真からGaussian Splattingを生成し、ブラウザで閲覧するまでの手順を紹介する。高価なGPUは不要で、スマホとブラウザだけで体験できる。

### 全体の流れ

```
スマホで撮影 → Polycamで3DGS生成 → .splatファイル出力 → ブラウザで閲覧
```

### Step 1: Polycamのセットアップ

[Polycam](https://poly.cam/)はスマホで3Dスキャンができるアプリだ。

1. App StoreまたはGoogle Playから**Polycam**をインストール
2. アカウントを作成
3. Gaussian Splatting機能を使うには**Proプラン**（有料）が必要

> **無料で試したい場合**: Polycamの無料プランではGaussian Splatting機能は使えない。ただし、Step 3のブラウザビューアーは無料で使える。ネット上で公開されている.splatファイル（[サンプル](https://antimatter15.com/splat/)で提供されているもの等）をダウンロードして試すことも可能だ。

### Step 2: 撮影と3DGS生成

#### 撮影のコツ

良い3DGSデータを作るには、撮影が一番重要だ。

| ポイント | 詳細 |
|---|---|
| 撮影枚数 | 20〜200枚。多いほど品質が上がる |
| 角度 | 対象物をぐるっと360度、様々な角度から撮影する |
| 高さ | 上からと横からの両方を含める |
| 照明 | できるだけ均一な自然光。影が強い環境は避ける |
| 動く物体 | 撮影中に動く人や車はノイズになるので避ける |
| オーバーラップ | 隣り合う写真で70%以上重なるように撮影する |

#### Polycamでの手順

1. Polycamアプリを開く
2. **Photo Mode**を選択
3. 対象物の周りを歩きながら写真を撮影（アプリが自動で必要枚数をガイドしてくれる）
4. 撮影完了後、**Process**をタップ
5. 処理方式で**Gaussian Splat**を選択
6. 数分待つと3Dモデルが完成

#### エクスポート

1. 完成した3Dモデルの画面で**Export**をタップ
2. フォーマットは**.splat**または**.ply**を選択
3. ファイルをダウンロード

### Step 3: ブラウザで閲覧する

生成した.splatファイルをブラウザで表示する方法は2つある。

#### 方法A: antimatter15/splatビューアー（最も手軽）

1. ブラウザで https://antimatter15.com/splat/ にアクセス
2. 画面に**.splatファイルをドラッグ&ドロップ**するだけ

操作方法:
| 操作 | PC | スマホ |
|---|---|---|
| 回転 | マウスドラッグ | ワンフィンガードラッグ |
| 移動 | 右クリックドラッグ | ツーフィンガードラッグ |
| ズーム | マウスホイール | ピンチ |

> 参考: [antimatter15/splat (GitHub)](https://github.com/antimatter15/splat)

#### 方法B: Babylon.jsで自分のWebページに埋め込む

本記事の前半で紹介した`ImportMeshAsync`を使えば、自分のWebサイトにGaussian Splattingを埋め込める。

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.babylonjs.com/babylon.js"></script>
  <script src="https://cdn.babylonjs.com/loaders/babylonjs-loaders.min.js"></script>
  <style>
    canvas { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="renderCanvas"></canvas>
  <script>
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new BABYLON.Scene(engine);

    // カメラ
    const camera = new BABYLON.ArcRotateCamera(
      "camera", Math.PI / 2, Math.PI / 3, 10,
      BABYLON.Vector3.Zero(), scene
    );
    camera.attachControl(canvas, true);

    // Gaussian Splattingファイルを読み込む
    BABYLON.ImportMeshAsync("your-file.splat", scene);

    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
  </script>
</body>
</html>
```

このHTMLファイルと.splatファイルを同じフォルダに置いてブラウザで開くだけで、自分だけの3Dビューアーが完成する。

### やってみよう: おすすめの撮影対象

初めて試すなら、以下のような対象が成功しやすい:

| おすすめ | 理由 |
|---|---|
| デスク周り | 静止物が多く、テクスチャも豊富 |
| 花・植物 | 色が鮮やかで結果が映える |
| 部屋の一角 | 様々な形状・素材が混在して練習に最適 |
| 食べ物 | 質感が複雑でGaussian Splattingの強みが出る |

逆に避けた方がいいもの:

| 避けるべき | 理由 |
|---|---|
| 動く対象 | 人や動物はブレてノイズになる |
| 単色の壁 | 特徴点が少なくカメラ位置推定が失敗しやすい |
| 鏡・反射面 | 見る角度で見え方が変わりすぎる |

---

## 制限事項・注意点

Gaussian Splattingを使う際に知っておくべき制限:

| 制限 | 詳細 |
|---|---|
| 座標系の標準がない | ファイルによって上下反転・左右反転する可能性あり |
| GPUメモリ消費 | 大規模なシーンではピーク20GB以上のGPUメモリが必要な場合がある |
| ポップアーティファクト | 視点を急に動かすと、Splatの描画順が追いつかず一瞬ちらつくことがある |
| パーツ数上限 | GPU性能に依存。事前に`GetGaussianSplattingMaxPartCount`で確認が必要 |

---

## まとめ

| 項目 | 内容 |
|---|---|
| Gaussian Splattingとは | 半透明な楕円（ガウス関数）の集合で3Dシーンを表現する手法 |
| 強み | リアルタイム描画、反射/透明の表現が得意、NeRFより圧倒的に高速 |
| Babylon.jsでの使い方 | `ImportMeshAsync`で.splat/.ply/.spzを読み込むだけ |
| データ構造 | 1 Splat = 32バイト（位置+サイズ+色+回転） |
| 応用 | 複数パーツ結合、GPUピッキング、影、シェーダーカスタマイズ |

Gaussian Splattingは、3Dスキャン・VR・ARなどの分野で今後ますます重要になる技術だ。Babylon.jsのおかげでブラウザ上でも手軽に試せるようになっている。ぜひ実際にサンプルファイルを読み込んで、その表現力を体験してみてほしい。

---

## 参考リンク

- [Babylon.js Gaussian Splatting公式ドキュメント](https://doc.babylonjs.com/features/featuresDeepDive/mesh/gaussianSplatting)
- [Babylon.js公式サイト](https://www.babylonjs.com/)
- [3D Gaussian Splatting - Wikipedia](https://en.wikipedia.org/wiki/3D_Gaussian_splatting)
- [3D Gaussian Splatting for Real-Time Radiance Field Rendering（原論文）](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [Lumalabs（Gaussian Splattingのデモ・サービス）](https://lumalabs.ai/)
- [Polycam（スマホで3DGS生成）](https://poly.cam/)
- [antimatter15/splat（ブラウザ用3DGSビューアー）](https://antimatter15.com/splat/)
- [antimatter15/splat GitHub](https://github.com/antimatter15/splat)
