const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('webapp-index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const script = scripts[scripts.length - 1];

function assert(condition, message) { if (!condition) throw new Error(message); }

// HTML/JavaScript全体の構文確認。
new Function(script);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert(new Set(ids).size === ids.length, 'HTML idに重複がない');

function fakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, readOnly: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, dataset: {},
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
  };
}

const elements = {};
const document = {
  getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
  querySelectorAll() { return []; }, querySelector() { return null; },
  createElement() { return fakeElement(); }, body: fakeElement(),
};
let successHandler = null;
let failureHandler = null;
const runner = new Proxy({}, {
  get(target, prop) {
    if (prop === 'withSuccessHandler') return fn => { successHandler = fn; return runner; };
    if (prop === 'withFailureHandler') return fn => { failureHandler = fn; return runner; };
    return function () {};
  },
});
const context = {
  console, document,
  window: {
    scrollTo() {}, confirm() { return true; }, addEventListener() {},
    crypto: { randomUUID() { return 'UUID-TEST'; } },
  },
  google: { script: { run: runner } },
  setTimeout() { return 1; }, clearTimeout() {}, Date, Math, JSON, Object, isFinite,
};
vm.createContext(context);
vm.runInContext(script, context);

assert(html.includes('id="btnGenerate"'), '既存指定様式ボタンを維持');
assert(html.includes('id="btnCreateStandardEstimate"'), '標準見積作成ボタン');
assert(html.includes('id="view-standard-estimate"'), '専用編集ビュー');
assert(html.includes('class="standard-item-card'), 'スマホ向け明細カード');
assert(!html.includes('<th>品名</th><th>仕様・型番</th><th>数量</th>'), '横長明細表を追加しない');
assert(html.includes('候補入力') && html.includes('candidate'), '候補明細表示');
assert(html.includes('id="standardEstimateWarnings"'), '警告専用領域');
assert(html.includes('id="standardEstimateConflict"'), 'ロック競合表示');
assert(html.includes('<summary>履歴を見る</summary>'), '過去・取消済みを折りたたみ表示');
assert(html.includes('保存されていない変更があります'), '未保存変更警告');
assert(html.includes("callStandardEstimateApi('api_getStandardEstimateInitialData'"), '初期値API接続');
assert(html.includes("callStandardEstimateApi('api_getStandardEstimate'"), '再取得API接続');
assert(html.includes("callStandardEstimateApi('api_listStandardEstimates'"), '一覧API接続');
assert(html.includes("'api_createStandardEstimate' : 'api_saveStandardEstimateDraft'"), '作成・保存API接続');
assert(html.includes("callStandardEstimateApi('api_generateStandardEstimatePdf'"), 'PDF API接続');
assert(html.includes('saveStandardEstimateEditor(function () { generateStandardEstimatePdfEditor(); })'), '未保存変更を保存後にPDF生成');
assert(html.includes('setStandardEstimatePdfBusy_(true)'), 'PDF生成中の二重操作防止');
assert(html.includes('id="standardEstimatePdfResult"'), '最新PDF結果表示');
assert(html.includes('id="btnAttachStandardEstimateToCase"'), '案件への採用版保存ボタン');
assert(html.includes("callStandardEstimateApi('api_attachStandardEstimateToCase'"), '採用版保存API接続');
assert(html.includes("if (state.standardEstimateDirty) { showError('未保存の変更があります。"), '未保存変更中の採用拒否');
assert(html.includes('この版は案件の採用版です'), 'UI上の採用済み表示');
assert(html.includes('採用中の見積書は取消済みです'), '取消済み採用版の警告');
assert(html.includes('案件へ保存された版はありません'), '採用版なし表示');

// クライアント表示計算。最終確定はAPI側だが、画面にも即時反映する。
context.state.standardEstimate = {
  items: [
    { name: '用紙', specification: '', quantity: 2, unit: '箱', unitPrice: 10001, note: '', candidate: false },
    { name: 'ファイル', specification: '', quantity: 3, unit: '冊', unitPrice: 500, note: '', candidate: false },
  ],
  caseId: 'CASE-1', businessProfile: { profileId: 'DEFAULT' }, businessProfileId: 'DEFAULT',
};
elements.standardEstimateRoundingMode.value = 'round';
elements.standardEstimateTaxCategory.value = 'standard';
elements.standardEstimateTaxRate.value = '0.1';
elements.standardEstimateAmountDisplay.value = 'exclusive';
context.calculateStandardEstimateClientTotals_();
assert(elements.standardEstimateSubtotal.textContent === '21,502円', '数量×単価と小計表示');
assert(elements.standardEstimateTaxAmount.textContent === '2,150円', '消費税表示');
assert(elements.standardEstimateTotal.textContent === '23,652円', '税込合計表示');
assert(elements.standardEstimateSubmittedAmount.textContent === '21,502円', '税抜提出金額');

elements.standardEstimateAmountDisplay.value = 'inclusive';
context.calculateStandardEstimateClientTotals_();
assert(elements.standardEstimateSubmittedAmount.textContent === '23,652円', '税込切替');

const items = context.state.standardEstimate.items;
context.addStandardEstimateItem();
assert(items.length === 3, '明細追加');
context.handleStandardEstimateItemAction({ target: {
  closest() { return { getAttribute(name) { return name === 'data-index' ? '0' : 'duplicate'; } }; },
} });
assert(items.length === 4, '明細複製');

assert(context.createStandardEstimateRequestId_() === 'UUID-TEST', '操作用requestId生成');
assert(html.includes('pending.action === action && pending.payloadKey === payloadKey'), '同じ通信再送でrequestId再利用');
assert(html.includes("error.code === 'LOCK_CONFLICT'"), 'ロック競合を専用表示');
assert(html.includes("estimate.header.state === 'canceled'"), '取消済み編集拒否');
assert(html.includes("item.candidate = false"), '候補は編集で解除');
assert(html.includes("action === 'confirm'"), '候補は確認操作で解除');
assert(html.includes("var inputId = 'standardItem-' + index + '-' + field"), '明細入力へ現在順の一意IDを付ける');
assert(html.includes("<label class=\"form-label\" for=\"' + inputId"), '明細ラベルを入力IDへ関連付ける');
assert(html.includes('html { scroll-padding-bottom: calc(96px + env(safe-area-inset-bottom)); }'), 'Safe Area込みのscroll-padding');
const stickyBlock = html.match(/<div class="standard-save-actions">([\s\S]*?)<\/div>/);
assert(stickyBlock && stickyBlock[1].includes('btnSaveStandardEstimate'), '保存ボタンはsticky領域');
assert(stickyBlock && stickyBlock[1].includes('btnGenerateStandardEstimatePdf'), 'PDF生成ボタンはsticky領域');
assert(stickyBlock && !stickyBlock[1].includes('btnCancelStandardEstimateEdit'), '戻るボタンはsticky領域外');

console.log('standard-estimate-ui: PASS');
