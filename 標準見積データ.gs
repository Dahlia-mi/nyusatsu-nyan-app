/**
 * 入札にゃんOS 標準見積書 Phase 1 / Step 1
 *
 * 標準見積書のデータ正本だけを管理する。Web画面、PDF生成、Drive保存、
 * 01_案件管理への書戻し、既存の指定様式生成には関与しない。
 */

const STANDARD_ESTIMATE_SCHEMA_VERSION = '1.0';
const STANDARD_ESTIMATE_TYPE = 'standard';
const STANDARD_ESTIMATE_LOCK_TIMEOUT_MS = 10000;
const STANDARD_ESTIMATE_MAX_ITEMS = 100;

const STANDARD_ESTIMATE_SHEETS = Object.freeze({
  HEADER: '標準見積ヘッダー',
  ITEM: '標準見積明細',
  PDF_HISTORY: '標準見積PDF履歴',
  COUNTER: '採番管理',
  REQUEST: '標準見積リクエスト履歴',
});

const STANDARD_ESTIMATE_HEADER_HEADERS = Object.freeze([
  '見積ID', '案件ID', '見積書種別', '見積番号', '作成日', '宛先', '件名',
  '提出金額表示', '課税区分', '税率', '端数処理', '小計', '消費税', '合計',
  '提出金額', '納期', '納品場所', '見積有効期限', '備考', '事業者設定ID',
  '事業者情報JSON', '最新PDF URL', '最新PDFファイルID', '最新版番号', '状態',
  'ロックバージョン', '作成者', '更新者', '作成日時', '更新日時', '取消日時', '取消理由'
]);

const STANDARD_ESTIMATE_ITEM_HEADERS = Object.freeze([
  '見積ID', '明細番号', '品名', '仕様・型番', '数量', '単位', '単価', '金額',
  '備考', '状態', '作成日時', '更新日時'
]);

const STANDARD_ESTIMATE_PDF_HISTORY_HEADERS = Object.freeze([
  'PDF履歴ID', '見積ID', '版番号', '見積番号', '案件ID', '生成日時',
  'PDFファイルID', 'PDF URL', 'ファイル名', '保存先フォルダID', 'ページ数',
  '提出金額表示', '課税区分', '小計', '消費税', '合計', '提出金額',
  'スナップショットJSON', 'データハッシュ', '生成経路', '状態', '提出日時',
  '取消日時', 'エラー内容', 'リクエストID'
]);

const STANDARD_ESTIMATE_COUNTER_HEADERS = Object.freeze([
  '採番種別', '年', '現在番号', '更新日時'
]);

const STANDARD_ESTIMATE_REQUEST_HEADERS = Object.freeze([
  'リクエストID', '操作', '対象ID', '入力ハッシュ', '結果JSON', '処理日時'
]);

const STANDARD_ESTIMATE_AMOUNT_DISPLAYS = Object.freeze(['exclusive', 'inclusive']);
const STANDARD_ESTIMATE_TAX_CATEGORIES = Object.freeze(['standard', 'reduced', 'exempt', 'out_of_scope']);
const STANDARD_ESTIMATE_ROUNDING_MODES = Object.freeze(['round', 'floor', 'ceil']);
const STANDARD_ESTIMATE_STATES = Object.freeze(['draft', 'pdf_generated', 'submitted', 'canceled']);

/** Step 1で必要な5シートと列を、不足分だけ追加する。 */
function setupStandardEstimateDataModel() {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateSheet_(ss, STANDARD_ESTIMATE_SHEETS.HEADER, STANDARD_ESTIMATE_HEADER_HEADERS);
    ensureStandardEstimateSheet_(ss, STANDARD_ESTIMATE_SHEETS.ITEM, STANDARD_ESTIMATE_ITEM_HEADERS);
    ensureStandardEstimateSheet_(ss, STANDARD_ESTIMATE_SHEETS.PDF_HISTORY, STANDARD_ESTIMATE_PDF_HISTORY_HEADERS);
    ensureStandardEstimateSheet_(ss, STANDARD_ESTIMATE_SHEETS.COUNTER, STANDARD_ESTIMATE_COUNTER_HEADERS);
    ensureStandardEstimateSheet_(ss, STANDARD_ESTIMATE_SHEETS.REQUEST, STANDARD_ESTIMATE_REQUEST_HEADERS);
    return {
      success: true,
      schemaVersion: STANDARD_ESTIMATE_SCHEMA_VERSION,
      sheets: Object.keys(STANDARD_ESTIMATE_SHEETS).map(function(key) { return STANDARD_ESTIMATE_SHEETS[key]; }),
    };
  });
}

