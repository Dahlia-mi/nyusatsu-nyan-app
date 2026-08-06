const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', 'supplier-nyan');
const testSourceContract = Object.freeze({
  'appsscript.json': {
    gitName: 'appsscript.json',
    sha256: '27de821fcdd066857c94f50e7993db90edbb70891072a33b8f3adbec1744aac2'
  },
  'コード.gs': {
    gitName: 'supplier-nyan-response.gs',
    sha256: '03703c4d44cd4898036aed1a8311d862dec5d805d991196c9f0f37a25e4488a1'
  },
  'supplier-nyan-config.gs': {
    gitName: 'supplier-nyan-config.gs',
    sha256: '2bb04afbf7200ac991c7baf76ed3193275bd53ddb6c87ea1f0c4477dff0702dd'
  },
  'supplier-nyan-spreadsheet.gs': {
    gitName: 'supplier-nyan-spreadsheet.gs',
    sha256: '5afa13aad9dabf5285db9ddf0f92126d0c5a69965aa4e2761acc28b95445ce41'
  },
  'supplier-nyan-case-service.gs': {
    gitName: 'supplier-nyan-case-service.gs',
    sha256: '444c9658e90691f32583af63c4fce378511dcb1705f6a800b1d3b25b1e831535'
  },
  'supplier-nyan-app.gs': {
    gitName: 'supplier-nyan-app.gs',
    sha256: '1557f0538b1f95c63b53c20e0245ea3a2313ff894e9f6f5dba0860f8236b1e1a'
  },
  'supplier-nyan-index.html': {
    gitName: '../tests/fixtures/supplier-nyan-test-v12/supplier-nyan-index.html',
    currentEntryPoint: 'supplier-nyan-index.html',
    sha256: 'b9e18f74ca9d3675a4378a453e7a6a435f22c9640d4bf485e3745107f62d8caf'
  },
  'supplier-nyan-preference-service.gs': {
    gitName: 'supplier-nyan-preference-service.gs',
    sha256: 'd9b9d5aa440779e10dccc8e57d2c91b512ff44b1c4174652a5d139b503876eff'
  },
  'supplier-nyan-cat-assets.html': {
    gitName: 'supplier-nyan-cat-assets.html',
    sha256: '8b746aba03eae9ff79897ba07802963ead0c161c1aeda21eaf8f1e510087ba3c'
  },
  'supplier-nyan-quote-service.gs': {
    gitName: 'supplier-nyan-quote-service.gs',
    sha256: 'aa5a09f68e4a016002779e4ba089b161e99592b7d64fe516f2408bb159d1ddfa'
  }
});

function normalizedHash(fileName) {
  const source = fs.readFileSync(path.join(root, fileName), 'utf8')
    .replace(/\r\n/g, '\n')
    .trimEnd();
  return crypto.createHash('sha256').update(source).digest('hex');
}

test('Git files reproduce all ten Apps Script TEST Version 12 sources', () => {
  assert.equal(Object.keys(testSourceContract).length, 10);
  Object.entries(testSourceContract).forEach(([appsScriptName, contract]) => {
    assert.equal(
      normalizedHash(contract.gitName),
      contract.sha256,
      `${appsScriptName} must match TEST Version 12`
    );
  });
});

test('the Apps Script to Git filename mapping remains explicit', () => {
  assert.equal(testSourceContract['コード.gs'].gitName,
    'supplier-nyan-response.gs');
  assert.equal(testSourceContract['appsscript.json'].gitName,
    'appsscript.json');
  assert.equal(testSourceContract['supplier-nyan-cat-assets.html'].gitName,
    'supplier-nyan-cat-assets.html');
  assert.equal(testSourceContract['supplier-nyan-index.html'].currentEntryPoint,
    'supplier-nyan-index.html');
});

test('the repository does not contain connection secrets in supplier sources', () => {
  const textSources = fs.readdirSync(root)
    .filter((name) => /\.(?:gs|html|json|md)$/.test(name))
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(textSources, /AKIA[0-9A-Z]{16}/);
  assert.doesNotMatch(textSources, /ya29\.[0-9A-Za-z_-]+/);
  assert.doesNotMatch(textSources, /https:\/\/script\.google\.com\/macros\/s\//);
});
