const fs = require('fs');
const vm = require('vm');
function assert(condition, message) { if (!condition) throw new Error(message); }

class Range {
  constructor(sheet, row, col, rows = 1, cols = 1) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValue() { return this.sheet.data[this.row - 1]?.[this.col - 1] ?? ''; }
  setValue(value) { while (this.sheet.data.length < this.row) this.sheet.data.push([]); this.sheet.data[this.row - 1][this.col - 1] = value; return this; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => this.sheet.data[this.row - 1 + r]?.[this.col - 1 + c] ?? '')); }
  getDisplayValues() { return this.getValues().map(row => row.map(value => String(value ?? ''))); }
}
class Sheet {
  constructor(name, headers, records = []) { this.name = name; this.data = [headers.slice(), ...records.map(record => headers.map(h => record[h] ?? ''))]; }
  getName() { return this.name; } getLastRow() { return this.data.length; } getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
  getRange(row, col, rows, cols) { return new Range(this, row, col, rows, cols); }
  appendRow(row) { this.data.push(row.slice()); } setFrozenRows() {}
}

const context = { console, isFinite, Math, JSON, Date, Object, String, Number, Array, RegExp };
vm.createContext(context);
const source = ['標準見積データ.gs', '標準見積API.gs', '標準見積採用.gs'].map(file => fs.readFileSync(file, 'utf8')).join('\n').replace(/^const /gm, 'var ');
vm.runInContext(source, context);

const caseHeaders = ['案件ID', '見積書PDF', '見積書テンプレートID', '見積書生成状態', '見積書生成経路', ...context.STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS];
const caseRecord = { '案件ID': 'CASE-1', '見積書PDF': 'legacy.pdf', '見積書テンプレートID': 'LEGACY', '見積書生成状態': 'done', '見積書生成経路': 'specified' };
const headerRecord = {
  '見積ID': 'EST-1', '案件ID': 'CASE-1', '見積書種別': 'standard', '見積番号': 'EST-2026-0001', '作成日': '2026-08-04',
  '宛先': 'テスト省 御中', '件名': '物品', '提出金額表示': 'exclusive', '課税区分': 'standard', '税率': .1, '端数処理': 'round',
  '小計': 1000, '消費税': 100, '合計': 1100, '提出金額': 1000, '納期': '2026-09-01', '納品場所': '庁舎', '見積有効期限': '',
  '備考': '', '事業者設定ID': 'BP', '事業者情報JSON': '{}', '最新PDF URL': 'v2.pdf', '最新PDFファイルID': 'F2', '最新版番号': 2,
  '状態': 'pdf_generated', 'ロックバージョン': 3, '作成者': '', '更新者': '', '作成日時': '2026-08-04', '更新日時': '2026-08-04', '取消日時': '', '取消理由': '',
};
const itemRecord = { '見積ID': 'EST-1', '明細番号': 1, '品名': '品', '仕様・型番': '', '数量': 1, '単位': '式', '単価': 1000, '金額': 1000, '備考': '', '状態': 'active', '作成日時': '', '更新日時': '' };
const pdf = version => ({ 'PDF履歴ID': 'H' + version, '見積ID': 'EST-1', '版番号': version, '見積番号': 'EST-2026-0001', '案件ID': 'CASE-1', '生成日時': '',
  'PDFファイルID': 'F' + version, 'PDF URL': 'v' + version + '.pdf', 'ファイル名': 'v' + version + '.pdf', '保存先フォルダID': 'D', 'ページ数': 1,
  '提出金額表示': 'exclusive', '課税区分': 'standard', '小計': 1000, '消費税': 100, '合計': 1100, '提出金額': 1000,
  'スナップショットJSON': '{}', 'データハッシュ': 'HASH' + version, '生成経路': 'standard-web', '状態': 'generated', '提出日時': '', '取消日時': '', 'エラー内容': '', 'リクエストID': 'PDF-' + version });

const sheets = {
  '01_案件管理': new Sheet('01_案件管理', caseHeaders, [caseRecord]),
  [context.STANDARD_ESTIMATE_SHEETS.HEADER]: new Sheet(context.STANDARD_ESTIMATE_SHEETS.HEADER, context.STANDARD_ESTIMATE_HEADER_HEADERS, [headerRecord]),
  [context.STANDARD_ESTIMATE_SHEETS.ITEM]: new Sheet(context.STANDARD_ESTIMATE_SHEETS.ITEM, context.STANDARD_ESTIMATE_ITEM_HEADERS, [itemRecord]),
  [context.STANDARD_ESTIMATE_SHEETS.PDF_HISTORY]: new Sheet(context.STANDARD_ESTIMATE_SHEETS.PDF_HISTORY, context.STANDARD_ESTIMATE_PDF_HISTORY_HEADERS, [pdf(1), pdf(2)]),
  [context.STANDARD_ESTIMATE_SHEETS.COUNTER]: new Sheet(context.STANDARD_ESTIMATE_SHEETS.COUNTER, context.STANDARD_ESTIMATE_COUNTER_HEADERS),
  [context.STANDARD_ESTIMATE_SHEETS.REQUEST]: new Sheet(context.STANDARD_ESTIMATE_SHEETS.REQUEST, context.STANDARD_ESTIMATE_REQUEST_HEADERS),
};
const ss = { getSheetByName(name) { return sheets[name] || null; } };
context.SpreadsheetApp = { getActiveSpreadsheet() { return ss; } };
context.LockService = { getDocumentLock() { return { tryLock() { return true; }, releaseLock() {} }; } };

