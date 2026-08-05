/**
 * 入札にゃんOS 標準見積書 Phase 1 / Step 2
 *
 * 標準見積専用API。既存APIとレスポンス形式を共有せず、Web画面、PDF、
 * Drive、01_案件管理への書戻し、提出済み操作は行わない。
 */

const STANDARD_ESTIMATE_API_ERROR_CODES = Object.freeze({
  CASE_NOT_FOUND: 'CASE_NOT_FOUND',
  ESTIMATE_NOT_FOUND: 'ESTIMATE_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  LOCK_CONFLICT: 'LOCK_CONFLICT',
  REQUEST_ID_CONFLICT: 'REQUEST_ID_CONFLICT',
  CANCELED_ESTIMATE: 'CANCELED_ESTIMATE',
  SUBMITTED_ESTIMATE_LOCKED: 'SUBMITTED_ESTIMATE_LOCKED',
  DATA_MODEL_NOT_READY: 'DATA_MODEL_NOT_READY',
  PDF_VALIDATION_ERROR: 'PDF_VALIDATION_ERROR',
  PDF_RENDER_ERROR: 'PDF_RENDER_ERROR',
  DRIVE_SAVE_ERROR: 'DRIVE_SAVE_ERROR',
  CASE_FOLDER_NOT_FOUND: 'CASE_FOLDER_NOT_FOUND',
  PDF_RECORD_ERROR: 'PDF_RECORD_ERROR',
  PDF_VERSION_NOT_FOUND: 'PDF_VERSION_NOT_FOUND',
  PDF_NOT_READY: 'PDF_NOT_READY',
  CASE_ESTIMATE_MISMATCH: 'CASE_ESTIMATE_MISMATCH',
  ATTACH_FAILED: 'ATTACH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/** 保存を行わず、案件から標準見積書の初期値候補を組み立てる。 */
function api_getStandardEstimateInitialData(caseId) {
  return runStandardEstimateApi_('', function(repository, warnings) {
    repository.assertDataModelReady();
    const caseData = repository.getCase(requiredStandardEstimateApiText_(caseId, '案件ID'));
    if (!caseData) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: String(caseId || '') });

    addStandardEstimateInitialWarnings_(caseData, warnings);
    const taxSuggestion = buildStandardEstimateTaxSuggestion_(caseData);
    const businessResult = repository.getBusinessProfile(caseData.businessProfileId);
    if (businessResult.warning) warnings.push(businessResult.warning);
    const initialItems = buildStandardEstimateInitialItems_(caseData, warnings);
    const existingEstimates = repository.listEstimatesByCase(caseData.caseId);

    return {
      caseId: caseData.caseId,
      subject: caseData.subject,
      organization: caseData.organization,
      addresseeCandidate: caseData.organization ? caseData.organization + ' 御中' : '',
      deliveryDate: caseData.deliveryDate,
      deliveryPlace: caseData.deliveryPlace,
      submissionMethod: caseData.submissionMethod,
      taxSuggestion: taxSuggestion,
      businessProfile: businessResult.profile,
      initialItems: initialItems,
      validityCandidate: '',
      pricingSuggestion: {
        amountExclusive: caseData.expectedAmountExclusive,
        source: caseData.expectedAmountExclusive === '' ? '' : '01_案件管理.想定入札額(税抜)',
        appliedToItems: false,
        note: caseData.expectedAmountExclusive === '' ? '' : '候補値です。明細の単価・金額へ自動適用していません。',
      },
      existingEstimates: existingEstimates,
    };
  });
}

/** 見積IDから標準見積正本を取得する。 */
function api_getStandardEstimate(estimateId) {
  return runStandardEstimateApi_('', function(repository) {
    repository.assertDataModelReady();
    return { estimate: repository.getEstimate(requiredStandardEstimateApiText_(estimateId, '見積ID')) };
  });
}

