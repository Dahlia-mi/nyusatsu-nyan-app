/**
 * 案件品目DB
 *
 * 案件ヘッダーとは分離して、案件ID配下の複数品目を正本管理する。
 * 既存の01_案件管理とcase.jsonは互換表示・スナップショットとして維持する。
 */

const CASE_ITEMS_DB_SHEET_NAME = '案件品目DB';
const CASE_ITEMS_DB_HEADERS = Object.freeze([
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
const CASE_ITEMS_DB_UPDATE_SOURCE = '案件カルテ';
const CASE_ITEMS_DB_MAX_SEQUENCE = 999;

function buildCaseItemsHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach(function(header, index) {
    const name = String(header || '').trim();
    if (name && !Object.prototype.hasOwnProperty.call(map, name)) {
      map[name] = index;
    }
  });
  return map;
}

function assertCaseItemsHeaders_(headerMap) {
  const missing = CASE_ITEMS_DB_HEADERS.filter(function(header) {
    return !Object.prototype.hasOwnProperty.call(headerMap, header);
  });
  if (missing.length) {
    throw new Error('案件品目DBの必須列が不足しています: ' + missing.join(', '));
  }
}

function ensureCaseItemsSheet_(ss) {
  if (!ss) throw new Error('案件品目DB初期化: スプレッドシートが指定されていません');

  let sheet = ss.getSheetByName(CASE_ITEMS_DB_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CASE_ITEMS_DB_SHEET_NAME);

  const lastColumn = sheet.getLastColumn();
  const existingHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  const existingMap = buildCaseItemsHeaderMap_(existingHeaders);
  const missingHeaders = CASE_ITEMS_DB_HEADERS.filter(function(header) {
    return !Object.prototype.hasOwnProperty.call(existingMap, header);
  });

  if (missingHeaders.length) {
    const startColumn = Math.max(1, lastColumn + 1);
    sheet.getRange(1, startColumn, 1, missingHeaders.length)
      .setValues([missingHeaders]);
  }

  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight('bold')
    .setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  return sheet;
}

function setupCaseItemsDb() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureCaseItemsSheet_(ss);
  return {
    sheetName: sheet.getName(),
    headers: CASE_ITEMS_DB_HEADERS.slice()
  };
}

function normalizeCaseItemText_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const normalized = typeof text.normalize === 'function'
    ? text.normalize('NFKC')
    : text;
  return normalized.replace(/\s+/g, ' ').trim();
}

function normalizeCaseItemQuantity_(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : '';
  }
  const text = normalizeCaseItemText_(value);
  const numeric = text.replace(/,/g, '');
  if (/^-?\d+(?:\.\d+)?$/.test(numeric)) return Number(numeric);
  return text;
}

function normalizeCaseItem_(item, displayOrder) {
  item = item || {};
  return {
    caseId: normalizeCaseItemText_(item.caseId),
    itemId: normalizeCaseItemText_(item.itemId),
    name: normalizeCaseItemText_(item.name || item.itemName),
    specification: normalizeCaseItemText_(item.specification || item.spec),
    quantity: normalizeCaseItemQuantity_(item.quantity),
    unit: normalizeCaseItemText_(item.unit),
    displayOrder: Number(displayOrder || item.displayOrder || 0),
    active: item.active === false ? false : true,
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
    updateSource: normalizeCaseItemText_(item.updateSource)
  };
}

function caseItemFingerprint_(item) {
  const normalized = normalizeCaseItem_(item, item && item.displayOrder);
  return [
    normalized.name.toLowerCase(),
    normalized.specification.toLowerCase(),
    normalizeCaseItemText_(normalized.quantity).toLowerCase(),
    normalized.unit.toLowerCase()
  ].join('\u001f');
}

function hasSameCaseItemContent_(left, right) {
  return (
    caseItemFingerprint_(left) === caseItemFingerprint_(right) &&
    Number(left.displayOrder || 0) === Number(right.displayOrder || 0) &&
    left.active !== false &&
    right.active !== false
  );
}

