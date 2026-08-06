/** 入札にゃんOS 標準見積書 Phase 1 / Step 4：PDF生成専用。 */

const STANDARD_ESTIMATE_PDF_TEMPLATE = 'standard-estimate-template';
const STANDARD_ESTIMATE_PDF_FALLBACK_FOLDER = '見積書_生成物';
const STANDARD_ESTIMATE_PDF_SOURCE = 'standard-web';

function api_generateStandardEstimatePdf(estimateId, lockVersion, requestId) {
  return runStandardEstimateApi_(requestId, function(repository, warnings) {
    repository.assertDataModelReady();
    const id = requiredStandardEstimateApiText_(estimateId, '見積ID');
    const version = normalizeStandardEstimateApiLockVersion_(lockVersion);
    const requestKey = requiredStandardEstimateApiText_(requestId, 'リクエストID');
    const replay = getStandardEstimatePdfRequestReplay(id, version, requestKey);
    if (replay) {
      const replayFallback = isStandardEstimatePdfFallbackHistory_(replay.history);
      if (replayFallback) warnings.push('案件フォルダを利用できなかったため、「見積書_生成物」へ保存しました。');
      return buildStandardEstimatePdfApiResult_(replay.estimate, replay.history, replayFallback);
    }
    const estimate = repository.getEstimate(id);
    assertStandardEstimatePdfState_(estimate.header);
    if (Number(estimate.header.lockVersion) !== version) {
      throw standardEstimateApiKnownError_('LOCK_CONFLICT', '標準見積書が別の処理で更新されています。再取得してからやり直してください。', {});
    }

    const model = buildStandardEstimatePdfModel_(estimate, Number(estimate.header.latestVersion || 0) + 1, new Date());
    const dataHash = standardEstimatePdfDataHash_(model);

    validateStandardEstimatePdfModel_(model);
    const pages = paginateStandardEstimatePdfItems_(model.items);
    model.pages = pages;
    model.pageCount = pages.length;
    if (pages.length > 1) warnings.push('明細量が多いため、PDFは' + pages.length + 'ページになりました。');

    let rendered;
    try {
      rendered = renderStandardEstimatePdfHtml_(model);
    } catch (error) {
      throw standardEstimateApiKnownError_('PDF_RENDER_ERROR', '標準見積書PDFのHTML生成に失敗しました。', {});
    }
    let pdfBlob;
    let pdfPageCount;
    const fileName = buildStandardEstimatePdfFileName_(model);
    try {
      pdfBlob = Utilities.newBlob(rendered, 'text/html', fileName + '.html').getAs(MimeType.PDF).setName(fileName);
      pdfPageCount = countStandardEstimatePdfPages_(pdfBlob, model.pageCount);
    } catch (error) {
      throw standardEstimateApiKnownError_('PDF_RENDER_ERROR', '標準見積書をPDFへ変換できませんでした。', {});
    }

    let destination;
    let file;
    try {
      destination = resolveStandardEstimatePdfFolder_(estimate.header.caseId);
      file = destination.folder.createFile(pdfBlob);
      if (!file || !file.getId()) throw new Error('Drive保存結果を確認できません。');
    } catch (error) {
      throw standardEstimateApiKnownError_('DRIVE_SAVE_ERROR', '標準見積書PDFをDriveへ保存できませんでした。', {});
    }
    if (destination.usedFallbackFolder) warnings.push('案件フォルダを利用できなかったため、「見積書_生成物」へ保存しました。');

    let recorded;
    try {
      recorded = recordStandardEstimatePdfSuccess(id, {
        fileId: file.getId(), pdfUrl: file.getUrl(), fileName: file.getName(),
        folderId: destination.folder.getId(), pageCount: pdfPageCount,
        generationSource: STANDARD_ESTIMATE_PDF_SOURCE, dataHash: dataHash, snapshot: model,
      }, version, requestKey);
    } catch (error) {
      const recordMessage = String(error && error.message || '');
      if (/同じリクエストID/.test(recordMessage)) throw standardEstimateApiKnownError_('REQUEST_ID_CONFLICT', '同じリクエストIDが異なる内容で使用されています。', {});
      if (/別の処理が更新中|ロックバージョン|別の操作で更新/.test(recordMessage)) {
        throw standardEstimateApiKnownError_('LOCK_CONFLICT', '標準見積書が別の処理で更新されています。再取得してからやり直してください。', {});
      }
      throw standardEstimateApiKnownError_('PDF_RECORD_ERROR', 'PDFは保存されましたが、標準見積書の履歴記録に失敗しました。', {});
    }
    const history = recorded.pdfHistory.filter(function(row) { return String(row['リクエストID']) === requestKey; }).pop();
    return buildStandardEstimatePdfApiResult_(recorded, history, destination.usedFallbackFolder);
  });
}

