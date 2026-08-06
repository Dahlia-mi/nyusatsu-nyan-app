const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const supplierRoot = path.join(projectRoot, 'supplier-nyan');
const progressHeaders = [
  '案件ID', '品目ID', '問い合わせ済み', '問い合わせメモ', '調査状態',
  '作成日時', '更新日時', '更新元'
];
const quoteHeaders = [
  '見積ID', '案件ID', '品目ID', '仕入先名', 'ファイル名', 'DriveURL',
  '見積金額', '税区分', '納期', '送料', 'AI読取状態', '登録日時',
  '更新日時', '採用フラグ', '有効フラグ'
];

function createSheet(initialRows = [], options = {}) {
  const rows = initialRows.map((row) => row.slice());
  return {
    rows,
    frozenRows: 0,
    getLastRow() { return rows.length; },
    getLastColumn() {
      return rows.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValue() {
          return rows[row - 1]?.[column - 1] ?? '';
        },
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
            )
          );
        },
        setValue(value) {
          while (rows.length < row) rows.push([]);
          rows[row - 1][column - 1] = value;
          return this;
        },
        setValues(values) {
          values.forEach((valueRow, rowOffset) => {
            while (rows.length < row + rowOffset) rows.push([]);
            valueRow.forEach((value, columnOffset) => {
              rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        }
      };
    },
    appendRow(values) {
      if (options.appendError) throw options.appendError;
      rows.push(values.slice());
    },
    setFrozenRows(count) { this.frozenRows = count; }
  };
}

function loadSources(sandbox, files) {
  vm.createContext(sandbox);
  files.forEach((fileName) => {
    vm.runInContext(
      fs.readFileSync(path.join(supplierRoot, fileName), 'utf8'),
      sandbox,
      { filename: fileName }
    );
  });
  return sandbox;
}

function createProperties(environment = 'test') {
  const values = {
    ENVIRONMENT: environment,
    NYUSATSU_SPREADSHEET_ID: 'nyusatsu-fixture',
    SUPPLIER_RESEARCH_SPREADSHEET_ID: 'research-fixture',
    ALLOWED_USERS: 'fixture@example.invalid',
    SUPPLIER_NYAN_QUOTE_FOLDER_ID_TEST: 'fixture-folder'
  };
  return {
    values,
    getProperties() { return { ...values }; },
    getProperty(key) { return values[key] || null; },
    setProperty(key, value) { values[key] = String(value); }
  };
}

function createProgressRuntime({ lockAllowed = true, sheet } = {}) {
  const properties = createProperties();
  let progressSheet = sheet || null;
  const spreadsheet = {
    getSheetByName(name) {
      return name === '仕入先にゃん進捗' ? progressSheet : null;
    },
    insertSheet(name) {
      assert.equal(name, '仕入先にゃん進捗');
      progressSheet = createSheet();
      return progressSheet;
    }
  };
  const lock = {
    released: false,
    tryLock() { return lockAllowed; },
    releaseLock() { this.released = true; }
  };
  const sandbox = {
    console: { error() {} },
    Date,
    Object,
    PropertiesService: { getScriptProperties() { return properties; } },
    LockService: { getScriptLock() { return lock; } },
    SupplierNyanSpreadsheet: {
      openSupplierResearch() { return spreadsheet; }
    }
  };
  loadSources(sandbox, [
    'supplier-nyan-response.gs',
    'supplier-nyan-config.gs',
    'supplier-nyan-preference-service.gs'
  ]);
  return { sandbox, properties, lock, getSheet: () => progressSheet };
}

