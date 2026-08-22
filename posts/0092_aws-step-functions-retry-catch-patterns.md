---
id: 92
title: "AWS Step Functions Retry/Catch戦略 — 本番で使えるエラーハンドリングパターン"
tags: [AWS, StepFunctions, エラーハンドリング, 分散システム]
create: "2026-06-27 21:30"
---

## はじめに

AWS Step Functions はステートマシンベースのワークフローオーケストレーションサービスである。分散システムにおいてエラーは避けられないため、適切な Retry/Catch 戦略の設計が信頼性の鍵となる。

本記事では、ASL（Amazon States Language）の Retry/Catch フィールドを体系的に整理し、本番環境で実際に使えるエラーハンドリングパターンを紹介する。

## Retry の設定項目

Retry フィールドは、Task・Parallel・Map ステートで使用可能なリトライポリシーの配列である。

| 項目 | 型 | デフォルト | 説明 |
|:---|:---|:---|:---|
| ErrorEquals | string[] | （必須） | リトライ対象のエラー名リスト |
| IntervalSeconds | integer | 1 | 初回リトライまでの待機秒数 |
| MaxAttempts | integer | 3 | 最大リトライ回数（0でリトライ無効） |
| BackoffRate | float | 2.0 | リトライ間隔の増加倍率 |
| MaxDelaySeconds | integer | なし | リトライ間隔の上限秒数 |
| JitterStrategy | string | NONE | `FULL` を指定するとジッターが追加される |

リトライ間隔の計算式は以下の通りである：

```
delay = min(IntervalSeconds * (BackoffRate ^ (attempt - 1)), MaxDelaySeconds)
```

## Catch の設定項目

Catch フィールドは、すべてのリトライが失敗した後のフォールバック先を定義する。

| 項目 | 型 | 説明 |
|:---|:---|:---|
| ErrorEquals | string[] | キャッチ対象のエラー名リスト |
| Next | string | 遷移先のステート名 |
| ResultPath | string | エラー情報を格納するパス（`$.error` 等） |

`ResultPath` に `$.error` を指定すると、元の入力を保持しつつエラー情報が追加される。`null` を指定すると入力がそのまま次のステートへ渡される。

## エラータイプ一覧

Step Functions が定義する組み込みエラータイプは以下の通りである。

| エラータイプ | 発生条件 |
|:---|:---|
| States.ALL | すべてのエラーにマッチ（ワイルドカード） |
| States.HeartbeatTimeout | HeartbeatSeconds 以内にハートビートが届かなかった |
| States.Timeout | TimeoutSeconds を超過した |
| States.TaskFailed | タスクが失敗を報告した |
| States.Permissions | 実行ロールに必要な権限がない |
| States.ResultPathMatchFailure | ResultPath でマッチするパスがない |
| States.ParameterPathFailure | Parameters のパス参照が解決できない |
| States.BranchFailed | Parallel/Map の分岐が失敗した |
| States.NoChoiceMatched | Choice ステートでどの条件にも合致しなかった |
| States.IntrinsicFailure | 組み込み関数の実行が失敗した |

Lambda 固有のエラーは、Lambda 関数が throw した例外のクラス名がそのままエラー名となる。例えば Python の `ValueError` は `"ValueError"` として Retry/Catch で参照可能である。

## パターン1: 一時的障害のリトライ（外部API呼び出し）

外部 API 呼び出しでは、ネットワークエラーや 5xx 応答など一時的な障害が頻繁に発生する。指数バックオフ + ジッターで安全にリトライする。

```json
{
  "Comment": "External API call with exponential backoff",
  "StartAt": "CallExternalAPI",
  "States": {
    "CallExternalAPI": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:call-external-api",
      "Retry": [
        {
          "ErrorEquals": ["RetryableError", "Lambda.ServiceException", "Lambda.TooManyRequestsException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 5,
          "BackoffRate": 3,
          "MaxDelaySeconds": 60,
          "JitterStrategy": "FULL"
        },
        {
          "ErrorEquals": ["States.Timeout"],
          "IntervalSeconds": 5,
          "MaxAttempts": 2,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "HandleAPIFailure",
          "ResultPath": "$.error"
        }
      ],
      "TimeoutSeconds": 30,
      "End": true
    },
    "HandleAPIFailure": {
      "Type": "Pass",
      "End": true
    }
  }
}
```

