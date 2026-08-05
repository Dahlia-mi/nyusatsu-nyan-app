const fs = require('fs');
const vm = require('vm');
function assert(condition, message) { if (!condition) throw new Error(message); }

const dataSource = fs.readFileSync('標準見積データ.gs', 'utf8');
const apiSource = fs.readFileSync('標準見積API.gs', 'utf8');
const pdfSource = fs.readFileSync('標準見積PDF.gs', 'utf8');
const template = fs.readFileSync('standard-estimate-template.html', 'utf8');
const context = { console, isFinite, Math, JSON, Date, Object, String, Number, Array, RegExp };
vm.createContext(context);
vm.runInContext((dataSource + '\n' + apiSource + '\n' + pdfSource).replace(/^const /gm, 'var '), context);

const estimate = {
  header: {
    estimateId: 'EST-ID-1', estimateNumber: 'EST-2026-0001', estimateDate: '2026-08-04', caseId: 'CASE-1',
    addressee: 'テスト省 <御中>', subject: '事務用品\n一式', deliveryDate: '2026-09-01', deliveryPlace: '本館1階',
    validity: '作成日から30日', note: '連絡事項\n二行目', amountDisplay: 'exclusive', taxCategory: 'standard', taxRate: 0.1,
    roundingMode: 'round', businessProfileId: 'BP-1', latestVersion: 0, lockVersion: 1, state: 'draft',
    businessSnapshot: { profileId: 'BP-1', name: '入札商事 & Co.', postalCode: '100-0001', address: '東京都<千代田区>',
      representativeRole: '代表取締役', representativeName: '山田 太郎', phone: '03-0000-0000', email: 'a@example.com' },
  },
  items: [{ lineNumber: 1, name: 'コピー用紙 <A4>', specification: '白色度 & 80%', quantity: 2, unit: '箱', unitPrice: 10001, amount: 0, note: '同等品可' }],
  pdfHistory: [],
};

const model = context.buildStandardEstimatePdfModel_(estimate, 1, new Date('2026-08-04T00:00:00Z'));
assert(model.schemaVersion === '1.0' && model.version === 1, 'PDFモデルの版情報');
const laterModel = context.buildStandardEstimatePdfModel_(estimate, 1, new Date('2026-08-04T01:00:00Z'));
assert(context.standardEstimatePdfDataHash_(model) === context.standardEstimatePdfDataHash_(laterModel), '再送ハッシュは生成日時に依存しない');
assert(model.tax.subtotal === 20002 && model.tax.taxAmount === 2000 && model.tax.submittedAmount === 20002, '税抜モデル再計算');
const inclusive = JSON.parse(JSON.stringify(estimate)); inclusive.header.amountDisplay = 'inclusive';
assert(context.buildStandardEstimatePdfModel_(inclusive, 1, new Date()).tax.submittedAmount === 22002, '税込表示');
assert(context.paginateStandardEstimatePdfItems_(model.items).length === 1, '1明細は1ページ');
const five = Array.from({ length: 5 }, (_, i) => ({ ...model.items[0], lineNumber: i + 1 }));
assert(context.paginateStandardEstimatePdfItems_(five).length === 1, '5明細');
const ten = Array.from({ length: 10 }, (_, i) => ({ ...model.items[0], lineNumber: i + 1 }));
assert(context.paginateStandardEstimatePdfItems_(ten).length >= 1, '10明細');
const longItems = Array.from({ length: 10 }, (_, i) => ({ ...model.items[0], lineNumber: i + 1,
  name: '非常に長い品名'.repeat(12), specification: '非常に長い仕様'.repeat(12), note: '長い備考'.repeat(12) }));
const pages = context.paginateStandardEstimatePdfItems_(longItems);
assert(pages.length > 1, '長文明細を複数ページへ分割');
assert(pages[pages.length - 1].isFinal && pages.slice(0, -1).every(page => !page.isFinal), '最終ページ判定');
assert(template.includes('<?= m.case.addressee ?>') && !template.includes('<?!= m.case.addressee ?>'), 'HTMLはコンテキストエスケープ');
assert(template.includes('white-space: pre-wrap'), 'エスケープ後の改行表示');
assert(template.includes('<?= page.number ?> / <?= m.pageCount ?>'), 'ページ番号');
assert(template.includes('<? if (page.isFinal) { ?>') && template.indexOf('class="summary"') > template.indexOf('<? if (page.isFinal) { ?>'), '合計は最終ページのみ');
assert(template.includes('table-header-group'), '複数ページの明細ヘッダー');
assert(context.countStandardEstimatePdfPages_({ getDataAsString() { return '/Type /Pages /Type /Page /Type /Page'; } }, 1) === 2, '変換済みPDFからページ数取得');

