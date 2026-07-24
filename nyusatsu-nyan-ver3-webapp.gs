/**
 * ============================================================
 * 入札にゃんOS Ver3 — Webアプリモジュール（v1.1）
 * ------------------------------------------------------------
 * ファイル名：nyusatsu-nyan-ver3-webapp.gs
 *
 * 【役割】
 *  スマホから「案件一覧 → 案件詳細 → 見積書生成 → PDFリンク表示」
 *  を実行するためのGAS Webアプリ（HtmlService）のサーバー側。
 *
 * 【重要：既存Ver3との関係】
 *  ・このファイルは nyusatsu-nyan-ver3-estimate.gs と同じ
 *    Apps Scriptプロジェクトに「追加」する。既存ファイルは一切変更しない。
 *  ・GASは全ファイルがグローバルスコープを共有するため、
 *    既存の定数（CASE_SHEET_NAME 等）や関数（generateEstimateForRow_ 等）を
 *    ここで再宣言してはいけない（constの二重宣言はエラーになる）。
 *    → このファイルでは既存の定数・関数をそのまま参照する。
 *
 * 【API設計ルール（Ver3 Web共通契約）】
 *  ・クライアントから呼ぶ関数は api_ プレフィックスで統一
 *  ・返却値は必ず { success: boolean, data: object|null, error: string|null }
 *  ・日付は文字列化してから返す（google.script.runの型崩れ対策）
 *  ・一覧系は必要最小限の列だけ返す（将来の大規模データ対策）
 *
 * 【デプロイ手順（初回のみ）】
 *  1. Apps Scriptエディタで「デプロイ」→「新しいデプロイ」
 *  2. 種類：「ウェブアプリ」
 *  3. 次のユーザーとして実行：「自分」
 *  4. アクセスできるユーザー：「自分のみ」
 *  5. 発行されたURLをスマホで開き、共有→「ホーム画面に追加」でアプリ風に
 *  ※コード更新時は「デプロイを管理」→ 既存デプロイを「編集」→
 *    バージョン「新バージョン」で更新（URLが変わらない）
 * 【更新履歴】
 *  v1.2 2026-07-07 ホーム画面アイコンをdata:URIから実配信URL方式に変更
 *                  （?icon=1 でPNGをBlob配信。iOSの「ホーム画面に追加」で
 *                  data:URIのapple-touch-iconが認識されない問題への対処）
 *  v1.1 2026-07-07 一覧APIの読み方を修正：末尾に空行があると0件になる
 *                  不具合を修正（全行読み→案件IDあり行のみ抽出→新しい順）
 *  v1.0 2026-07-07 初号機
 * ============================================================
 */

// Webアプリ用の追加定数（既存ファイルと名前が被らないよう WEBAPP_ プレフィックス）
const WEBAPP_TITLE = '入札にゃん';
const WEBAPP_HTML_FILE = 'webapp-index'; // HTMLファイル名（.htmlは不要）
const WEBAPP_LIST_LIMIT_DEFAULT = 100;   // 一覧の最大取得件数（初号機は直近100件）
const WEBAPP_STATUS_HEADER = '状態';
const WEBAPP_UPDATED_AT_HEADER = '更新日時';

// ホーム画面アイコン（180x180 PNG、Base64）。差し替える場合はこの1行を丸ごと置き換える。
const WEBAPP_ICON_BASE64 = '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';

// ── エントリーポイント ──────────────────────────────────────

/**
 * WebアプリのGETエントリーポイント。
 * HtmlServiceで1枚のHTML（SPA風）を返す。
 *
 * 【NewData APIとの共存ルーター】
 *  NewData v14系にも doGet（?action=... のJSON API）が存在する。
 *  GASでは1プロジェクトに doGet は1つしか持てないため、
 *  もしこのWebアプリをNewDataと同じプロジェクトに入れる場合は：
 *   1. NewData側の「function doGet(e)」を「function newDataApi_(e)」に改名する
 *   2. すると下のルーターが ?action= 付きリクエストをNewData APIへ流す
 *  別プロジェクトに入れる場合は何もしなくてよい（このままでOK）。
 */
function doGet(e) {
  // ?action=xxx が付いたリクエストは NewData API へ委譲（同居時のみ有効）
  if (e && e.parameter && e.parameter.action && typeof newDataApi_ === 'function') {
    return newDataApi_(e);
  }

  // ?icon=1 はホーム画面アイコン用のPNG配信ルート
  // （data:URIのapple-touch-iconはiOSの「ホーム画面に追加」で認識されないことがあるため、
  //   実URLとして画像を返す方式にしている）
  if (e && e.parameter && e.parameter.icon) {
    return serveIcon_();
  }

  const template = HtmlService.createTemplateFromFile(WEBAPP_HTML_FILE);
  template.iconUrl = ScriptApp.getService().getUrl() + '?icon=1';
  return template.evaluate()
    .setTitle(WEBAPP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ホーム画面アイコン（180x180 PNG）をBlobとして返す */
function serveIcon_() {
  const bytes = Utilities.base64Decode(WEBAPP_ICON_BASE64);
  return Utilities.newBlob(bytes, 'image/png', 'icon.png');
}

// ── 共通：JSON契約ヘルパー ──────────────────────────────────

/** 成功レスポンス */
function apiOk_(data) {
  return { success: true, data: data || null, error: null };
}

/** 失敗レスポンス */
function apiError_(message) {
  return { success: false, data: null, error: String(message) };
}

/** Date/文字列/数値を表示用文字列へ安全に変換（時刻ありなら yyyy/MM/dd HH:mm） */
function toDisplayDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      hasTime ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd'
    );
  }
  return String(value).trim();
}