/** 金額をサーバー側の単一ルールで再計算する純粋関数。 */
function calculateStandardEstimateAmounts(input) {
  const source = input || {};
  const display = normalizeStandardEstimateEnum_(source.amountDisplay || source.submittedAmountDisplay, STANDARD_ESTIMATE_AMOUNT_DISPLAYS, '提出金額表示');
  const category = normalizeStandardEstimateEnum_(source.taxCategory, STANDARD_ESTIMATE_TAX_CATEGORIES, '課税区分');
  const roundingMode = normalizeStandardEstimateEnum_(source.roundingMode, STANDARD_ESTIMATE_ROUNDING_MODES, '端数処理');
  const rate = normalizeStandardEstimateTaxRate_(category, source.taxRate);
  const items = normalizeStandardEstimateItems_(source.items || [], roundingMode);
  const subtotal = items.reduce(function(sum, item) { return sum + item.amount; }, 0);
  const taxAmount = category === 'exempt' || category === 'out_of_scope'
    ? 0
    : roundStandardEstimateMoney_(subtotal * rate, roundingMode);
  const total = subtotal + taxAmount;
  return {
    amountDisplay: display,
    taxCategory: category,
    taxRate: rate,
    roundingMode: roundingMode,
    items: items,
    subtotal: subtotal,
    taxAmount: taxAmount,
    total: total,
    submittedAmount: display === 'inclusive' ? total : subtotal,
  };
}

/** 下書き入力を検証・正規化する純粋関数。 */
function validateStandardEstimateDraft(draft) {
  const source = draft || {};
  const caseId = requiredStandardEstimateText_(source.caseId, '案件ID', 100);
  const subject = requiredStandardEstimateText_(source.subject, '件名', 300);
  const addressee = requiredStandardEstimateText_(source.addressee, '宛先', 300);
  const estimateDate = normalizeStandardEstimateDate_(source.estimateDate, '作成日', true);
  const amounts = calculateStandardEstimateAmounts({
    amountDisplay: source.amountDisplay || source.submittedAmountDisplay || 'exclusive',
    taxCategory: source.taxCategory || 'standard',
    taxRate: source.taxRate === undefined || source.taxRate === '' ? 0.10 : source.taxRate,
    roundingMode: source.roundingMode || 'round',
    items: source.items || [],
  });
  return {
    caseId: caseId,
    estimateDate: estimateDate,
    addressee: addressee,
    subject: subject,
    amountDisplay: amounts.amountDisplay,
    taxCategory: amounts.taxCategory,
    taxRate: amounts.taxRate,
    roundingMode: amounts.roundingMode,
    subtotal: amounts.subtotal,
    taxAmount: amounts.taxAmount,
    total: amounts.total,
    submittedAmount: amounts.submittedAmount,
    deliveryDate: optionalStandardEstimateText_(source.deliveryDate, 300),
    deliveryPlace: optionalStandardEstimateText_(source.deliveryPlace, 500),
    validity: optionalStandardEstimateText_(source.validity, 300),
    note: optionalStandardEstimateText_(source.note, 2000),
    businessProfileId: optionalStandardEstimateText_(source.businessProfileId, 100),
    businessSnapshot: normalizeStandardEstimateObject_(source.businessSnapshot, '事業者情報'),
    items: amounts.items,
  };
}

/** 新しい標準見積下書きを作成し、初回採番する。 */
function createStandardEstimateDraft(draft, requestId) {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateModelReady_(ss);
    const normalized = validateStandardEstimateDraft(draft);
    assertStandardEstimateCaseExists_(ss, normalized.caseId);
    const request = beginStandardEstimateRequest_(ss, requestId, 'create-draft', '', normalized);
    if (request.replayed) return request.result;

    const now = new Date();
    const estimateId = Utilities.getUuid();
    const estimateNumber = nextStandardEstimateNumber_(ss, Number(normalized.estimateDate.slice(0, 4)), now);
    const actor = getStandardEstimateActor_();
    const header = buildStandardEstimateHeaderRecord_(estimateId, estimateNumber, normalized, {
      state: 'draft', lockVersion: 1, latestVersion: 0, createdAt: now, updatedAt: now,
      createdBy: actor, updatedBy: actor,
    });
    appendStandardEstimateRecord_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.HEADER), STANDARD_ESTIMATE_HEADER_HEADERS, header);
    replaceStandardEstimateItems_(ss, estimateId, normalized.items, now);
    const result = getStandardEstimateDraftUnlocked_(ss, estimateId);
    finishStandardEstimateRequest_(ss, request, estimateId, result);
    return result;
  });
}

