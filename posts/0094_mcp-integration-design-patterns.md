---
id: 94
title: "MCP統合の設計パターン — AIエージェントと外部サービスを繋ぐアーキテクチャ"
tags: [MCP, AI, アーキテクチャ, 開発環境]
create: "2026-06-27 21:30"
---

## はじめに

AIエージェントが外部サービスやデータソースと連携する際、各ツールごとに独自のインテグレーションを実装するのは非効率である。Model Context Protocol（MCP）は、この問題を解決するために設計されたオープンプロトコルであり、AIモデルと外部システムの間に統一的なインターフェースを提供する。

本記事では、MCPの基本アーキテクチャを整理した上で、実践的な設計パターンを4つ紹介する。

## MCPとは

### 概要と目的

Model Context Protocol（MCP）は、Anthropicが2024年に公開したオープンプロトコルである。LLMアプリケーションが外部のデータソースやツールに接続するための標準化されたインターフェースを定義する。

MCPが解決する課題:

- AIエージェントごとに異なるツール統合の実装が必要だった問題
- コンテキスト情報の取得方法がアプリケーションごとにバラバラだった問題
- セキュリティポリシーの統一的な適用が困難だった問題

### プロトコル仕様の要点

MCPはJSON-RPCベースのプロトコルであり、以下の3つのプリミティブを提供する。

| プリミティブ | 方向 | 説明 |
|:---|:---|:---|
| Tools | Server → Client | モデルが呼び出し可能な関数 |
| Resources | Server → Client | コンテキストとして提供されるデータ |
| Prompts | Server → Client | テンプレート化されたプロンプト |

通信はステートフルなセッションとして管理され、capability negotiationによってクライアントとサーバーが互いの機能を確認してから通信を開始する。

## MCPのアーキテクチャ

MCPは3つのコンポーネントで構成される。

```
┌─────────────────────────────────────────────┐
│                   Host                       │
│  (IDE, AIアシスタント, チャットアプリ等)        │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ Client A│  │ Client B│  │ Client C│    │
│  └────┬────┘  └────┬────┘  └────┬────┘    │
└───────┼─────────────┼─────────────┼─────────┘
        │             │             │
        ▼             ▼             ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Server A │  │ Server B │  │ Server C │
  │ (DB)     │  │ (Slack)  │  │ (GitHub) │
  └──────────┘  └──────────┘  └──────────┘
```

### Host

MCPクライアントを管理するアプリケーション本体である。IDE（VS Code, Cursor等）やAIアシスタントがこれに該当する。Hostは複数のClientインスタンスを生成し、それぞれが独立したServerと1:1で通信する。

### Client

Host内に存在し、特定のServerとのセッションを管理するコンポーネントである。プロトコルのネゴシエーション、メッセージのルーティング、セッションのライフサイクル管理を担う。

### Server

外部サービスやデータソースへのアクセスを提供するプロセスである。Tools、Resources、Promptsを公開し、Clientからのリクエストに応答する。

## Transport層

MCPは複数のトランスポート方式をサポートしている。

### stdio（標準入出力）