function createQuoteRuntime({
  environment = 'test', lockAllowed = true, appendError = null
} = {}) {
  const properties = createProperties(environment);
  const quoteSheet = createSheet([quoteHeaders], { appendError });
  const driveCreates = [];
  const drive = {
    Files: {
      get(id) {
        assert.equal(id, 'fixture-folder');
        return {
          id,
          name: 'TEST quote folder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        };
      },
      create(metadata, blob) {
        driveCreates.push({ metadata, blob });
        return {
          id: `file-${driveCreates.length}`,
          name: metadata.name,
          webViewLink: `https://example.invalid/file-${driveCreates.length}`
        };
      }
    }
  };
  const lock = {
    released: false,
    tryLock() { return lockAllowed; },
    releaseLock() { this.released = true; }
  };
  let uuid = 0;
  const sandbox = {
    console: { error() {} },
    Date,
    Object,
    PropertiesService: { getScriptProperties() { return properties; } },
    LockService: { getScriptLock() { return lock; } },
    Drive: drive,
    Utilities: {
      base64Decode(value) {
        if (value === 'TOO_LARGE') return new Uint8Array(8 * 1024 * 1024 + 1);
        return Uint8Array.from(Buffer.from(value, 'base64'));
      },
      getUuid() { uuid += 1; return `uuid-${uuid}`; },
      newBlob(bytes, mimeType, name) { return { bytes, mimeType, name }; }
    },
    SupplierNyanSpreadsheet: {
      openSupplierResearch() {
        return {
          getSheetByName(name) {
            return name === '仕入先見積書DB' ? quoteSheet : null;
          }
        };
      }
    }
  };
  loadSources(sandbox, [
    'supplier-nyan-response.gs',
    'supplier-nyan-config.gs',
    'supplier-nyan-quote-service.gs'
  ]);
  return { sandbox, quoteSheet, driveCreates, lock };
}

test('progress save creates the current sheet contract and writes one item', () => {
  const runtime = createProgressRuntime();
  const result = runtime.sandbox.api_saveItemProgress(
    'CASE-1', 'ITEM-1', true, '回答待ちメモ', '回答待ち'
  );

  assert.equal(result.success, true);
  assert.equal(result.data.researchStatus, '回答待ち');
  assert.deepEqual(runtime.getSheet().rows[0], progressHeaders);
  assert.equal(runtime.getSheet().rows[1][0], 'CASE-1');
  assert.equal(runtime.getSheet().rows[1][1], 'ITEM-1');
  assert.equal(runtime.getSheet().rows[1][2], true);
  assert.equal(runtime.getSheet().rows[1][3], '回答待ちメモ');
  assert.equal(runtime.lock.released, true);
});

test('saved progress is joined back into item detail', () => {
  const sheet = createSheet([
    progressHeaders,
    ['CASE-1', 'ITEM-1', true, '保存済み', '完了', '', '', '仕入先にゃん']
  ]);
  const runtime = createProgressRuntime({ sheet });
  const detail = {
    case: { caseId: 'CASE-1', items: [{ itemId: 'ITEM-1' }] }
  };

  runtime.sandbox.SupplierNyanPreferenceService.decorateCaseDetail(detail);

  assert.equal(detail.case.items[0].contacted, true);
  assert.equal(detail.case.items[0].inquiryMemo, '保存済み');
  assert.equal(detail.case.items[0].researchStatus, '完了');
});

test('progress save reports lock contention without writing', () => {
  const runtime = createProgressRuntime({ lockAllowed: false });
  const result = runtime.sandbox.api_saveItemProgress(
    'CASE-1', 'ITEM-1', false, '', '未着手'
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PROGRESS_LOCK_TIMEOUT');
  assert.equal(runtime.getSheet(), null);
});

test('cat name is read and saved in environment-scoped Script Properties', () => {
  const runtime = createProgressRuntime();
  const saved = runtime.sandbox.api_saveCatName('みどりにゃん');

  assert.equal(saved.success, true);
  assert.equal(
    runtime.properties.values.SUPPLIER_NYAN_CAT_NAME_TEST,
    'みどりにゃん'
  );
  assert.equal(runtime.sandbox.SupplierNyanPreferenceService.getCatName(),
    'みどりにゃん');
});

test('quote upload rejects unsupported type and files over 8MB', () => {
  const runtime = createQuoteRuntime();
  const content = Buffer.from('fixture').toString('base64');

  const badType = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', 'fixture', 'quote.txt', 'text/plain', content
  );
  const tooLarge = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', 'fixture', 'quote.pdf', 'application/pdf', 'TOO_LARGE'
  );

  assert.equal(badType.error.code, 'QUOTE_FILE_TYPE_INVALID');
  assert.equal(tooLarge.error.code, 'QUOTE_FILE_SIZE_INVALID');
  assert.equal(runtime.driveCreates.length, 0);
  assert.equal(runtime.quoteSheet.rows.length, 1);
});

