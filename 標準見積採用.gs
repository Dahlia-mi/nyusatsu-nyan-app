/** 入札にゃんOS 標準見積書 Phase 1 / Step 5：案件採用版ポインター。 */

const STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS = Object.freeze([
  '標準見積ID', '標準見積書PDF', '標準見積書PDFファイルID', '標準見積書版',
  '標準見積番号', '標準見積状態', '標準見積採用日時', '標準見積更新日時',
]);

/** 01_案件管理へ不足している標準見積専用列だけを末尾追加する。自動実行しない。 */
function setupStandardEstimateCaseAttachmentColumns() {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('01_案件管理');
    if (!sheet) throw new Error('「01_案件管理」シートが見つかりません。');
    ensureStandardEstimateSheet_(ss, '01_案件管理', STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS);
    return { success: true, sheet: '01_案件管理', columns: STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.slice() };
  });
}

function api_attachStandardEstimateToCase(estimateId, version, lockVersion, requestId) {
  return runStandardEstimateApi_(requestId, function(repository, warnings) {
    repository.assertDataModelReady();
    const result = attachStandardEstimateToCase_(
      requiredStandardEstimateApiText_(estimateId, '見積ID'),
      normalizeStandardEstimateAttachmentVersion_(version),
      normalizeStandardEstimateApiLockVersion_(lockVersion),
      requiredStandardEstimateApiText_(requestId, 'リクエストID')
    );
    if (result.estimate && result.estimate.header && result.estimate.header.state === 'canceled') {
      result.attachedEstimate.status = 'canceled';
      warnings.push('採用中の見積書は取消済みです。');
    }
    return result;
  });
}

function attachStandardEstimateToCase_(estimateId, version, lockVersion, requestId) {
  return withStandardEstimateLock_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureStandardEstimateModelReady_(ss);
    ensureStandardEstimateCaseAttachmentReady_(ss);
    const request = beginStandardEstimateAttachmentRequest_(ss, requestId, estimateId, version, lockVersion);
    if (request.replayed) {
      return { caseId: request.result.caseId, attachedEstimate: request.result.attachedEstimate,
        estimate: getStandardEstimateDraftUnlocked_(ss, estimateId) };
    }

    const estimateRef = findStandardEstimateHeader_(ss, estimateId);
    assertStandardEstimateLockVersion_(estimateRef.record, lockVersion);
    if (String(estimateRef.record['状態']) === 'canceled') throw new Error('取消済みの標準見積書は案件へ採用できません。');
    const caseId = String(estimateRef.record['案件ID'] || '');
    const caseRef = findStandardEstimateAttachmentCaseRow_(ss, caseId);
    if (String(caseRef.caseId) !== caseId) throw new Error('見積と案件の案件IDが一致しません。');

    const history = listStandardEstimatePdfHistoryUnlocked_(ss, estimateId).find(function(row) {
      return Number(row['版番号']) === version;
    });
    if (!history) throw standardEstimateApiKnownError_('PDF_VERSION_NOT_FOUND', '指定されたPDF版が見つかりません。', { version: version });
    const pdfStatus = String(history['状態'] || '');
    if (['generated', 'submitted'].indexOf(pdfStatus) < 0 || !String(history['PDFファイルID'] || '').trim() || !String(history['PDF URL'] || '').trim()) {
      throw standardEstimateApiKnownError_('PDF_NOT_READY', '指定されたPDF版は案件へ採用できる状態ではありません。', { version: version });
    }
    if (String(history['案件ID'] || '') !== caseId || String(history['見積ID'] || '') !== estimateId) {
      throw standardEstimateApiKnownError_('CASE_ESTIMATE_MISMATCH', '見積とPDF履歴の案件情報が一致しません。', {});
    }

    const now = new Date();
    const values = {
      '標準見積ID': estimateId,
      '標準見積書PDF': String(history['PDF URL']),
      '標準見積書PDFファイルID': String(history['PDFファイルID']),
      '標準見積書版': version,
      '標準見積番号': String(history['見積番号'] || estimateRef.record['見積番号'] || ''),
      '標準見積状態': pdfStatus === 'submitted' ? 'submitted' : 'pdf_generated',
      '標準見積採用日時': now,
      '標準見積更新日時': now,
    };
    const previousValues = {};
    STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.forEach(function(header) {
      previousValues[header] = caseRef.sheet.getRange(caseRef.row, caseRef.headerMap[header]).getValue();
    });
    try {
      STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.forEach(function(header) {
        caseRef.sheet.getRange(caseRef.row, caseRef.headerMap[header]).setValue(values[header]);
      });
    } catch (error) {
      try {
        STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.forEach(function(header) {
          caseRef.sheet.getRange(caseRef.row, caseRef.headerMap[header]).setValue(previousValues[header]);
        });
      } catch (ignore) {}
      throw standardEstimateApiKnownError_('ATTACH_FAILED', '標準見積書を案件へ保存できませんでした。', {});
    }

    const estimate = getStandardEstimateDraftUnlocked_(ss, estimateId);
    const attachedEstimate = normalizeStandardEstimateCaseAttachment_(values);
    finishStandardEstimateAttachmentRequest_(ss, request, caseId, attachedEstimate);
    return { caseId: caseId, attachedEstimate: attachedEstimate, estimate: estimate };
  });
}

