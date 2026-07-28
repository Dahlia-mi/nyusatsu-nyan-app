const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const caseHeaders = [
  '案件ID', '案件名', '発注機関', '提出期限', '状態', '調査対象'
];
const itemHeaders = [
  '案件ID', '品目ID', '品目名', '仕様', 'メーカー', 'ブランド', '型番',
  '数量', '単位', '同等品可', '表示順', '有効フラグ'
];

function createSheet(values) {
  return {
    getLastRow() { return values.length; },
    getLastColumn() { return values[0] ? values[0].length : 0; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() {
          return values
            .slice(row - 1, row - 1 + rowCount)
            .map((valuesRow) =>
              valuesRow.slice(column - 1, column - 1 + columnCount)
            );
        }
      };
    }
  };
}

function createRuntime({ cases, items, caseHeader = caseHeaders }) {
  const spreadsheet = {
    getSheetByName(name) {
      if (name === '01_案件管理') {
        return createSheet([caseHeader, ...cases]);
      }
      if (name === '案件品目DB') {
        return createSheet([itemHeaders, ...items]);
      }
      return null;
    }
  };
  const sandbox = {
    console: { error() {} },
    Date,
    Object,
    Utilities: {
      formatDate(value) {
        return value.toISOString().slice(0, 10).replace(/-/g, '/');
      }
    },
    Session: { getScriptTimeZone() { return 'Asia/Tokyo'; } },
    SupplierNyanSpreadsheet: {
      openNyusatsu() { return spreadsheet; }
    }
  };
  vm.createContext(sandbox);
  [
    'supplier-nyan-response.gs',
    'supplier-nyan-case-service.gs'
  ].forEach((fileName) => {
    vm.runInContext(
      fs.readFileSync(
        path.join(projectRoot, 'supplier-nyan', fileName),
        'utf8'
      ),
      sandbox,
      { filename: fileName }
    );
  });
  return sandbox;
}

function itemRow({
  caseId = 'CASE-1',
  itemId = 'CASE-1-001',
  name = '帽子',
  specification = '',
  manufacturer = '',
  brand = '',
  modelNumber = '',
  quantity = 1,
  unit = '個',
  equivalentAllowed = '',
  displayOrder = 1,
  active = true
} = {}) {
  return [
    caseId, itemId, name, specification, manufacturer, brand, modelNumber,
    quantity, unit, equivalentAllowed, displayOrder, active
  ];
}

test('lists only rows explicitly marked as research targets when flag exists', () => {
  const runtime = createRuntime({
    cases: [
      ['CASE-1', '帽子案件', 'A市', new Date('2026-08-01'), '検討中', true],
      ['CASE-2', '対象外', 'B市', '', '見積中', false],
      ['CASE-3', '明示対象', 'C市', '', '新規', 'TRUE']
    ],
    items: [
      itemRow(),
      itemRow({ itemId: 'CASE-1-002', name: '袋', displayOrder: 2 }),
      itemRow({ caseId: 'CASE-3', itemId: 'CASE-3-001', name: '印刷' })
    ]
  });

  const result = runtime.api_listResearchCases();

  assert.equal(result.success, true);
  assert.equal(result.data.targetRule, 'researchTargetFlag');
  assert.deepEqual(
    Array.from(result.data.cases, (entry) => entry.caseId),
    ['CASE-1', 'CASE-3']
  );
  assert.equal(result.data.cases[0].itemCount, 2);
  assert.equal(result.data.cases[0].deadline, '2026/08/01');
});

test('falls back to considering and estimating statuses when flag is absent', () => {
  const headers = caseHeaders.slice(0, 5);
  const runtime = createRuntime({
    caseHeader: headers,
    cases: [
      ['CASE-1', '検討案件', 'A市', '', '検討中'],
      ['CASE-2', '見積案件', 'B市', '', '見積中'],
      ['CASE-3', '失注案件', 'C市', '', '失注']
    ],
    items: []
  });

  const result = runtime.api_listResearchCases();

  assert.equal(result.success, true);
  assert.equal(result.data.targetRule, 'status');
  assert.deepEqual(
    Array.from(result.data.cases, (entry) => entry.caseId),
    ['CASE-1', 'CASE-2']
  );
});