/** 金額を「36,364」形式の文字列へ（未入力は空文字） */
function toDisplayAmount_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (isNaN(n)) return String(value);
  return n.toLocaleString('ja-JP');
}

// ── 共通：案件行の検索（案件IDベース化の中核） ──────────────

/**
 * 01_案件管理から案件IDで行を探す。
 * 列位置は決め打ちせず、見出し名で解決する（標準ルール）。
 * @return {{sheet, row, headerMap}} 見つからなければ throw
 */
function findCaseRowById_(ss, caseId) {
  const caseSheet = ss.getSheetByName(CASE_SHEET_NAME);
  if (!caseSheet) throw new Error(`「${CASE_SHEET_NAME}」シートが見つからないにゃん。`);

  const headerMap = getHeaderMap_(caseSheet);
  const idCol = headerMap[CASE_HEADERS.CASE_ID];
  if (!idCol) throw new Error(`01_案件管理に「${CASE_HEADERS.CASE_ID}」列が見つからないにゃん。`);

  const lastRow = caseSheet.getLastRow();
  if (lastRow < 2) throw new Error('01_案件管理にデータ行がないにゃん。');

  const target = String(caseId).trim();
  const idValues = caseSheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]).trim() === target) {
      return { sheet: caseSheet, caseSheet: caseSheet, row: i + 2, headerMap: headerMap };
    }
  }
  throw new Error(`案件ID「${caseId}」が01_案件管理に見つからないにゃん。`);
}

/** 指定行から表示用の案件オブジェクトを組み立てる（一覧・詳細共用） */
function buildCaseObject_(caseSheet, headerMap, row) {
  const readCell = (headerName) => {
    const col = headerMap[headerName];
    if (!col) return '';
    return caseSheet.getRange(row, col).getValue();
  };

  const caseId = String(readCell(CASE_HEADERS.CASE_ID)).trim();
  const fallbackCostSummary = {
    caseId: caseId,
    costStatus: 'missing',
    statusSource: '',
    matchedRowCount: 0,
    confirmedRowCount: 0,
    reviewRowCount: 0,
    amountTaxExclusive: null,
    amountTaxInclusive: null,
    taxStatus: 'unknown',
    unknownTaxRowCount: 0,
    warnings: ['原価情報を取得できませんでした'],
  };
  let estimateSummary = {
    schemaVersion: '1.0',
    caseId: caseId,
    summaryStatus: 'incomplete',
    estimate: {
      status: 'unavailable',
      source: CASE_HEADERS.AMOUNT,
      amountTaxExclusive: null,
      amountTaxInclusive: null,
      taxStatus: 'unknown',
    },
    cost: fallbackCostSummary,
    profit: {
      status: 'unavailable',
      basis: 'tax_exclusive',
      amountTaxExclusive: null,
      amountTaxInclusive: null,
      marginRate: null,
      marginPercent: null,
      marginDisplayDecimals: 1,
    },
    warnings: ['見積サマリーを取得できませんでした'],
  };
  try {
    if (typeof calculateEstimateSummary === 'function') {
      estimateSummary = calculateEstimateSummary(caseId);
    }
  } catch (summaryError) {
    Logger.log('estimateSummary warning: ' + summaryError.stack);
  }

  return {
    caseId: caseId,
    caseName: String(readCell(CASE_HEADERS.CASE_NAME)).trim(),
    org: String(readCell(CASE_HEADERS.ORG)).trim(),
    amount: toDisplayAmount_(readCell(CASE_HEADERS.AMOUNT)),
    deadline: toDisplayDate_(readCell(CASE_HEADERS.DEADLINE)),
    pdfUrl: String(readCell(CASE_HEADERS.PDF_LINK) || '').trim(),
    status: String(readCell(WEBAPP_STATUS_HEADER) || '').trim(),
    costSummary: estimateSummary.cost,
    estimateSummary: estimateSummary,
  };
}

// ── API：案件一覧（必要最小限の列だけ返す） ─────────────────

/**
 * 案件一覧を返す。
 * 初号機仕様：
 *  ・下の行（＝新しい案件が下に追記される想定）を優先して最大100件
 *  ・返す列は caseId / caseName / org / deadline / pdfUrl のみ（軽量化）
 * @param {number=} limit 取得件数（省略時100）
 */