function escapeCaseItemRegExp_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function caseItemIdPattern_(caseId) {
  return new RegExp('^' + escapeCaseItemRegExp_(caseId) + '-(\\d{3})$');
}

function validateCaseItemId_(caseId, itemId) {
  return caseItemIdPattern_(caseId).test(String(itemId || ''));
}

function buildCaseItemUpsertPlan_(
  caseId,
  incomingItems,
  existingItems,
  now,
  updateSource,
  options
) {
  options = options || {};
  const deactivateMissing = options.deactivateMissing !== false;
  const allowPositionMatch = options.allowPositionMatch !== false;
  const normalizedCaseId = normalizeCaseItemText_(caseId);
  if (!normalizedCaseId) throw new Error('案件品目DB同期: 案件IDが空です');

  const timestamp = now || new Date();
  const source = normalizeCaseItemText_(updateSource) || CASE_ITEMS_DB_UPDATE_SOURCE;
  const existing = (existingItems || []).map(function(item) {
    return normalizeCaseItem_(item, item && item.displayOrder);
  }).filter(function(item) {
    return item.caseId === normalizedCaseId && item.itemId;
  });

  const idPattern = caseItemIdPattern_(normalizedCaseId);
  let maxSequence = 0;
  existing.forEach(function(item) {
    const match = item.itemId.match(idPattern);
    if (match) maxSequence = Math.max(maxSequence, Number(match[1]));
  });

  const usedIds = {};
  const reservedIds = {};
  existing.forEach(function(item) {
    reservedIds[item.itemId] = true;
  });
  const activeRecords = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  function findUnused_(predicate) {
    for (let i = 0; i < existing.length; i++) {
      if (!usedIds[existing[i].itemId] && predicate(existing[i])) {
        return existing[i];
      }
    }
    return null;
  }

  function issueItemId_() {
    let candidate = '';
    do {
      maxSequence++;
      if (maxSequence > CASE_ITEMS_DB_MAX_SEQUENCE) {
        throw new Error(
          '案件品目DB同期: 1案件あたりの品目上限' +
          CASE_ITEMS_DB_MAX_SEQUENCE + '件を超えています'
        );
      }
      candidate = normalizedCaseId + '-' + ('00' + maxSequence).slice(-3);
    } while (reservedIds[candidate] || usedIds[candidate]);
    return candidate;
  }

  (incomingItems || []).forEach(function(rawItem, index) {
    const incoming = normalizeCaseItem_(rawItem, index + 1);
    if (
      !incoming.name &&
      !incoming.specification &&
      !incoming.quantity &&
      !incoming.unit
    ) {
      return;
    }

    let matched = null;
    if (incoming.itemId) {
      if (!validateCaseItemId_(normalizedCaseId, incoming.itemId)) {
        throw new Error(
          '案件品目DB同期: 品目IDが案件IDに属していません: ' +
          incoming.itemId
        );
      }
      if (usedIds[incoming.itemId]) {
        throw new Error(
          '案件品目DB同期: 同じ品目IDがitems[]内で重複しています: ' +
          incoming.itemId
        );
      }
      const explicitMatch = incoming.itemId.match(idPattern);
      maxSequence = Math.max(maxSequence, Number(explicitMatch[1]));
      matched = findUnused_(function(item) {
        return item.itemId === incoming.itemId;
      });
    }
    if (!matched) {
      const fingerprint = caseItemFingerprint_(incoming);
      matched = findUnused_(function(item) {
        return caseItemFingerprint_(item) === fingerprint;
      });
    }
    if (!matched && allowPositionMatch) {
      matched = findUnused_(function(item) {
        return item.displayOrder === incoming.displayOrder;
      });
    }

    const itemId = matched
      ? matched.itemId
      : (incoming.itemId || issueItemId_());
    usedIds[itemId] = true;
    reservedIds[itemId] = true;

    const unchangedItem = matched && hasSameCaseItemContent_(incoming, matched);
    if (!matched) added++;
    else if (unchangedItem) unchanged++;
    else updated++;

    activeRecords.push({
      caseId: normalizedCaseId,
      itemId: itemId,
      name: incoming.name,
      specification: incoming.specification,
      quantity: incoming.quantity,
      unit: incoming.unit,
      displayOrder: incoming.displayOrder,
      active: true,
      createdAt: matched && matched.createdAt ? matched.createdAt : timestamp,
      updatedAt: unchangedItem && matched.updatedAt ? matched.updatedAt : timestamp,
      updateSource:
        unchangedItem && matched.updateSource ? matched.updateSource : source
    });
  });

  const inactiveRecords = existing.filter(function(item) {
    return !usedIds[item.itemId] && item.active !== false;
  }).map(function(item) {
    return {
      caseId: item.caseId,
      itemId: item.itemId,
      name: item.name,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      displayOrder: item.displayOrder,
      active: false,
      createdAt: item.createdAt || timestamp,
      updatedAt: timestamp,
      updateSource: source
    };
  });
  const recordsToDeactivate = deactivateMissing ? inactiveRecords : [];

  return {
    caseId: normalizedCaseId,
    records: activeRecords.concat(recordsToDeactivate),
    activeRecords: activeRecords,
    added: added,
    updated: updated,
    unchanged: unchanged,
    deactivated: recordsToDeactivate.length
  };
}