/** 案件別の標準見積一覧を返す。 */
function api_listStandardEstimates(caseId) {
  return runStandardEstimateApi_('', function(repository, warnings) {
    repository.assertDataModelReady();
    const id = requiredStandardEstimateApiText_(caseId, '案件ID');
    if (!repository.getCase(id)) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: id });
    const estimates = repository.listEstimatesByCase(id);
    const attached = typeof readStandardEstimateCaseAttachment === 'function' ? readStandardEstimateCaseAttachment(id) : null;
    if (attached) {
      const attachedEstimate = estimates.find(function(item) { return item.estimateId === attached.estimateId; });
      if (attachedEstimate && attachedEstimate.state === 'canceled') {
        attached.status = 'canceled';
        warnings.push('採用中の見積書は取消済みです。');
      }
    }
    return { caseId: id, estimates: estimates, attachedStandardEstimate: attached, total: estimates.length };
  });
}

/** 標準見積下書きを新規作成する。 */
function api_createStandardEstimate(caseId, draft, requestId) {
  return runStandardEstimateApi_(requestId, function(repository) {
    repository.assertDataModelReady();
    const id = requiredStandardEstimateApiText_(caseId, '案件ID');
    if (!repository.getCase(id)) throw standardEstimateApiKnownError_('CASE_NOT_FOUND', '指定された案件が見つかりません。', { caseId: id });
    if (draft && draft.caseId && String(draft.caseId).trim() !== id) {
      throw standardEstimateApiKnownError_('VALIDATION_ERROR', '案件IDがAPI引数と下書きで一致しません。', {});
    }
    const input = Object.assign({}, draft || {}, { caseId: id });
    const normalized = validateStandardEstimateDraft(input); // API境界でも必ず再計算する。
    return { estimate: repository.createDraft(normalized, requiredStandardEstimateApiText_(requestId, 'リクエストID')) };
  });
}

/** 標準見積下書きを楽観ロック付きで保存する。 */
function api_saveStandardEstimateDraft(estimateId, draft, lockVersion, requestId) {
  return runStandardEstimateApi_(requestId, function(repository) {
    repository.assertDataModelReady();
    const id = requiredStandardEstimateApiText_(estimateId, '見積ID');
    const normalized = validateStandardEstimateDraft(draft || {}); // クライアントの集計値は使用しない。
    return {
      estimate: repository.saveDraft(
        id,
        normalized,
        normalizeStandardEstimateApiLockVersion_(lockVersion),
        requiredStandardEstimateApiText_(requestId, 'リクエストID')
      ),
    };
  });
}

/** 標準見積を論理取消する。行やPDF履歴は削除しない。 */
function api_cancelStandardEstimate(estimateId, reason, lockVersion, requestId) {
  return runStandardEstimateApi_(requestId, function(repository) {
    repository.assertDataModelReady();
    return {
      estimate: repository.cancelEstimate(
        requiredStandardEstimateApiText_(estimateId, '見積ID'),
        requiredStandardEstimateApiText_(reason, '取消理由'),
        normalizeStandardEstimateApiLockVersion_(lockVersion),
        requiredStandardEstimateApiText_(requestId, 'リクエストID')
      ),
    };
  });
}

function runStandardEstimateApi_(requestId, handler) {
  const responseRequestId = String(requestId == null ? '' : requestId);
  try {
    const warnings = [];
    const data = handler(getStandardEstimateApiRepository_(), warnings);
    return normalizeStandardEstimateApiResponseValue_({
      ok: true,
      data: data || {},
      warnings: uniqueStandardEstimateWarnings_(warnings),
      requestId: responseRequestId,
    });
  } catch (error) {
    const mapped = mapStandardEstimateApiError_(error);
    return normalizeStandardEstimateApiResponseValue_({
      ok: false,
      error: { code: mapped.code, message: mapped.message, details: mapped.details || {} },
      requestId: responseRequestId,
    });
  }
}

/** google.script.run へ Date を渡さないため、API境界で再帰的にプレーン値へ正規化する。 */
function normalizeStandardEstimateApiResponseValue_(value) {
  if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(function(item) { return normalizeStandardEstimateApiResponseValue_(item); });
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce(function(result, key) {
      const normalized = normalizeStandardEstimateApiResponseValue_(value[key]);
      result[key] = normalized === undefined ? null : normalized;
      return result;
    }, {});
  }
  return value;
}

