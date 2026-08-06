# 仕入先にゃん Phase A 現行契約定義

## 固定基準

- Apps Scriptプロジェクト: 仕入先にゃんOS TEST
- Apps Script Version: 12
- Git基準コミット: `321a6a1f9de8eaba3fe939e04aaeb4e74910a6ad`
- 対象: TEST正本10ファイル
- 対象外: Apps Script PROD、PROD Deployment、PROD Spreadsheet

この文書は現行動作を記録するもので、API再設計や新仕様を定義しない。

## 公開API契約

すべてのAPIは原則として次の共通形式を返す。

```javascript
{ success: true, data: value, error: null }
{ success: false, data: null, error: { code: string, message: string } }
```

未知の例外は`INTERNAL_ERROR`へ変換され、内部スタックや接続先IDはレスポンスへ含めない。

| 用途 | 公開関数 | 引数 | 成功時の主な`data` | 利用先 | 書込 |
|---|---|---|---|---|---:|
| 初期コンテキスト | `api_getAppContext()` | なし | application、version、environment、deploymentVersion、preferenceStorage、catName | Script Properties | なし |
| 案件一覧 | `api_listResearchCases(questType)` | クエスト種別、省略可 | cases、total、questCounts、targetRule | `01_案件管理`、`案件品目DB`、進捗、見積DB | なし |
| 案件詳細 | `api_getResearchCaseDetail(caseId)` | 案件ID | case、items、進捗 | `01_案件管理`、`案件品目DB`、進捗 | なし |
| 進捗取得 | 独立公開関数なし | ― | 一覧・詳細API内で品目へ結合 | `仕入先にゃん進捗` | なし |
| 進捗保存 | `api_saveItemProgress(caseId, itemId, contacted, memo, researchStatus)` | 案件ID、品目ID、問い合わせ済み、メモ、状態 | 保存後の進捗 | `仕入先にゃん進捗` | あり |
| 見積一覧 | 独立公開関数なし | ― | `SupplierNyanQuoteService.attachToDetail()`で品目へ結合する内部契約 | `仕入先見積書DB` | なし |
| 見積アップロード | `api_uploadQuoteFile(caseId, itemId, supplierName, fileName, mimeType, base64Data)` | 案件・品目・仕入先・ファイル情報 | 見積ID、Drive URL、登録日時等 | Drive、`仕入先見積書DB` | あり |
| 猫名取得 | `api_getAppContext()` | なし | catName | Script Properties | なし |
| 猫名保存 | `api_saveCatName(name)` | 30文字以内の名前 | catName | Script Properties | あり |
| ヘルスチェック | `api_healthCheck()` | なし | 環境、版、依存先名、checkedAt | 2接続先Spreadsheet | なし |

### 現行契約上の注意

- `api_getResearchCaseDetail()`は現在`SupplierNyanQuoteService.attachToDetail()`を呼ばない。見積一覧結合処理は存在するが公開詳細APIへ未接続である。
- 進捗取得と見積一覧取得に独立した公開APIはない。
- `runSupplierNyanApi_()`に再帰的Dateシリアライズはない。現在の公開データは各サービスで日付を文字列化している。
- `requestId`、`lockVersion`は現行契約に存在しない。
- `ALLOWED_USERS`は必須設定として解析されるが、現行コード内で利用者照合には使われていない。

## 主なエラー

| 領域 | コード例 |
|---|---|
| 設定 | `CONFIG_MISSING`、`CONFIG_INVALID_ENVIRONMENT`、`CONFIG_INVALID_ALLOWED_USERS` |
| Spreadsheet | `SPREADSHEET_OPEN_FAILED`、`SHEET_NOT_FOUND`、`SHEET_HEADER_MISSING` |
| 案件 | `CASE_ID_REQUIRED`、`CASE_NOT_FOUND`、`CASE_NOT_RESEARCH_TARGET` |
| 進捗 | `PROGRESS_KEY_REQUIRED`、`PROGRESS_STATUS_INVALID`、`PROGRESS_LOCK_TIMEOUT` |
| 見積 | `QUOTE_FILE_TYPE_INVALID`、`QUOTE_FILE_SIZE_INVALID`、`QUOTE_UPLOAD_BUSY`、`TEST_ONLY_OPERATION` |

