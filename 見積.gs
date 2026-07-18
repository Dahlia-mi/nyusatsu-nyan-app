/**
 * ============================================================
 * 入札にゃんOS Ver4.6 — 見積書生成モジュール（案件ID自動読込＋東北OC対応）
 * ------------------------------------------------------------
 * Ver3からの変更点：
 *  ・03_見積書の対応表は「発注機関名 / 様式名 / manifestID」の3列のみに簡素化。
 *  ・テンプレの実体（Doc ID・JSON manifest・宛名情報）は
 *    別スプレッドシート「入札にゃん_テンプレ管理マスター」に集約。
 *  ・プレースホルダーの置換ロジックはmanifest.placeholdersを読んで
 *    汎用的に処理する（＝発注機関が増えてもコード修正不要）。
 *  ・同一発注機関に複数様式（紙入札・電子調達など）がある場合は
 *    該当する様式を全部まとめて一括生成する。
 *  ・案件ID読込時に前案件の明細を消去し、案件名／仕様書のとおり／1式を初期入力。
 *  ・見積生成コアをJSON payload入力へ分離。03_見積書は互換作業台として残す。
 *  ・WebアプリからはgenerateEstimateFromPayload(payload)を直接呼び出せる。
 *
 * 「01_案件管理」が司令塔。行を選択し、
 * メニュー「🐈 入札にゃん」→「見積書を生成」で実行する。
 * ============================================================
 */

// ⚠️ テンプレ管理マスター（別スプレッドシート）のID。運用開始前に必ず設定すること。
const TEMPLATE_MASTER_SS_ID = '1lbdoA2m2W-L-YrdQjTY-Hlp0bBUPvHRBhHvzDCkwwuk';
const TEMPLATE_MASTER_SHEET_NAME = '01_テンプレ一覧';

const CASE_SHEET_NAME = '01_案件管理';
const ESTIMATE_WORK_SHEET_NAME = '03_見積書';
const PDF_OUTPUT_FOLDER_NAME = '見積書_生成物';

// 03_見積書内の対応表ヘッダー（発注機関名 → 様式名 → manifestID の3列構成）
const TEMPLATE_TABLE_HEADERS = {
  ORG: '発注機関名',
  STYLE: '様式名',
  MANIFEST_ID: 'manifestID',
};

// テンプレ管理マスター側のヘッダー
const MASTER_HEADERS = {
  MANIFEST_ID: 'manifestID',
  DOC_ID: 'テンプレDoc ID',
  JSON: 'JSON',
  ACTIVE: '有効',
  ADDR1: '宛名_役職1',
  ADDR2: '宛名_役職2',
  ADDR_NAME: '宛名_氏名',
};

const CASE_HEADERS = {
  CASE_ID: '案件ID',
  CASE_NAME: '案件名',
  ORG: '発注機関',
  AMOUNT: '想定入札額(税抜)',
  DEADLINE: '納品期限',
  DELIVERY_PLACE: '納品場所',
  FOLDER_URL: '案件フォルダURL',
  PDF_LINK: '見積書PDF', // 無ければ自動で右端に新設する
};

// 03_見積書 作業台エリアのラベル名
const WORK_LABELS = {
  CASE_ID: '案件ID',
  SUBMIT_DATE: '提出日',
  ADDRESSEE: '宛名',
  SUBJECT: '件名',
  DEADLINE: '納期',
  DELIVERY_PLACE: '納品場所',
  ITEM_TABLE_HEADER: '品名',
};

const COMPANY_LABELS = {
  NAME: '屋号',
  ADDRESS: '住所',
  REP: '代表者',
  RESPONSIBLE: '本件責任者',
  RESPONSIBLE_PHONE: '本件責任者電話',
  CONTACT: '担当',
  CONTACT_PHONE: '担当電話',
};

const MAX_ITEM_ROWS = 30; // 品目テーブルを読む最大行数（安全上限）

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐈 入札にゃん')
    .addItem('案件情報を再読込', 'reloadCaseToWorkbench')
    .addSeparator()
    .addItem('見積書を生成', 'generateEstimateFromSelection')
    .addToUi();
}

/**
 * 03_見積書の「案件ID」入力欄が変更されたら、01_案件管理から案件情報を自動読込する。
 * simple trigger なので、Drive操作など権限が必要な処理はここでは行わない。
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== ESTIMATE_WORK_SHEET_NAME) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const idLabel = findCellByHeader_(sheet, WORK_LABELS.CASE_ID, 60, 1);
  if (!idLabel) return;

  const idInputRow = idLabel.row;
  const idInputCol = 2;
  if (e.range.getRow() !== idInputRow || e.range.getColumn() !== idInputCol) return;

  const caseId = String(e.range.getValue() || '').trim();
  if (!caseId) return;

  try {
    const result = loadCaseToWorkbenchById_(e.source || SpreadsheetApp.getActiveSpreadsheet(), caseId);
    (e.source || SpreadsheetApp.getActiveSpreadsheet()).toast(
      `案件情報を読み込んだにゃん：${result.caseId}`,
      '入札にゃん',
      4
    );
  } catch (err) {
    (e.source || SpreadsheetApp.getActiveSpreadsheet()).toast(
      `案件情報を読めなかったにゃん：${err.message}`,
      '入札にゃん',
      8
    );
  }
}

/** 手動再読込用。自動反映しない時の保険としてメニューから実行できる。 */
function reloadCaseToWorkbench() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const workSheet = ss.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  if (!workSheet) throw new Error(`「${ESTIMATE_WORK_SHEET_NAME}」シートが見つからないにゃん。`);

  const caseId = getValueByLabel_(workSheet, WORK_LABELS.CASE_ID);
  if (!caseId) {
    SpreadsheetApp.getUi().alert('03_見積書の案件IDを入力してから実行してほしいにゃん。');
    return;
  }

  try {
    const result = loadCaseToWorkbenchById_(ss, caseId);
    SpreadsheetApp.getUi().alert(
      '案件情報を再読込したにゃん🐈\n\n' +
      `案件ID：${result.caseId}\n` +
      `案件名：${result.caseName}`
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('案件情報を読めなかったにゃん：\n' + err.message);
  }
}