let validation = null;
try { const invalid = JSON.parse(JSON.stringify(model)); invalid.case.deliveryPlace = ''; context.validateStandardEstimatePdfModel_(invalid); } catch (error) { validation = error; }
assert(validation && validation.standardEstimateApiCode === 'PDF_VALIDATION_ERROR' && validation.publicDetails.fields.includes('納品場所'), '必須不足を拒否');
assert(context.buildStandardEstimatePdfFileName_(model) === '標準見積書_EST-2026-0001_第01版_CASE-1.pdf', 'ファイル名');
assert(pdfSource.indexOf('createFile(pdfBlob)') < pdfSource.indexOf('recordStandardEstimatePdfSuccess'), 'Drive成功後だけ履歴確定');
assert(dataSource.includes("ref.record['最新PDF URL'] = pdf.pdfUrl") && dataSource.includes("ref.record['状態'] = 'pdf_generated'"), '最新PDFポインターと状態を更新');
assert(dataSource.includes("'データハッシュ': pdf.dataHash"), 'PDFモデルの安定ハッシュを履歴保存');

let recordCount = 0;
context.getStandardEstimateApiRepository_ = () => ({ assertDataModelReady() {}, getEstimate() { return JSON.parse(JSON.stringify(estimate)); } });
context.getStandardEstimatePdfRequestReplay = () => null;
context.renderStandardEstimatePdfHtml_ = () => '<html></html>';
context.standardEstimateStableHash_ = () => 'HASH';
context.Utilities = { newBlob() { return { getAs() { return { setName() { return {}; } }; } }; } };
context.MimeType = { PDF: 'pdf' };
context.resolveStandardEstimatePdfFolder_ = () => ({ usedFallbackFolder: true, folder: {
  getId() { return 'FOLDER'; }, createFile() { return { getId() { return 'FILE'; }, getUrl() { return 'https://example/pdf'; }, getName() { return 'file.pdf'; } }; },
} });
context.recordStandardEstimatePdfSuccess = () => { recordCount++; return { ...estimate, header: { ...estimate.header, latestVersion: 1, lockVersion: 2, state: 'pdf_generated' }, pdfHistory: [{
  'PDF履歴ID': 'H1', '版番号': 1, '生成日時': new Date('2026-08-04T01:02:03.000Z'), 'PDFファイルID': 'FILE', 'PDF URL': 'https://example/pdf', 'ファイル名': 'file.pdf', '保存先フォルダID': 'FOLDER', 'ページ数': 1, 'リクエストID': 'REQ-1',
}] }; };
let response = context.api_generateStandardEstimatePdf('EST-ID-1', 1, 'REQ-1');
assert(response.ok && recordCount === 1 && response.data.pdf.usedFallbackFolder, 'PDF履歴とフォールバック応答');
assert(response.data.estimate.header.lockVersion === 2, 'PDF生成成功後の最新ロックバージョン');
assert(response.data.estimate.pdfHistory[0]['生成日時'] === '2026-08-04T01:02:03.000Z', 'PDF成功レスポンスも共通処理でISO文字列化');

recordCount = 0;
context.Utilities.newBlob = () => ({ getAs() { throw new Error('render'); } });
response = context.api_generateStandardEstimatePdf('EST-ID-1', 1, 'REQ-2');
assert(!response.ok && response.error.code === 'PDF_RENDER_ERROR' && recordCount === 0, 'PDF変換失敗で版を消費しない');
context.Utilities.newBlob = () => ({ getAs() { return { setName() { return {}; } }; } });
context.resolveStandardEstimatePdfFolder_ = () => ({ usedFallbackFolder: false, folder: { createFile() { throw new Error('drive'); } } });
response = context.api_generateStandardEstimatePdf('EST-ID-1', 1, 'REQ-3');
assert(!response.ok && response.error.code === 'DRIVE_SAVE_ERROR' && recordCount === 0, 'Drive失敗で版を消費しない');

context.getStandardEstimatePdfRequestReplay = () => ({ estimate, history: { 'PDF履歴ID': 'H1', '版番号': 1, 'PDFファイルID': 'FILE', 'PDF URL': 'u', 'ファイル名': 'f', '保存先フォルダID': 'D', 'ページ数': 1 } });
response = context.api_generateStandardEstimatePdf('EST-ID-1', 1, 'REQ-1');
assert(response.ok && recordCount === 0, '同じrequestIdの再送は再生成しない');
context.getStandardEstimatePdfRequestReplay = () => { throw new Error('同じリクエストIDが異なる操作または内容で使用されています。'); };
response = context.api_generateStandardEstimatePdf('EST-ID-1', 1, 'REQ-X');
assert(!response.ok && response.error.code === 'REQUEST_ID_CONFLICT', 'requestId内容不一致');
context.getStandardEstimatePdfRequestReplay = () => null;
response = context.api_generateStandardEstimatePdf('EST-ID-1', 2, 'REQ-L');
assert(!response.ok && response.error.code === 'LOCK_CONFLICT', 'ロック競合');

console.log('standard-estimate-pdf: PASS');