function buildStandardEstimatePdfModel_(estimate, version, generatedAt) {
  const h = estimate && estimate.header || {};
  const company = h.businessSnapshot || {};
  const amounts = calculateStandardEstimateAmounts({
    amountDisplay: h.amountDisplay, taxCategory: h.taxCategory, taxRate: h.taxRate,
    roundingMode: h.roundingMode, items: estimate.items || [],
  });
  return {
    schemaVersion: '1.0', estimateId: String(h.estimateId || ''), estimateNumber: String(h.estimateNumber || ''),
    version: Number(version), estimateDate: String(h.estimateDate || ''),
    case: { caseId: String(h.caseId || ''), subject: String(h.subject || ''), addressee: String(h.addressee || ''),
      deliveryDate: String(h.deliveryDate || ''), deliveryPlace: String(h.deliveryPlace || ''), validity: String(h.validity || '') },
    company: { profileId: String(h.businessProfileId || company.profileId || ''), name: String(company.name || ''),
      postalCode: String(company.postalCode || ''), address: String(company.address || ''),
      representativeRole: String(company.representativeRole || ''), representativeName: String(company.representativeName || ''),
      responsibleName: String(company.responsibleName || ''), contactName: String(company.contactName || ''),
      phone: String(company.phone || company.contactPhone || ''), fax: String(company.fax || ''), email: String(company.email || ''),
      invoiceRegistrationNumber: String(company.invoiceRegistrationNumber || '') },
    items: amounts.items.map(function(item, index) { return {
      lineNumber: index + 1, name: item.name, specification: item.specification, quantity: item.quantity,
      unit: item.unit, unitPrice: item.unitPrice, amount: item.amount, note: item.note,
    }; }),
    tax: { amountDisplay: amounts.amountDisplay, category: amounts.taxCategory, rate: amounts.taxRate,
      roundingMode: amounts.roundingMode, subtotal: amounts.subtotal, taxAmount: amounts.taxAmount,
      total: amounts.total, submittedAmount: amounts.submittedAmount },
    note: String(h.note || ''), generatedAt: standardEstimatePdfIso_(generatedAt),
  };
}

function validateStandardEstimatePdfModel_(model) {
  const missing = [];
  [['見積ID', model.estimateId], ['見積番号', model.estimateNumber], ['作成日', model.estimateDate],
    ['宛先', model.case.addressee], ['件名', model.case.subject], ['会社名', model.company.name],
    ['会社住所', model.company.address], ['代表者', model.company.representativeName],
    ['納期', model.case.deliveryDate], ['納品場所', model.case.deliveryPlace]].forEach(function(pair) {
    if (!String(pair[1] == null ? '' : pair[1]).trim()) missing.push(pair[0]);
  });
  if (!model.items.length) missing.push('見積明細');
  model.items.forEach(function(item, index) {
    if (!String(item.name || '').trim()) missing.push('明細' + (index + 1) + 'の品名');
    if (!(Number(item.quantity) > 0)) missing.push('明細' + (index + 1) + 'の数量');
    if (!String(item.unit || '').trim()) missing.push('明細' + (index + 1) + 'の単位');
    if (!(Number(item.unitPrice) >= 0)) missing.push('明細' + (index + 1) + 'の単価');
  });
  if (missing.length) throw standardEstimateApiKnownError_('PDF_VALIDATION_ERROR', 'PDF生成に必要な項目を確認してください。', { fields: missing });
  return model;
}

function paginateStandardEstimatePdfItems_(items) {
  const costs = items.map(standardEstimatePdfItemCost_);
  const total = costs.reduce(function(sum, cost) { return sum + cost; }, 0);
  if (total <= 30) return [{ items: items.slice(), isFinal: true }];
  const pages = [];
  let pageItems = [], pageCost = 0;
  items.forEach(function(item, index) {
    const cost = costs[index];
    if (pageItems.length && pageCost + cost > 36) { pages.push({ items: pageItems, isFinal: false }); pageItems = []; pageCost = 0; }
    pageItems.push(item); pageCost += cost;
  });
  if (pageItems.length) pages.push({ items: pageItems, isFinal: true });
  while (pages.length > 1 && standardEstimatePdfPageCost_(pages[pages.length - 1].items) > 22) {
    const last = pages[pages.length - 1];
    const moved = last.items.shift();
    pages[pages.length - 2].items.push(moved);
    if (!last.items.length) pages.pop();
  }
  pages.forEach(function(page, index) { page.number = index + 1; page.isFinal = index === pages.length - 1; });
  return pages;
}

function standardEstimatePdfItemCost_(item) {
  const text = [item.name, item.specification, item.note].join('\n');
  return Math.max(2, Math.min(12, 1 + Math.ceil(String(text).length / 34) + (String(text).match(/\n/g) || []).length));
}
function standardEstimatePdfPageCost_(items) { return items.reduce(function(sum, item) { return sum + standardEstimatePdfItemCost_(item); }, 0); }

function renderStandardEstimatePdfHtml_(model) {
  const template = HtmlService.createTemplateFromFile(STANDARD_ESTIMATE_PDF_TEMPLATE);
  template.modelJson = JSON.stringify(model);
  return template.evaluate().getContent();
}

