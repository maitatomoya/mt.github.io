---
id: 83
title: "MySQL の tinyint(1) と tinyint は何が違う？— 整数型 display width 非推奨の話"
tags: [MySQL, データベース, DB設計]
create: "2026-04-10 10:00"
---

## はじめに

MySQL のテーブル定義で `tinyint(1)` や `int(11)` のように、整数型にカッコ付きの数値を見たことがあるだろうか。この `(N)` は **display width（表示幅）** と呼ばれるもので、MySQL 8.0.17 以降で非推奨になっている。

本記事では、display width とは何か、なぜ非推奨になったのか、新規テーブル設計ではどうすべきかを整理する。

---

## display width とは

### 基本

整数型の `(N)` は **表示幅のヒント** であり、格納できる値の範囲には一切影響しない。

```sql
tinyint       -- display width 指定なし
tinyint(1)    -- display width = 1
tinyint(3)    -- display width = 3
```

上記はすべて同じ `tinyint` 型（1バイト、-128〜127）であり、格納サイズも値の範囲もまったく同じである。

### ZEROFILL との組み合わせ

display width が効果を持つのは `ZEROFILL` 属性と組み合わせた場合 **のみ** である。

```sql
-- ZEROFILL ありの場合
val tinyint(3) ZEROFILL

-- 値が 5 の場合 → 005 と表示される
-- 値が 42 の場合 → 042 と表示される
```

`ZEROFILL` を使っていなければ、`(N)` は完全に無意味な指定となる。

---

## tinyint(1) と tinyint の違い

結論から言うと、**動作上の違いはない**。

| 項目 | `tinyint` | `tinyint(1)` |
|------|-----------|--------------|
| 格納サイズ | 1バイト | 1バイト |
| 値の範囲 | -128〜127 | -128〜127 |
| UNSIGNED の場合 | 0〜255 | 0〜255 |
| ZEROFILL なしでの違い | なし | なし |

### なぜ tinyint(1) をよく見るのか

MySQL は **BOOLEAN 型を `tinyint(1)` のエイリアス** として扱う。`BOOLEAN` や `BOOL` でカラムを定義すると、内部的に `tinyint(1)` になる。

```sql
-- この2つは同じ意味
status BOOLEAN DEFAULT FALSE
status tinyint(1) DEFAULT 0
```

このため「0/1 のフラグには `tinyint(1)`」という慣習が広まった。しかし `(1)` があっても `0` と `1` 以外の値（例えば `127`）も普通に格納できてしまう。値の制約にはなっていない。

---

## なぜ非推奨になったのか

MySQL 8.0.17 のリリースノートで以下のように記載されている。

> The display width attribute for integer data types is deprecated and will be removed in a future MySQL version.

参考：[MySQL 8.0.17 Release Notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html)

非推奨の理由は主に3つ。

### 1. 誤解を招く

多くの開発者が `(N)` を「格納できる桁数」や「値の範囲の制限」だと誤解している。

```sql
tinyint(1)  -- 「0〜9 の1桁だけ入る」→ 誤解。-128〜127 が入る
int(3)      -- 「0〜999 だけ入る」→ 誤解。約 -21億〜21億 が入る
```

### 2. ZEROFILL なしでは意味がない

display width が効果を持つのは `ZEROFILL` との組み合わせだけだが、ほとんどのテーブルで `ZEROFILL` は使われていない。つまり大半のケースで `(N)` は無意味な記述である。

### 3. ZEROFILL 自体も不要

ゼロ埋めはアプリケーション側で行うべき表示ロジックであり、データ型の責務ではない。MySQL は `LPAD()` 関数などで代替できる。

```sql
-- ZEROFILL の代わりに
SELECT LPAD(val, 3, '0') FROM example;
-- 5 → '005'
```

まとめると「**ほぼ誰も正しく使っていない機能を残しておくと害の方が大きい**」という判断で非推奨となった。

---

## 新規テーブル設計での推奨

### display width を付けない

新しくテーブルを作る場合は、display width なしで定義する。

```sql
-- 推奨
status tinyint NOT NULL DEFAULT 0

-- 非推奨（動作はするが無意味）
status tinyint(1) NOT NULL DEFAULT 0
```

### NOT NULL を意識する

ON/OFF のフラグカラムで `DEFAULT` だけ設定して `NOT NULL` を付け忘れると、明示的に `NULL` を INSERT できてしまう。

```sql
-- NULL が入り得る（意図しない可能性が高い）
status tinyint DEFAULT 0

-- NULL を許容しない（安全）
status tinyint NOT NULL DEFAULT 0
```

### 既存テーブルとの統一性

既存テーブルが `tinyint(1)` で統一されているスキーマでは、無理に変える必要はない。ただし、DB 全体で `tinyint`（display width なし）の方が多い場合は、新規テーブルでは `tinyint` を使う方が自然である。

---

## まとめ

| 項目 | 内容 |
|------|------|
| `tinyint(1)` の `(1)` | display width（表示幅のヒント） |
| 値の範囲への影響 | なし |
| 効果があるケース | `ZEROFILL` との組み合わせのみ |
| 非推奨 | MySQL 8.0.17 以降 |
| 非推奨の理由 | 誤解を招く、ZEROFILL なしでは無意味 |
| 新規テーブルでの推奨 | `tinyint`（display width なし）を使う |

レガシーなスキーマでは `tinyint(1)` が大量に残っているが、新規テーブルでは display width を付けないシンプルな定義にしていくのがよいだろう。

---

## 参考

- [MySQL 8.0.17 Release Notes - Deprecation and Removal Notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html)
- [MySQL 8.0 Reference Manual - Numeric Data Type Syntax](https://dev.mysql.com/doc/refman/8.0/en/numeric-type-syntax.html)
