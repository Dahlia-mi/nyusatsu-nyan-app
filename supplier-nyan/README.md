# 仕入先にゃん

既存の「仕入先にゃんOS TEST」を正本とするApps Scriptコードです。TEST用のScript PropertiesとSpreadsheet接続を利用します。

## TEST正本の再現

Phase Aの固定基準はApps Script TEST Version 12です。Gitでは次の対応で
Apps Script上の10ファイルを再現します。

| Apps Script上のファイル | Git上のファイル |
|---|---|
| `appsscript.json` | `supplier-nyan/appsscript.json` |
| `コード.gs` | `supplier-nyan/supplier-nyan-response.gs` |
| `supplier-nyan-config.gs` | 同名 |
| `supplier-nyan-spreadsheet.gs` | 同名 |
| `supplier-nyan-case-service.gs` | 同名 |
| `supplier-nyan-app.gs` | 同名 |
| `supplier-nyan-index.html` | 同名 |
| `supplier-nyan-preference-service.gs` | 同名 |
| `supplier-nyan-cat-assets.html` | 同名 |
| `supplier-nyan-quote-service.gs` | 同名 |

正本との一致は`tests/supplier-nyan-test-source-contract.test.js`に保存した
正規化SHA-256で検証します。改行コードだけは比較前にLFへ正規化します。
分割前のVersion 12 UI原本は
`tests/fixtures/supplier-nyan-test-v12/supplier-nyan-index.html`へ固定し、
現在の`index.html`は同じ画面をincludeで構成します。

現行API、接続設定、初期化処理の契約は
`supplier-nyan/docs/phase-a-current-contracts.md`を参照してください。

## TEST統合版の範囲

Foundationの設定・接続方式を維持したまま、仕入先調査の入口を提供します。

- Script Propertiesの読取と検証
- `test` / `production`の環境判定
- `SpreadsheetApp.openById()`による明示的な接続
- 共通APIレスポンスと共通エラー処理
- JSON形式のヘルスチェック
- `01_案件管理`から調査対象案件を読み取る一覧・詳細API
- `案件品目DB`を品目SSOTとする複数品目表示
- `仕入先にゃん進捗`と`仕入先見積書DB`からのクエスト集計
- Home、絞り込み一覧、案件詳細のスマートフォン向け1カラムUI
- History APIによるブラウザ戻る・再読み込み時の画面復元
- Homeのスクロール位置維持、Safe Area、Reduced Motion対応
- 品目名、品目カード、全品目のコピー
- 相棒猫の初回命名と名前変更

既存の進捗保存、見積アップロード、見積書DB、猫アセット、詳細UIを維持しています。

## 今日のクエスト

クエスト判定は既存列だけを使い、新しい状態値を作りません。

- 見積回答を確認: `仕入先見積書DB`に有効な見積行がある案件
- 新しい仕入先を調査: `仕入先にゃん進捗`に行がない案件
- 見積PDFを確認: 有効な見積行の`AI読取状態`が`確認待ち`の案件

見積PDFの確認待ちを示す正式列が追加された場合は、独自解釈を増やさず
この判定を正式仕様に合わせて更新します。

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

## TEST環境の取扱い

既存の「仕入先にゃんOS TEST」と既存Deploymentを使用します。新しい
Apps Scriptプロジェクト、Deployment、Spreadsheetは作成しません。
Phase AではApps Scriptへの保存やDeployment更新も行いません。

将来TESTへ反映する場合も、接続値をGitへ書かず、既存Script Properties、
アクセス範囲`MYSELF`、Drive Advanced Serviceを維持したうえで、
`api_healthCheck()`が`success: true`を返すことを確認します。