test('returns multiple active items and excludes inactive items', () => {
  const runtime = createRuntime({
    cases: [['CASE-1', '複数品目', 'A市', '', '見積中', true]],
    items: [
      itemRow({
        itemId: 'CASE-1-002',
        name: 'エコバッグ',
        equivalentAllowed: false,
        displayOrder: 2
      }),
      itemRow({
        itemId: 'CASE-1-001',
        name: '帽子',
        specification: '綿100%',
        manufacturer: '猫印',
        brand: 'Nyan',
        modelNumber: 'CAT-01',
        quantity: 308,
        equivalentAllowed: true,
        displayOrder: 1
      }),
      itemRow({
        itemId: 'CASE-1-003',
        name: '削除済み',
        active: false,
        displayOrder: 3
      })
    ]
  });

  const result = runtime.api_getResearchCaseDetail('CASE-1');

  assert.equal(result.success, true);
  assert.equal(result.data.case.items.length, 2);
  assert.equal(result.data.case.items[0].itemId, 'CASE-1-001');
  assert.equal(result.data.case.items[0].equivalentAllowed, true);
  assert.equal(result.data.case.items[1].equivalentAllowed, false);
});

test('represents unknown equivalent status as null and supports zero items', () => {
  const runtime = createRuntime({
    cases: [
      ['CASE-1', '未確認', 'A市', '', '検討中', true],
      ['CASE-2', '品目なし', 'B市', '', '検討中', true]
    ],
    items: [itemRow({ equivalentAllowed: '' })]
  });

  const list = runtime.api_listResearchCases();
  const detail = runtime.api_getResearchCaseDetail('CASE-2');

  assert.equal(list.data.cases[0].unknownEquivalentCount, 1);
  assert.equal(list.data.cases[1].itemCount, 0);
  assert.equal(detail.success, true);
  assert.deepEqual(Array.from(detail.data.case.items), []);
});

test('returns common errors for missing case IDs and missing headers', () => {
  const runtime = createRuntime({ cases: [], items: [] });
  const missingId = runtime.api_getResearchCaseDetail('');
  assert.equal(missingId.success, false);
  assert.equal(missingId.error.code, 'CASE_ID_REQUIRED');

  const invalidRuntime = createRuntime({
    caseHeader: ['案件ID', '案件名'],
    cases: [],
    items: []
  });
  const invalid = invalidRuntime.api_listResearchCases();
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'SHEET_HEADER_MISSING');
});

test('does not return detail for a case outside the research target', () => {
  const runtime = createRuntime({
    cases: [['CASE-1', '対象外', 'A市', '', '失注', false]],
    items: [itemRow()]
  });

  const result = runtime.api_getResearchCaseDetail('CASE-1');

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CASE_NOT_RESEARCH_TARGET');
});

test('UI contains copy formatting, cat-name states, and mobile overflow guards', () => {
  const html = fs.readFileSync(
    path.join(projectRoot, 'supplier-nyan', 'supplier-nyan-index.html'),
    'utf8'
  );

  assert.match(html, /品目名：/);
  assert.match(html, /数量：/);
  assert.match(html, /同等品可：/);
  assert.match(html, /全品目をコピー/);
  assert.match(html, /localStorage\.getItem/);
  assert.match(html, /localStorage\.setItem/);
  assert.match(html, /あとで変更できます/);
  assert.match(html, /猫の名前を変更/);
  assert.match(html, /environmentBadge/);
  assert.match(html, />TEST<\/span>/);
  assert.match(html, /context\.environment !== 'test'/);
  assert.match(html, /overflow-x:\s*hidden/);
  assert.match(html, /width:\s*min\(100%,\s*680px\)/);
  assert.match(html, /if \(value === true\) return '同等品可'/);
  assert.match(html, /if \(value === false\) return '同等品不可'/);
  assert.match(html, /return '未確認'/);
});

test('supplier app never uses active spreadsheet or hard-coded IDs', () => {
  const directory = path.join(projectRoot, 'supplier-nyan');
  const source = fs.readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.gs'))
    .map((fileName) =>
      fs.readFileSync(path.join(directory, fileName), 'utf8')
    )
    .join('\n');

  assert.doesNotMatch(source, /getActiveSpreadsheet\s*\(/);
  assert.match(source, /SupplierNyanSpreadsheet\.openNyusatsu\(\)/);
  assert.doesNotMatch(source, /1MYPbCOT|11enYdR_|11fw-klp/);
  assert.doesNotMatch(
    source,
    /\.(?:setValue|setValues|appendRow|deleteRow|deleteRows|insertSheet)\s*\(/
  );
  assert.doesNotMatch(source, /DriveApp\./);
});