function readCaseItemRows_(sheet, headerMap, caseId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastColumn = sheet.getLastColumn();
  const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  return rows.map(function(values, index) {
    return {
      row: index + 2,
      values: values,
      caseId: normalizeCaseItemText_(values[headerMap['案件ID']]),
      itemId: normalizeCaseItemText_(values[headerMap['品目ID']]),
      name: normalizeCaseItemText_(values[headerMap['品目名']]),
      specification: normalizeCaseItemText_(values[headerMap['仕様・型番']]),
      quantity: values[headerMap['数量']],
      unit: normalizeCaseItemText_(values[headerMap['単位']]),
      displayOrder: Number(values[headerMap['表示順']] || 0),
      active: values[headerMap['有効フラグ']] !== false,
      createdAt: values[headerMap['作成日時']],
      updatedAt: values[headerMap['更新日時']],
      updateSource: normalizeCaseItemText_(values[headerMap['更新元']])
    };
  }).filter(function(item) {
    return item.caseId === caseId && item.itemId;
  });
}

function writeCaseItemRecordToValues_(record, values, headerMap) {
  const rowValues = values.slice();
  rowValues[headerMap['案件ID']] = record.caseId;
  rowValues[headerMap['品目ID']] = record.itemId;
  rowValues[headerMap['品目名']] = record.name;
  rowValues[headerMap['仕様・型番']] = record.specification;
  rowValues[headerMap['数量']] = record.quantity;
  rowValues[headerMap['単位']] = record.unit;
  rowValues[headerMap['表示順']] = record.displayOrder;
  rowValues[headerMap['有効フラグ']] = record.active;
  rowValues[headerMap['作成日時']] = record.createdAt;
  rowValues[headerMap['更新日時']] = record.updatedAt;
  rowValues[headerMap['更新元']] = record.updateSource;
  return rowValues;
}