ローカルプロセスとの通信に使用する。Hostがサーバープロセスを子プロセスとして起動し、stdin/stdoutでJSON-RPCメッセージを交換する。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "transportType": "stdio"
    }
  }
}
```

特徴:
- セットアップが簡単
- ネットワーク不要
- プロセスのライフサイクルをHostが管理

### HTTP + SSE（Server-Sent Events）

リモートサーバーとの通信に使用する。クライアントからサーバーへはHTTP POST、サーバーからクライアントへはSSEでメッセージを送信する。

```json
{
  "mcpServers": {
    "remote-service": {
      "url": "https://mcp.example.com/sse",
      "transportType": "sse"
    }
  }
}
```

### Streamable HTTP

2025年に追加された新しいトランスポートである。単一のHTTPエンドポイントでリクエスト/レスポンスとストリーミングの両方を処理する。SSEのステートフル性を維持しつつ、ステートレスなリクエストも可能になった。

```json
{
  "mcpServers": {
    "remote-v2": {
      "url": "https://mcp.example.com/mcp",
      "transportType": "streamable-http"
    }
  }
}
```

## MCPサーバーの種類

### ローカル実行型

Hostマシン上でプロセスとして実行されるサーバーである。stdio transportを使用し、ファイルシステムやローカルDBへのアクセスに適する。

メリット:
- ネットワークレイテンシなし
- 認証が不要（OSレベルのアクセス制御で十分）
- オフラインでも動作

デメリット:
- サーバーの更新をクライアント側で管理する必要がある
- マシンリソースを消費する

### リモート型

ネットワーク越しにアクセスするサーバーである。HTTP+SSEまたはStreamable HTTP transportを使用する。

メリット:
- 複数ユーザーでサーバーインスタンスを共有可能
- サーバー側で一元的にアップデート可能
- クライアントマシンのリソースを消費しない

デメリット:
- ネットワーク障害の影響を受ける
- 認証・認可の実装が必要

## 設計パターン1: READ ONLYデータアクセス

データベースやデータウェアハウスに対して、読み取り専用でアクセスするパターンである。

### ユースケース

- PostgreSQLからテーブル定義やサンプルデータを取得
- BigQueryで分析クエリを実行
- Redisのキャッシュ状態を確認

### 設計方針

```
┌──────────┐     ┌────────────────┐     ┌──────────┐
│  Client  │────▶│  MCP Server    │────▶│    DB    │
│          │◀────│ (READ ONLY)    │◀────│          │
└──────────┘     └────────────────┘     └──────────┘
                  - SELECT のみ許可
                  - DDL/DML 禁止
                  - タイムアウト設定
```

### 実装例: PostgreSQL READ ONLYサーバー

```json
{
  "mcpServers": {
    "postgres-readonly": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://readonly_user:${DB_PASSWORD}@localhost:5432/mydb"
      }
    }
  }
}
```

データベース側の設定:

```sql
-- READ ONLY専用ユーザーの作成
CREATE ROLE mcp_readonly WITH LOGIN PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;

-- 今後作成されるテーブルにも自動でSELECT権限を付与
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO mcp_readonly;

-- ステートメントタイムアウトの設定
ALTER ROLE mcp_readonly SET statement_timeout = '30s';
```

### BigQueryの例

```json
{
  "mcpServers": {
    "bigquery": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-bigquery"],
      "env": {
        "GOOGLE_PROJECT_ID": "my-project",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json",
        "BQ_MAX_BYTES_BILLED": "1073741824"
      }
    }
  }
}
```

重要な制約:
- `BQ_MAX_BYTES_BILLED`でスキャン量の上限を設定する
- サービスアカウントには`bigquery.dataViewer`ロールのみ付与する
- 本番データセットへの直接アクセスは避け、ビューを経由させる

## 設計パターン2: 外部API統合

SaaS製品のAPIをMCPサーバー経由で利用するパターンである。

### ユースケース

- Slackへのメッセージ送信・検索
- GitHubのIssue/PR操作
- Jiraチケットの作成・更新

### 設計方針

外部APIとの統合では、スコープの最小化と操作の制限が重要である。

```
┌──────────┐     ┌─────────────────┐     ┌──────────────┐
│  Client  │────▶│   MCP Server    │────▶│  External    │
│          │◀────│                 │◀────│  API         │
└──────────┘     └─────────────────┘     └──────────────┘
                  - スコープ制限
                  - レート制限対応
                  - 監査ログ出力
```

### GitHub統合の設定例

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

トークンに付与するスコープ（最小権限）:

| 操作 | 必要なスコープ |
|:---|:---|
| Issue/PR閲覧 | `repo:read` |
| Issue作成 | `repo:write` |
| コードプッシュ | `repo:write` |
| Discussions閲覧 | `read:discussion` |

### Slack統合の設定例

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_ALLOWED_CHANNELS": "C01234567,C89012345"
      }
    }
  }
}
```

Slack Bot Tokenに付与するスコープ:

```
channels:read
channels:history
chat:write
users:read
```

### レート制限への対処

外部APIにはレート制限が存在するため、MCP Server側で以下の対策を実装する。

```typescript
// レート制限を考慮したリトライロジックの概念
const retryConfig = {
  maxRetries: 3,
  baseDelay: 1000,      // 1秒
  maxDelay: 60000,      // 60秒
  backoffFactor: 2,     // 指数バックオフ
  retryableStatuses: [429, 502, 503]
};
```

## 設計パターン3: ファイルシステム操作

ローカルまたはリモートのファイルシステムにアクセスするパターンである。

### ユースケース

- プロジェクトのソースコード読み取り
- 設定ファイルの生成・編集
- ログファイルの検索・分析

