# nyusatsu-nyan-app

## Phase3.4 業者見積管理

案件詳細から複数の業者見積を登録・編集・比較し、1件を採用できます。
専用明細シートは `業者見積DB` です。初回書き込み時にDocumentLock内で作成されます。
一覧取得だけではシートや列を変更しません。事前作成する場合は
`setupSupplierEstimateSheet` をApps Scriptエディタから実行します。

消費税率は Apps Script のスクリプトプロパティ
`SUPPLIER_ESTIMATE_TAX_RATE`（0以上1未満の小数、例: `0.10`）で変更できます。
未設定時の既定値は `0.10` です。採用時に適用した税率は見積行へ保存されます。
未採用行の適用税率は空欄とし、採用切替時は旧採用行からも削除します。

税込かつ送料別の場合は、見積金額と送料金額の合計全体を税込額として税抜換算します。

保存payloadでは任意の `idempotencyKey`（または `requestId`）を指定できます。
同じ案件・同じキーの新規登録は重複行を作成しません。未指定時は従来どおり登録します。

Apps Script エディタから `testSupplierEstimatePureFunctions` を実行すると、
税込から税抜への換算、送料込み・送料別・送料未入力、利益・利益率の純粋関数テストを実行できます。

## 将来の「仕入先にゃん」分離

`業者見積DB` は案件IDに加え、任意の `品目ID` と `仕入先ID` を保持できます。
現在の入札にゃんOS画面では仕入先名を入力しますが、保存payloadの `itemId` と
`supplierId` を使えば、独立Webアプリから同じ保存処理を利用できます。

分離後も再利用できる主な処理は次のとおりです。

- `normalizeSupplierEstimate_`：画面やOCR由来payloadの正規化
- `saveSupplierEstimate_`：DocumentLock取得後の見積保存
- `getSupplierEstimateRows_`：案件単位の見積取得
- `calculateSupplierEstimateCost_`：税・送料を含む原価計算
- `buildSupplierEstimateAdoptionPlan_`：採用切替計画
- `getAdoptedSupplierEstimateResult_`：案件・品目単位の採用結果取得

採用結果には案件ID、品目ID、採用見積ID、採用仕入先ID・名称、採用原価、
原価確定状態、納期を含みます。

現時点で入札にゃんOSへ依存するのは、案件詳細DOM、`state.currentCase`、
`google.script.run` のAPI呼出し、および想定入札額を `01_案件管理` から取得する
利益サマリーです。保存・原価計算・採用結果DTOはこれらへ依存しません。
採用排他はPhase3.4互換のため引き続き1案件1件です。品目単位の複数採用への変更は、
独立Webアプリ化の際に行います。