function upsertCaseItemsFromCaseJson_(ss, caseJson, options) {
  options = options || {};
  caseJson = caseJson || {};
  const caseId = normalizeCaseItemText_(caseJson.caseId);
  if (!caseId) throw new Error('案件品目DB同期: 案件IDが空です');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureCaseItemsSheet_(ss);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = buildCaseItemsHeaderMap_(headers);
    assertCaseItemsHeaders_(headerMap);

    const existingRows = readCaseItemRows_(sheet, headerMap, caseId);
    const plan = buildCaseItemUpsertPlan_(
      caseId,
      Array.isArray(caseJson.items) ? caseJson.items : [],
      existingRows,
      options.now || new Date(),
      options.updateSource || CASE_ITEMS_DB_UPDATE_SOURCE,
      {
        deactivateMissing: options.deactivateMissing !== false,
        allowPositionMatch: options.allowPositionMatch !== false
      }
    );
    const rowsById = {};
    existingRows.forEach(function(item) {
      rowsById[item.itemId] = item;
    });

    const appendValues = [];
    let appendStartRow = 0;
    let appendSucceeded = false;
    try {
      plan.records.forEach(function(record) {
        const existingRow = rowsById[record.itemId];
        if (existingRow) {
          const values = writeCaseItemRecordToValues_(
            record,
            existingRow.values,
            headerMap
          );
          sheet.getRange(existingRow.row, 1, 1, values.length).setValues([values]);
        } else {
          const values = writeCaseItemRecordToValues_(
            record,
            new Array(sheet.getLastColumn()).fill(''),
            headerMap
          );
          appendValues.push(values);
        }
      });

      if (appendValues.length) {
        appendStartRow = sheet.getLastRow() + 1;
        sheet.getRange(
          appendStartRow,
          1,
          appendValues.length,
          sheet.getLastColumn()
        ).setValues(appendValues);
        appendSucceeded = true;
      }
    } catch (writeError) {
      existingRows.forEach(function(existingRow) {
        sheet.getRange(
          existingRow.row,
          1,
          1,
          existingRow.values.length
        ).setValues([existingRow.values]);
      });
      if (appendSucceeded) {
        sheet.deleteRows(appendStartRow, appendValues.length);
      }
      throw writeError;
    }

    const currentActiveItems = readCaseItemRows_(sheet, headerMap, caseId)
      .filter(function(item) {
        return item.active;
      })
      .sort(function(a, b) {
        return a.displayOrder - b.displayOrder || a.itemId.localeCompare(b.itemId);
      });

    return {
      sheetName: sheet.getName(),
      caseId: caseId,
      items: currentActiveItems.map(function(item) {
        return {
          itemId: item.itemId,
          name: item.name,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit
        };
      }),
      added: plan.added,
      updated: plan.updated,
      unchanged: plan.unchanged,
      deactivated: plan.deactivated
    };
  } finally {
    lock.releaseLock();
  }
}

function getCaseItemsByCaseId_(ss, caseId, includeInactive) {
  const normalizedCaseId = normalizeCaseItemText_(caseId);
  if (!normalizedCaseId) throw new Error('案件品目DB取得: 案件IDが空です');

  const sheet = ensureCaseItemsSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = buildCaseItemsHeaderMap_(headers);
  assertCaseItemsHeaders_(headerMap);

  return readCaseItemRows_(sheet, headerMap, normalizedCaseId)
    .filter(function(item) {
      return includeInactive || item.active;
    })
    .sort(function(a, b) {
      return a.displayOrder - b.displayOrder || a.itemId.localeCompare(b.itemId);
    });
}

function deleteCaseItemsByCaseId_(ss, caseId) {
  const normalizedCaseId = normalizeCaseItemText_(caseId);
  if (!normalizedCaseId) return 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ss.getSheetByName(CASE_ITEMS_DB_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = buildCaseItemsHeaderMap_(headers);
    if (!Object.prototype.hasOwnProperty.call(headerMap, '案件ID')) return 0;

    const ids = sheet.getRange(
      2,
      headerMap['案件ID'] + 1,
      sheet.getLastRow() - 1,
      1
    ).getValues();
    let deleted = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      if (normalizeCaseItemText_(ids[i][0]) === normalizedCaseId) {
        sheet.deleteRow(i + 2);
        deleted++;
      }
    }
    return deleted;
  } finally {
    lock.releaseLock();
  }
}
