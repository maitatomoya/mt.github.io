---
id: 89
title: "macOS launchd 入門 — 定期タスクを自動実行する仕組み"
tags: [macOS, launchd, 自動化, DevOps]
create: "2026-06-26 00:30"
---

## はじめに

macOS で「1時間ごとにスクリプトを実行したい」「ファイルが変更されたら自動でビルドしたい」と思ったとき、Linux の `cron` や `systemd timer` に相当するのが **launchd** である。

本記事では、launchd の基本から実践的な使い方、よくあるハマりポイントまでを整理する。

---

## launchd とは

macOS の PID 1 プロセス。システム起動と同時に立ち上がり、すべてのプロセスの親になる。
Linux での `systemd` + `cron` を1つにまとめたような存在。

### 他 OS との対応表

| macOS | Linux | Windows |
|:---|:---|:---|
| launchd | systemd / cron | タスクスケジューラ |
| plist (XML) | .service / .timer / crontab | XML |
| launchctl | systemctl / crontab -e | schtasks |

---

## plist の配置場所

| パス | 実行タイミング | 権限 | 用途 |
|:---|:---|:---|:---|
| `~/Library/LaunchAgents/` | ユーザーログイン時 | 一般ユーザー | 個人の定期タスク |
| `/Library/LaunchAgents/` | 任意ユーザーログイン時 | 管理者(sudo) | 全ユーザー共通タスク |
| `/Library/LaunchDaemons/` | システム起動時 | 管理者(sudo) | バックグラウンドサービス |

開発者が使うのはほぼ `~/Library/LaunchAgents/` だけ。

---

## plist ファイルの書き方

### 最小構成

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.my-task</string>

    <key>ProgramArguments</key>
    <array>
        <string>/path/to/script.sh</string>
    </array>

    <key>StartInterval</key>
    <integer>3600</integer>
</dict>
</plist>
```

これだけで「1時間ごとにスクリプトを実行する」設定が完成する。

### 主要キーの説明

| キー | 型 | 説明 |
|:---|:---|:---|
| `Label` | string | 一意な識別子（逆ドメイン形式推奨） |
| `ProgramArguments` | array | 実行するコマンド（第1要素が実行ファイル） |
| `StartInterval` | integer | N秒ごとに実行 |
| `StartCalendarInterval` | dict | cron的な時刻指定 |
| `WatchPaths` | array | 指定パスの変更を検知して実行 |
| `RunAtLoad` | boolean | load直後に1回実行するか |
| `StandardOutPath` | string | 標準出力のログファイルパス |
| `StandardErrorPath` | string | 標準エラーのログファイルパス |
| `WorkingDirectory` | string | 実行時のカレントディレクトリ |
| `EnvironmentVariables` | dict | 環境変数の指定 |

---

## トリガー方式の比較

### 1. StartInterval（インターバル実行）

```xml
<key>StartInterval</key>
<integer>1800</integer>  <!-- 30分ごと -->
```

シンプルで最もよく使う。前回実行からN秒後に次を実行。

### 2. StartCalendarInterval（カレンダー指定）

```xml
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
</dict>
```

毎日9:00に実行。crontab の `0 9 * * *` に相当。

使えるキー: `Month`, `Day`, `Weekday`(0=日曜), `Hour`, `Minute`

### 3. WatchPaths（ファイル監視）

```xml
<key>WatchPaths</key>
<array>
    <string>/path/to/watched/directory</string>
</array>
```

指定パスに変更があったら実行。ファイル同期やビルドトリガーに便利。

---

## launchctl コマンド

### 基本操作

```bash
# 登録（自動実行を開始）
launchctl load ~/Library/LaunchAgents/com.example.my-task.plist

# 解除（自動実行を停止）
launchctl unload ~/Library/LaunchAgents/com.example.my-task.plist

# 一覧確認
launchctl list | grep example

# 即座に1回実行（テスト用）
launchctl start com.example.my-task

# 詳細状態確認
launchctl print gui/$(id -u)/com.example.my-task
```

### デバッグ

```bash
# ログを確認
tail -f ~/Library/Logs/my-task.log

# launchdのシステムログ
log show --predicate 'subsystem == "com.apple.launchd"' --last 1h

# 終了ステータス確認（0=成功）
launchctl list | grep my-task
# PID  Status  Label
# -    0       com.example.my-task  ← Status=0 は正常終了
```

---

## 実践例

### 例1: 1時間ごとに Git リポジトリを自動 pull

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.auto-git-pull</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/git</string>
        <string>pull</string>
        <string>--ff-only</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/me/projects/my-repo</string>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>StandardOutPath</key>
    <string>/tmp/auto-pull.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/auto-pull.log</string>
</dict>
</plist>
```

### 例2: ファイル変更を検知してビルド

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.auto-build</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>build</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/me/projects/app</string>
    <key>WatchPaths</key>
    <array>
        <string>/Users/me/projects/app/src</string>
    </array>
</dict>
</plist>
```

### 例3: 毎朝9時にデスクトップ通知

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.morning-reminder</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/osascript</string>
        <string>-e</string>
        <string>display notification "タスクを確認しよう" with title "Morning"</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

---

## よくあるハマりポイント

| 症状 | 原因 | 対策 |
|:---|:---|:---|
| 実行されない | plist が load されていない | `launchctl load` を実行 |
| 実行されない | スクリプトに実行権限がない | `chmod +x script.sh` |
| 実行されない | PATH が通っていない | ProgramArguments にフルパスを使う |
| 環境変数が効かない | launchd は shell を経由しない | `EnvironmentVariables` で明示指定 |
| ログに何も出ない | StandardOutPath が未設定 | ログパスを明示指定する |

### PATH 問題の解決

launchd はログインシェルを経由しないため `.zshrc` の PATH が使えない。

```xml
<!-- 方法1: フルパスを使う（推奨） -->
<key>ProgramArguments</key>
<array>
    <string>/Users/me/.nvm/versions/node/v20.20.1/bin/node</string>
    <string>/path/to/script.js</string>
</array>

<!-- 方法2: 環境変数で渡す -->
<key>EnvironmentVariables</key>
<dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/Users/me/.local/bin</string>
</dict>
```

---

## cron との比較

| | launchd | cron |
|:---|:---|:---|
| macOS での推奨度 | ○（公式推奨） | △（非推奨だが動く） |
| スリープ復帰後の実行 | ○（見逃し分を実行） | ×（スリープ中はスキップ） |
| ファイル監視トリガー | ○ | × |
| 依存関係の記述 | ○（KeepAlive 条件） | × |

macOS ではノートPCのスリープが多いため、launchd の「見逃し実行」機能が特に重要。cron だとスリープ中のジョブが飛ぶ。

---

## まとめ

1. `~/Library/LaunchAgents/` に plist を置く
2. `launchctl load` で登録
3. あとは自動で動く

困ったら `launchctl list | grep ラベル名` で状態確認、ログファイルを `tail` で見る。シンプルだが強力な仕組みなので、開発の自動化に積極的に活用しよう。
