const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('標準見積データ.gs', 'utf8');
const context = { console, isFinite, Math, JSON, Date, Object };
vm.createContext(context);
vm.runInContext(source.replace(/^const /gm, 'var '), context);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(fn, contains) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert(message.includes(contains), `Expected error containing "${contains}", got "${message}"`);
}

const base = {
  caseId: '2026-08-001',
  estimateDate: '2026-08-04',
  addressee: '国土交通省 御中',
  subject: '事務用品一式',
  amountDisplay: 'exclusive',
  taxCategory: 'standard',
  taxRate: 0.10,
  roundingMode: 'round',
  items: [
    { name: 'コピー用紙', specification: 'A4', quantity: 2, unit: '箱', unitPrice: 10001 },
    { name: 'ファイル', quantity: 3, unit: '冊', unitPrice: 500 },
  ],
};

const normalized = context.validateStandardEstimateDraft(base);
assert(normalized.items[0].amount === 20002, '数量×単価を明細金額にする');
assert(normalized.subtotal === 21502, '複数明細の小計');
assert(normalized.taxAmount === 2150, '税額を四捨五入');
assert(normalized.total === 23652, '税込合計');
assert(normalized.submittedAmount === 21502, '税抜提出金額');

const inclusive = context.validateStandardEstimateDraft({ ...base, amountDisplay: 'inclusive' });
assert(inclusive.submittedAmount === 23652, '税込提出金額');

const exempt = context.validateStandardEstimateDraft({ ...base, taxCategory: 'exempt', taxRate: 0 });
assert(exempt.taxAmount === 0 && exempt.total === exempt.subtotal, '非課税');

const outside = context.validateStandardEstimateDraft({ ...base, taxCategory: 'out_of_scope', taxRate: '' });
assert(outside.taxAmount === 0, '対象外');

const floor = context.calculateStandardEstimateAmounts({
  amountDisplay: 'inclusive', taxCategory: 'standard', taxRate: 0.10, roundingMode: 'floor',
  items: [{ name: '品目', quantity: 1, unit: '式', unitPrice: 10001 }],
});
const ceil = context.calculateStandardEstimateAmounts({
  amountDisplay: 'inclusive', taxCategory: 'standard', taxRate: 0.10, roundingMode: 'ceil',
  items: [{ name: '品目', quantity: 1, unit: '式', unitPrice: 10001 }],
});
assert(floor.taxAmount === 1000, '切り捨て');
assert(ceil.taxAmount === 1001, '切り上げ');

const fractional = context.calculateStandardEstimateAmounts({
  amountDisplay: 'exclusive', taxCategory: 'standard', taxRate: 0.10, roundingMode: 'round',
  items: [{ name: '重量品', quantity: 1.25, unit: 'kg', unitPrice: 101 }],
});
assert(fractional.items[0].amount === 126, '小数数量の明細金額を丸める');

expectError(() => context.validateStandardEstimateDraft({ ...base, items: [] }), '1件以上');
expectError(() => context.validateStandardEstimateDraft({ ...base, items: [{ name: '', quantity: 1, unit: '式', unitPrice: 1 }] }), '品名');
expectError(() => context.validateStandardEstimateDraft({ ...base, items: [{ name: '品', quantity: 0, unit: '式', unitPrice: 1 }] }), '0より大きい');
expectError(() => context.validateStandardEstimateDraft({ ...base, taxRate: 2 }), '0以上1以下');
expectError(() => context.validateStandardEstimateDraft({ ...base, estimateDate: '2026-02-30' }), '実在しない');

assert(context.validateStandardEstimateTransition_('draft', 'canceled', false), '下書きから取消');
assert(context.validateStandardEstimateTransition_('pdf_generated', 'draft', false), 'PDF生成済みから再編集');
expectError(() => context.validateStandardEstimateTransition_('draft', 'pdf_generated', false), 'PDF生成成功時だけ');
expectError(() => context.validateStandardEstimateTransition_('draft', 'submitted', false), 'Step 1の対象外');
expectError(() => context.validateStandardEstimateTransition_('canceled', 'draft', false), '変更できません');

const hashA = context.standardEstimateStableHash_({ b: 2, a: 1 });
const hashB = context.standardEstimateStableHash_({ a: 1, b: 2 });
assert(hashA === hashB, '冪等性ハッシュはキー順に依存しない');
assert(context.STANDARD_ESTIMATE_HEADER_HEADERS.includes('ロックバージョン'), '楽観ロック列');
assert(context.STANDARD_ESTIMATE_PDF_HISTORY_HEADERS.includes('スナップショットJSON'), 'PDFスナップショット列');
assert(context.STANDARD_ESTIMATE_REQUEST_HEADERS.includes('入力ハッシュ'), '冪等性入力ハッシュ列');

console.log('standard-estimate-data: PASS');