### 設計方針

ファイルシステムアクセスでは、アクセス可能なディレクトリを明示的に制限する。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/developer/projects",
        "/Users/developer/documents"
      ]
    }
  }
}
```

この設定では、引数に指定したディレクトリのみアクセスを許可する。`/etc`や`~/.ssh`のような機密ディレクトリには到達できない。

### アクセス制御の層

```
┌─────────────────────────────────────────┐
│ Layer 1: MCP Server (allowedDirectories) │
├─────────────────────────────────────────┤
│ Layer 2: OS File Permissions (chmod)     │
├─────────────────────────────────────────┤
│ Layer 3: .gitignore / .mcpignore         │
└─────────────────────────────────────────┘
```

`.mcpignore`ファイルで追加のフィルタリングが可能である:

```
# .mcpignore
.env
.env.*
*.pem
*.key
secrets/
node_modules/
```

## 設計パターン4: カスタムツール作成

既存のMCPサーバーでカバーできない要件に対して、独自のMCPサーバーを実装するパターンである。

### ユースケース

- 社内APIとの統合
- 独自のワークフロー自動化
- 複数サービスをまたぐオーケストレーション

### 基本的なサーバー実装（TypeScript）

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "custom-tool-server",
  version: "1.0.0"
});

// ツールの定義
server.tool(
  "search_documents",
  "Search internal documents by keyword",
  {
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results")
  },
  async ({ query, limit }) => {
    const results = await searchDocuments(query, limit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  }
);

// リソースの定義
server.resource(
  "config",
  "config://app",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(getAppConfig())
    }]
  })
);

// サーバー起動
const transport = new StdioServerTransport();
await server.connect(transport);
```

### mcp.json への登録

```json
{
  "mcpServers": {
    "custom-tools": {
      "command": "node",
      "args": ["./mcp-servers/custom-tool-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "https://api.example.com",
        "API_KEY": "${CUSTOM_API_KEY}"
      }
    }
  }
}
```

### Python実装の例

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

app = Server("python-custom-server")