/** Apps Scriptシート・Step 1正本関数へのアダプター。テスト時は差替可能。 */
function getStandardEstimateApiRepository_() {
  return {
    assertDataModelReady: function() {
      ensureStandardEstimateModelReady_(SpreadsheetApp.getActiveSpreadsheet());
    },
    getCase: function(caseId) {
      return readStandardEstimateApiCase_(SpreadsheetApp.getActiveSpreadsheet(), caseId);
    },
    getBusinessProfile: function(profileId) {
      return readStandardEstimateApiBusinessProfile_(SpreadsheetApp.getActiveSpreadsheet(), profileId);
    },
    listEstimatesByCase: function(caseId) {
      return listStandardEstimateApiSummaries_(SpreadsheetApp.getActiveSpreadsheet(), caseId);
    },
    getEstimate: function(estimateId) {
      return getStandardEstimateDraft(estimateId);
    },
    createDraft: function(draft, requestId) {
      return createStandardEstimateDraft(draft, requestId);
    },
    saveDraft: function(estimateId, draft, lockVersion, requestId) {
      return saveStandardEstimateDraft(estimateId, draft, lockVersion, requestId);
    },
    cancelEstimate: function(estimateId, reason, lockVersion, requestId) {
      return transitionStandardEstimateState(estimateId, 'canceled', lockVersion, requestId, reason);
    },
  };
}

