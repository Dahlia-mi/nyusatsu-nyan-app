const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'supplier-nyan-response.gs',
  'supplier-nyan-config.gs',
  'supplier-nyan-spreadsheet.gs',
  'supplier-nyan-app.gs'
];

function createRuntime(properties, spreadsheetNames = {}) {
  const openedIds = [];
  const sandbox = {
    console: { error() {} },
    Date,
    JSON,
    Object,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperties() {
            return { ...properties };
          }
        };
      }
    },
    SpreadsheetApp: {
      openById(id) {
        openedIds.push(id);
        if (!Object.prototype.hasOwnProperty.call(spreadsheetNames, id)) {
          throw new Error('Spreadsheet not found: ' + id);
        }
        return {
          getName() {
            return spreadsheetNames[id];
          }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          mimeType: null,
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          }
        };
      }
    }
  };

  vm.createContext(sandbox);
  sourceFiles.forEach((fileName) => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'supplier-nyan', fileName),
      'utf8'
    );
    vm.runInContext(source, sandbox, { filename: fileName });
  });

  return { sandbox, openedIds };
}

function validProperties(overrides = {}) {
  return {
    ENVIRONMENT: 'test',
    NYUSATSU_SPREADSHEET_ID: 'nyusatsu-test-id',
    SUPPLIER_RESEARCH_SPREADSHEET_ID: 'supplier-test-id',
    ALLOWED_USERS: 'mizuki@example.com, midori@example.com',
    ...overrides
  };
}

test('returns a common success response from the health check', () => {
  const runtime = createRuntime(validProperties(), {
    'nyusatsu-test-id': '入札にゃんOS テスト',
    'supplier-test-id': '仕入先調査マスター テスト'
  });

  const result = runtime.sandbox.api_healthCheck();

  assert.equal(result.success, true);
  assert.equal(result.error, null);
  assert.equal(result.data.application, 'supplier-nyan');
  assert.equal(result.data.version, '0.3.0');
  assert.equal(result.data.environment, 'test');
  assert.equal(result.data.status, 'ok');
  assert.deepEqual(runtime.openedIds, [
    'nyusatsu-test-id',
    'supplier-test-id'
  ]);
});

test('serves the health check as JSON from doGet', () => {
  const runtime = createRuntime(validProperties(), {
    'nyusatsu-test-id': '入札にゃんOS テスト',
    'supplier-test-id': '仕入先調査マスター テスト'
  });

  const output = runtime.sandbox.doGet({ parameter: { api: 'health' } });
  const result = JSON.parse(output.content);

  assert.equal(output.mimeType, 'application/json');
  assert.equal(result.success, true);
  assert.equal(result.data.status, 'ok');
});

test('stops before opening a spreadsheet when required properties are missing', () => {
  const runtime = createRuntime(
    validProperties({ SUPPLIER_RESEARCH_SPREADSHEET_ID: '' })
  );

  const result = runtime.sandbox.api_healthCheck();

  assert.equal(result.success, false);
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'CONFIG_MISSING');
  assert.equal(runtime.openedIds.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /SPREADSHEET_ID|test-id/);
});

test('rejects an unknown environment before opening a spreadsheet', () => {
  const runtime = createRuntime(validProperties({ ENVIRONMENT: 'staging' }));

  const result = runtime.sandbox.api_healthCheck();

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CONFIG_INVALID_ENVIRONMENT');
  assert.equal(runtime.openedIds.length, 0);
});

test('normalizes and deduplicates allowed users', () => {
  const runtime = createRuntime(
    validProperties({
      ALLOWED_USERS:
        ' Mizuki@Example.com,midori@example.com,mizuki@example.com '
    })
  );

  const config = runtime.sandbox.SupplierNyanConfig.load();

  assert.deepEqual(
    Array.from(config.allowedUsers),
    ['mizuki@example.com', 'midori@example.com']
  );
});

test('uses openById and never references getActiveSpreadsheet', () => {
  const supplierNyanDirectory = path.join(projectRoot, 'supplier-nyan');
  const source = fs
    .readdirSync(supplierNyanDirectory)
    .filter((fileName) => fileName.endsWith('.gs'))
    .map((fileName) =>
      fs.readFileSync(path.join(supplierNyanDirectory, fileName), 'utf8')
    )
    .join('\n');

  assert.match(source, /SpreadsheetApp\.openById/);
  assert.doesNotMatch(source, /getActiveSpreadsheet\s*\(/);
});

test('does not expose spreadsheet IDs or internal exceptions on open failure', () => {
  const runtime = createRuntime(validProperties(), {});

  const result = runtime.sandbox.api_healthCheck();
  const serialized = JSON.stringify(result);

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SPREADSHEET_OPEN_FAILED');
  assert.doesNotMatch(serialized, /nyusatsu-test-id/);
  assert.doesNotMatch(serialized, /Spreadsheet not found/);
});

test('manifest preserves the TEST spreadsheet and Drive configuration', () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, 'supplier-nyan', 'appsscript.json'),
      'utf8'
    )
  );

  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ]);
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.webapp, {
    executeAs: 'USER_DEPLOYING',
    access: 'MYSELF'
  });
  assert.equal(
    manifest.dependencies.enabledAdvancedServices[0].serviceId,
    'drive'
  );
});