/** 保存済み下書きを楽観ロック付きで更新する。 */
function saveStandardEstimateDraft(estimateId, draft, lockVersion, requestId) {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateModelReady_(ss);
    const id = requiredStandardEstimateText_(estimateId, '見積ID', 100);
    const normalized = validateStandardEstimateDraft(draft);
    const request = beginStandardEstimateRequest_(ss, requestId, 'save-draft', id, {
      lockVersion: lockVersion, draft: normalized,
    });
    if (request.replayed) return request.result;

    const ref = findStandardEstimateHeader_(ss, id);
    assertStandardEstimateLockVersion_(ref.record, lockVersion);
    if (ref.record['状態'] === 'canceled') throw new Error('取消済みの標準見積書は更新できません。');
    if (ref.record['状態'] === 'submitted') throw new Error('提出済みの標準見積書は直接更新できません。改版を作成してください。');
    if (String(ref.record['案件ID']) !== normalized.caseId) throw new Error('案件IDは変更できません。');

    const now = new Date();
    const nextLockVersion = Number(ref.record['ロックバージョン']) + 1;
    const updated = buildStandardEstimateHeaderRecord_(id, ref.record['見積番号'], normalized, {
      state: 'draft',
      lockVersion: nextLockVersion,
      latestVersion: Number(ref.record['最新版番号']) || 0,
      latestPdfUrl: ref.record['最新PDF URL'] || '',
      latestPdfFileId: ref.record['最新PDFファイルID'] || '',
      createdAt: ref.record['作成日時'],
      updatedAt: now,
      createdBy: ref.record['作成者'] || '',
      updatedBy: getStandardEstimateActor_(),
    });
    writeStandardEstimateRecord_(ref.sheet, ref.row, STANDARD_ESTIMATE_HEADER_HEADERS, updated);
    replaceStandardEstimateItems_(ss, id, normalized.items, now);
    const result = getStandardEstimateDraftUnlocked_(ss, id);
    finishStandardEstimateRequest_(ss, request, id, result);
    return result;
  });
}

/** 見積IDから下書き正本とPDF履歴を再取得する。 */
function getStandardEstimateDraft(estimateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStandardEstimateModelReady_(ss);
  return getStandardEstimateDraftUnlocked_(ss, requiredStandardEstimateText_(estimateId, '見積ID', 100));
}

/**
 * Step 1で許可する手動状態遷移。pdf_generatedはPDF成功記録関数だけが設定する。
 * submitted操作は今回の対象外。
 */
function transitionStandardEstimateState(estimateId, targetState, lockVersion, requestId, reason) {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateModelReady_(ss);
    const id = requiredStandardEstimateText_(estimateId, '見積ID', 100);
    const target = normalizeStandardEstimateEnum_(targetState, STANDARD_ESTIMATE_STATES, '状態');
    const request = beginStandardEstimateRequest_(ss, requestId, 'transition-state', id, {
      targetState: target, lockVersion: lockVersion, reason: reason || '',
    });
    if (request.replayed) return request.result;
    const ref = findStandardEstimateHeader_(ss, id);
    assertStandardEstimateLockVersion_(ref.record, lockVersion);
    validateStandardEstimateTransition_(ref.record['状態'], target, false);

    ref.record['状態'] = target;
    ref.record['ロックバージョン'] = Number(ref.record['ロックバージョン']) + 1;
    ref.record['更新者'] = getStandardEstimateActor_();
    ref.record['更新日時'] = new Date();
    if (target === 'canceled') {
      ref.record['取消日時'] = new Date();
      ref.record['取消理由'] = requiredStandardEstimateText_(reason, '取消理由', 1000);
    }
    writeStandardEstimateRecord_(ref.sheet, ref.row, STANDARD_ESTIMATE_HEADER_HEADERS, ref.record);
    const result = getStandardEstimateDraftUnlocked_(ss, id);
    finishStandardEstimateRequest_(ss, request, id, result);
    return result;
  });
}

/**
 * 将来のPDF生成処理が、Drive保存まで成功した後だけ呼ぶ成功記録入口。
 * この関数の呼出し前に失敗した場合、版番号は一切消費されない。
 */