test('quote upload sanitizes the Drive name and registers the DB row', () => {
  const runtime = createQuoteRuntime();
  const result = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', 'fixture supplier', '見積:書?.pdf',
    'application/pdf', Buffer.from('pdf').toString('base64')
  );

  assert.equal(result.success, true);
  assert.equal(runtime.driveCreates.length, 1);
  assert.equal(runtime.driveCreates[0].metadata.name,
    'QUOTE-uuid-1_見積_書_.pdf');
  assert.equal(runtime.quoteSheet.rows.length, 2);
  assert.equal(runtime.quoteSheet.rows[1][1], 'CASE-1');
  assert.equal(runtime.quoteSheet.rows[1][2], 'ITEM-1');
  assert.equal(runtime.quoteSheet.rows[1][14], true);
});

test('quote upload reports lock contention before Drive or DB writes', () => {
  const runtime = createQuoteRuntime({ lockAllowed: false });
  const result = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', '', 'quote.pdf', 'application/pdf',
    Buffer.from('pdf').toString('base64')
  );

  assert.equal(result.error.code, 'QUOTE_UPLOAD_BUSY');
  assert.equal(runtime.driveCreates.length, 0);
  assert.equal(runtime.quoteSheet.rows.length, 1);
});

test('quote upload remains TEST-only', () => {
  const runtime = createQuoteRuntime({ environment: 'production' });
  const result = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', '', 'quote.pdf', 'application/pdf',
    Buffer.from('pdf').toString('base64')
  );

  assert.equal(result.error.code, 'TEST_ONLY_OPERATION');
  assert.equal(runtime.driveCreates.length, 0);
});

test('current retry contract creates duplicate files and rows', () => {
  const runtime = createQuoteRuntime();
  const args = [
    'CASE-1', 'ITEM-1', 'fixture', 'quote.pdf', 'application/pdf',
    Buffer.from('pdf').toString('base64')
  ];

  const first = runtime.sandbox.api_uploadQuoteFile(...args);
  const replay = runtime.sandbox.api_uploadQuoteFile(...args);

  assert.equal(first.success, true);
  assert.equal(replay.success, true);
  assert.notEqual(first.data.quoteId, replay.data.quoteId);
  assert.equal(runtime.driveCreates.length, 2);
  assert.equal(runtime.quoteSheet.rows.length, 3);
});

test('current DB failure contract leaves the previously created Drive file', () => {
  const runtime = createQuoteRuntime({ appendError: new Error('fixture DB failure') });
  const result = runtime.sandbox.api_uploadQuoteFile(
    'CASE-1', 'ITEM-1', '', 'quote.pdf', 'application/pdf',
    Buffer.from('pdf').toString('base64')
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.equal(runtime.driveCreates.length, 1);
  assert.equal(runtime.quoteSheet.rows.length, 1);
});

test('existing quote rows can be joined by the internal detail decorator', () => {
  const runtime = createQuoteRuntime();
  runtime.quoteSheet.rows.push([
    'QUOTE-1', 'CASE-1', 'ITEM-1', 'fixture', 'quote.pdf',
    'https://example.invalid/quote', '', '', '', '', '未処理',
    new Date('2026-08-06T00:00:00Z'), '', false, true
  ]);
  const detail = {
    case: { caseId: 'CASE-1', items: [{ itemId: 'ITEM-1' }] }
  };

  runtime.sandbox.SupplierNyanQuoteService.attachToDetail(detail);

  assert.equal(detail.case.items[0].quotes.length, 1);
  assert.equal(detail.case.items[0].quotes[0].quoteId, 'QUOTE-1');
  assert.equal(typeof detail.case.items[0].quotes[0].registeredAt, 'string');
});
