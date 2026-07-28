# 仕入先にゃん

独立版「仕入先にゃん」のApps Scriptプロジェクトです。既存の入札にゃんOSとは、`scriptId`、デプロイURL、Script Propertiesを共有しません。

## v0.3.0の範囲

Foundationの設定・接続方式を維持したまま、仕入先調査の入口を提供します。

- Script Propertiesの読取と検証
- `test` / `production`の環境判定
- `SpreadsheetApp.openById()`による明示的な接続
- 共通APIレスポンスと共通エラー処理
- JSON形式のヘルスチェック
- `01_案件管理`から調査対象案件を読み取る一覧・詳細API
- `案件品目DB`を品目SSOTとする複数品目表示
- スマートフォン向け1カラムUI
- 品目名、品目カード、全品目のコピー
- 相棒猫の初回命名と名前変更

会社、問い合わせ、見積、同期、認証UIは未実装です。

## 調査対象案件

`01_案件管理`に`仕入先調査対象`または`調査対象`列が存在する場合は、
TRUEの案件だけを表示します。専用列がない場合は、状態が`検討中`または
`見積中`の案件を表示します。新しい管理シートは作成しません。

品目は`案件品目DB`の有効行だけを読み取り、`case.json`や
`01_案件管理`の先頭品目から複製しません。

## 相棒猫の名前

Phase1では、安全な利用者IDがまだ確定していないため、猫の名前を
ブラウザの`localStorage`へ環境別キーで保存します。案件データ、
案件品目DB、Script Properties、仕入先調査マスターには書き込みません。

この方式では別端末へ名前が同期されません。将来、認証された不変の利用者IDが
利用可能になった時点で、`CatNameStorage`をユーザー設定APIへ差し替えます。

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
    "version": "0.3.0",
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