function recordStandardEstimatePdfSuccess(estimateId, pdfRecord, lockVersion, requestId) {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateModelReady_(ss);
    const id = requiredStandardEstimateText_(estimateId, '見積ID', 100);
    const pdf = normalizeStandardEstimatePdfRecord_(pdfRecord);
    const request = beginStandardEstimateRequest_(ss, requestId, 'record-pdf-success', id, {
      lockVersion: lockVersion, dataHash: pdf.dataHash,
    });
    if (request.replayed) return request.result;
    const ref = findStandardEstimateHeader_(ss, id);
    assertStandardEstimateLockVersion_(ref.record, lockVersion);
    if (ref.record['状態'] === 'canceled') throw new Error('取消済みの標準見積書へPDFを記録できません。');
    if (ref.record['状態'] === 'submitted') throw new Error('提出済みの標準見積書へ直接PDFを追加できません。');

    const version = (Number(ref.record['最新版番号']) || 0) + 1;
    const snapshot = pdf.snapshot || getStandardEstimateDraftUnlocked_(ss, id);
    const now = new Date();
    const history = {
      'PDF履歴ID': Utilities.getUuid(), '見積ID': id, '版番号': version,
      '見積番号': ref.record['見積番号'], '案件ID': ref.record['案件ID'], '生成日時': now,
      'PDFファイルID': pdf.fileId, 'PDF URL': pdf.pdfUrl, 'ファイル名': pdf.fileName,
      '保存先フォルダID': pdf.folderId, 'ページ数': pdf.pageCount,
      '提出金額表示': ref.record['提出金額表示'], '課税区分': ref.record['課税区分'],
      '小計': Number(ref.record['小計']), '消費税': Number(ref.record['消費税']),
      '合計': Number(ref.record['合計']), '提出金額': Number(ref.record['提出金額']),
      'スナップショットJSON': JSON.stringify(snapshot),
      'データハッシュ': pdf.dataHash || standardEstimateStableHash_(snapshot),
      '生成経路': pdf.generationSource, '状態': 'generated', '提出日時': '', '取消日時': '',
      'エラー内容': '', 'リクエストID': request.requestId,
    };
    appendStandardEstimateRecord_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.PDF_HISTORY), STANDARD_ESTIMATE_PDF_HISTORY_HEADERS, history);
    ref.record['最新PDF URL'] = pdf.pdfUrl;
    ref.record['最新PDFファイルID'] = pdf.fileId;
    ref.record['最新版番号'] = version;
    ref.record['状態'] = 'pdf_generated';
    ref.record['ロックバージョン'] = Number(ref.record['ロックバージョン']) + 1;
    ref.record['更新者'] = getStandardEstimateActor_();
    ref.record['更新日時'] = now;
    writeStandardEstimateRecord_(ref.sheet, ref.row, STANDARD_ESTIMATE_HEADER_HEADERS, ref.record);
    const result = getStandardEstimateDraftUnlocked_(ss, id);
    finishStandardEstimateRequest_(ss, request, id, result);
    return result;
  });
}

/** PDF生成APIの再送時に、既に確定済みの結果だけを復元する。 */
function getStandardEstimatePdfRequestReplay(estimateId, lockVersion, requestId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStandardEstimateModelReady_(ss);
  const id = requiredStandardEstimateText_(estimateId, '見積ID', 100);
  const requestKey = requiredStandardEstimateText_(requestId, 'リクエストID', 200);
  const request = readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.REQUEST), STANDARD_ESTIMATE_REQUEST_HEADERS)
    .find(function(row) { return String(row['リクエストID']) === requestKey; });
  if (!request) return null;
  if (String(request['操作']) !== 'record-pdf-success' || String(request['対象ID']) !== id) {
    throw new Error('同じリクエストIDが異なる操作または内容で使用されています。');
  }
  const history = listStandardEstimatePdfHistoryUnlocked_(ss, id)
    .filter(function(row) { return String(row['リクエストID']) === requestKey; })
    .pop();
  if (!history) throw new Error('PDF生成の冪等性履歴から結果を復元できません。');
  const expectedHash = standardEstimateStableHash_({ lockVersion: lockVersion, dataHash: String(history['データハッシュ'] || '') });
  if (String(request['入力ハッシュ']) !== expectedHash) {
    throw new Error('同じリクエストIDが異なる操作または内容で使用されています。');
  }
  return { estimate: getStandardEstimateDraftUnlocked_(ss, id), history: history };
}

/** 見積IDに紐づく不変PDF履歴を版順で返す。 */
function listStandardEstimatePdfHistory(estimateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStandardEstimateModelReady_(ss);
  const id = requiredStandardEstimateText_(estimateId, '見積ID', 100);
  return readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.PDF_HISTORY), STANDARD_ESTIMATE_PDF_HISTORY_HEADERS)
    .filter(function(row) { return String(row['見積ID']) === id; })
    .sort(function(a, b) { return Number(a['版番号']) - Number(b['版番号']); });
}