function api_listCases(limit) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const caseSheet = ss.getSheetByName(CASE_SHEET_NAME);
    if (!caseSheet) return apiError_(`「${CASE_SHEET_NAME}」シートが見つからないにゃん。`);

    const headerMap = getHeaderMap_(caseSheet);
    const required = [CASE_HEADERS.CASE_ID, CASE_HEADERS.CASE_NAME, CASE_HEADERS.ORG];
    for (const h of required) {
      if (!headerMap[h]) return apiError_(`01_案件管理に「${h}」列が見つからないにゃん。`);
    }

    const lastRow = caseSheet.getLastRow();
    if (lastRow < 2) return apiOk_({ cases: [], total: 0 });

    const max = Math.max(1, Math.min(Number(limit) || WEBAPP_LIST_LIMIT_DEFAULT, 500));

    // 全データ行を一括読み → 案件IDが入っている行だけ抽出 → 新しい順にmax件
    // （末尾に空行・書式だけの行があってもgetLastRow()は大きく返るため、
    //   「下からmax行だけ読む」方式だと全部スキップされて空になる：v1.0の不具合）
    const lastCol = caseSheet.getLastColumn();
    const values = caseSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const col = (name) => (headerMap[name] ? headerMap[name] - 1 : -1);
    const cId = col(CASE_HEADERS.CASE_ID);
    const cName = col(CASE_HEADERS.CASE_NAME);
    const cOrg = col(CASE_HEADERS.ORG);
    const cDeadline = col(CASE_HEADERS.DEADLINE);
    const cPdf = col(CASE_HEADERS.PDF_LINK);
    const cStatus = col(WEBAPP_STATUS_HEADER);

    const cases = [];
    for (let i = values.length - 1; i >= 0 && cases.length < max; i--) { // 下＝新しい順
      const rowVals = values[i];
      const caseId = String(rowVals[cId] || '').trim();
      if (!caseId) continue; // 案件IDが空の行はスキップ
      cases.push({
        caseId: caseId,
        caseName: String(rowVals[cName] || '').trim(),
        org: String(rowVals[cOrg] || '').trim(),
        deadline: cDeadline >= 0 ? toDisplayDate_(rowVals[cDeadline]) : '',
        pdfUrl: cPdf >= 0 ? String(rowVals[cPdf] || '').trim() : '',
        status: cStatus >= 0 ? String(rowVals[cStatus] || '').trim() : '',
      });
    }

    return apiOk_({ cases: cases, total: cases.length });
  } catch (e) {
    return apiError_(e.message);
  }
}

// ── API：案件詳細 ───────────────────────────────────────────

/**
 * 案件IDで1件の詳細を返す。
 * @param {string} caseId
 */
function api_getCaseDetail(caseId) {
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const found = findCaseRowById_(ss, caseId);
    const caseObj = buildCaseObject_(found.sheet, found.headerMap, found.row);
    return apiOk_({ case: caseObj });
  } catch (e) {
    return apiError_(e.message);
  }
}

/**
 * 案件IDを指定し、正本から再計算した現在の見積サマリーを返す。
 * @param {string} caseId
 */
function api_getEstimateSummary(caseId) {
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');
    return apiOk_({ estimateSummary: calculateEstimateSummary(caseId) });
  } catch (e) {
    return apiError_(e.message);
  }
}

/**
 * 案件IDを指定して、01_案件管理の想定入札額(税抜)を更新する。
 * 見積書Ver2は同じ列を正本として参照する。
 * @param {string} caseId
 * @param {number|string} newAmount
 */
function api_updateExpectedBidAmount(caseId, newAmount) {
  let lock = null;
  let lockAcquired = false;
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');

    const normalized = String(newAmount == null ? '' : newAmount)
      .replace(/[￥¥,\s]/g, '');
    if (!/^\d+$/.test(normalized)) {
      return apiError_('想定入札額は1円単位の数字で入力してほしいにゃん。');
    }
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return apiError_('想定入札額は1円以上の有効な金額で入力してほしいにゃん。');
    }

    lock = LockService.getDocumentLock();
    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      return apiError_('ほかの更新処理中にゃん。少し待ってから、もう一度保存してほしいにゃん。');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // ロック待機中に行位置や値が変わる可能性があるため、取得後に必ず検索し直す。
    const found = findCaseRowById_(ss, caseId);
    const amountCol = found.headerMap[CASE_HEADERS.AMOUNT];
    if (!amountCol) {
      return apiError_(`01_案件管理に「${CASE_HEADERS.AMOUNT}」列が見つからないにゃん。`);
    }

    const updatedAtCol = found.headerMap[WEBAPP_UPDATED_AT_HEADER];
    const now = new Date();
    const amountCell = found.sheet.getRange(found.row, amountCol);
    const previousAmount = amountCell.getValue();
    const updatedAtCell = updatedAtCol ? found.sheet.getRange(found.row, updatedAtCol) : null;
    const previousUpdatedAt = updatedAtCell ? updatedAtCell.getValue() : null;

    try {
      amountCell.setValue(amount);
      if (updatedAtCell) updatedAtCell.setValue(now);
    } catch (writeError) {
      try {
        amountCell.setValue(previousAmount);
        if (updatedAtCell) updatedAtCell.setValue(previousUpdatedAt);
      } catch (rollbackError) {}
      throw writeError;
    }

    const refreshedHeaderMap = getHeaderMap_(found.sheet);
    return apiOk_({
      case: buildCaseObject_(found.sheet, refreshedHeaderMap, found.row),
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    return apiError_(e.message);
  } finally {
    if (lockAcquired && lock) lock.releaseLock();
  }
}

function toDisplayDateTime_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

// ── Phase3.4：業者見積管理 ─────────────────────────────────

const SUPPLIER_ESTIMATE_SHEET = '業者見積DB';
const SUPPLIER_ESTIMATE_DEFAULT_TAX_RATE = 0.10;
const SUPPLIER_ESTIMATE_TAX_RATE_PROPERTY = 'SUPPLIER_ESTIMATE_TAX_RATE';
const SUPPLIER_ESTIMATE_HEADERS = [
  '見積ID', '案件ID', '仕入先名', '見積金額', '税区分',
  '送料区分', '送料金額', '納期', 'PDF URL', '備考',
  '採用フラグ', '採用原価(税抜)', '原価確定状態', '適用税率',
  '冪等キー', '登録日時', '更新日時'
];