ポイント:
- `RetryableError` を Lambda 関数側で明示的に raise することで、リトライ可能なエラーを制御できる
- `MaxDelaySeconds` を設定しないと、BackoffRate=3 の場合、5回目のリトライで 162 秒待つことになる
- `JitterStrategy: "FULL"` により、同時リトライによるサンダリングハード問題を緩和する

## パターン2: 致命的エラーのフォールバック（DLQへ送信）

リトライしても回復しないエラー（バリデーションエラー、認証エラー等）は、Dead Letter Queue（DLQ）に送信して後続処理を止めずに記録する。

```json
{
  "Comment": "Fatal error fallback to DLQ",
  "StartAt": "ProcessOrder",
  "States": {
    "ProcessOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:process-order",
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["ValidationError", "AuthenticationError"],
          "Next": "SendToDLQ",
          "ResultPath": "$.error"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "SendToDLQ",
          "ResultPath": "$.error"
        }
      ],
      "Next": "OrderComplete"
    },
    "SendToDLQ": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "https://sqs.ap-northeast-1.amazonaws.com/123456789012/order-dlq",
        "MessageBody.$": "States.JsonToString($.error)",
        "MessageAttributes": {
          "ErrorType": {
            "DataType": "String",
            "StringValue.$": "$.error.Error"
          }
        }
      },
      "Next": "NotifyFailure"
    },
    "NotifyFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:ap-northeast-1:123456789012:order-failure-notification",
        "Message.$": "States.Format('Order processing failed: {}', $.error.Cause)"
      },
      "End": true
    },
    "OrderComplete": {
      "Type": "Succeed"
    }
  }
}
```

ポイント:
- `ValidationError` 等の致命的エラーはリトライせず即座に Catch する
- Catch の配列は上から順に評価されるため、具体的なエラーを先に、`States.ALL` を最後に配置する
- DLQ 送信後に SNS 通知を行い、運用チームにアラートを上げる

## パターン3: 部分的失敗の補償トランザクション

分散トランザクションで一部が失敗した場合、既に完了した処理をロールバック（補償）する Saga パターンの実装例である。

```json
{
  "Comment": "Saga pattern with compensation",
  "StartAt": "ReserveInventory",
  "States": {
    "ReserveInventory": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:reserve-inventory",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "ReservationFailed",
          "ResultPath": "$.error"
        }
      ],
      "ResultPath": "$.reservation",
      "Next": "ProcessPayment"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:process-payment",
      "Retry": [
        {
          "ErrorEquals": ["PaymentGatewayTimeout"],
          "IntervalSeconds": 5,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "CompensateReservation",
          "ResultPath": "$.error"
        }
      ],
      "ResultPath": "$.payment",
      "Next": "ConfirmShipment"
    },
    "ConfirmShipment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:confirm-shipment",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "CompensatePayment",
          "ResultPath": "$.error"
        }
      ],
      "End": true
    },
    "CompensatePayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:refund-payment",
      "Retry": [
        {
          "ErrorEquals": ["States.ALL"],
          "IntervalSeconds": 5,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "ResultPath": "$.compensation.payment",
      "Next": "CompensateReservation"
    },
    "CompensateReservation": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:release-inventory",
      "Retry": [
        {
          "ErrorEquals": ["States.ALL"],
          "IntervalSeconds": 5,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "ResultPath": "$.compensation.reservation",
      "Next": "SagaFailed"
    },
    "ReservationFailed": {
      "Type": "Fail",
      "Error": "ReservationFailed",
      "Cause": "Failed to reserve inventory"
    },
    "SagaFailed": {
      "Type": "Fail",
      "Error": "SagaFailed",
      "Cause": "Transaction rolled back due to partial failure"
    }
  }
}
```

ポイント:
- 各ステップの Catch が前段の補償処理へ遷移する（逆順にロールバック）
- 補償処理自体にも Retry を設定する（補償の失敗は致命的であるため、MaxAttempts を多めに設定）
- `ResultPath` で各段階の結果を保持し、補償に必要な情報（予約ID、決済ID等）を後続で参照可能にする

## パターン4: タイムアウト制御（HeartbeatSeconds + TimeoutSeconds）

長時間実行タスクでは `TimeoutSeconds` だけでなく `HeartbeatSeconds` を併用することで、タスクの生存確認を行える。