function validateStandardEstimateTransition_(currentState, targetState, fromPdfSuccess) {
  const current = String(currentState || '');
  const target = String(targetState || '');
  if (current === target) return true;
  if (target === 'submitted') throw new Error('提出済み操作はStep 1の対象外です。');
  if (target === 'pdf_generated' && !fromPdfSuccess) throw new Error('PDF生成済みへの遷移はPDF生成成功時だけ許可されます。');
  const allowed = {
    draft: ['canceled'],
    pdf_generated: ['draft', 'canceled'],
    submitted: ['canceled'],
    canceled: [],
  };
  if ((allowed[current] || []).indexOf(target) < 0) {
    throw new Error('状態を「' + current + '」から「' + target + '」へ変更できません。');
  }
  return true;
}

function normalizeStandardEstimateItems_(items, roundingMode) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('見積明細を1件以上入力してください。');
  if (items.length > STANDARD_ESTIMATE_MAX_ITEMS) throw new Error('見積明細は' + STANDARD_ESTIMATE_MAX_ITEMS + '件以内にしてください。');
  return items.map(function(item, index) {
    const source = item || {};
    const quantity = parseStandardEstimateNumber_(source.quantity, '明細' + (index + 1) + 'の数量');
    const unitPrice = parseStandardEstimateNumber_(source.unitPrice, '明細' + (index + 1) + 'の単価');
    if (!(quantity > 0)) throw new Error('明細' + (index + 1) + 'の数量は0より大きい値にしてください。');
    if (unitPrice < 0) throw new Error('明細' + (index + 1) + 'の単価は0以上にしてください。');
    return {
      lineNumber: index + 1,
      name: requiredStandardEstimateText_(source.name, '明細' + (index + 1) + 'の品名', 500),
      specification: optionalStandardEstimateText_(source.specification, 1000),
      quantity: quantity,
      unit: requiredStandardEstimateText_(source.unit, '明細' + (index + 1) + 'の単位', 50),
      unitPrice: unitPrice,
      amount: roundStandardEstimateMoney_(quantity * unitPrice, roundingMode),
      note: optionalStandardEstimateText_(source.note, 1000),
      state: 'active',
    };
  });
}

function normalizeStandardEstimateTaxRate_(category, value) {
  if (category === 'exempt' || category === 'out_of_scope') return 0;
  const rate = parseStandardEstimateNumber_(value, '税率');
  if (rate < 0 || rate > 1) throw new Error('税率は0以上1以下の小数で指定してください。');
  if (category === 'standard' && rate === 0) throw new Error('標準税率には0より大きい税率を指定してください。');
  if (category === 'reduced' && rate === 0) throw new Error('軽減税率には0より大きい税率を指定してください。');
  return rate;
}

function roundStandardEstimateMoney_(value, mode) {
  if (mode === 'floor') return Math.floor(value);
  if (mode === 'ceil') return Math.ceil(value);
  return Math.round(value);
}

function parseStandardEstimateNumber_(value, label) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') throw new Error(label + 'を入力してください。');
  const normalized = typeof value === 'number' ? value : Number(String(value).replace(/[￥¥,\s]/g, ''));
  if (!isFinite(normalized)) throw new Error(label + 'を有効な数値で入力してください。');
  return normalized;
}

function buildStandardEstimateHeaderRecord_(estimateId, estimateNumber, data, meta) {
  return {
    '見積ID': estimateId, '案件ID': data.caseId, '見積書種別': STANDARD_ESTIMATE_TYPE,
    '見積番号': estimateNumber, '作成日': data.estimateDate, '宛先': data.addressee, '件名': data.subject,
    '提出金額表示': data.amountDisplay, '課税区分': data.taxCategory, '税率': data.taxRate,
    '端数処理': data.roundingMode, '小計': data.subtotal, '消費税': data.taxAmount,
    '合計': data.total, '提出金額': data.submittedAmount, '納期': data.deliveryDate,
    '納品場所': data.deliveryPlace, '見積有効期限': data.validity, '備考': data.note,
    '事業者設定ID': data.businessProfileId, '事業者情報JSON': JSON.stringify(data.businessSnapshot || {}),
    '最新PDF URL': meta.latestPdfUrl || '', '最新PDFファイルID': meta.latestPdfFileId || '',
    '最新版番号': meta.latestVersion || 0, '状態': meta.state, 'ロックバージョン': meta.lockVersion,
    '作成者': meta.createdBy || '', '更新者': meta.updatedBy || '', '作成日時': meta.createdAt,
    '更新日時': meta.updatedAt, '取消日時': '', '取消理由': '',
  };
}