function readStandardEstimateCaseAttachment(caseId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStandardEstimateCaseAttachmentReady_(ss);
  return readStandardEstimateCaseAttachment_(ss, caseId);
}

function readStandardEstimateCaseAttachment_(ss, caseId) {
  const ref = findStandardEstimateAttachmentCaseRow_(ss, caseId);
  const read = function(header) { return ref.sheet.getRange(ref.row, ref.headerMap[header]).getValue(); };
  if (!String(read('標準見積ID') || '').trim()) return null;
  return normalizeStandardEstimateCaseAttachment_({
    '標準見積ID': read('標準見積ID'), '標準見積書PDF': read('標準見積書PDF'),
    '標準見積書PDFファイルID': read('標準見積書PDFファイルID'), '標準見積書版': read('標準見積書版'),
    '標準見積番号': read('標準見積番号'), '標準見積状態': read('標準見積状態'),
    '標準見積採用日時': read('標準見積採用日時'), '標準見積更新日時': read('標準見積更新日時'),
  });
}

function normalizeStandardEstimateCaseAttachment_(record) {
  if (!record) return null;
  return {
    estimateId: String(record['標準見積ID'] || ''), estimateNumber: String(record['標準見積番号'] || ''),
    version: Number(record['標準見積書版']) || 0, pdfUrl: String(record['標準見積書PDF'] || ''),
    pdfFileId: String(record['標準見積書PDFファイルID'] || ''), status: String(record['標準見積状態'] || ''),
    attachedAt: normalizeStandardEstimateStoredDateTime_(record['標準見積採用日時']),
    updatedAt: normalizeStandardEstimateStoredDateTime_(record['標準見積更新日時']),
  };
}

function ensureStandardEstimateCaseAttachmentReady_(ss) {
  const sheet = ss.getSheetByName('01_案件管理');
  if (!sheet) throw new Error('「01_案件管理」シートが未設定です。');
  const map = standardEstimateHeaderMap_(sheet);
  if (!map['案件ID']) throw new Error('01_案件管理に「案件ID」列がありません。');
  STANDARD_ESTIMATE_CASE_ATTACHMENT_HEADERS.forEach(function(header) {
    if (!map[header]) throw new Error('01_案件管理に「' + header + '」列が未設定です。setupStandardEstimateCaseAttachmentColumns()を実行してください。');
  });
}

function findStandardEstimateAttachmentCaseRow_(ss, caseId) {
  const sheet = ss.getSheetByName('01_案件管理');
  if (!sheet) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: caseId });
  const map = standardEstimateHeaderMap_(sheet);
  if (!map['案件ID']) throw new Error('01_案件管理に「案件ID」列がありません。');
  if (sheet.getLastRow() < 2) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: caseId });
  const values = sheet.getRange(2, map['案件ID'], sheet.getLastRow() - 1, 1).getValues();
  const index = values.findIndex(function(row) { return String(row[0] || '').trim() === caseId; });
  if (index < 0) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: caseId });
  return { sheet: sheet, row: index + 2, headerMap: map, caseId: caseId };
}

function normalizeStandardEstimateAttachmentVersion_(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw standardEstimateApiKnownError_('VALIDATION_ERROR', 'PDF版番号が不正です。', { field: 'version' });
  return number;
}

function beginStandardEstimateAttachmentRequest_(ss, requestId, estimateId, version, lockVersion) {
  const inputHash = standardEstimateStableHash_({ version: version, lockVersion: lockVersion });
  const rows = readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.REQUEST), STANDARD_ESTIMATE_REQUEST_HEADERS);
  const existing = rows.find(function(row) { return String(row['リクエストID']) === requestId; });
  if (!existing) return { replayed: false, requestId: requestId, operation: 'attach-case', targetId: estimateId, inputHash: inputHash };
  if (String(existing['操作']) !== 'attach-case' || String(existing['対象ID']) !== estimateId || String(existing['入力ハッシュ']) !== inputHash) {
    throw new Error('同じリクエストIDが異なる操作または内容で使用されています。');
  }
  const result = parseStandardEstimateJson_(existing['結果JSON'], null);
  if (!result || !result.caseId || !result.attachedEstimate) throw new Error('採用版の冪等性履歴から結果を復元できません。');
  return { replayed: true, result: result };
}

function finishStandardEstimateAttachmentRequest_(ss, request, caseId, attachedEstimate) {
  appendStandardEstimateRecord_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.REQUEST), STANDARD_ESTIMATE_REQUEST_HEADERS, {
    'リクエストID': request.requestId, '操作': request.operation, '対象ID': request.targetId,
    '入力ハッシュ': request.inputHash,
    '結果JSON': JSON.stringify({ caseId: caseId, attachedEstimate: attachedEstimate }), '処理日時': new Date(),
  });
}