// ── 汎用ヘルパー（Ver3から継続） ────────────────────────────

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headerRow.forEach((name, idx) => {
    const key = String(name).trim();
    if (key) map[key] = idx + 1;
  });
  return map;
}

function getOrCreateColumnByHeader_(sheet, headerName, searchLimitCol) {
  const map = getHeaderMap_(sheet);
  if (map[headerName]) return map[headerName];

  const limit = searchLimitCol || sheet.getLastColumn() + 1;
  const headerRow = sheet.getRange(1, 1, 1, limit).getValues()[0];
  let targetCol = -1;
  for (let i = 0; i < limit; i++) {
    if (!String(headerRow[i]).trim()) { targetCol = i + 1; break; }
  }
  if (targetCol === -1) targetCol = limit + 1;

  sheet.getRange(1, targetCol).setValue(headerName);
  return targetCol;
}

function normalizeHeader_(s) {
  return String(s).replace(/[\s　]+/g, '').trim();
}

function findCellByHeader_(sheet, headerName, maxRows, maxCols) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) return null;

  const rows = Math.min(maxRows || 60, lastRow);
  const cols = Math.min(maxCols || lastCol, lastCol);
  const values = sheet.getRange(1, 1, rows, cols).getValues();
  const target = normalizeHeader_(headerName);

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (normalizeHeader_(values[r][c]) === target) {
        return { row: r + 1, col: c + 1 };
      }
    }
  }
  return null;
}

function setValueByLabel_(sheet, label, value) {
  const cell = findCellByHeader_(sheet, label, 60, 1);
  if (!cell) throw new Error(`「${label}」というラベルが${sheet.getName()}のA列に見つからないにゃん。`);
  sheet.getRange(cell.row, 2).setValue(value);
}

function getValueByLabel_(sheet, label) {
  const cell = findCellByHeader_(sheet, label, 60, 1);
  if (!cell) throw new Error(`「${label}」というラベルが${sheet.getName()}のA列に見つからないにゃん。`);
  return String(sheet.getRange(cell.row, 2).getValue()).trim();
}

function getOptionalValueByLabel_(sheet, label) {
  const cell = findCellByHeader_(sheet, label, 60, 1);
  if (!cell) return '';
  return String(sheet.getRange(cell.row, 2).getValue()).trim();
}

function toReiwaDateString_(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const reiwaYear = y - 2018;
  return `令和${reiwaYear}年　${m}月　${d}日`;
}