function getStandardEstimateDraftUnlocked_(ss, estimateId) {
  const ref = findStandardEstimateHeader_(ss, estimateId);
  const header = ref.record;
  const items = readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.ITEM), STANDARD_ESTIMATE_ITEM_HEADERS)
    .filter(function(row) { return String(row['見積ID']) === estimateId && String(row['状態']) === 'active'; })
    .sort(function(a, b) { return Number(a['明細番号']) - Number(b['明細番号']); })
    .map(function(row) {
      return {
        lineNumber: Number(row['明細番号']), name: String(row['品名'] || ''),
        specification: String(row['仕様・型番'] || ''), quantity: Number(row['数量']),
        unit: String(row['単位'] || ''), unitPrice: Number(row['単価']), amount: Number(row['金額']),
        note: String(row['備考'] || ''), state: String(row['状態'] || ''),
      };
    });
  return {
    schemaVersion: STANDARD_ESTIMATE_SCHEMA_VERSION,
    header: {
      estimateId: String(header['見積ID']), caseId: String(header['案件ID']),
      estimateType: String(header['見積書種別']), estimateNumber: String(header['見積番号']),
      estimateDate: normalizeStandardEstimateStoredDate_(header['作成日']), addressee: String(header['宛先'] || ''),
      subject: String(header['件名'] || ''), amountDisplay: String(header['提出金額表示']),
      taxCategory: String(header['課税区分']), taxRate: Number(header['税率']),
      roundingMode: String(header['端数処理']), subtotal: Number(header['小計']),
      taxAmount: Number(header['消費税']), total: Number(header['合計']),
      submittedAmount: Number(header['提出金額']), deliveryDate: String(header['納期'] || ''),
      deliveryPlace: String(header['納品場所'] || ''), validity: String(header['見積有効期限'] || ''),
      note: String(header['備考'] || ''), businessProfileId: String(header['事業者設定ID'] || ''),
      businessSnapshot: parseStandardEstimateJson_(header['事業者情報JSON'], {}),
      latestPdfUrl: String(header['最新PDF URL'] || ''), latestPdfFileId: String(header['最新PDFファイルID'] || ''),
      latestVersion: Number(header['最新版番号']) || 0, state: String(header['状態']),
      lockVersion: Number(header['ロックバージョン']), createdBy: String(header['作成者'] || ''),
      updatedBy: String(header['更新者'] || ''), createdAt: normalizeStandardEstimateStoredDateTime_(header['作成日時']),
      updatedAt: normalizeStandardEstimateStoredDateTime_(header['更新日時']),
      canceledAt: normalizeStandardEstimateStoredDateTime_(header['取消日時']), cancelReason: String(header['取消理由'] || ''),
    },
    items: items,
    pdfHistory: listStandardEstimatePdfHistoryUnlocked_(ss, estimateId),
  };
}

function replaceStandardEstimateItems_(ss, estimateId, items, now) {
  const sheet = ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.ITEM);
  const map = standardEstimateHeaderMap_(sheet);
  for (let row = sheet.getLastRow(); row >= 2; row--) {
    if (String(sheet.getRange(row, map['見積ID']).getValue()) === estimateId) sheet.deleteRow(row);
  }
  items.forEach(function(item) {
    appendStandardEstimateRecord_(sheet, STANDARD_ESTIMATE_ITEM_HEADERS, {
      '見積ID': estimateId, '明細番号': item.lineNumber, '品名': item.name,
      '仕様・型番': item.specification, '数量': item.quantity, '単位': item.unit,
      '単価': item.unitPrice, '金額': item.amount, '備考': item.note, '状態': 'active',
      '作成日時': now, '更新日時': now,
    });
  });
}

function nextStandardEstimateNumber_(ss, year, now) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('見積番号の採番年が不正です。');
  const sheet = ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.COUNTER);
  const records = readStandardEstimateRecords_(sheet, STANDARD_ESTIMATE_COUNTER_HEADERS);
  const index = records.findIndex(function(row) {
    return String(row['採番種別']) === 'standard_estimate' && Number(row['年']) === year;
  });
  let current;
  if (index < 0) {
    current = 1;
    appendStandardEstimateRecord_(sheet, STANDARD_ESTIMATE_COUNTER_HEADERS, {
      '採番種別': 'standard_estimate', '年': year, '現在番号': current, '更新日時': now,
    });
  } else {
    current = Number(records[index]['現在番号']) + 1;
    const row = index + 2;
    writeStandardEstimateRecord_(sheet, row, STANDARD_ESTIMATE_COUNTER_HEADERS, {
      '採番種別': 'standard_estimate', '年': year, '現在番号': current, '更新日時': now,
    });
  }
  if (current > 9999) throw new Error(year + '年の標準見積番号が上限9999件に達しました。');
  return 'EST-' + year + '-' + String(current).padStart(4, '0');
}

