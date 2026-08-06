const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const supplierRoot = path.join(root, 'supplier-nyan');

function read(name) {
  return fs.readFileSync(path.join(supplierRoot, name), 'utf8');
}

function normalizeStaticMarkup(source) {
  return source
    .replace(/<style>[\s\S]*?<\/style>/, '<style></style>')
    .replace(/<script>[\s\S]*?<\/script>/, '<script></script>')
    .replace(/>\s+</g, '><')
    .trim();
}

test('index composes the unchanged screens through includeSupplierNyanFile_', () => {
  const index = read('supplier-nyan-index.html');
  const includes = [
    'supplier-nyan-styles',
    'supplier-nyan-navigation',
    'supplier-nyan-home',
    'supplier-nyan-case-list',
    'supplier-nyan-case-detail',
    'supplier-nyan-dialogs',
    'supplier-nyan-home-assets',
    'supplier-nyan-scripts'
  ];

  includes.forEach((name) => {
    assert.match(index, new RegExp(
      `includeSupplierNyanFile_\\('${name}'\\)`
    ));
  });
  assert.doesNotMatch(index, /google\.script\.run|SpreadsheetApp|Drive\.Files/);
  assert.doesNotMatch(index, /includeSupplierNyanFile_\('supplier-nyan-cat-assets'\)/);
});

test('Version 12 fixture remains fixed while Home uses the formal component markup', () => {
  const current = read('supplier-nyan-home.html') + read('supplier-nyan-navigation.html');
  const baseline = fs.readFileSync(path.join(
    root,
    'tests',
    'fixtures',
    'supplier-nyan-test-v12',
    'supplier-nyan-index.html'
  ), 'utf8');

  assert.match(baseline, /id="homeHero"/);
  assert.match(current, /id="dailyInstruction"/);
  assert.match(current, /class="wood-card quest-board"/);
  assert.match(current, /id="recentList"/);
  assert.match(current, /id="statusBoard"/);
  assert.match(current, /id="bottomNavigation"/);
  assert.notEqual(normalizeStaticMarkup(current), normalizeStaticMarkup(baseline));
});

test('AppContext separates data, application, UI and navigation state', () => {
  const scripts = read('supplier-nyan-scripts.html');

  ['data', 'application', 'ui', 'pending', 'navigation', 'filters', 'scroll']
    .forEach((namespace) => {
      assert.match(scripts, new RegExp(`\\b${namespace}: \\{`));
    });
  assert.doesNotMatch(scripts, /\bstate\.(?:cases|currentCase|activeQuest)/);
});

test('only the API adapter knows google.script.run', () => {
  const scripts = read('supplier-nyan-scripts.html');
  const directCalls = scripts.match(/google\.script\.run/g) || [];

  assert.equal(directCalls.length, 1);
  assert.match(scripts, /var SupplierNyanApi = Object\.freeze/);
  assert.match(scripts, /var CaseService = Object\.freeze/);
  assert.match(scripts, /CaseService\.listResearchCases\(\)/);
  assert.match(scripts, /CaseService\.getResearchCaseDetail\(caseId\)/);
  assert.match(scripts, /CaseService\.saveItemProgress\(/);
  assert.match(scripts, /CaseService\.uploadQuoteFile\(/);
});

test('split UI retains home, list, detail, progress, quote and navigation paths', () => {
  const source = [
    read('supplier-nyan-home.html'),
    read('supplier-nyan-case-list.html'),
    read('supplier-nyan-case-detail.html'),
    read('supplier-nyan-navigation.html'),
    read('supplier-nyan-styles.html'),
    read('supplier-nyan-scripts.html')
  ].join('\n');

  assert.match(source, /id="dailyInstruction"/);
  assert.match(source, /id="questList"/);
  assert.match(source, /id="recentList"/);
  assert.match(source, /id="statusBoard"/);
  assert.match(source, /id="caseList"/);
  assert.match(source, /id="caseDetail"/);
  assert.match(source, /api_saveItemProgress/);
  assert.match(source, /api_uploadQuoteFile/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /homeScrollY/);
  assert.match(source, /Header and navigation boundary/);
  assert.match(source, /Home quests and filters/);
  assert.match(source, /Case list/);
  assert.match(source, /Case detail/);
  assert.match(source, /Progress panel/);
  assert.match(source, /Quote panel/);
  assert.match(source, /HOME_NAVIGATION = Object\.freeze/);
  assert.match(source, /nav\.home\.selected/);
  assert.match(source, /grid-template-columns:\s*repeat\(4/);
  assert.match(source, /nav-item__icon--selected\s*\{\s*opacity:\s*0/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /@media \(max-width:\s*359px\)/);
  assert.match(source, /@media \(min-width:\s*360px\) and \(max-width:\s*430px\)/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /min-height:\s*48px/);
});

test('server API names and signatures remain unchanged', () => {
  const server = fs.readdirSync(supplierRoot)
    .filter((name) => name.endsWith('.gs'))
    .map(read)
    .join('\n');

  [
    /function api_healthCheck\(\)/,
    /function api_getAppContext\(\)/,
    /function api_listResearchCases\(questType\)/,
    /function api_getResearchCaseDetail\(caseId\)/,
    /function api_saveCatName\(name\)/,
    /function api_saveItemProgress\(caseId, itemId, contacted, memo, researchStatus\)/,
    /function api_uploadQuoteFile\(\s*caseId,\s*itemId,\s*supplierName,\s*fileName,\s*mimeType,\s*base64Data\s*\)/
  ].forEach((signature) => assert.match(server, signature));
});