## データ接続定義

値、ID、URL、メールアドレス、トークンはこの文書へ記録しない。

### Script Properties

| キー | 必須 | 用途 |
|---|---:|---|
| `ENVIRONMENT` | 必須 | `test`または`production` |
| `NYUSATSU_SPREADSHEET_ID` | 必須 | 入札にゃんOSデータ接続 |
| `SUPPLIER_RESEARCH_SPREADSHEET_ID` | 必須 | 進捗・見積DB接続 |
| `ALLOWED_USERS` | 必須 | 許可利用者候補。現行では照合未実装 |
| `APP_USER_KEY_HASH` | 任意 | 存在有無のみ取得。認証未実装 |
| `DEPLOYMENT_VERSION` | 任意 | 画面上のDeployment版表示 |
| `SUPPLIER_NYAN_CAT_NAME_TEST` | 動的 | TEST環境の猫名 |
| `SUPPLIER_NYAN_CAT_NAME_PRODUCTION` | 動的 | PROD環境の猫名 |
| `SUPPLIER_NYAN_QUOTE_FOLDER_ID_TEST` | 見積利用時必須 | TEST見積保存先Driveフォルダ |

### Spreadsheetとシート

| 接続 | シート | 役割 |
|---|---|---|
| 入札にゃんOS | `01_案件管理` | 案件基本情報、対象判定 |
| 入札にゃんOS | `案件品目DB` | 複数品目、数量、単位、仕様等 |
| 仕入先調査 | `仕入先にゃん進捗` | 品目別状態、問い合わせメモ |
| 仕入先調査 | `仕入先見積書DB` | 見積メタデータ、Drive URL |

### Apps Script実行設定

- Advanced Service: Drive API v3、シンボル`Drive`
- OAuth Scope: `spreadsheets`、`drive.file`
- Webアプリ実行者: `USER_DEPLOYING`
- アクセス範囲: `MYSELF`
- Runtime: V8
- Timezone: Asia/Tokyo

## 初期化処理の隔離計画

今回は移動・削除・実行しない。

| 現行処理 | 現在位置 | 通常経路からの参照 | 分離先候補 |
|---|---|---|---|
| `__setupSupplierNyanTestData()` | `コード.gs` | UI・公開APIから参照なし | `supplier-nyan-test-fixtures.gs`またはローカルテスト専用fixture |
| `setupSupplierNyanQuoteSheetTest()` | quote service | UI・公開APIから参照なし | `supplier-nyan-test-setup.gs` |
| 進捗シート自動作成 | `saveItemProgress()`内部 | 進捗初回保存時 | 明示的なTESTセットアップ関数／管理者用migration |
| 見積DBシート自動作成 | quote setup | 手動setup時のみ | TESTセットアップ専用ファイル |
| TESTフォルダ自動作成 | quote setup | 手動setup時のみ | TESTセットアップ専用ファイル |

分離時は、`ENVIRONMENT === test`、接続先の許可リスト、明示的な管理者操作の三条件を満たさない限り実行できない構成にする。

## 現状の既知リスク（Phase Aでは修正しない）

1. 同じ見積アップロード要求を再送すると、DriveファイルとDB行が重複する。
2. Drive保存成功後にDB追記が失敗すると孤立ファイルが残る。
3. 進捗保存はLockServiceで直列化するが楽観ロックはなく、最後の保存が勝つ。
4. 見積詳細結合処理は公開案件詳細APIへ未接続。
5. `ALLOWED_USERS`は認可判定に使用されていない。
6. 猫名は利用者単位ではなく環境単位のScript Propertyである。
7. 初期化・fixture関数が通常のApps Scriptプロジェクト内に同居する。