/** 変換済みPDFのPageオブジェクト数を読み、取得不能時だけ分割計画値へ戻す。 */
function countStandardEstimatePdfPages_(pdfBlob, plannedCount) {
  try {
    const binary = pdfBlob.getDataAsString('ISO-8859-1');
    const matches = binary.match(/\/Type\s*\/Page\b/g) || [];
    if (matches.length > 0) return matches.length;
  } catch (ignore) {}
  return Number(plannedCount) || 1;
}

function resolveStandardEstimatePdfFolder_(caseId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('01_案件管理');
  let projectFolder = null;
  if (sheet && sheet.getLastRow() >= 2) {
    const map = standardEstimateHeaderMap_(sheet);
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const row = rows.find(function(values) { return String(values[(map['案件ID'] || 1) - 1] || '').trim() === caseId; });
    if (row) {
      const read = function(names) { for (let i = 0; i < names.length; i++) if (map[names[i]]) return row[map[names[i]] - 1]; return ''; };
      const direct04 = standardEstimatePdfDriveId_(read(['04_見積フォルダID', '見積フォルダID']));
      if (direct04) try { return { folder: DriveApp.getFolderById(direct04), usedFallbackFolder: false }; } catch (ignore) {}
      const projectId = standardEstimatePdfDriveId_(read(['案件フォルダID', 'folderId', 'フォルダID'])) ||
        standardEstimatePdfDriveId_(read(['案件フォルダURL', '案件フォルダ']));
      if (projectId) try { projectFolder = DriveApp.getFolderById(projectId); } catch (ignore) {}
    }
  }
  if (!projectFolder) projectFolder = findStandardEstimateProjectFolderByCaseId_(caseId);
  if (projectFolder) {
    const folders = projectFolder.getFoldersByName('04_見積');
    return { folder: folders.hasNext() ? folders.next() : projectFolder.createFolder('04_見積'), usedFallbackFolder: false };
  }
  return { folder: getOrCreateFolder_(STANDARD_ESTIMATE_PDF_FALLBACK_FOLDER), usedFallbackFolder: true };
}

function findStandardEstimateProjectFolderByCaseId_(caseId) {
  const target = String(caseId == null ? '' : caseId).trim();
  if (!target) return null;

  const rootId = String(PropertiesService.getScriptProperties().getProperty('NYAN_PROJECT_ROOT_FOLDER_ID') || '').trim();
  if (!rootId) return null;

  let root;
  try {
    root = DriveApp.getFolderById(rootId);
  } catch (ignore) {
    return null;
  }

  const folders = root.getFoldersByName(target);
  if (!folders.hasNext()) return null;
  const projectFolder = folders.next();
  if (folders.hasNext()) throw new Error('案件IDと同名の案件フォルダが複数あります: ' + target);
  return projectFolder;
}

function standardEstimatePdfDriveId_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const match = text.match(/[-\w]{20,}/);
  return match ? match[0] : '';
}

function buildStandardEstimatePdfFileName_(model) {
  const safe = function(value) { return String(value || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'NO-ID'; };
  return '標準見積書_' + safe(model.estimateNumber) + '_第' + String(model.version).padStart(2, '0') + '版_' + safe(model.case.caseId) + '.pdf';
}

function buildStandardEstimatePdfApiResult_(estimate, history, usedFallbackFolder) {
  const h = history || {};
  return { estimate: estimate, pdf: {
    historyId: String(h['PDF履歴ID'] || ''), version: Number(h['版番号']) || 0,
    fileId: String(h['PDFファイルID'] || ''), url: String(h['PDF URL'] || ''), fileName: String(h['ファイル名'] || ''),
    pageCount: Number(h['ページ数']) || 1, folderId: String(h['保存先フォルダID'] || ''),
    usedFallbackFolder: !!usedFallbackFolder,
  } };
}

function assertStandardEstimatePdfState_(header) {
  if (!header) throw standardEstimateApiKnownError_('ESTIMATE_NOT_FOUND', '指定された標準見積書が見つかりません。', {});
  if (header.state === 'canceled') throw standardEstimateApiKnownError_('CANCELED_ESTIMATE', '取消済みの標準見積書からPDFは生成できません。', {});
  if (header.state === 'submitted') throw standardEstimateApiKnownError_('SUBMITTED_ESTIMATE_LOCKED', '提出済みの標準見積書から直接PDFは生成できません。', {});
}
function isStandardEstimatePdfFallbackHistory_(history) {
  const folderId = String(history && history['保存先フォルダID'] || '');
  if (!folderId || typeof DriveApp === 'undefined') return false;
  try { return DriveApp.getFolderById(folderId).getName() === STANDARD_ESTIMATE_PDF_FALLBACK_FOLDER; } catch (ignore) { return false; }
}
function standardEstimatePdfIso_(value) { return value instanceof Date ? value.toISOString() : String(value || ''); }
function standardEstimatePdfDataHash_(model) {
  const stable = JSON.parse(JSON.stringify(model || {}));
  stable.generatedAt = '';
  delete stable.pages;
  delete stable.pageCount;
  return standardEstimateStableHash_(stable);
}