@app.list_tools()
async def list_tools():
    return [
        Tool(
            name="analyze_logs",
            description="Analyze application logs for patterns",
            inputSchema={
                "type": "object",
                "properties": {
                    "log_path": {"type": "string", "description": "Path to log file"},
                    "pattern": {"type": "string", "description": "Regex pattern to search"}
                },
                "required": ["log_path"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "analyze_logs":
        results = analyze_log_file(arguments["log_path"], arguments.get("pattern"))
        return [TextContent(type="text", text=results)]

async def main():
    async with stdio_server() as (read, write):
        await app.run(read, write, app.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## セキュリティ考慮事項

### READ ONLY制約の徹底

データアクセス系のMCPサーバーでは、書き込み操作を物理的に不可能にする設計が望ましい。

| レイヤー | 対策 |
|:---|:---|
| DB接続 | READ ONLYユーザーで接続 |
| SQLパース | SELECT以外を拒否 |
| ORM設定 | ReadReplicaエンドポイントを指定 |
| ネットワーク | 書き込みポートへの接続をブロック |

### トークン管理

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["./server.js"],
      "env": {
        "API_TOKEN": "${ENV_VARIABLE_NAME}"
      }
    }
  }
}
```

ベストプラクティス:
- トークンは環境変数経由で渡す（`${VAR_NAME}`構文）
- mcp.jsonにトークンの値を直書きしない
- `.env`ファイルは`.gitignore`に含める
- トークンの有効期限を短く設定する（可能なら1時間以内）

### スコープ制限

外部サービスのトークンには、MCPサーバーが必要とする最小限のスコープのみ付与する。

```
# 悪い例: 全権限
GITHUB_TOKEN=ghp_xxxx  # repo, admin:org, delete_repo...

# 良い例: 必要最小限
GITHUB_TOKEN=ghp_xxxx  # repo:read, issues:write のみ
```

## mcp.json設定例

### ローカルサーバーの完全な設定例

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
      "transportType": "stdio"
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "${DATABASE_URL}"
      }
    },
    "custom-tools": {
      "command": "node",
      "args": ["./tools/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### リモートサーバーの設定例

```json
{
  "mcpServers": {
    "cloud-db": {
      "url": "https://mcp-db.example.com/mcp",
      "transportType": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    },
    "shared-tools": {
      "url": "https://mcp-tools.example.com/sse",
      "transportType": "sse",
      "headers": {
        "X-API-Key": "${SHARED_TOOLS_API_KEY}"
      }
    }
  }
}
```

### ローカル + リモート混在構成

```json
{
  "mcpServers": {
    "local-fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
      "transportType": "stdio"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "remote-analytics": {
      "url": "https://analytics-mcp.example.com/mcp",
      "transportType": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${ANALYTICS_TOKEN}"
      }
    }
  }
}
```

## 認証パターン

### API Key認証

最もシンプルな認証方式である。個人の開発環境での利用に適する。

```json
{
  "mcpServers": {
    "service": {
      "command": "node",
      "args": ["./server.js"],
      "env": {
        "API_KEY": "${SERVICE_API_KEY}"
      }
    }
  }
}
```

### OAuth 2.0（Authorization Code + PKCE）

ユーザーの権限でリソースにアクセスする場合に使用する。リモートMCPサーバーでの利用が一般的である。

```
┌────────┐     ┌────────────┐     ┌──────────────┐     ┌─────────┐
│  Host  │────▶│ MCP Client │────▶│  MCP Server  │────▶│  OAuth  │
│        │     │            │     │              │     │ Provider│
│        │◀────│            │◀────│              │◀────│         │
└────────┘     └────────────┘     └──────────────┘     └─────────┘
                                   トークン管理
                                   リフレッシュ処理
```

MCPプロトコル仕様では、サーバーがOAuth 2.1に基づいた認証フローを実装できる。クライアントは`Authorization`ヘッダーでアクセストークンを送信する。

### Service Account認証

サーバー間通信やバッチ処理向けである。Google Cloud等のサービスアカウントを使用する。

```json
{
  "mcpServers": {
    "gcp-resources": {
      "command": "node",
      "args": ["./gcp-mcp-server.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "${HOME}/.config/gcloud/service-account.json",
        "GCP_PROJECT_ID": "my-project-id"
      }
    }
  }
}
```

## トラブルシューティング

### トークン期限切れ

症状: `401 Unauthorized`または`403 Forbidden`が返る。

対処:
1. トークンの有効期限を確認する
2. リフレッシュトークンによる自動更新が機能しているか確認する
3. 環境変数の値が最新か確認する

```bash
# GitHub tokenの有効期限確認
curl -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  https://api.github.com/rate_limit

# トークンの再生成が必要な場合
# 各サービスのUI/CLIからトークンを再発行し、環境変数を更新する
```

### 接続エラー

症状: MCPサーバーが起動しない、または接続がタイムアウトする。

対処手順:

```bash
# 1. サーバープロセスが起動しているか確認
ps aux | grep mcp

# 2. stdioサーバーの手動テスト
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | npx -y @modelcontextprotocol/server-filesystem /tmp

# 3. リモートサーバーの疎通確認
curl -v https://mcp.example.com/mcp

# 4. ログの確認（サーバー実装依存）
tail -f /tmp/mcp-server.log
```

### よくある問題と解決策

| 問題 | 原因 | 解決策 |
|:---|:---|:---|
| `ENOENT`エラー | コマンドが見つからない | `npx`のパスを確認、Node.jsバージョンを確認 |
| `ECONNREFUSED` | リモートサーバー停止 | サーバーの稼働状態を確認 |
| タイムアウト | ネットワーク遅延/ファイアウォール | プロキシ設定、VPN接続を確認 |
| `capability not supported` | バージョン不一致 | クライアント/サーバーのMCP SDKバージョンを合わせる |
| メモリ不足 | 大量データの読み込み | ページネーション実装、結果件数の制限 |

## まとめ

MCPは、AIエージェントと外部サービスの統合を標準化するプロトコルである。設計パターンを適切に選択することで、セキュアかつ保守性の高い統合を実現できる。

重要なポイント:
- データアクセスはREAD ONLYを基本とし、書き込みが必要な場合は明示的に許可する
- トークンは環境変数で管理し、最小権限の原則を適用する
- ローカル/リモートの選択はユースケースに応じて判断する
- カスタムサーバーの実装はMCP SDKを使えば比較的容易である

MCPエコシステムは急速に成長しており、公式・コミュニティ製のサーバーが日々追加されている。まずは既存のサーバーを試し、カバーできない要件が出た時点でカスタム実装を検討するのが実践的なアプローチである。
