# 仕入先にゃん Phase B-1 UI境界

## 目的

Home Design Ver.1.4を移植する前に、TEST Version 12の外観とAPI契約を
変えず、Apps Scriptのテンプレートを画面責務ごとに分割する。

## テンプレート構成

```text
supplier-nyan-index.html
├─ supplier-nyan-styles.html
├─ supplier-nyan-navigation.html
├─ supplier-nyan-home.html
├─ supplier-nyan-case-list.html
├─ supplier-nyan-case-detail.html
├─ supplier-nyan-dialogs.html
├─ supplier-nyan-cat-assets.html
└─ supplier-nyan-scripts.html
```

`supplier-nyan-index.html`は構成だけを担当する。各パーツは既存の
`includeSupplierNyanFile_()`で展開される。Apps Scriptの公開API、
`doGet()`、Spreadsheet接続、Drive接続は変更しない。

## 状態管理

`AppContext`を次の名前空間へ分類した。

| 名前空間 | 所有する状態 |
|---|---|
| `data` | 案件一覧、現在案件、クエスト件数 |
| `application` | 猫名、環境、アプリ版、Deployment版 |
| `ui` | トーストタイマー等の表示状態 |
| `pending` | 猫名、進捗、見積の保存中状態 |
| `navigation` | 選択品目、復元した画面状態 |
| `filters` | 選択中クエスト |
| `scroll` | Homeスクロール位置 |

状態値と状態遷移の仕様は変更していない。

## Core境界

ブラウザ側に次の境界を設けた。

```text
UI component
    ↓
CaseService
    ↓
SupplierNyanApi
    ↓
google.script.run
    ↓
既存Apps Script API
```

- `SupplierNyanApi`だけが`google.script.run`を扱う。
- Home、一覧、詳細、進捗、見積は`CaseService`を呼ぶ。
- UIからSpreadsheet、Drive、Apps Script関数名を直接扱わない。
- サーバーAPIの関数名、引数、レスポンス形式は変更しない。

## UI責務

| 責務 | 静的テンプレート | スクリプト内の境界 |
|---|---|---|
| Header・Navigation | `supplier-nyan-navigation.html` | Header/dialog section |
| Home | `supplier-nyan-home.html` | Home component |
| 一覧 | `supplier-nyan-case-list.html` | Case list component |
| 詳細 | `supplier-nyan-case-detail.html` | Case detail component |
| 進捗 | 詳細内の動的HTML | Progress presentation/persistence component |
| 見積 | 詳細内の動的HTML | Quote panel/persistence component |
| 戻る・復元 | entry point | Navigation/History/session section |

Bottom Navigationは現行TESTに存在しないため新規追加していない。
将来は`navigation.html`とNavigation区画だけを置き換える。

## CSS境界

CSSは表示順とカスケードを維持するため、Phase B-1では1ファイルのまま
次の区画へ分類した。

- Base tokens and shared controls
- Header and navigation
- Case list
- Case detail
- Progress panel
- Shared feedback and dialogs
- Home
- Quote panel
- Home quests and filters

Phase B-2では該当区画単位でPages版CSSへ差し替えられる。

## Phase B-2の差し替え面

Home Design Ver.1.4移植時の主な変更対象は次に限定できる。

1. `supplier-nyan-navigation.html`
2. `supplier-nyan-home.html`
3. `supplier-nyan-styles.html`のHeader・Home・Navigation区画
4. `supplier-nyan-scripts.html`のHome描画区画

案件取得、進捗保存、見積アップロード、History APIの契約は変更不要である。
