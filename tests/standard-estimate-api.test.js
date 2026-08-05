const fs = require('fs');
const vm = require('vm');

const dataSource = fs.readFileSync('標準見積データ.gs', 'utf8');
const apiSource = fs.readFileSync('標準見積API.gs', 'utf8');
const context = { console, isFinite, Math, JSON, Date, Object };
vm.createContext(context);
vm.runInContext((dataSource + '\n' + apiSource).replace(/^const /gm, 'var '), context);

function assert(condition, message) { if (!condition) throw new Error(message); }
function containsDate(value) {
  if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') return true;
  if (Array.isArray(value)) return value.some(containsDate);
  return !!value && typeof value === 'object' && Object.keys(value).some(key => containsDate(value[key]));
}

const cases = {
  'CASE-1': {
    caseId: 'CASE-1', subject: '事務用品', organization: '○○省', deliveryDate: '2026-09-01',
    deliveryPlace: '指定場所', submissionMethod: '電子調達システム', existingTaxDisplay: 'inclusive',
    businessProfileId: 'DEFAULT', itemName: '', itemSpecification: '', itemQuantity: '', itemUnit: '',
    expectedAmountExclusive: 100000,
  },
};
let estimates = {};
let createCount = 0;
let modelReady = true;
const requests = {};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function makeEstimate(id, draft) {
  return { schemaVersion: '1.0', header: {
    estimateId: id, caseId: draft.caseId, estimateNumber: 'EST-2026-0001', estimateDate: draft.estimateDate,
    subject: draft.subject, state: 'draft', lockVersion: 1, latestVersion: 0, updatedAt: '2026-08-04T00:00:00.000Z',
  }, items: clone(draft.items), pdfHistory: [] };
}

const repository = {
  assertDataModelReady() { if (!modelReady) throw new Error('「標準見積ヘッダー」が未設定です。setupStandardEstimateDataModel()を実行してください。'); },
  getCase(id) { return cases[id] ? clone(cases[id]) : null; },
  getBusinessProfile() { return { profile: { profileId: 'DEFAULT', name: '株式会社見本' }, warning: '' }; },
  listEstimatesByCase(caseId) { return Object.values(estimates).filter(e => e.header.caseId === caseId).map(e => clone(e.header)); },
  getEstimate(id) { if (!estimates[id]) throw new Error(`見積ID「${id}」が見つかりません。`); return clone(estimates[id]); },
  createDraft(draft, requestId) {
    const fingerprint = JSON.stringify(draft);
    if (requests[requestId]) {
      if (requests[requestId].fingerprint !== fingerprint) throw new Error('同じリクエストIDが異なる操作または内容で使用されています。');
      return clone(estimates[requests[requestId].id]);
    }
    const id = `ESTIMATE-${++createCount}`;
    estimates[id] = makeEstimate(id, draft);
    requests[requestId] = { fingerprint, id };
    return clone(estimates[id]);
  },
  saveDraft(id, draft, lockVersion, requestId) {
    if (!estimates[id]) throw new Error(`見積ID「${id}」が見つかりません。`);
    if (estimates[id].header.lockVersion !== lockVersion) throw new Error('標準見積書は別の操作で更新されています。');
    estimates[id].header.lockVersion++;
    estimates[id].header.subject = draft.subject;
    estimates[id].items = clone(draft.items);
    return clone(estimates[id]);
  },
  cancelEstimate(id, reason, lockVersion) {
    if (!estimates[id]) throw new Error(`見積ID「${id}」が見つかりません。`);
    if (estimates[id].header.lockVersion !== lockVersion) throw new Error('ロックバージョンが一致しません。');
    estimates[id].header.state = 'canceled';
    estimates[id].header.cancelReason = reason;
    estimates[id].header.lockVersion++;
    return clone(estimates[id]);
  },
};
context.getStandardEstimateApiRepository_ = () => repository;

const initial = context.api_getStandardEstimateInitialData('CASE-1');
assert(initial.ok, '初期値取得');
assert(initial.data.taxSuggestion.value === 'exclusive' && initial.data.taxSuggestion.confirmed === false, '電子調達は税抜候補で未確定');
assert(initial.data.initialItems[0].name === '事務用品', '品名なしは案件名候補');
assert(initial.data.initialItems[0].unitPrice === '', '想定入札額を単価へ自動適用しない');
assert(initial.data.pricingSuggestion.appliedToItems === false, '金額候補を明示');
assert(initial.warnings.length > 0, '不足値の警告');