function normalizeStandardEstimatePdfRecord_(value) {
  const source = value || {};
  const pageCount = Number(source.pageCount || 1);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('PDFページ数が不正です。');
  return {
    fileId: requiredStandardEstimateText_(source.fileId, 'PDFファイルID', 300),
    pdfUrl: requiredStandardEstimateText_(source.pdfUrl, 'PDF URL', 2000),
    fileName: requiredStandardEstimateText_(source.fileName, 'PDFファイル名', 500),
    folderId: optionalStandardEstimateText_(source.folderId, 300), pageCount: pageCount,
    generationSource: optionalStandardEstimateText_(source.generationSource || 'standard-pdf', 100),
    dataHash: optionalStandardEstimateText_(source.dataHash, 200),
    snapshot: normalizeStandardEstimateObject_(source.snapshot, 'PDFスナップショット'),
  };
}

function beginStandardEstimateRequest_(ss, requestId, operation, targetId, payload) {
  const id = requiredStandardEstimateText_(requestId, 'リクエストID', 200);
  const hash = standardEstimateStableHash_(payload);
  const rows = readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.REQUEST), STANDARD_ESTIMATE_REQUEST_HEADERS);
  const existing = rows.find(function(row) { return String(row['リクエストID']) === id; });
  if (existing) {
    if (String(existing['操作']) !== operation || String(existing['入力ハッシュ']) !== hash) {
      throw new Error('同じリクエストIDが異なる操作または内容で使用されています。');
    }
    const stored = parseStandardEstimateJson_(existing['結果JSON'], {});
    const storedTargetId = String(existing['対象ID'] || stored.estimateId || '');
    if (!storedTargetId) throw new Error('冪等性履歴から処理対象を復元できません。');
    return { replayed: true, result: getStandardEstimateDraftUnlocked_(ss, storedTargetId) };
  }
  return { replayed: false, requestId: id, operation: operation, targetId: targetId || '', inputHash: hash };
}

function finishStandardEstimateRequest_(ss, request, targetId, result) {
  const responseReference = {
    estimateId: targetId || request.targetId,
    lockVersion: result && result.header ? result.header.lockVersion : '',
    state: result && result.header ? result.header.state : '',
  };
  appendStandardEstimateRecord_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.REQUEST), STANDARD_ESTIMATE_REQUEST_HEADERS, {
    'リクエストID': request.requestId, '操作': request.operation, '対象ID': targetId || request.targetId,
    '入力ハッシュ': request.inputHash, '結果JSON': JSON.stringify(responseReference), '処理日時': new Date(),
  });
}

function withStandardEstimateLock_(callback) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(STANDARD_ESTIMATE_LOCK_TIMEOUT_MS)) {
    throw new Error('標準見積書を別の処理が更新中です。少し待ってから再実行してください。');
  }
  try { return callback(); } finally { lock.releaseLock(); }
}

function assertStandardEstimateLockVersion_(record, expected) {
  const actual = Number(record['ロックバージョン']);
  const requested = Number(expected);
  if (!Number.isInteger(requested) || requested < 1) throw new Error('ロックバージョンが不正です。');
  if (actual !== requested) {
    throw new Error('標準見積書は別の操作で更新されています。再取得してから編集し直してください。' +
      '（要求=' + requested + '、現在=' + actual + '）');
  }
}

function assertStandardEstimateCaseExists_(ss, caseId) {
  const sheet = ss.getSheetByName('01_案件管理');
  if (!sheet) throw new Error('「01_案件管理」シートが見つかりません。');
  const map = standardEstimateHeaderMap_(sheet);
  if (!map['案件ID']) throw new Error('01_案件管理に「案件ID」列が見つかりません。');
  if (sheet.getLastRow() < 2) throw new Error('01_案件管理に案件がありません。');
  const values = sheet.getRange(2, map['案件ID'], sheet.getLastRow() - 1, 1).getDisplayValues();
  const found = values.some(function(row) { return String(row[0]).trim() === caseId; });
  if (!found) throw new Error('案件ID「' + caseId + '」が01_案件管理に見つかりません。');
}

function ensureStandardEstimateModelReady_(ss) {
  Object.keys(STANDARD_ESTIMATE_SHEETS).forEach(function(key) {
    const name = STANDARD_ESTIMATE_SHEETS[key];
    if (!ss.getSheetByName(name)) throw new Error('「' + name + '」が未設定です。setupStandardEstimateDataModel()を実行してください。');
  });
}

function ensureStandardEstimateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function(v) { return String(v || '').trim(); })
    : [];
  headers.forEach(function(header) {
    const count = existing.filter(function(value) { return value === header; }).length;
    if (count > 1) throw new Error(name + 'のヘッダー「' + header + '」が重複しています。');
    if (count === 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function findStandardEstimateHeader_(ss, estimateId) {
  const sheet = ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.HEADER);
  const records = readStandardEstimateRecords_(sheet, STANDARD_ESTIMATE_HEADER_HEADERS);
  const index = records.findIndex(function(row) { return String(row['見積ID']) === estimateId; });
  if (index < 0) throw new Error('見積ID「' + estimateId + '」が見つかりません。');
  return { sheet: sheet, row: index + 2, record: records[index] };
}

function readStandardEstimateRecords_(sheet, headers) {
  if (sheet.getLastRow() < 2) return [];
  const map = standardEstimateHeaderMap_(sheet);
  headers.forEach(function(header) {
    if (!map[header]) throw new Error(sheet.getName() + 'に「' + header + '」列がありません。');
  });
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values.map(function(row) {
    const record = {};
    headers.forEach(function(header) { record[header] = row[map[header] - 1]; });
    return record;
  });
}

function listStandardEstimatePdfHistoryUnlocked_(ss, estimateId) {
  return readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.PDF_HISTORY), STANDARD_ESTIMATE_PDF_HISTORY_HEADERS)
    .filter(function(row) { return String(row['見積ID']) === estimateId; })
    .sort(function(a, b) { return Number(a['版番号']) - Number(b['版番号']); });
}

function appendStandardEstimateRecord_(sheet, headers, record) {
  sheet.appendRow(headers.map(function(header) { return record[header] === undefined ? '' : record[header]; }));
}

function writeStandardEstimateRecord_(sheet, row, headers, record) {
  const map = standardEstimateHeaderMap_(sheet);
  headers.forEach(function(header) {
    if (!map[header]) throw new Error(sheet.getName() + 'に「' + header + '」列がありません。');
    sheet.getRange(row, map[header]).setValue(record[header] === undefined ? '' : record[header]);
  });
}

function standardEstimateHeaderMap_(sheet) {
  const map = {};
  if (sheet.getLastColumn() < 1) return map;
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].forEach(function(value, index) {
    const header = String(value || '').trim();
    if (header && map[header]) throw new Error(sheet.getName() + 'のヘッダー「' + header + '」が重複しています。');
    if (header) map[header] = index + 1;
  });
  return map;
}

function normalizeStandardEstimateEnum_(value, allowed, label) {
  const normalized = String(value == null ? '' : value).trim();
  if (allowed.indexOf(normalized) < 0) throw new Error(label + 'が不正です：' + normalized);
  return normalized;
}

function requiredStandardEstimateText_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(label + 'を入力してください。');
  if (text.length > maxLength) throw new Error(label + 'は' + maxLength + '文字以内にしてください。');
  return text;
}

function optionalStandardEstimateText_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maxLength) throw new Error(maxLength + '文字以内で入力してください。');
  return text;
}

function normalizeStandardEstimateDate_(value, label, required) {
  if ((value === '' || value === null || value === undefined) && !required) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + 'はYYYY-MM-DD形式で入力してください。');
  const parsed = new Date(text + 'T00:00:00');
  if (isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(text.slice(0, 4)) ||
      parsed.getMonth() + 1 !== Number(text.slice(5, 7)) || parsed.getDate() !== Number(text.slice(8, 10))) {
    throw new Error(label + 'が実在しない日付です。');
  }
  return text;
}

function normalizeStandardEstimateObject_(value, label) {
  if (value === '' || value === null || value === undefined) return {};
  if (Object.prototype.toString.call(value) !== '[object Object]') throw new Error(label + 'はオブジェクトで指定してください。');
  return JSON.parse(JSON.stringify(value));
}

function parseStandardEstimateJson_(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch (ignore) { return fallback; }
}

function normalizeStandardEstimateStoredDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value || '');
}

function normalizeStandardEstimateStoredDateTime_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return String(value);
}

function getStandardEstimateActor_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (ignore) { return ''; }
}

function standardEstimateStableHash_(value) {
  const canonical = standardEstimateStableStringify_(value);
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
    return bytes.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function standardEstimateStableStringify_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(standardEstimateStableStringify_).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + standardEstimateStableStringify_(value[key]);
  }).join(',') + '}';
}