function toSeirekiDateString_(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}年${m}月${d}日`;
}

function formatYen_(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('ja-JP');
}

function getOrCreateFolder_(folderName) {
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const parents = ssFile.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const existing = parentFolder.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(folderName);
}

function openDocWithRetry_(fileId, maxRetries) {
  maxRetries = maxRetries || 4;
  let lastError = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      Utilities.sleep(1000 * (i + 1));
      return DocumentApp.openById(fileId);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error('ドキュメントを開けなかったにゃん（複数回リトライ後）：' + lastError.message);
}

// ── メイン処理 ──────────────────────────────────────────────

function generateEstimateFromSelection() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();

  if (activeSheet.getName() !== CASE_SHEET_NAME) {
    ui.alert(`「${CASE_SHEET_NAME}」シートで対象の案件行を選択してから実行してほしいにゃん。`);
    return;
  }

  const row = activeSheet.getActiveRange().getRow();
  if (row === 1) {
    ui.alert('見出し行ではなく、案件のデータ行を選択してほしいにゃん。');
    return;
  }

  try {
    const results = generateEstimatesForRow_(ss, activeSheet, row);
    const lines = results.map((r) => `【${r.style}】\n${r.pdfUrl}`).join('\n\n');
    ui.alert(
      '見積書を生成したにゃん🐈\n\n' +
      `案件ID：${results[0].caseId}\n` +
      `発注機関：${results[0].org}\n\n` +
      lines
    );
  } catch (e) {
    ui.alert('エラーが発生したにゃん：\n' + e.message);
  }
}

/**
 * 既存PC運用の互換入口。
 * 01_案件管理の選択行＋03_見積書の作業台からpayloadを作り、JSON生成コアへ渡す。
 */
function generateEstimatesForRow_(ss, caseSheet, row) {
  const payload = buildEstimatePayloadFromWorkbench_(ss, caseSheet, row);
  return generateEstimateFromPayload_(payload, { ss: ss, caseSheet: caseSheet, row: row });
}

/** 03_見積書と01_案件管理から、共通の見積payloadを作る */
function buildEstimatePayloadFromWorkbench_(ss, caseSheet, row) {
  const caseHeaderMap = getHeaderMap_(caseSheet);
  [CASE_HEADERS.CASE_ID, CASE_HEADERS.CASE_NAME, CASE_HEADERS.ORG].forEach((h) => {
    if (!caseHeaderMap[h]) throw new Error(`01_案件管理に「${h}」列が見つからないにゃん。`);
  });

  const read = (header, fallback) => caseHeaderMap[header]
    ? caseSheet.getRange(row, caseHeaderMap[header]).getValue()
    : (fallback || '');
  const workSheet = ss.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  if (!workSheet) throw new Error(`「${ESTIMATE_WORK_SHEET_NAME}」シートが見つからないにゃん。`);

  const items = readItemsFromWorkbench_(workSheet);
  if (items.length === 0) {
    throw new Error('品目テーブルにデータが無いにゃん。03_見積書で品名・数量・金額を確認してほしいにゃん。');
  }

  const caseAmount = Number(read(CASE_HEADERS.AMOUNT, '')) || 0;
  const workbenchAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const amount = workbenchAmount > 0 ? workbenchAmount : caseAmount;
  if (amount <= 0) {
    throw new Error('見積金額が未入力にゃん。03_見積書の「金額(税抜)」へ金額を入れてほしいにゃん。');
  }

  const company = {
    name: getValueByLabel_(workSheet, COMPANY_LABELS.NAME),
    address: getValueByLabel_(workSheet, COMPANY_LABELS.ADDRESS),
    representative: getOptionalValueByLabel_(workSheet, COMPANY_LABELS.REP) || getValueByLabel_(workSheet, COMPANY_LABELS.CONTACT),
    responsibleName: getOptionalValueByLabel_(workSheet, COMPANY_LABELS.RESPONSIBLE),
    responsiblePhone: getOptionalValueByLabel_(workSheet, COMPANY_LABELS.RESPONSIBLE_PHONE),
    contactName: getValueByLabel_(workSheet, COMPANY_LABELS.CONTACT),
    contactPhone: getOptionalValueByLabel_(workSheet, COMPANY_LABELS.CONTACT_PHONE),
  };
  if (!company.responsibleName) company.responsibleName = company.representative;

  return {
    caseId: String(read(CASE_HEADERS.CASE_ID, '')).trim(),
    caseName: String(read(CASE_HEADERS.CASE_NAME, '')).trim(),
    org: String(read(CASE_HEADERS.ORG, '')).trim(),
    estimateDate: new Date(),
    deadline: read(CASE_HEADERS.DEADLINE, ''),
    deliveryPlace: read(CASE_HEADERS.DELIVERY_PLACE, '仕様書のとおり') || '仕様書のとおり',
    amountTaxExclusive: amount,
    items: items,
    company: company,
  };
}

/**
 * Webアプリ等から呼ぶ公開入口。
 * payloadだけでテンプレ選択→差し込み→PDF化→01_案件管理へのURL書戻しまで実行する。
 */
function generateEstimateFromPayload(payload) {
  return generateEstimateFromPayload_(payload, {});
}

/** JSON見積生成コア。03_見積書のセル配置には依存しない。 */
function generateEstimateFromPayload_(payload, context) {
  context = context || {};
  const data = normalizeEstimatePayload_(payload);
  const ss = context.ss || SpreadsheetApp.getActiveSpreadsheet();
  const caseRef = context.caseSheet && context.row
    ? { caseSheet: context.caseSheet, row: context.row }
    : findCaseRowById_(ss, data.caseId);
  const caseSheet = caseRef.caseSheet;
  const row = caseRef.row;

  const workSheet = ss.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  if (!workSheet) throw new Error(`「${ESTIMATE_WORK_SHEET_NAME}」シートが見つからないにゃん。`);
  const templateEntries = findTemplateEntriesForOrg_(workSheet, data.org);
  if (templateEntries.length === 0) {
    throw new Error(`発注機関「${data.org}」に対応するテンプレが見つからないにゃん。`);
  }

  const amount = data.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) || data.amountTaxExclusive;
  if (amount <= 0) throw new Error('見積金額が未入力にゃん。');
  const amountStr = formatYen_(amount);
  const amountGrossStr = formatYen_(Math.round(amount * 1.1));
  const estimateDate = data.estimateDate || new Date();
  const itemDescLabel = data.items.length > 1
    ? `${data.items[0].name}外${data.items.length - 1}件`
    : data.items[0].name;

  const folder = getOrCreateFolder_(PDF_OUTPUT_FOLDER_NAME);
  const results = [];
  const skipped = [];

  templateEntries.forEach((entry) => {
    const master = getManifestById_(entry.manifestId);
    if (!master) throw new Error(`manifestID「${entry.manifestId}」がテンプレ管理マスターに見つからないにゃん。`);
    if (isFalsy_(master.active)) { skipped.push(entry.style); return; }

    const canonicalData = {
      submitDate_wareki: toReiwaDateString_(estimateDate),
      submitDate_seireki: toSeirekiDateString_(estimateDate),
      addressee_line1: master.addressee1 || '',
      addressee_line2: master.addressee2 || '',
      addressee_name: master.addresseeName || '',
      companyAddress: data.company.address,
      companyName: data.company.name,
      repName: data.company.representative,
      responsibleName: data.company.responsibleName,
      responsiblePhone: data.company.responsiblePhone,
      contactName: data.company.contactName,
      contactPhone: data.company.contactPhone,
      amount: amountStr,
      amountGross: amountGrossStr,
      caseName: data.caseName,
      deadline: data.deadline instanceof Date ? toReiwaDateString_(data.deadline) : String(data.deadline || ''),
      deliveryPlace: data.deliveryPlace,
      itemDesc: itemDescLabel,
    };

    const docName = `見積書_${data.caseId}_${data.caseName}_${entry.style}`;
    const templateFile = DriveApp.getFileById(master.docId);
    const copyFile = templateFile.makeCopy(docName, folder);
    const pdfUrl = templateFile.getMimeType() === MimeType.GOOGLE_SHEETS
      ? fillSpreadsheetTemplate_(copyFile.getId(), master.manifest, canonicalData, data.items)
      : fillDocTemplate_(copyFile.getId(), master.manifest, canonicalData, data.items);
    results.push({ caseId: data.caseId, org: data.org, style: entry.style, pdfUrl: pdfUrl });
  });

  if (results.length === 0) {
    throw new Error(`有効なテンプレが無いにゃん。スキップ：${skipped.join('、') || 'なし'}`);
  }

  const pdfCol = getOrCreateColumnByHeader_(caseSheet, CASE_HEADERS.PDF_LINK);
  caseSheet.getRange(row, pdfCol).setValue(results.map((r) => `【${r.style}】${r.pdfUrl}`).join('\n'));
  return results;
}

/** payloadの必須項目・品目構造を共通化する */
function normalizeEstimatePayload_(payload) {
  const p = payload || {};
  const items = (p.items || []).map((item) => {
    const qty = Number(item.qty !== undefined ? item.qty : item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const explicitAmount = Number(item.amount) || 0;
    return {
      name: String(item.name || '').trim(),
      spec: item.spec !== undefined ? item.spec : (item.specification || ''),
      qty: qty,
      unit: item.unit || '',
      unitPrice: unitPrice,
      amount: explicitAmount || (qty * unitPrice),
    };
  }).filter((item) => item.name);

  if (!p.caseId) throw new Error('caseIdが無いにゃん。');
  if (!p.caseName) throw new Error('caseNameが無いにゃん。');
  if (!p.org) throw new Error('org（発注機関）が無いにゃん。');
  if (items.length === 0) throw new Error('itemsが空にゃん。');

  const company = p.company || {};
  return {
    caseId: String(p.caseId).trim(),
    caseName: String(p.caseName).trim(),
    org: String(p.org).trim(),
    estimateDate: p.estimateDate ? new Date(p.estimateDate) : new Date(),
    deadline: p.deadline || '',
    deliveryPlace: p.deliveryPlace || '仕様書のとおり',
    amountTaxExclusive: Number(p.amountTaxExclusive) || 0,
    items: items,
    company: {
      name: company.name || '', address: company.address || '',
      representative: company.representative || company.repName || '',
      responsibleName: company.responsibleName || company.representative || '',
      responsiblePhone: company.responsiblePhone || '',
      contactName: company.contactName || '', contactPhone: company.contactPhone || '',
    },
  };
}

/** 案件IDで01_案件管理を全行検索し、書戻し先を返す */
function findCaseRowById_(ss, caseId) {
  const caseSheet = ss.getSheetByName(CASE_SHEET_NAME);
  if (!caseSheet) throw new Error(`「${CASE_SHEET_NAME}」シートが見つからないにゃん。`);
  const headerMap = getHeaderMap_(caseSheet);
  if (!headerMap[CASE_HEADERS.CASE_ID]) throw new Error(`「${CASE_HEADERS.CASE_ID}」列が見つからないにゃん。`);
  const lastRow = caseSheet.getLastRow();
  const found = caseSheet.getRange(2, headerMap[CASE_HEADERS.CASE_ID], Math.max(lastRow - 1, 1), 1)
    .createTextFinder(String(caseId).trim()).matchEntireCell(true).matchCase(false).findNext();
  if (!found) throw new Error(`案件ID「${caseId}」が01_案件管理に見つからないにゃん。`);
  return { caseSheet: caseSheet, row: found.getRow() };
}

/** JSONコアの接続確認用。PDFは生成せず、payload構造だけログ出力する。 */
function testBuildEstimatePayload_v46() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ref = findCaseRowById_(ss, '2026-07-003');
  const payload = buildEstimatePayloadFromWorkbench_(ss, ref.caseSheet, ref.row);
  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}

function isFalsy_(v) {
  if (v === false) return true;
  const s = String(v).trim().toUpperCase();
  return s === 'FALSE' || s === '0' || s === '';
}

// ── 対応表・テンプレ管理マスターの読み取り ──────────────────

/** 03_見積書の対応表（発注機関名/様式名/manifestID）から該当発注機関の全行を取得 */
function findTemplateEntriesForOrg_(workSheet, org) {
  const orgCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.ORG);
  const styleCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.STYLE);
  const manifestCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.MANIFEST_ID);

  if (!orgCell || !styleCell || !manifestCell) {
    throw new Error(
      `${ESTIMATE_WORK_SHEET_NAME}シートに「${TEMPLATE_TABLE_HEADERS.ORG}」` +
      `「${TEMPLATE_TABLE_HEADERS.STYLE}」「${TEMPLATE_TABLE_HEADERS.MANIFEST_ID}」の対応表が見つからないにゃん。`
    );
  }

  const headerRow = orgCell.row;
  const lastRow = workSheet.getLastRow();
  const numDataRows = lastRow - headerRow;
  if (numDataRows < 1) return [];

  const orgValues = workSheet.getRange(headerRow + 1, orgCell.col, numDataRows, 1).getValues();
  const styleValues = workSheet.getRange(headerRow + 1, styleCell.col, numDataRows, 1).getValues();
  const manifestValues = workSheet.getRange(headerRow + 1, manifestCell.col, numDataRows, 1).getValues();

  const exactEntries = [];
  const partialEntries = [];
  const orgText = String(org).trim();

  for (let i = 0; i < orgValues.length; i++) {
    const registeredOrg = String(orgValues[i][0]).trim();
    const manifestId = String(manifestValues[i][0]).trim();
    const style = String(styleValues[i][0]).trim();
    if (!registeredOrg || !manifestId) continue;

    if (registeredOrg === orgText) {
      exactEntries.push({ style, manifestId });
    } else if (orgText.indexOf(registeredOrg) !== -1 || registeredOrg.indexOf(orgText) !== -1) {
      partialEntries.push({ style, manifestId, matchLength: registeredOrg.length });
    }
  }

  if (exactEntries.length > 0) return exactEntries;
  if (partialEntries.length === 0) return [];

  const longest = Math.max.apply(null, partialEntries.map((e) => e.matchLength));
  return partialEntries
    .filter((e) => e.matchLength === longest)
    .map((e) => ({ style: e.style, manifestId: e.manifestId }));
}

/** テンプレ管理マスター（別スプレッドシート）からmanifestIDで1件取得 */
function getManifestById_(manifestId) {
  const masterSs = SpreadsheetApp.openById(TEMPLATE_MASTER_SS_ID);
  const sheet = masterSs.getSheetByName(TEMPLATE_MASTER_SHEET_NAME);
  if (!sheet) throw new Error(`テンプレ管理マスターに「${TEMPLATE_MASTER_SHEET_NAME}」シートが無いにゃん。`);

  const headerMap = getHeaderMap_(sheet);
  [MASTER_HEADERS.MANIFEST_ID, MASTER_HEADERS.DOC_ID, MASTER_HEADERS.JSON].forEach((h) => {
    if (!headerMap[h]) throw new Error(`テンプレ管理マスターに「${h}」列が無いにゃん。`);
  });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  for (const r of data) {
    if (String(r[headerMap[MASTER_HEADERS.MANIFEST_ID] - 1]).trim() === manifestId) {
      const jsonStr = r[headerMap[MASTER_HEADERS.JSON] - 1];
      let manifest;
      try {
        manifest = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error(`manifestID「${manifestId}」のJSON列が壊れてるにゃん：${e.message}`);
      }
      return {
        docId: String(r[headerMap[MASTER_HEADERS.DOC_ID] - 1]).trim(),
        manifest: manifest,
        active: headerMap[MASTER_HEADERS.ACTIVE] ? r[headerMap[MASTER_HEADERS.ACTIVE] - 1] : true,
        addressee1: headerMap[MASTER_HEADERS.ADDR1] ? r[headerMap[MASTER_HEADERS.ADDR1] - 1] : '',
        addressee2: headerMap[MASTER_HEADERS.ADDR2] ? r[headerMap[MASTER_HEADERS.ADDR2] - 1] : '',
        addresseeName: headerMap[MASTER_HEADERS.ADDR_NAME] ? r[headerMap[MASTER_HEADERS.ADDR_NAME] - 1] : '',
      };
    }
  }
  return null;
}

// ── 案件IDから作業台へ読込 ──────────────────────────────────

/**
 * 01_案件管理を全行検索し、案件IDが一致した案件を03_見積書へ反映する。
 * 201行目など離れた位置にある案件も対象。
 */
function loadCaseToWorkbenchById_(ss, caseId) {
  const caseSheet = ss.getSheetByName(CASE_SHEET_NAME);
  if (!caseSheet) throw new Error(`「${CASE_SHEET_NAME}」シートが見つからないにゃん。`);

  const workSheet = ss.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  if (!workSheet) throw new Error(`「${ESTIMATE_WORK_SHEET_NAME}」シートが見つからないにゃん。`);

  const headerMap = getHeaderMap_(caseSheet);
  [CASE_HEADERS.CASE_ID, CASE_HEADERS.CASE_NAME, CASE_HEADERS.ORG].forEach((header) => {
    if (!headerMap[header]) throw new Error(`01_案件管理に「${header}」列が見つからないにゃん。`);
  });

  const lastRow = caseSheet.getLastRow();
  if (lastRow < 2) throw new Error('01_案件管理に案件データが無いにゃん。');

  const idCol = headerMap[CASE_HEADERS.CASE_ID];
  const finder = caseSheet
    .getRange(2, idCol, lastRow - 1, 1)
    .createTextFinder(String(caseId).trim())
    .matchEntireCell(true)
    .matchCase(false);
  const found = finder.findNext();
  if (!found) throw new Error(`案件ID「${caseId}」が01_案件管理に見つからないにゃん。`);

  const row = found.getRow();
  const read = (header, fallback) => {
    if (!headerMap[header]) return fallback || '';
    return caseSheet.getRange(row, headerMap[header]).getValue();
  };

  const data = {
    caseId: read(CASE_HEADERS.CASE_ID, ''),
    caseName: read(CASE_HEADERS.CASE_NAME, ''),
    org: read(CASE_HEADERS.ORG, ''),
    deadline: read(CASE_HEADERS.DEADLINE, ''),
    deliveryPlace: read(CASE_HEADERS.DELIVERY_PLACE, '仕様書のとおり') || '仕様書のとおり',
    amount: read(CASE_HEADERS.AMOUNT, ''),
    row: row,
  };

  writeCaseHeaderToWorkbench_(workSheet, data);
  resetAndSeedItemsForCase_(workSheet, data);
  SpreadsheetApp.flush();
  return data;
}

// ── 03_見積書 作業台まわり ──────────────────────────────────

/** 作業台のヘッダー欄（案件ID/提出日/件名/納期/納品場所）を更新する。提出日は読込日、納期は案件データ。 */
function writeCaseHeaderToWorkbench_(workSheet, data) {
  setValueByLabel_(workSheet, WORK_LABELS.CASE_ID, data.caseId);
  setValueByLabel_(workSheet, WORK_LABELS.SUBMIT_DATE, new Date());
  setValueByLabel_(workSheet, WORK_LABELS.ADDRESSEE, data.org);
  setValueByLabel_(workSheet, WORK_LABELS.SUBJECT, data.caseName);
  setValueByLabel_(workSheet, WORK_LABELS.DEADLINE, data.deadline || '');
  setValueByLabel_(workSheet, WORK_LABELS.DELIVERY_PLACE, data.deliveryPlace || '仕様書のとおり');
}


/**
 * 前案件の明細を消去し、新案件の初期明細を1行だけ作る。
 * 金額は判断が必要なので自動入力しない。
 */
function resetAndSeedItemsForCase_(workSheet, data) {
  const headerCell = findCellByHeader_(workSheet, WORK_LABELS.ITEM_TABLE_HEADER);
  if (!headerCell) throw new Error(`「${WORK_LABELS.ITEM_TABLE_HEADER}」の品目テーブルが見つからないにゃん。`);

  const headerRow = headerCell.row;
  const lastCol = workSheet.getLastColumn();
  const labels = workSheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const colMap = {};
  labels.forEach((label, idx) => {
    const key = String(label).trim();
    if (key) colMap[key] = idx + 1;
  });

  const required = ['品名', '仕様・型番', '数量', '単位', '単価(税抜)', '金額(税抜)'];
  required.forEach((name) => {
    if (!colMap[name]) throw new Error(`品目テーブルに「${name}」列が見つからないにゃん。`);
  });

  const firstRow = headerRow + 1;
  const clearCols = Math.max.apply(null, required.map((name) => colMap[name]));
  workSheet.getRange(firstRow, 1, MAX_ITEM_ROWS, clearCols).clearContent();

  workSheet.getRange(firstRow, colMap['品名']).setValue(data.caseName || '');
  workSheet.getRange(firstRow, colMap['仕様・型番']).setValue('仕様書のとおり');
  workSheet.getRange(firstRow, colMap['数量']).setValue(1);
  workSheet.getRange(firstRow, colMap['単位']).setValue('式');
  // 単価・金額は手入力。前案件の値を残さないことを優先する。
}

/** 作業台の品目テーブルを、品名が空になるまで可変長で読み取る */
function readItemsFromWorkbench_(workSheet) {
  const headerCell = findCellByHeader_(workSheet, WORK_LABELS.ITEM_TABLE_HEADER);
  if (!headerCell) throw new Error(`「${WORK_LABELS.ITEM_TABLE_HEADER}」の品目テーブルが見つからないにゃん。`);

  const headerRow = headerCell.row;
  const lastCol = workSheet.getLastColumn();
  const rowLabels = workSheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const colMap = {};
  rowLabels.forEach((label, idx) => {
    const key = String(label).trim();
    if (key) colMap[key] = idx + 1;
  });

  const items = [];
  for (let i = 0; i < MAX_ITEM_ROWS; i++) {
    const r = headerRow + 1 + i;
    const name = colMap['品名'] ? String(workSheet.getRange(r, colMap['品名']).getValue()).trim() : '';
    if (!name) break;
    items.push({
      name: name,
      spec: colMap['仕様・型番'] ? workSheet.getRange(r, colMap['仕様・型番']).getValue() : '',
      qty: colMap['数量'] ? workSheet.getRange(r, colMap['数量']).getValue() : '',
      unit: colMap['単位'] ? workSheet.getRange(r, colMap['単位']).getValue() : '',
      unitPrice: colMap['単価(税抜)'] ? workSheet.getRange(r, colMap['単価(税抜)']).getValue() : '',
      amount: colMap['金額(税抜)'] ? workSheet.getRange(r, colMap['金額(税抜)']).getValue() : '',
    });
  }
  return items;
}

// ── テンプレへの差し込み：Googleドキュメント用 ────────────────

function fillDocTemplate_(fileId, manifest, canonicalData, items) {
  const doc = openDocWithRetry_(fileId);
  const body = doc.getBody();

  const placeholders = manifest.placeholders || {};
  Object.keys(placeholders).forEach((placeholder) => {
    const key = placeholders[placeholder];
    const value = canonicalData[key] !== undefined ? canonicalData[key] : '';
    const escaped = placeholder.replace(/[{}]/g, '\\$&');
    body.replaceText(escaped, String(value));
  });

  if (manifest.detailTable) {
    // Googleドキュメントのテーブル内訳（可変行）は今後の様式追加時に実装するにゃん。
    // 現状（近畿農政局の紙入札テンプレ）はdetailTable:falseなのでここは通らない。
    throw new Error('このDocテンプレのdetailTable対応はまだ実装されてないにゃん。クロちゃんに相談してほしいにゃん。');
  }

  doc.saveAndClose();

  const file = DriveApp.getFileById(fileId);
  const pdfBlob = file.getAs('application/pdf');
  pdfBlob.setName(file.getName() + '.pdf');
  const folder = file.getParents().next();
  const pdfFile = folder.createFile(pdfBlob);
  return pdfFile.getUrl();
}

// ── テンプレへの差し込み：Googleスプレッドシート用 ─────────────

function fillSpreadsheetTemplate_(fileId, manifest, canonicalData, items) {
  const targetSs = SpreadsheetApp.openById(fileId);
  const sheetName = manifest.detailSheetName || targetSs.getSheets()[0].getName();
  const sheet = targetSs.getSheetByName(sheetName);
  if (!sheet) throw new Error(`テンプレ内に「${sheetName}」シートが見つからないにゃん。`);

  if (manifest.detailTable) {
    fillItemsIntoSheet_(sheet, manifest, items);
  }

  replaceFlatPlaceholdersInSheet_(sheet, manifest.placeholders || {}, canonicalData);
  SpreadsheetApp.flush();

  const file = DriveApp.getFileById(fileId);
  const pdfBlob = file.getAs('application/pdf');
  pdfBlob.setName(file.getName() + '.pdf');
  const folder = file.getParents().next();
  const pdfFile = folder.createFile(pdfBlob);
  return pdfFile.getUrl();
}

/** シート全体を走査し、{{プレースホルダー}}を含むセルをcanonicalデータで一括置換 */
function replaceFlatPlaceholdersInSheet_(sheet, placeholderMap, data) {
  const keys = Object.keys(placeholderMap);
  if (keys.length === 0) return;

  const range = sheet.getDataRange();
  const values = range.getValues();

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      let cell = values[r][c];
      if (typeof cell === 'string' && cell.indexOf('{{') !== -1) {
        keys.forEach((placeholder) => {
          if (cell.indexOf(placeholder) !== -1) {
            const key = placeholderMap[placeholder];
            const value = data[key] !== undefined ? data[key] : '';
            cell = cell.split(placeholder).join(String(value));
          }
        });
        values[r][c] = cell;
      }
    }
  }
  range.setValues(values);
}

/**
 * 可変長の品目データをmanifest.detailTemplateRowに差し込む。
 * テンプレ行の書式をそのまま複製しながら、品目数ぶん行を増やしていく。
 */
function fillItemsIntoSheet_(sheet, manifest, items) {
  const templateRow = manifest.detailTemplateRow;
  if (!templateRow) throw new Error('manifestにdetailTemplateRowが設定されてないにゃん。');
  const itemPlaceholders = manifest.itemPlaceholders || {};

  const lastCol = sheet.getLastColumn();
  const templateRowValues = sheet.getRange(templateRow, 1, 1, lastCol).getValues()[0];

  // テンプレ行のどの列がどのcanonicalキー（品名/規格/数量/単位/単価/金額）に対応するか特定
  const colKeyMap = {};
  templateRowValues.forEach((val, idx) => {
    if (typeof val === 'string') {
      Object.keys(itemPlaceholders).forEach((placeholder) => {
        if (val.indexOf(placeholder) !== -1) {
          const subKey = itemPlaceholders[placeholder].replace('items[].', '');
          colKeyMap[idx + 1] = subKey;
        }
      });
    }
  });

  if (Object.keys(colKeyMap).length === 0) {
    throw new Error(`detailTemplateRow（${templateRow}行目）にitemPlaceholdersが見つからないにゃん。`);
  }
  if (items.length === 0) return;

  // テンプレ行の書式を退避（複数行複製に使う）
  const templateRange = sheet.getRange(templateRow, 1, 1, lastCol);

  // 2件目以降は、テンプレ行の下に行を複製して書式をコピー
  for (let i = 1; i < items.length; i++) {
    sheet.insertRowAfter(templateRow + i - 1);
    const newRange = sheet.getRange(templateRow + i, 1, 1, lastCol);
    templateRange.copyTo(newRange, { formatOnly: true });
  }

  // 全品目を書き込む（1件目はテンプレ行そのものに）
  items.forEach((item, i) => {
    const targetRow = templateRow + i;
    Object.keys(colKeyMap).forEach((colIdxStr) => {
      const colIdx = Number(colIdxStr);
      const subKey = colKeyMap[colIdx];
      const val = item[subKey] !== undefined ? item[subKey] : '';
      sheet.getRange(targetRow, colIdx).setValue(val);
    });
  });
}


// ── Ver4.3 初期設定：東北地方整備局テンプレ追加 ─────────────

/**
 * 既存のテンプレ管理マスターへ東北地方整備局の様式を追加し、
 * 03_見積書の対応表にも登録する。何度実行しても重複しない。
 */
function setupEstimateTemplateMaster_v43() {
  const manifestId = 'TOHOKU_OC_01';
  const templateDocId = '1rY0mvLb6z1zNIXrVxF9-5su1BPpuunEP';
  const styleName = 'オープンカウンター見積書';
  const orgKey = '東北地方整備局';

  const manifest = {
    version: '1.0',
    templateType: 'google-docs',
    detailTable: false,
    placeholders: {
      '{{AMOUNT_GROSS}}': 'amountGross',
      '{{CASE_NAME}}': 'caseName',
      '{{SUBMIT_DATE}}': 'submitDate_wareki',
      '{{COMPANY_ADDRESS}}': 'companyAddress',
      '{{COMPANY_NAME}}': 'companyName',
      '{{REP_NAME}}': 'repName',
      '{{RESPONSIBLE_NAME}}': 'responsibleName',
      '{{RESPONSIBLE_PHONE}}': 'responsiblePhone',
      '{{CONTACT_NAME}}': 'contactName',
      '{{CONTACT_PHONE}}': 'contactPhone',
      '{{ADDRESSEE_LINE1}}': 'addressee_line1',
      '{{ADDRESSEE_LINE2}}': 'addressee_line2',
      '{{ADDRESSEE_NAME}}': 'addressee_name',
      '{{DEADLINE}}': 'deadline',
      '{{DELIVERY_PLACE}}': 'deliveryPlace'
    }
  };

  const masterSs = SpreadsheetApp.openById(TEMPLATE_MASTER_SS_ID);
  let masterSheet = masterSs.getSheetByName(TEMPLATE_MASTER_SHEET_NAME);
  if (!masterSheet) masterSheet = masterSs.insertSheet(TEMPLATE_MASTER_SHEET_NAME);

  const requiredHeaders = [
    MASTER_HEADERS.MANIFEST_ID,
    MASTER_HEADERS.DOC_ID,
    MASTER_HEADERS.JSON,
    MASTER_HEADERS.ACTIVE,
    MASTER_HEADERS.ADDR1,
    MASTER_HEADERS.ADDR2,
    MASTER_HEADERS.ADDR_NAME
  ];
  const headerMap = ensureHeadersV43_(masterSheet, requiredHeaders);

  const masterRow = findRowByValueV43_(masterSheet, headerMap[MASTER_HEADERS.MANIFEST_ID], manifestId);
  const targetRow = masterRow || Math.max(masterSheet.getLastRow() + 1, 2);
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.MANIFEST_ID]).setValue(manifestId);
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.DOC_ID]).setValue(templateDocId);
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.JSON]).setValue(JSON.stringify(manifest));
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.ACTIVE]).setValue(true);
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.ADDR1]).setValue('東北地方整備局長');
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.ADDR2]).setValue('');
  masterSheet.getRange(targetRow, headerMap[MASTER_HEADERS.ADDR_NAME]).setValue('');

  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  const workSheet = activeSs.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  if (!workSheet) throw new Error(`「${ESTIMATE_WORK_SHEET_NAME}」シートが見つからないにゃん。`);

  const orgCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.ORG);
  const styleCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.STYLE);
  const manifestCell = findCellByHeader_(workSheet, TEMPLATE_TABLE_HEADERS.MANIFEST_ID);
  if (!orgCell || !styleCell || !manifestCell || orgCell.row !== styleCell.row || orgCell.row !== manifestCell.row) {
    throw new Error('03_見積書の対応表ヘッダー（発注機関名／様式名／manifestID）が見つからないにゃん。');
  }

  const headerRow = orgCell.row;
  const lastRow = Math.max(workSheet.getLastRow(), headerRow + 1);
  let mappingRow = 0;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const id = String(workSheet.getRange(r, manifestCell.col).getValue()).trim();
    if (id === manifestId) {
      mappingRow = r;
      break;
    }
  }
  if (!mappingRow) mappingRow = lastRow + 1;

  workSheet.getRange(mappingRow, orgCell.col).setValue(orgKey);
  workSheet.getRange(mappingRow, styleCell.col).setValue(styleName);
  workSheet.getRange(mappingRow, manifestCell.col).setValue(manifestId);

  SpreadsheetApp.flush();
  const result = {
    manifestId: manifestId,
    masterSheet: TEMPLATE_MASTER_SHEET_NAME,
    masterRow: targetRow,
    mappingSheet: ESTIMATE_WORK_SHEET_NAME,
    mappingRow: mappingRow,
    templateDocId: templateDocId
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** 東北テンプレの登録状態とDocへのアクセスを確認する。 */
function testEstimateTemplateMaster_v43() {
  const manifestId = 'TOHOKU_OC_01';
  const master = getManifestById_(manifestId);
  if (!master) throw new Error(`manifestID「${manifestId}」が見つからないにゃん。`);
  if (!master.docId) throw new Error('テンプレDoc IDが空にゃん。');

  const file = DriveApp.getFileById(master.docId);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const workSheet = ss.getSheetByName(ESTIMATE_WORK_SHEET_NAME);
  const entries = findTemplateEntriesForOrg_(workSheet, '東北地方整備局長 総務部 契約課 購買第一係');

  const result = {
    found: true,
    active: !isFalsy_(master.active),
    manifestId: manifestId,
    templateName: file.getName(),
    templateMimeType: file.getMimeType(),
    mappingFound: entries.some((e) => e.manifestId === manifestId),
    mappingEntries: entries
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function ensureHeadersV43_(sheet, headers) {
  const currentLastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, currentLastCol).getValues()[0];
  const map = {};
  current.forEach((v, i) => {
    const key = String(v).trim();
    if (key) map[key] = i + 1;
  });

  headers.forEach((header) => {
    if (!map[header]) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(header);
      map[header] = col;
    }
  });
  return map;
}

function findRowByValueV43_(sheet, col, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(value).trim()) return i + 2;
  }
  return 0;
}


/**
 * Webアプリ旧呼出名との互換ラッパー。
 * 複数テンプレ生成結果の先頭1件をWebアプリへ返す。
 */
function generateEstimateForRow_(ss, caseSheet, row) {
  const results = generateEstimatesForRow_(ss, caseSheet, row);

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('見積書の生成結果を取得できなかったにゃん。');
  }

  return results[0];
}