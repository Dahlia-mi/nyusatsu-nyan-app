const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(projectRoot, '案件品目DB.gs'),
  'utf8'
);
const sandbox = {
  console,
  Date,
  Error,
  Object,
  String
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: '案件品目DB.gs' });

const buildPlan = sandbox.buildCaseItemUpsertPlan_;

function existingItem(overrides = {}) {
  return {
    caseId: '2026-07-015',
    itemId: '2026-07-015-001',
    name: '帽子',
    specification: '紺',
    quantity: '308',
    unit: '個',
    displayOrder: 1,
    active: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    updateSource: '案件カルテ',
    ...overrides
  };
}

test('issues readable item IDs scoped to the immutable case ID', () => {
  const now = new Date('2026-07-28T00:00:00.000Z');
  const plan = buildPlan(
    '2026-07-015',
    [
      { name: '帽子', quantity: 308, unit: '個' },
      { name: 'エコバッグ', quantity: 100, unit: '枚' }
    ],
    [],
    now,
    '案件カルテ'
  );

  assert.deepEqual(
    Array.from(plan.activeRecords, (item) => item.itemId),
    ['2026-07-015-001', '2026-07-015-002']
  );
  assert.equal(plan.added, 2);
  assert.equal(plan.updated, 0);
  assert.equal(plan.activeRecords[0].quantity, 308);
});

test('stores ordinary numeric quantities as numbers and preserves non-numeric text', () => {
  const plan = buildPlan(
    '2026-07-015',
    [
      { name: '帽子', quantity: '1,200', unit: '個' },
      { name: '作業一式', quantity: '約3', unit: '式' }
    ],
    [],
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  assert.equal(plan.activeRecords[0].quantity, 1200);
  assert.equal(plan.activeRecords[1].quantity, '約3');
});

test('is idempotent for the same case and items', () => {
  const now = new Date('2026-07-28T00:00:00.000Z');
  const plan = buildPlan(
    '2026-07-015',
    [{ name: '帽子', specification: '紺', quantity: 308, unit: '個' }],
    [existingItem()],
    now,
    '案件カルテ'
  );

  assert.equal(plan.activeRecords.length, 1);
  assert.equal(plan.activeRecords[0].itemId, '2026-07-015-001');
  assert.equal(plan.activeRecords[0].createdAt, '2026-07-01T00:00:00.000Z');
  assert.equal(plan.added, 0);
  assert.equal(plan.updated, 0);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.deactivated, 0);
  assert.equal(
    plan.activeRecords[0].updatedAt,
    '2026-07-01T00:00:00.000Z'
  );
});