```json
{
  "Comment": "Heartbeat-based timeout control",
  "StartAt": "LongRunningProcess",
  "States": {
    "LongRunningProcess": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:long-process",
        "Payload": {
          "taskToken.$": "$$.Task.Token",
          "input.$": "$"
        }
      },
      "TimeoutSeconds": 3600,
      "HeartbeatSeconds": 300,
      "Retry": [
        {
          "ErrorEquals": ["States.HeartbeatTimeout"],
          "IntervalSeconds": 10,
          "MaxAttempts": 2,
          "BackoffRate": 1
        },
        {
          "ErrorEquals": ["States.Timeout"],
          "MaxAttempts": 0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.HeartbeatTimeout"],
          "Next": "HandleStuckProcess",
          "ResultPath": "$.error"
        },
        {
          "ErrorEquals": ["States.Timeout"],
          "Next": "HandleTimeout",
          "ResultPath": "$.error"
        }
      ],
      "Next": "ProcessComplete"
    },
    "HandleStuckProcess": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:cleanup-stuck-process",
      "Next": "NotifyOperator"
    },
    "HandleTimeout": {
      "Type": "Pass",
      "Result": "Process exceeded maximum duration",
      "Next": "NotifyOperator"
    },
    "NotifyOperator": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:ap-northeast-1:123456789012:ops-alerts",
        "Message": "Long-running process requires attention"
      },
      "End": true
    },
    "ProcessComplete": {
      "Type": "Succeed"
    }
  }
}
```

ポイント:
- `HeartbeatSeconds: 300` により、5分以内にハートビートが届かなければ `States.HeartbeatTimeout` が発生する
- `TimeoutSeconds: 3600` はタスク全体の最大実行時間（1時間）
- `States.HeartbeatTimeout` はリトライ可能（一時的なネットワーク障害の可能性）だが、`States.Timeout` はリトライしない（MaxAttempts: 0）
- `.waitForTaskToken` パターンでは、ワーカー側で `SendTaskHeartbeat` API を定期的に呼び出す必要がある

## パターン5: Map/Parallel ステートでの個別エラーハンドリング

Map ステートで複数アイテムを並列処理する場合、個別のアイテム失敗がバッチ全体を停止させないよう制御する。

```json
{
  "Comment": "Map state with individual error handling",
  "StartAt": "ProcessBatch",
  "States": {
    "ProcessBatch": {
      "Type": "Map",
      "ItemsPath": "$.items",
      "MaxConcurrency": 10,
      "ToleratedFailurePercentage": 20,
      "ItemProcessor": {
        "ProcessorConfig": {
          "Mode": "INLINE"
        },
        "StartAt": "ProcessItem",
        "States": {
          "ProcessItem": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:process-item",
            "Retry": [
              {
                "ErrorEquals": ["Lambda.TooManyRequestsException"],
                "IntervalSeconds": 1,
                "MaxAttempts": 6,
                "BackoffRate": 2
              },
              {
                "ErrorEquals": ["TransientError"],
                "IntervalSeconds": 2,
                "MaxAttempts": 3,
                "BackoffRate": 2
              }
            ],
            "Catch": [
              {
                "ErrorEquals": ["States.ALL"],
                "Next": "MarkItemFailed",
                "ResultPath": "$.error"
              }
            ],
            "Next": "ItemSuccess"
          },
          "MarkItemFailed": {
            "Type": "Pass",
            "Parameters": {
              "status": "FAILED",
              "itemId.$": "$.itemId",
              "error.$": "$.error"
            },
            "End": true
          },
          "ItemSuccess": {
            "Type": "Pass",
            "Parameters": {
              "status": "SUCCESS",
              "itemId.$": "$.itemId"
            },
            "End": true
          }
        }
      },
      "ResultPath": "$.results",
      "Catch": [
        {
          "ErrorEquals": ["States.BranchFailed"],
          "Next": "HandleBatchFailure",
          "ResultPath": "$.batchError"
        }
      ],
      "Next": "AggregateResults"
    },
    "AggregateResults": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:aggregate-results",
      "End": true
    },
    "HandleBatchFailure": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:handle-batch-failure",
      "End": true
    }
  }
}
```

ポイント:
- `ToleratedFailurePercentage: 20` により、20%までの失敗はバッチ全体を失敗させない
- Iterator 内部で Catch → `MarkItemFailed` とすることで、個別アイテムの失敗を結果として記録しつつ Map 全体は継続する
- `MaxConcurrency` でスロットリングを制御し、Lambda の同時実行制限やダウンストリームの負荷を考慮する
- Map 全体の Catch は `States.BranchFailed`（ToleratedFailurePercentage を超えた場合）に対応する