let response = context.api_attachStandardEstimateToCase('EST-1', 1, 3, 'ATTACH-1');
assert(response.ok && response.data.attachedEstimate.version === 1, '第1版・過去版を採用');
assert(response.data.attachedEstimate.pdfUrl === 'v1.pdf', '指定版のPDFを採用');
let attached = context.readStandardEstimateCaseAttachment('CASE-1');
assert(attached.version === 1 && attached.estimateId === 'EST-1', '案件ポインターを保存');

response = context.api_attachStandardEstimateToCase('EST-1', 2, 3, 'ATTACH-2');
assert(response.ok && response.data.attachedEstimate.version === 2, '採用版を第2版へ切替');
const requestRowsAfterSwitch = sheets[context.STANDARD_ESTIMATE_SHEETS.REQUEST].getLastRow();
response = context.api_attachStandardEstimateToCase('EST-1', 2, 3, 'ATTACH-2');
assert(response.ok && sheets[context.STANDARD_ESTIMATE_SHEETS.REQUEST].getLastRow() === requestRowsAfterSwitch, 'requestId再送は二重更新しない');
response = context.api_attachStandardEstimateToCase('EST-1', 1, 3, 'ATTACH-2');
assert(!response.ok && response.error.code === 'REQUEST_ID_CONFLICT', 'requestId内容不一致');
response = context.api_attachStandardEstimateToCase('EST-1', 1, 2, 'LOCK');
assert(!response.ok && response.error.code === 'LOCK_CONFLICT', 'ロック競合');
response = context.api_attachStandardEstimateToCase('EST-1', 99, 3, 'NO-VERSION');
assert(!response.ok && response.error.code === 'PDF_VERSION_NOT_FOUND', '存在しないPDF版');
response = context.api_attachStandardEstimateToCase('NO-ESTIMATE', 1, 3, 'NO-ESTIMATE');
assert(!response.ok && response.error.code === 'ESTIMATE_NOT_FOUND', '存在しない見積');

const historySheet = sheets[context.STANDARD_ESTIMATE_SHEETS.PDF_HISTORY];
const pdfUrlColumn = context.STANDARD_ESTIMATE_PDF_HISTORY_HEADERS.indexOf('PDF URL');
historySheet.data[2][pdfUrlColumn] = '';
response = context.api_attachStandardEstimateToCase('EST-1', 2, 3, 'NO-PDF');
assert(!response.ok && response.error.code === 'PDF_NOT_READY', 'PDF URLなし');
historySheet.data[2][pdfUrlColumn] = 'v2.pdf';
const historyCaseColumn = context.STANDARD_ESTIMATE_PDF_HISTORY_HEADERS.indexOf('案件ID');
historySheet.data[1][historyCaseColumn] = 'CASE-X';
response = context.api_attachStandardEstimateToCase('EST-1', 1, 3, 'MISMATCH');
assert(!response.ok && response.error.code === 'CASE_ESTIMATE_MISMATCH', '案件ID不一致');
historySheet.data[1][historyCaseColumn] = 'CASE-1';
const headerCaseColumn = context.STANDARD_ESTIMATE_HEADER_HEADERS.indexOf('案件ID');
sheets[context.STANDARD_ESTIMATE_SHEETS.HEADER].data[1][headerCaseColumn] = 'CASE-NOT-FOUND';
response = context.api_attachStandardEstimateToCase('EST-1', 1, 3, 'NO-CASE');
assert(!response.ok && response.error.code === 'CASE_NOT_FOUND', '存在しない案件');
sheets[context.STANDARD_ESTIMATE_SHEETS.HEADER].data[1][headerCaseColumn] = 'CASE-1';

const stateColumn = context.STANDARD_ESTIMATE_HEADER_HEADERS.indexOf('状態');
sheets[context.STANDARD_ESTIMATE_SHEETS.HEADER].data[1][stateColumn] = 'canceled';
response = context.api_attachStandardEstimateToCase('EST-1', 1, 3, 'CANCELED');
assert(!response.ok && response.error.code === 'CANCELED_ESTIMATE', '取消済み見積の新規採用拒否');
attached = context.readStandardEstimateCaseAttachment('CASE-1');
assert(attached.version === 2, '取消後も既存採用ポインターを自動解除しない');
response = context.api_attachStandardEstimateToCase('EST-1', 2, 3, 'ATTACH-2');
assert(response.ok && response.data.attachedEstimate.status === 'canceled' && response.warnings.length === 1, '既存採用版を持つ取消見積を警告');

const legacy = sheets['01_案件管理'].data[1];
assert(legacy[caseHeaders.indexOf('見積書PDF')] === 'legacy.pdf' && legacy[caseHeaders.indexOf('見積書テンプレートID')] === 'LEGACY' &&
  legacy[caseHeaders.indexOf('見積書生成状態')] === 'done' && legacy[caseHeaders.indexOf('見積書生成経路')] === 'specified', '既存指定様式列を変更しない');
assert(!fs.readFileSync('標準見積採用.gs', 'utf8').includes('api_generateStandardEstimatePdf('), '採用時にPDFを再生成しない');

const initSheet = new Sheet('01_案件管理', ['案件ID', '見積書PDF'], [{ '案件ID': 'CASE-I', '見積書PDF': 'legacy-i.pdf' }]);
const initSs = { getSheetByName(name) { return name === '01_案件管理' ? initSheet : null; } };
context.SpreadsheetApp.getActiveSpreadsheet = () => initSs;
context.setupStandardEstimateCaseAttachmentColumns();
context.setupStandardEstimateCaseAttachmentColumns();
const initializedHeaders = initSheet.data[0];
assert(initializedHeaders[0] === '案件ID' && initializedHeaders[1] === '見積書PDF', '既存列順を変更しない');
context.STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.forEach(header => assert(initializedHeaders.filter(value => value === header).length === 1, '初期化で不足列だけを一度追加: ' + header));

console.log('standard-estimate-attachment: PASS');