function readStandardEstimateApiCase_(ss, caseId) {
  const sheet = ss.getSheetByName('01_案件管理');
  if (!sheet) throw standardEstimateApiKnownError_('DATA_MODEL_NOT_READY', '案件管理シートが準備されていません。', { sheet: '01_案件管理' });
  const map = standardEstimateHeaderMap_(sheet);
  if (!map['案件ID']) throw standardEstimateApiKnownError_('DATA_MODEL_NOT_READY', '案件管理シートの列が不足しています。', { missingColumn: '案件ID' });
  if (sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const row = rows.find(function(values) { return String(values[map['案件ID'] - 1] || '').trim() === caseId; });
  if (!row) return null;
  const read = function(names) {
    for (let i = 0; i < names.length; i++) {
      if (map[names[i]]) return row[map[names[i]] - 1];
    }
    return '';
  };
  return {
    caseId: caseId,
    subject: String(read(['案件名', '件名']) || '').trim(),
    organization: String(read(['発注機関']) || '').trim(),
    deliveryDate: normalizeStandardEstimateApiValue_(read(['納品期限', '納期'])),
    deliveryPlace: String(read(['納品場所']) || '').trim(),
    submissionMethod: String(read(['提出方法']) || '').trim(),
    existingTaxDisplay: normalizeStandardEstimateApiTaxDisplay_(read(['見積税表示'])),
    businessProfileId: String(read(['事業者設定ID']) || '').trim(),
    itemName: String(read(['品目']) || '').trim(),
    itemSpecification: String(read(['仕様', '規格']) || '').trim(),
    itemQuantity: read(['数量']),
    itemUnit: String(read(['単位']) || '').trim(),
    expectedAmountExclusive: normalizeStandardEstimateApiAmountCandidate_(read(['想定入札額(税抜)'])),
  };
}

function readStandardEstimateApiBusinessProfile_(ss, requestedId) {
  const sheet = ss.getSheetByName('事業者設定');
  if (!sheet || sheet.getLastRow() < 2) {
    return { profile: null, warning: '事業者設定を取得できませんでした。' };
  }
  const map = standardEstimateHeaderMap_(sheet);
  if (!map['設定ID']) return { profile: null, warning: '事業者設定に「設定ID」列がありません。' };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const enabled = function(row) {
    if (!map['有効']) return true;
    const value = row[map['有効'] - 1];
    return !(value === false || String(value).trim().toUpperCase() === 'FALSE' || String(value).trim() === '0');
  };
  let selected = null;
  if (requestedId) {
    selected = rows.find(function(row) { return enabled(row) && String(row[map['設定ID'] - 1] || '').trim() === requestedId; }) || null;
  } else {
    selected = rows.find(function(row) {
      if (!enabled(row) || !map['デフォルト']) return false;
      const value = row[map['デフォルト'] - 1];
      return value === true || String(value).trim().toUpperCase() === 'TRUE' || String(value).trim() === '1';
    }) || rows.find(enabled) || null;
  }
  if (!selected) return { profile: null, warning: requestedId ? '指定された事業者設定を取得できませんでした。' : '有効な事業者設定を取得できませんでした。' };
  const read = function(header) { return map[header] ? selected[map[header] - 1] : ''; };
  return {
    profile: {
      profileId: String(read('設定ID') || '').trim(), name: String(read('商号') || '').trim(),
      postalCode: String(read('郵便番号') || '').trim(), address: String(read('住所') || '').trim(),
      representativeRole: String(read('代表者役職') || '').trim(), representativeName: String(read('代表者氏名') || '').trim(),
      responsibleName: String(read('本件責任者') || '').trim(), contactName: String(read('担当者') || '').trim(),
      phone: String(read('電話') || '').trim(), contactPhone: String(read('担当者電話') || '').trim(),
      fax: String(read('FAX') || '').trim(), email: String(read('メール') || '').trim(),
      invoiceRegistrationNumber: String(read('適格請求書発行事業者登録番号') || '').trim(),
    },
    warning: '',
  };
}

function listStandardEstimateApiSummaries_(ss, caseId) {
  const records = readStandardEstimateRecords_(ss.getSheetByName(STANDARD_ESTIMATE_SHEETS.HEADER), STANDARD_ESTIMATE_HEADER_HEADERS);
  return records.filter(function(row) { return String(row['案件ID']) === caseId; })
    .map(function(row) {
      return {
        estimateId: String(row['見積ID']), estimateNumber: String(row['見積番号']),
        estimateDate: normalizeStandardEstimateApiValue_(row['作成日']), subject: String(row['件名'] || ''),
        submittedAmount: Number(row['提出金額']), amountDisplay: String(row['提出金額表示']),
        state: String(row['状態']), latestVersion: Number(row['最新版番号']) || 0,
        latestPdfUrl: String(row['最新PDF URL'] || ''), lockVersion: Number(row['ロックバージョン']),
        updatedAt: normalizeStandardEstimateApiDateTime_(row['更新日時']),
      };
    }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function buildStandardEstimateInitialItems_(caseData, warnings) {
  const hasStructuredItem = !!caseData.itemName;
  const name = caseData.itemName || caseData.subject;
  if (!hasStructuredItem) warnings.push('案件に明細品名がないため、案件名を初期品名候補にしました。');
  if (!name) warnings.push('初期明細の品名を取得できませんでした。');
  const quantity = Number(caseData.itemQuantity);
  return [{
    name: name || '',
    specification: caseData.itemSpecification || '仕様書のとおり',
    quantity: quantity > 0 ? quantity : 1,
    unit: caseData.itemUnit || '式',
    unitPrice: '',
    amount: '',
    note: '',
    candidate: true,
  }];
}

function buildStandardEstimateTaxSuggestion_(caseData) {
  if (/電子調達/.test(caseData.submissionMethod || '')) {
    return { value: 'exclusive', reason: '提出方法に「電子調達」が含まれるため', editable: true, confirmed: false };
  }
  if (caseData.existingTaxDisplay) {
    return { value: caseData.existingTaxDisplay, reason: '案件の既存税表示設定', editable: true, confirmed: false };
  }
  return { value: 'exclusive', reason: '既定値', editable: true, confirmed: false };
}

function addStandardEstimateInitialWarnings_(caseData, warnings) {
  if (!caseData.subject) warnings.push('案件の件名を取得できませんでした。');
  if (!caseData.organization) warnings.push('発注機関を取得できないため、宛先候補は空です。');
  if (!caseData.deliveryDate) warnings.push('納期を取得できませんでした。');
  if (!caseData.deliveryPlace) warnings.push('納品場所を取得できませんでした。');
  if (!caseData.submissionMethod) warnings.push('提出方法を取得できませんでした。');
}

function mapStandardEstimateApiError_(error) {
  if (error && error.standardEstimateApiCode) {
    return { code: error.standardEstimateApiCode, message: error.publicMessage, details: error.publicDetails || {} };
  }
  const message = String(error && error.message || '');
  if (/未設定|準備されていません|setupStandardEstimateDataModel/.test(message)) return standardEstimateApiMappedError_('DATA_MODEL_NOT_READY', '標準見積書のデータモデルが準備されていません。');
  if (/案件ID.+見つかりません/.test(message)) return standardEstimateApiMappedError_('CASE_NOT_FOUND', '指定された案件が見つかりません。');
  if (/見積ID.+見つかりません/.test(message)) return standardEstimateApiMappedError_('ESTIMATE_NOT_FOUND', '指定された標準見積書が見つかりません。');
  if (/別の処理が更新中|ロックバージョン|別の操作で更新/.test(message)) return standardEstimateApiMappedError_('LOCK_CONFLICT', '標準見積書が別の処理で更新されています。再取得してからやり直してください。');
  if (/同じリクエストID/.test(message)) return standardEstimateApiMappedError_('REQUEST_ID_CONFLICT', '同じリクエストIDが異なる内容で使用されています。');
  if (/取消済み/.test(message)) return standardEstimateApiMappedError_('CANCELED_ESTIMATE', '取消済みの標準見積書は変更できません。');
  if (/提出済み/.test(message)) return standardEstimateApiMappedError_('SUBMITTED_ESTIMATE_LOCKED', '提出済みの標準見積書は直接変更できません。');
  if (isStandardEstimateApiValidationMessage_(message)) return standardEstimateApiMappedError_('VALIDATION_ERROR', message || '入力内容を確認してください。');
  return standardEstimateApiMappedError_('INTERNAL_ERROR', '標準見積書の処理中にエラーが発生しました。');
}

function isStandardEstimateApiValidationMessage_(message) {
  return /入力してください|不正です|以内にしてください|有効な数値|0より大きい|0以上|一致しません|変更できません|実在しない|YYYY-MM-DD/.test(message);
}

function standardEstimateApiKnownError_(code, message, details) {
  const error = new Error(message);
  error.standardEstimateApiCode = code;
  error.publicMessage = message;
  error.publicDetails = details || {};
  return error;
}

function standardEstimateApiMappedError_(code, message, details) {
  return { code: STANDARD_ESTIMATE_API_ERROR_CODES[code] || code, message: message, details: details || {} };
}

function requiredStandardEstimateApiText_(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw standardEstimateApiKnownError_('VALIDATION_ERROR', label + 'を入力してください。', { field: label });
  return text;
}

function normalizeStandardEstimateApiLockVersion_(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw standardEstimateApiKnownError_('VALIDATION_ERROR', 'ロックバージョンが不正です。', { field: 'lockVersion' });
  return number;
}

function normalizeStandardEstimateApiTaxDisplay_(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === 'exclusive' || text === '税抜' || text === '税抜き') return 'exclusive';
  if (text === 'inclusive' || text === '税込' || text === '税込み') return 'inclusive';
  return '';
}

function normalizeStandardEstimateApiAmountCandidate_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(String(value).replace(/[￥¥,\s]/g, ''));
  return isFinite(number) && number > 0 ? number : '';
}

function normalizeStandardEstimateApiValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value == null ? '' : value).trim();
}

function normalizeStandardEstimateApiDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return String(value == null ? '' : value);
}

function uniqueStandardEstimateWarnings_(warnings) {
  return warnings.filter(function(value, index, array) { return value && array.indexOf(value) === index; });
}