test('preserves IDs when items are reordered', () => {
  const existing = [
    existingItem(),
    existingItem({
      itemId: '2026-07-015-002',
      name: 'エコバッグ',
      specification: '',
      quantity: '100',
      unit: '枚',
      displayOrder: 2
    })
  ];
  const plan = buildPlan(
    '2026-07-015',
    [
      { name: 'エコバッグ', quantity: 100, unit: '枚' },
      { name: '帽子', specification: '紺', quantity: 308, unit: '個' }
    ],
    existing,
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  assert.deepEqual(
    Array.from(plan.activeRecords, (item) => item.itemId),
    ['2026-07-015-002', '2026-07-015-001']
  );
  assert.deepEqual(
    Array.from(plan.activeRecords, (item) => item.displayOrder),
    [1, 2]
  );
});

test('preserves the position ID when an item is edited', () => {
  const plan = buildPlan(
    '2026-07-015',
    [{ name: '帽子', specification: '黒', quantity: 308, unit: '個' }],
    [existingItem()],
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  assert.equal(plan.activeRecords[0].itemId, '2026-07-015-001');
  assert.equal(plan.activeRecords[0].specification, '黒');
  assert.equal(plan.added, 0);
});

test('soft-deactivates removed items instead of deleting historical keys', () => {
  const existing = [
    existingItem(),
    existingItem({
      itemId: '2026-07-015-002',
      name: 'エコバッグ',
      quantity: '100',
      unit: '枚',
      displayOrder: 2
    })
  ];
  const plan = buildPlan(
    '2026-07-015',
    [{ itemId: '2026-07-015-001', name: '帽子', quantity: 308, unit: '個' }],
    existing,
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  const inactive = plan.records.find(
    (item) => item.itemId === '2026-07-015-002'
  );
  assert.equal(inactive.active, false);
  assert.equal(plan.deactivated, 1);
});

test('keeps missing items when merging a partial source into an existing case', () => {
  const existing = [
    existingItem(),
    existingItem({
      itemId: '2026-07-015-002',
      name: 'エコバッグ',
      quantity: '100',
      unit: '枚',
      displayOrder: 2
    })
  ];
  const plan = buildPlan(
    '2026-07-015',
    [{ name: '帽子', specification: '紺', quantity: 308, unit: '個' }],
    existing,
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ',
    { deactivateMissing: false, allowPositionMatch: false }
  );

  assert.equal(plan.deactivated, 0);
  assert.equal(
    plan.records.some((item) => item.itemId === '2026-07-015-002'),
    false
  );
});

test('does not overwrite by position when merging a different partial item', () => {
  const plan = buildPlan(
    '2026-07-015',
    [{ name: 'エコバッグ', quantity: 100, unit: '枚' }],
    [existingItem()],
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ',
    { deactivateMissing: false, allowPositionMatch: false }
  );

  assert.equal(plan.activeRecords[0].itemId, '2026-07-015-002');
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 0);
});

test('rejects an item ID belonging to another case', () => {
  assert.throws(
    () =>
      buildPlan(
        '2026-07-015',
        [{ itemId: '2026-07-999-001', name: '帽子' }],
        [],
        new Date('2026-07-28T00:00:00.000Z'),
        '案件カルテ'
      ),
    /品目IDが案件IDに属していません/
  );
});

test('does not collide after an explicit item ID in the same payload', () => {
  const plan = buildPlan(
    '2026-07-015',
    [
      { itemId: '2026-07-015-001', name: '帽子' },
      { name: 'エコバッグ' }
    ],
    [],
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  assert.deepEqual(
    Array.from(plan.activeRecords, (item) => item.itemId),
    ['2026-07-015-001', '2026-07-015-002']
  );
});

test('rejects duplicate explicit item IDs in one payload', () => {
  assert.throws(
    () =>
      buildPlan(
        '2026-07-015',
        [
          { itemId: '2026-07-015-001', name: '帽子' },
          { itemId: '2026-07-015-001', name: 'エコバッグ' }
        ],
        [],
        new Date('2026-07-28T00:00:00.000Z'),
        '案件カルテ'
      ),
    /items\[\]内で重複/
  );
});

test('skips completely empty placeholder items', () => {
  const plan = buildPlan(
    '2026-07-015',
    [{}],
    [],
    new Date('2026-07-28T00:00:00.000Z'),
    '案件カルテ'
  );

  assert.equal(plan.activeRecords.length, 0);
  assert.equal(plan.added, 0);
});

test('uses header names and includes lifecycle columns', () => {
  const headers = Array.from(
    vm.runInContext('CASE_ITEMS_DB_HEADERS', sandbox)
  );
  assert.deepEqual(headers, [
    '案件ID',
    '品目ID',
    '品目名',
    '仕様・型番',
    '数量',
    '単位',
    '表示順',
    '有効フラグ',
    '作成日時',
    '更新日時',
    '更新元'
  ]);

  const shuffled = [
    '更新日時',
    '品目名',
    '案件ID',
    '品目ID',
    '数量',
    '単位',
    '仕様・型番',
    '表示順',
    '有効フラグ',
    '作成日時',
    '更新元'
  ];
  const map = sandbox.buildCaseItemsHeaderMap_(shuffled);
  assert.equal(map['案件ID'], 2);
  assert.equal(map['品目ID'], 3);
  assert.doesNotThrow(() => sandbox.assertCaseItemsHeaders_(map));
});

test('Core keeps legacy projection and wires the item SSOT into registration', () => {
  const core = fs.readFileSync(path.join(projectRoot, 'Core.gs'), 'utf8');

  assert.match(core, /const item = Array\.isArray\(data\.items\)/);
  assert.match(core, /upsertCaseItemsFromCaseJson_\(/);
  assert.match(core, /data\.items = itemSync\.items/);
  assert.match(core, /ensureCaseItemsSheet_\(ss\)/);
  assert.match(core, /itemId: String\(item\.itemId \|\| ''\)\.trim\(\)/);
  assert.match(
    core,
    /NYAN_SHEETS\.SOURCE_LINK,\s+NYAN_SHEETS\.CASE_ITEMS/
  );
});