## アンチパターン

### 1. Retry 無限ループ

```json
{
  "Retry": [
    {
      "ErrorEquals": ["States.ALL"],
      "MaxAttempts": 99999,
      "IntervalSeconds": 1,
      "BackoffRate": 1
    }
  ]
}
```

問題点:
- 復旧不可能なエラーでもリトライし続け、実行時間とコストが膨れ上がる
- Standard ワークフローの最大実行期間（1年）まで停止しない

対策: MaxAttempts は現実的な値（3〜6回）に設定し、BackoffRate で間隔を広げ、Catch でフォールバックを必ず定義する。

### 2. Catch なしの放置

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:...",
  "End": true
}
```

問題点:
- リトライ失敗後にステートマシン全体が `FAILED` となり、後続の通知やクリーンアップが実行されない
- エラー原因の情報が Execution History に埋もれる

対策: すべての Task ステートに少なくとも `States.ALL` の Catch を定義する。

### 3. States.ALL のみの Retry

```json
{
  "Retry": [
    {
      "ErrorEquals": ["States.ALL"],
      "IntervalSeconds": 5,
      "MaxAttempts": 3
    }
  ]
}
```

問題点:
- `States.Permissions` のようなリトライしても回復しないエラーまでリトライしてしまう
- エラー種別ごとの最適なリトライ戦略が適用できない

対策: 具体的なエラーを先に定義し、`States.ALL` は最後のフォールバックとして使う。リトライ不要なエラーは `MaxAttempts: 0` で明示的に無効化する。

### 4. ResultPath 未指定での Catch

```json
{
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleError"
    }
  ]
}
```

問題点:
- デフォルトでは `ResultPath: "$"` となり、元の入力が完全にエラー情報で上書きされる
- 後続の補償処理で元のデータ（ID等）を参照できなくなる

対策: `ResultPath: "$.error"` を明示的に指定し、元の入力を保持する。

## デバッグ手順

### Execution Event History の確認

Step Functions コンソールの Execution Details から、各ステートの遷移履歴を確認できる。

確認すべきイベント:
- `TaskStateEntered` — タスク開始時の入力
- `TaskFailed` — エラーの Error/Cause
- `TaskStateExited` — リトライ後の出力
- `ExecutionFailed` — 最終的な失敗理由

CLI での確認:

```bash
aws stepfunctions get-execution-history \
  --execution-arn "arn:aws:states:ap-northeast-1:123456789012:execution:MyStateMachine:exec-id" \
  --query "events[?type=='TaskFailed']" \
  --output json
```

### CloudWatch Logs の活用

Standard / Express ワークフローともにログレベルを設定可能である。

```json
{
  "LoggingConfiguration": {
    "Level": "ALL",
    "IncludeExecutionData": true,
    "Destinations": [
      {
        "CloudWatchLogsLogGroup": {
          "LogGroupArn": "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/states/MyStateMachine:*"
        }
      }
    ]
  }
}
```

CloudWatch Logs Insights でのエラー集計:

```
fields @timestamp, execution_arn, type, details.error, details.cause
| filter type = "TaskFailed"
| stats count(*) as failCount by details.error
| sort failCount desc
```

### X-Ray トレーシング

Step Functions は AWS X-Ray と統合可能であり、Lambda・DynamoDB・SQS 等の下流サービスを含むエンドツーエンドのトレースが取得できる。ステートマシン作成時に `TracingConfiguration.Enabled: true` を設定する。

## まとめ

Step Functions のエラーハンドリング設計で重要な原則をまとめる。

1. エラーを分類する — 一時的（リトライ可能）と致命的（リトライ不可）を明確に区別する
2. 具体的なエラーから定義する — Retry/Catch の配列は具体的なエラーを先に、`States.ALL` を最後に配置する
3. 指数バックオフ + ジッターを使う — `BackoffRate` と `JitterStrategy: "FULL"` を組み合わせてサンダリングハード問題を回避する
4. MaxDelaySeconds で上限を設ける — バックオフが無制限に増大するのを防ぐ
5. 補償処理も堅牢に — Saga パターンの補償処理自体にも十分な Retry を設定する
6. 可観測性を確保する — CloudWatch Logs、X-Ray、Execution History を組み合わせて障害を迅速に特定する
7. すべての Task に Catch を定義する — 未処理エラーによるサイレント失敗を防ぐ