const missingCase = context.api_getStandardEstimateInitialData('NONE');
assert(!missingCase.ok && missingCase.error.code === 'CASE_NOT_FOUND', '存在しない案件');

const draft = {
  estimateDate: '2026-08-04', addressee: '○○省 御中', subject: '事務用品',
  amountDisplay: 'exclusive', taxCategory: 'standard', taxRate: 0.1, roundingMode: 'round',
  items: [{ name: '用紙', quantity: 2, unit: '箱', unitPrice: 1000 }],
};
const created = context.api_createStandardEstimate('CASE-1', draft, 'REQ-1');
assert(created.ok && created.data.estimate.header.estimateId === 'ESTIMATE-1', '新規作成');
assert(created.data.estimate.items[0].amount === 2000, 'API側で金額再計算');

const replay = context.api_createStandardEstimate('CASE-1', draft, 'REQ-1');
assert(replay.ok && createCount === 1, 'requestId再送で二重作成しない');
const conflict = context.api_createStandardEstimate('CASE-1', { ...draft, subject: '変更' }, 'REQ-1');
assert(!conflict.ok && conflict.error.code === 'REQUEST_ID_CONFLICT', 'requestId不一致');

const fetched = context.api_getStandardEstimate('ESTIMATE-1');
assert(fetched.ok && fetched.data.estimate.header.subject === '事務用品', '再取得');
estimates['ESTIMATE-1'].pdfHistory = [{ generatedAt: new Date('2026-08-04T01:02:03.000Z'), nested: { canceledAt: new Date('2026-08-05T00:00:00.000Z') } }];
const fetchedWithPdfHistory = context.api_getStandardEstimate('ESTIMATE-1');
assert(fetchedWithPdfHistory.ok, 'PDF履歴ありの再取得');
assert(fetchedWithPdfHistory.data.estimate.pdfHistory[0].generatedAt === '2026-08-04T01:02:03.000Z', 'PDF履歴日時をISO文字列化');
assert(!containsDate(fetchedWithPdfHistory), 'APIレスポンス内にDateを残さない');
const listed = context.api_listStandardEstimates('CASE-1');
assert(listed.ok && listed.data.total === 1, '案件別一覧');

const saved = context.api_saveStandardEstimateDraft('ESTIMATE-1', { ...draft, caseId: 'CASE-1', subject: '変更後' }, 1, 'REQ-2');
assert(saved.ok && saved.data.estimate.header.subject === '変更後', '下書き保存');
const lockConflict = context.api_saveStandardEstimateDraft('ESTIMATE-1', { ...draft, caseId: 'CASE-1' }, 1, 'REQ-3');
assert(!lockConflict.ok && lockConflict.error.code === 'LOCK_CONFLICT', 'ロック競合');

const canceled = context.api_cancelStandardEstimate('ESTIMATE-1', '不要になったため', 2, 'REQ-4');
assert(canceled.ok && canceled.data.estimate.header.state === 'canceled', '取消');

modelReady = false;
const notReady = context.api_getStandardEstimateInitialData('CASE-1');
assert(!notReady.ok && notReady.error.code === 'DATA_MODEL_NOT_READY', 'シート未作成');
modelReady = true;

context.getStandardEstimateApiRepository_ = () => ({
  assertDataModelReady() { throw new Error('SECRET_STACK_OR_INTERNAL_DETAIL'); },
});
const internal = context.api_getStandardEstimateInitialData('CASE-1');
assert(!internal.ok && internal.error.code === 'INTERNAL_ERROR', '内部例外を変換');
assert(!JSON.stringify(internal).includes('SECRET_STACK'), '内部例外を画面へ返さない');

assert(apiSource.includes('function api_getStandardEstimateInitialData('), '専用初期値API');
assert(apiSource.includes('function api_cancelStandardEstimate('), '専用取消API');
assert(!apiSource.includes('api_generateEstimate =') && !apiSource.includes('function api_generateEstimate('), '既存指定様式APIを再定義しない');
assert(!apiSource.includes('setupStandardEstimateDataModel();'), 'APIから初期化を自動実行しない');

console.log('standard-estimate-api: PASS');