function getSupplierEstimateTaxRate_() {
  const configured = PropertiesService.getScriptProperties()
    .getProperty(SUPPLIER_ESTIMATE_TAX_RATE_PROPERTY);
  if (configured === null || configured === '') return SUPPLIER_ESTIMATE_DEFAULT_TAX_RATE;
  const rate = Number(configured);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new Error(`${SUPPLIER_ESTIMATE_TAX_RATE_PROPERTY}は0以上1未満の小数で設定してほしいにゃん。`);
  }
  return rate;
}

/**
 * DocumentLock取得後の書き込み処理からだけ呼ぶ。
 * 不足シート・不足列を追加するが、既存列の位置や値は変更しない。
 */
function ensureSupplierEstimateSheetForWrite_(ss) {
  let sheet = ss.getSheetByName(SUPPLIER_ESTIMATE_SHEET);
  if (!sheet) sheet = ss.insertSheet(SUPPLIER_ESTIMATE_SHEET);
  const existing = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map((value) => String(value || '').trim())
    : [];
  SUPPLIER_ESTIMATE_HEADERS.forEach((header) => {
    const matches = existing.filter((value) => value === header).length;
    if (matches > 1) throw new Error(`${SUPPLIER_ESTIMATE_SHEET}の「${header}」列が重複しているにゃん。`);
    if (!matches) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });
  const headerMap = supplierEstimateHeaderMap_(sheet);
  SUPPLIER_ESTIMATE_HEADERS.forEach((header) => {
    sheet.getRange(1, headerMap[header]).setFontWeight('bold').setBackground('#f0f0f0');
  });
  sheet.setFrozenRows(1);
  return sheet;
}

