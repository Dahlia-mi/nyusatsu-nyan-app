# 仕入先にゃん

独立版「仕入先にゃん」のApps Scriptプロジェクトです。既存の入札にゃんOSとは、`scriptId`、デプロイURL、Script Propertiesを共有しません。

## v0.2.0の範囲

このバージョンは土台のみを提供します。

- Script Propertiesの読取と検証
- `test` / `production`の環境判定
- `SpreadsheetApp.openById()`による明示的な接続
- 共通APIレスポンスと共通エラー処理
- JSON形式のヘルスチェック

案件、会社、問い合わせ、見積、同期、認証、HTML画面は未実装です。

## Script Properties

| キー | 必須 | 用途 |
|---|---:|---|
| `ENVIRONMENT` | はい | `test`または`production` |
| `NYUSATSU_SPREADSHEET_ID` | はい | 読取元の入札にゃんOS |
| `SUPPLIER_RESEARCH_SPREADSHEET_ID` | はい | 読み書き対象の仕入先調査マスター |
| `ALLOWED_USERS` | はい | 許可ユーザーのメールアドレス（カンマ区切り） |
| `APP_USER_KEY_HASH` | いいえ | 将来の補助認証用ハッシュ |

値はソースコードへ記述しません。必須設定が不足または不正な場合、APIは失敗レスポンスを返し、スプレッドシートを開きません。

## ヘルスチェック

`api_healthCheck()`は設定を検証し、2つのスプレッドシートへ明示的に接続します。Webアプリの`GET`も同じ結果をJSONで返します。

成功時の形式:

```json
{
  "success": true,
  "data": {
    "application": "supplier-nyan",
    "version": "0.2.0",
    "environment": "test",
    "status": "ok"
  },
  "error": null
}
```

失敗時は内部例外やスプレッドシートIDをレスポンスへ出しません。

## デプロイ前確認

1. 既存の入札にゃんOSとは別のApps Scriptプロジェクトを作成する
2. テスト用スプレッドシート2つを用意する
3. Script Propertiesへテスト環境の値を設定する
4. 匿名アクセスを許可せず、新しいテスト用URLとしてデプロイする
5. ヘルスチェックが`success: true`を返すことを確認する
