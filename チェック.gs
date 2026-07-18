/**
 * ============================================================
 * nyusatsu-nyan-schema-check-v1.gs (v3)
 * ------------------------------------------------------------
 * 【役割】案件テーブルの実態調査（読み取り専用・書き込み一切なし）
 * 【既存への影響】新規ファイル追加のみ。既存関数・定数は再宣言しない。
 * 【v3での変更点】
 *  ・findCaseIdColumnIndex_() を新設：
 *      完全一致優先（案件ID／案件番号／Project ID）
 *      → 見つからない場合のみ「案件」かつ「ID」を含む列にフォールバック
 *      （旧：indexOf('ID')だけの緩い判定は廃止。仕入先ID等の誤検出を防止）
 *  ・getLatestCaseIds_() を新設：
 *      2行目〜最終行を全読みし、空でない値のみ抽出→末尾maxCount件を返す
 *      （末尾数行が空でも正しく最新の案件IDを拾える。getDisplayValuesで
 *       日付や数値混在のIDでも表示形式のまま安全に取得）
 *  ・lastUpdatedRow → lastDataRow に改名（実態が「最終行番号」であり
 *      「最終更新日時」ではないことを明確化。中身の意味は変更なし）
 * 【v2からの継続】
 *  ・案件マスター/01_案件管理 両存在時の比較表示
 *  ・NYAN_SHEETS.PROJECT の参照確認（未定義でも安全に動く）
 *  ・intakeProject関数の同一プロジェクト内可視性チェック
 * 【安全設計】
 *  ・このファイルはどのセルにも値を書き込まない
 *  ・新規シート作成・列追加・見出し追加は一切行わない
 *  ・既存の定数（CASE_SHEET_NAME等）は再宣言せず、文字列リテラルで独立して調査する
 * ============================================================
 */

const SCHEMA_CHECK_CANDIDATES = ['01_案件管理', '案件マスター', '案件一覧', 'Projects'];

/**
 * 案件ID列を探す。完全一致を優先し、無ければ「案件」＋「ID」を含む列にフォールバック。
 * @param {string[]} headers 見出し行（trim済み文字列配列）
 * @return {number} 列インデックス（0始まり）。見つからなければ -1
 */
function findCaseIdColumnIndex_(headers) {
  const exactCandidates = ['案件ID', '案件番号', 'Project ID'];
  for (const candidate of exactCandidates) {
    const index = headers.findIndex(h => h === candidate);
    if (index >= 0) return index;
  }
  return headers.findIndex(h =>
    h.indexOf('案件') !== -1 && h.toUpperCase().indexOf('ID') !== -1
  );
}

/**
 * 指定シートの案件ID列から、空でない末尾maxCount件を取得する。
 * 末尾数行が空欄でも、遡って正しく最新の実値を拾う。
 * @param {Sheet} sheet
 * @param {number} idColIdx 0始まり列インデックス
 * @param {number} maxCount
 * @return {string[]} 古い→新しい順の案件ID実値
 */
function getLatestCaseIds_(sheet, idColIdx, maxCount) {
  const lastRow = sheet.getLastRow();
  if (idColIdx < 0 || lastRow < 2) return [];
  const values = sheet
    .getRange(2, idColIdx + 1, lastRow - 1, 1)
    .getDisplayValues()
    .map(row => String(row[0]).trim());
  return values
    .filter(value => value)
    .slice(-maxCount);
}

function checkCaseSchema_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheetNames = ss.getSheets().map(s => s.getName());

  const report = {
    allSheetNames: allSheetNames,
    checkedAt: new Date().toISOString(),
    sheets: [],
    nyanSheetsProjectRef: null,   // NYAN_SHEETS.PROJECT の値（あれば）
    intakeProjectVisible: false,  // intakeProject が同一プロジェクトで見えるか
  };

  // ── 各候補シートの基本情報（見出し・最新案件ID） ──────────
  SCHEMA_CHECK_CANDIDATES.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      report.sheets.push({ name: name, exists: false });
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim())
      : [];

    const idColIdx = findCaseIdColumnIndex_(headers);
    const latestIds = getLatestCaseIds_(sheet, idColIdx, 5);

    report.sheets.push({
      name: name,
      exists: true,
      rowCount: lastRow,
      colCount: lastCol,
      headers: headers,
      idColumnGuess: idColIdx >= 0 ? headers[idColIdx] : '(該当する案件ID列が見つからず)',
      latestCaseIds: latestIds,                                   // 古い→新しい順、末尾5件
      lastDataRow: lastRow,                                        // ※最終行番号であり最終更新日時ではない
      lastCaseId: latestIds.length ? latestIds[latestIds.length - 1] : null,
    });
  });

  // ── 両方存在する場合の比較サマリー ─────────────────────
  const caseKanri = report.sheets.find(s => s.name === '01_案件管理' && s.exists);
  const anKenMaster = report.sheets.find(s => s.name === '案件マスター' && s.exists);
  if (caseKanri && anKenMaster) {
    report.comparisonBothExist = {
      note: '両方存在します。lastCaseIdの形式・行数だけで正本を確定せず、目視確認のうえ判断してください。',
      caseKanri: { rowCount: caseKanri.rowCount, lastCaseId: caseKanri.lastCaseId },
      anKenMaster: { rowCount: anKenMaster.rowCount, lastCaseId: anKenMaster.lastCaseId },
    };
  } else {
    report.comparisonBothExist = null;
  }

  // ── NYAN_SHEETS.PROJECT の参照確認（未定義でも例外を出さない） ──
  try {
    if (typeof NYAN_SHEETS !== 'undefined' && NYAN_SHEETS && NYAN_SHEETS.PROJECT) {
      report.nyanSheetsProjectRef = NYAN_SHEETS.PROJECT;
    } else {
      report.nyanSheetsProjectRef = '未検出（NYAN_SHEETS未定義、または同一プロジェクト内にCore2.gsが無い可能性）';
    }
  } catch (e) {
    report.nyanSheetsProjectRef = '参照エラー：' + e.message;
  }

  // ── intakeProject関数の可視性確認 ─────────────────────
  try {
    report.intakeProjectVisible = (typeof intakeProject === 'function');
  } catch (e) {
    report.intakeProjectVisible = false;
  }

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// Webアプリからは呼ばない（今回はエディタ手動実行のみの想定）。
// 将来ボタン化する場合に備えてapi_関数だけ用意しておく（未使用でも害なし）。
function api_checkCaseSchema() {
  try {
    const report = checkCaseSchema_();
    return { success: true, data: report, error: null };
  } catch (e) {
    return { success: false, data: null, error: String(e.message) };
  }
}