/** 手動初期設定用。通常の一覧取得からは呼ばない。 */
function setupSupplierEstimateSheet() {
  const lock = LockService.getDocumentLock();
  let acquired = false;
  try {
    acquired = lock.tryLock(10000);
    if (!acquired) throw new Error('ほかの更新処理中にゃん。少し待ってから、もう一度初期設定してほしいにゃん。');
    const sheet = ensureSupplierEstimateSheetForWrite_(SpreadsheetApp.getActiveSpreadsheet());
    return { success: true, sheetName: sheet.getName(), headers: SUPPLIER_ESTIMATE_HEADERS.slice() };
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function supplierEstimateHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach((header, index) => {
    const name = String(header || '').trim();
    if (name) map[name] = index + 1;
  });
  SUPPLIER_ESTIMATE_HEADERS.forEach((header) => {
    if (!map[header]) throw new Error(`${SUPPLIER_ESTIMATE_SHEET}に「${header}」列が見つからないにゃん。`);
  });
  return map;
}

function parseSupplierEstimateAmount_(value, required, label) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw new Error(`${label}を入力してほしいにゃん。`);
    return null;
  }
  const normalized = String(value).replace(/[￥¥,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`${label}は0以上の数字で入力してほしいにゃん。`);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label}は0以上の数字で入力してほしいにゃん。`);
  return amount;
}

function validateSupplierEstimateUrl_(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (!isSafeSupplierEstimateUrl_(url)) throw new Error('見積書PDF URLは https:// から始まるURLを入力してほしいにゃん。');
  return url;
}

function isSafeSupplierEstimateUrl_(value) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(value || '').trim());
}

function normalizeSupplierEstimate_(payload) {
  const input = payload || {};
  const supplierName = String(input.supplierName || '').trim();
  if (!supplierName) throw new Error('仕入先名を入力してほしいにゃん。');
  const taxCategory = String(input.taxCategory || '').trim();
  if (['税込', '税抜'].indexOf(taxCategory) === -1) throw new Error('税区分を選んでほしいにゃん。');
  const shippingCategory = String(input.shippingCategory || '').trim();
  if (['送料込み', '送料別', '不明'].indexOf(shippingCategory) === -1) throw new Error('送料区分を選んでほしいにゃん。');
  return {
    estimateId: String(input.estimateId || '').trim(),
    supplierName: supplierName,
    quoteAmount: parseSupplierEstimateAmount_(input.quoteAmount, true, '見積金額'),
    taxCategory: taxCategory,
    shippingCategory: shippingCategory,
    shippingAmount: parseSupplierEstimateAmount_(input.shippingAmount, false, '送料金額'),
    deliveryDate: String(input.deliveryDate || '').trim(),
    pdfUrl: validateSupplierEstimateUrl_(input.pdfUrl),
    note: String(input.note || '').trim(),
    idempotencyKey: String(input.idempotencyKey || input.requestId || '').trim(),
  };
}

function calculateSupplierEstimateCost_(estimate, taxRate) {
  const rate = Number(taxRate);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    return { confirmed: false, amountTaxExclusive: null, warning: '消費税率の設定が不正です' };
  }
  if (!estimate || !Number.isFinite(estimate.quoteAmount) || estimate.quoteAmount < 0) {
    return { confirmed: false, amountTaxExclusive: null, warning: '見積金額が不正です' };
  }
  if (estimate.shippingCategory === '不明') {
    return { confirmed: false, amountTaxExclusive: null, warning: '送料不明のため原価未確定' };
  }
  if (estimate.shippingCategory === '送料別' &&
      (!Number.isFinite(estimate.shippingAmount) || estimate.shippingAmount < 0)) {
    return { confirmed: false, amountTaxExclusive: null, warning: '送料未入力のため原価未確定' };
  }
  const total = estimate.quoteAmount +
    (estimate.shippingCategory === '送料別' ? estimate.shippingAmount : 0);
  // 税込＋送料別では、見積金額と送料金額の合計全体を税込額として税抜換算する。
  const taxExclusive = estimate.taxCategory === '税込'
    ? Math.round(total / (1 + rate))
    : total;
  return { confirmed: true, amountTaxExclusive: taxExclusive, warning: '' };
}

function supplierEstimateRowObject_(row, map, rowNumber) {
  const read = (header) => row[map[header] - 1];
  const shippingRaw = read('送料金額');
  const costRaw = read('採用原価(税抜)');
  const pdfUrlRaw = String(read('PDF URL') || '').trim();
  return {
    rowNumber: rowNumber,
    estimateId: String(read('見積ID') || '').trim(),
    caseId: String(read('案件ID') || '').trim(),
    supplierName: String(read('仕入先名') || '').trim(),
    quoteAmount: Number(read('見積金額')),
    taxCategory: String(read('税区分') || '').trim(),
    shippingCategory: String(read('送料区分') || '').trim(),
    shippingAmount: shippingRaw === '' ? null : Number(shippingRaw),
    deliveryDate: toDisplayDate_(read('納期')),
    pdfUrl: isSafeSupplierEstimateUrl_(pdfUrlRaw) ? pdfUrlRaw : '',
    pdfUrlNeedsReview: Boolean(pdfUrlRaw) && !isSafeSupplierEstimateUrl_(pdfUrlRaw),
    note: String(read('備考') || '').trim(),
    adopted: read('採用フラグ') === true || String(read('採用フラグ')).toUpperCase() === 'TRUE',
    adoptedCostTaxExclusive: costRaw === '' ? null : Number(costRaw),
    costStatus: String(read('原価確定状態') || '').trim(),
    taxRate: Number(read('適用税率')),
    idempotencyKey: String(read('冪等キー') || '').trim(),
    createdAt: toDisplayDateTime_(read('登録日時')),
    updatedAt: toDisplayDateTime_(read('更新日時')),
  };
}

function getSupplierEstimateRows_(sheet, caseId) {
  if (sheet.getLastRow() < 2) return [];
  const map = supplierEstimateHeaderMap_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map((row, index) => supplierEstimateRowObject_(row, map, index + 2))
    .filter((estimate) => estimate.caseId === String(caseId || '').trim())
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function findSupplierEstimate_(sheet, estimateId) {
  const target = String(estimateId || '').trim();
  if (sheet.getLastRow() < 2) return null;
  const map = supplierEstimateHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    const estimate = supplierEstimateRowObject_(values[i], map, i + 2);
    if (estimate.estimateId === target) return estimate;
  }
  return null;
}

function findSupplierEstimateByIdempotencyKey_(sheet, caseId, idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key || sheet.getLastRow() < 2) return null;
  return getSupplierEstimateRows_(sheet, caseId)
    .find((estimate) => estimate.idempotencyKey === key) || null;
}

function buildSupplierEstimateSummary_(caseId, expectedBidValue, estimates) {
  let expected = null;
  const adopted = (estimates || []).filter((estimate) => estimate.adopted);
  const warnings = [];
  try {
    expected = parseSupplierEstimateAmount_(expectedBidValue, false, '想定入札額');
  } catch (e) {
    warnings.push('想定入札額のデータが不正です');
  }
  if (expected === null) warnings.push('想定入札額が未入力です');
  if (expected === 0) warnings.push('想定入札額が0円のため利益率を計算できません');
  if (!adopted.length) warnings.push('採用見積がありません');
  if (adopted.length > 1) warnings.push('採用見積が複数あるため要確認です');
  const selected = adopted.length === 1 ? adopted[0] : null;
  if (selected && selected.costStatus !== '確定') {
    warnings.push(selected.costStatus || '原価未確定');
  }
  const ready = expected !== null && expected > 0 && selected &&
    selected.costStatus === '確定' &&
    Number.isFinite(selected.adoptedCostTaxExclusive);
  const cost = ready ? selected.adoptedCostTaxExclusive : null;
  const profit = ready ? expected - cost : null;
  return {
    status: ready ? 'calculated' : 'incomplete',
    expectedBidTaxExclusive: expected,
    adoptedCostTaxExclusive: cost,
    expectedProfit: profit,
    expectedProfitRate: ready ? Math.round((profit / expected) * 1000) / 10 : null,
    loss: ready && profit < 0,
    warnings: warnings,
  };
}

function buildSupplierEstimateResponse_(ss, caseId) {
  const found = findCaseRowById_(ss, caseId);
  const sheet = ss.getSheetByName(SUPPLIER_ESTIMATE_SHEET);
  const estimates = sheet ? getSupplierEstimateRows_(sheet, caseId) : [];
  const expected = found.sheet.getRange(found.row, found.headerMap[CASE_HEADERS.AMOUNT]).getValue();
  return {
    estimates: estimates,
    summary: buildSupplierEstimateSummary_(caseId, expected, estimates),
  };
}

function api_listSupplierEstimates(caseId) {
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');
    return apiOk_(buildSupplierEstimateResponse_(SpreadsheetApp.getActiveSpreadsheet(), caseId));
  } catch (e) {
    if (String(e.message || '').indexOf(`${SUPPLIER_ESTIMATE_SHEET}に「`) >= 0) {
      return apiError_(`業者見積DBの初期設定が必要にゃん。setupSupplierEstimateSheetを実行してほしいにゃん。（${e.message}）`);
    }
    return apiError_(e.message);
  }
}

function api_saveSupplierEstimate(caseId, payload) {
  let lock = null;
  let acquired = false;
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');
    const normalized = normalizeSupplierEstimate_(payload);
    lock = LockService.getDocumentLock();
    acquired = lock.tryLock(10000);
    if (!acquired) return apiError_('ほかの更新処理中にゃん。少し待ってから、もう一度保存してほしいにゃん。');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    findCaseRowById_(ss, caseId);
    return apiOk_(saveSupplierEstimate_(ss, caseId, normalized));
  } catch (e) {
    return apiError_(e.message);
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

/**
 * Phase3.5 OCRからも再利用する業者見積保存サービス。
 * 呼出元がDocumentLockを取得済みであること。DOMや画面状態には依存しない。
 */
function saveSupplierEstimate_(ss, caseId, normalized) {
  const targetCaseId = String(caseId || '').trim();
  const sheet = ensureSupplierEstimateSheetForWrite_(ss);
  const map = supplierEstimateHeaderMap_(sheet);
  const duplicate = !normalized.estimateId && normalized.idempotencyKey
    ? findSupplierEstimateByIdempotencyKey_(sheet, targetCaseId, normalized.idempotencyKey)
    : null;
  if (duplicate) return buildSupplierEstimateResponse_(ss, targetCaseId);

  const existing = normalized.estimateId ? findSupplierEstimate_(sheet, normalized.estimateId) : null;
  if (normalized.estimateId && (!existing || existing.caseId !== targetCaseId)) {
    throw new Error('編集対象の業者見積が見つからないにゃん。');
  }
  const now = new Date();
  const rowNumber = existing ? existing.rowNumber : sheet.getLastRow() + 1;
  const record = buildSupplierEstimateSaveRecord_(sheet, map, targetCaseId, normalized, existing, now);
  writeSupplierEstimateFields_(sheet, map, rowNumber, record);
  SpreadsheetApp.flush();
  return buildSupplierEstimateResponse_(ss, targetCaseId);
}

function buildSupplierEstimateSaveRecord_(sheet, map, caseId, normalized, existing, now) {
  const record = {
    '見積ID': existing ? existing.estimateId : Utilities.getUuid(),
    '案件ID': caseId,
    '仕入先名': normalized.supplierName,
    '見積金額': normalized.quoteAmount,
    '税区分': normalized.taxCategory,
    '送料区分': normalized.shippingCategory,
    '送料金額': normalized.shippingAmount === null ? '' : normalized.shippingAmount,
    '納期': normalized.deliveryDate,
    'PDF URL': normalized.pdfUrl,
    '備考': normalized.note,
    '採用フラグ': existing ? existing.adopted : false,
    '採用原価(税抜)': '',
    '原価確定状態': '',
    '適用税率': '',
    '冪等キー': normalized.idempotencyKey || (existing ? existing.idempotencyKey : ''),
    '登録日時': existing ? sheet.getRange(existing.rowNumber, map['登録日時']).getValue() : now,
    '更新日時': now,
  };
  if (record['採用フラグ']) {
    const taxRate = getSupplierEstimateTaxRate_();
    const cost = calculateSupplierEstimateCost_(normalized, taxRate);
    record['採用原価(税抜)'] = cost.confirmed ? cost.amountTaxExclusive : '';
    record['原価確定状態'] = cost.confirmed ? '確定' : cost.warning;
    record['適用税率'] = taxRate;
  }
  return record;
}

/** 管理対象列だけを書き、未知列・将来列は一切変更しない。 */
function writeSupplierEstimateFields_(sheet, map, rowNumber, record) {
  Object.keys(record).forEach((header) => {
    if (!map[header]) throw new Error(`${SUPPLIER_ESTIMATE_SHEET}に「${header}」列が見つからないにゃん。`);
    sheet.getRange(rowNumber, map[header]).setValue(record[header]);
  });
}

function api_adoptSupplierEstimate(caseId, estimateId) {
  let lock = null;
  let acquired = false;
  try {
    if (!caseId || !estimateId) return apiError_('案件IDまたは見積IDが指定されていないにゃん。');
    lock = LockService.getDocumentLock();
    acquired = lock.tryLock(10000);
    if (!acquired) return apiError_('ほかの更新処理中にゃん。少し待ってから、もう一度採用してほしいにゃん。');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    findCaseRowById_(ss, caseId);
    const sheet = ensureSupplierEstimateSheetForWrite_(ss);
    const map = supplierEstimateHeaderMap_(sheet);
    const target = findSupplierEstimate_(sheet, estimateId);
    const targetCaseId = String(caseId).trim();
    if (!target || target.caseId !== targetCaseId) return apiError_('採用対象の業者見積が見つからないにゃん。');
    const estimates = getSupplierEstimateRows_(sheet, caseId);
    const taxRate = getSupplierEstimateTaxRate_();
    const plan = buildSupplierEstimateAdoptionPlan_(estimates, estimateId, taxRate, new Date());
    const snapshots = snapshotSupplierEstimateAdoption_(sheet, map, plan);
    try {
      applySupplierEstimateAdoptionPlan_(sheet, map, plan);
      SpreadsheetApp.flush();
      verifySupplierEstimateAdoption_(sheet, targetCaseId, estimateId);
    } catch (writeError) {
      rollbackSupplierEstimateAdoption_(sheet, map, snapshots);
      throw writeError;
    }
    return apiOk_(buildSupplierEstimateResponse_(ss, caseId));
  } catch (e) {
    return apiError_(e.message);
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

const SUPPLIER_ESTIMATE_ADOPTION_COLUMNS = [
  '採用フラグ', '採用原価(税抜)', '原価確定状態', '適用税率', '更新日時'
];

function buildSupplierEstimateAdoptionPlan_(estimates, targetEstimateId, taxRate, now) {
  return estimates.map((estimate) => {
    const adopted = estimate.estimateId === String(targetEstimateId);
    const cost = adopted ? calculateSupplierEstimateCost_(estimate, taxRate) : null;
    return {
      rowNumber: estimate.rowNumber,
      values: {
        '採用フラグ': adopted,
        '採用原価(税抜)': adopted && cost.confirmed ? cost.amountTaxExclusive : '',
        '原価確定状態': adopted ? (cost.confirmed ? '確定' : cost.warning) : '',
        '適用税率': adopted ? taxRate : '',
        '更新日時': now,
      },
    };
  });
}

function snapshotSupplierEstimateAdoption_(sheet, map, plan) {
  return plan.map((item) => ({
    rowNumber: item.rowNumber,
    values: SUPPLIER_ESTIMATE_ADOPTION_COLUMNS.map(
      (header) => sheet.getRange(item.rowNumber, map[header]).getValue()
    ),
  }));
}

function applySupplierEstimateAdoptionPlan_(sheet, map, plan) {
  plan.forEach((item) => writeSupplierEstimateFields_(sheet, map, item.rowNumber, item.values));
}

function rollbackSupplierEstimateAdoption_(sheet, map, snapshots) {
  snapshots.forEach((snapshot) => {
    SUPPLIER_ESTIMATE_ADOPTION_COLUMNS.forEach((header, index) => {
      sheet.getRange(snapshot.rowNumber, map[header]).setValue(snapshot.values[index]);
    });
  });
  SpreadsheetApp.flush();
}

function verifySupplierEstimateAdoption_(sheet, caseId, estimateId) {
  const adopted = getSupplierEstimateRows_(sheet, caseId).filter((estimate) => estimate.adopted);
  if (adopted.length !== 1 || adopted[0].estimateId !== String(estimateId)) {
    throw new Error('採用見積を1件に確定できなかったにゃん。');
  }
}

function testSupplierEstimatePureFunctions() {
  let tested = 0;
  const assert = (condition, message) => {
    tested++;
    if (!condition) throw new Error(`業者見積テスト失敗: ${message}`);
  };
  const base = {
    quoteAmount: 110000, taxCategory: '税込',
    shippingCategory: '送料込み', shippingAmount: null,
  };
  const included = calculateSupplierEstimateCost_(base, 0.10);
  assert(included.confirmed && included.amountTaxExclusive === 100000, '税込・送料込み計算');
  const separate = calculateSupplierEstimateCost_({
    quoteAmount: 100000, taxCategory: '税抜',
    shippingCategory: '送料別', shippingAmount: 5000,
  }, 0.10);
  assert(separate.confirmed && separate.amountTaxExclusive === 105000, '送料別計算');
  const missing = calculateSupplierEstimateCost_({
    quoteAmount: 100000, taxCategory: '税抜',
    shippingCategory: '送料別', shippingAmount: null,
  }, 0.10);
  assert(!missing.confirmed && missing.warning.indexOf('送料未入力') >= 0, '送料未入力は未確定');
  const unknown = calculateSupplierEstimateCost_({
    quoteAmount: 100000, taxCategory: '税抜',
    shippingCategory: '不明', shippingAmount: null,
  }, 0.10);
  assert(!unknown.confirmed, '送料不明は未確定');
  const summary = buildSupplierEstimateSummary_('CASE-1', 235000, [{
    adopted: true, costStatus: '確定', adoptedCostTaxExclusive: 184500,
  }]);
  assert(summary.expectedProfit === 50500, '想定利益');
  assert(summary.expectedProfitRate === 21.5, '想定利益率');
  assert(buildSupplierEstimateSummary_('CASE-1', '', []).status === 'incomplete', '想定入札額・採用見積なし');
  assert(buildSupplierEstimateSummary_('CASE-1', 100000, [
    { adopted: true, costStatus: '確定', adoptedCostTaxExclusive: 50000 },
    { adopted: true, costStatus: '確定', adoptedCostTaxExclusive: 60000 },
  ]).status === 'incomplete', '複数採用は未確定');
  assert(buildSupplierEstimateSummary_('CASE-1', 100000, [{
    adopted: true, costStatus: '確定', adoptedCostTaxExclusive: 120000,
  }]).loss === true, '赤字警告');
  let invalidUrlRejected = false;
  try {
    normalizeSupplierEstimate_({
      supplierName: 'A社', quoteAmount: 1, taxCategory: '税抜',
      shippingCategory: '送料込み', pdfUrl: 'javascript:alert(1)',
    });
  } catch (e) {
    invalidUrlRejected = true;
  }
  assert(invalidUrlRejected, '不正URL拒否');
  assert(isSafeSupplierEstimateUrl_('https://example.com/quote.pdf'), 'HTTPS URL許可');
  ['javascript:alert(1)', 'data:text/html,test', 'http://example.com/a.pdf'].forEach((url) => {
    assert(!isSafeSupplierEstimateUrl_(url), `${url.split(':')[0]} URL拒否`);
  });
  const adoptionPlan = buildSupplierEstimateAdoptionPlan_([
    { rowNumber: 2, estimateId: 'OLD', quoteAmount: 80000, taxCategory: '税抜', shippingCategory: '送料込み', shippingAmount: null },
    { rowNumber: 3, estimateId: 'NEW', quoteAmount: 110000, taxCategory: '税込', shippingCategory: '送料込み', shippingAmount: null },
  ], 'NEW', 0.10, new Date(0));
  assert(adoptionPlan[0].values['適用税率'] === '', '採用解除時の税率クリア');
  assert(adoptionPlan[0].values['採用原価(税抜)'] === '', '採用解除時の原価クリア');
  assert(adoptionPlan[1].values['適用税率'] === 0.10, '採用時の税率保存');
  assert(adoptionPlan[1].values['採用原価(税抜)'] === 100000, '採用時の原価保存');
  const cellValues = {1: '既存管理値', 2: ''};
  const mockSheet = {
    getRange: function(row, column) {
      return { setValue: function(value) { cellValues[column] = value; } };
    }
  };
  writeSupplierEstimateFields_(mockSheet, {'仕入先名': 2}, 2, {'仕入先名': '更新後'});
  assert(cellValues[1] === '既存管理値', '未知列を維持');
  assert(cellValues[2] === '更新後', '管理対象列だけ更新');
  const requestNormalized = normalizeSupplierEstimate_({
    supplierName: 'A社', quoteAmount: 1, taxCategory: '税抜',
    shippingCategory: '送料込み', requestId: 'OCR-REQUEST-1',
  });
  assert(requestNormalized.idempotencyKey === 'OCR-REQUEST-1', 'requestIdを冪等キーとして正規化');
  return { success: true, tested: tested };
}

// ── API：案件状態更新 ────────────────────────────────────────

/**
 * 案件IDを指定して、01_案件管理の状態を許可済みの値へ更新する。
 * @param {string} caseId
 * @param {string} newStatus
 */
function api_updateCaseStatus(caseId, newStatus) {
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');

    const allowedStatuses = [
      '検討中', '見積中', '入札済', '落札',
      '失注', '見送り', '納品完了', '請求済'
    ];
    const status = String(newStatus || '').trim();
    if (allowedStatuses.indexOf(status) === -1) {
      return apiError_('更新できない状態が指定されたにゃん。');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const found = findCaseRowById_(ss, caseId);
    const statusCol = found.headerMap[WEBAPP_STATUS_HEADER];
    if (!statusCol) {
      return apiError_(`01_案件管理に「${WEBAPP_STATUS_HEADER}」列が見つからないにゃん。`);
    }

    const updatedAtCol = found.headerMap[WEBAPP_UPDATED_AT_HEADER];
    const now = new Date();
    const statusCell = found.sheet.getRange(found.row, statusCol);
    const previousStatus = statusCell.getValue();
    const updatedAtCell = updatedAtCol ? found.sheet.getRange(found.row, updatedAtCol) : null;
    const previousUpdatedAt = updatedAtCell ? updatedAtCell.getValue() : null;

    try {
      statusCell.setValue(status);
      if (updatedAtCell) updatedAtCell.setValue(now);
    } catch (writeError) {
      try {
        statusCell.setValue(previousStatus);
        if (updatedAtCell) updatedAtCell.setValue(previousUpdatedAt);
      } catch (rollbackError) {}
      throw writeError;
    }

    return apiOk_({
      caseId: String(caseId).trim(),
      status: status,
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    return apiError_(e.message);
  }
}

// ── API：見積書生成（案件IDベースのラッパー） ────────────────

/**
 * 案件IDを指定して見積書を生成する。
 * 中身は既存Ver3の generateEstimateForRow_() をそのまま呼ぶだけ。
 * （＝スプレッドシートのメニューからでも、Web画面からでも同じロジックが動く）
 * @param {string} caseId
 */
function api_generateEstimate(caseId) {
  try {
    if (!caseId) return apiError_('案件IDが指定されていないにゃん。');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const found = findCaseRowById_(ss, caseId);
    const payload = buildEstimatePayloadV2FromRow_(ss, found.sheet, found.row, 'web-app');
    const result = generateEstimateFromPayload_(payload, {
      ss: ss,
      caseSheet: found.sheet,
      row: found.row,
    });
    const refreshedHeaderMap = getHeaderMap_(found.sheet);
    const caseData = buildCaseObject_(found.sheet, refreshedHeaderMap, found.row);

    return apiOk_({
      caseId: result.caseId,
      org: result.org,
      pdfUrl: result.primaryPdfUrl,
      primaryPdfUrl: result.primaryPdfUrl,
      documents: result.documents,
      caseData: caseData,
    });
  } catch (e) {
    return apiError_(e.message);
  }
}

// ── 動作確認用（エディタから手動実行してログで確認） ─────────

function testWebApi_listCases() {
  const res = api_listCases(10);
  Logger.log(JSON.stringify(res, null, 2));
}

function testWebApi_detailAndGenerate() {
  // 実在する案件IDに書き換えて実行するにゃん（例：2026-007）
  const caseId = '2026-007';
  Logger.log(JSON.stringify(api_getCaseDetail(caseId), null, 2));
  // 見積書生成まで試す場合は次の行のコメントを外す
  // Logger.log(JSON.stringify(api_generateEstimate(caseId), null, 2));
}
