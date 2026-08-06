var SUPPLIER_NYAN_PROGRESS_SHEET = '仕入先にゃん進捗';
var SUPPLIER_NYAN_PROGRESS_HEADERS = Object.freeze([
  '案件ID',
  '品目ID',
  '問い合わせ済み',
  '問い合わせメモ',
  '調査状態',
  '作成日時',
  '更新日時',
  '更新元'
]);

function api_saveCatName(name) {
  return runSupplierNyanApi_(function () {
    return SupplierNyanPreferenceService.saveCatName(name);
  });
}

function api_saveItemProgress(caseId, itemId, contacted, memo, researchStatus) {
  return runSupplierNyanApi_(function () {
    return SupplierNyanPreferenceService.saveItemProgress(
      caseId,
      itemId,
      contacted,
      memo,
      researchStatus
    );
  });
}

var SupplierNyanPreferenceService = (function () {
  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function propertyKey_() {
    return 'SUPPLIER_NYAN_CAT_NAME_' +
      SupplierNyanConfig.getEnvironment().toUpperCase();
  }

  function scriptProperties_() {
    if (
      typeof PropertiesService === 'undefined' ||
      !PropertiesService.getScriptProperties
    ) {
      throw new SupplierNyanError(
        'CONFIG_SERVICE_UNAVAILABLE',
        '設定サービスを利用できません。'
      );
    }
    return PropertiesService.getScriptProperties();
  }

  function getCatName() {
    return text_(scriptProperties_().getProperty(propertyKey_()));
  }

  function saveCatName(name) {
    var normalized = text_(name);
    if (!normalized) {
      throw new SupplierNyanError(
        'CAT_NAME_REQUIRED',
        '猫の名前を入力してください。'
      );
    }
    if (normalized.length > 30) {
      throw new SupplierNyanError(
        'CAT_NAME_TOO_LONG',
        '猫の名前は30文字以内で入力してください。'
      );
    }

    scriptProperties_().setProperty(propertyKey_(), normalized);
    return { catName: normalized };
  }

  function headerMap_(headers) {
    var map = {};
    headers.forEach(function (header, index) {
      var name = text_(header);
      if (name && !Object.prototype.hasOwnProperty.call(map, name)) {
        map[name] = index;
      }
    });
    return map;
  }

  function getSheet_(createIfMissing) {
    var spreadsheet = SupplierNyanSpreadsheet.openSupplierResearch();
    var sheet = spreadsheet.getSheetByName(SUPPLIER_NYAN_PROGRESS_SHEET);
    if (!sheet && createIfMissing) {
      sheet = spreadsheet.insertSheet(SUPPLIER_NYAN_PROGRESS_SHEET);
      sheet.getRange(1, 1, 1, SUPPLIER_NYAN_PROGRESS_HEADERS.length)
        .setValues([SUPPLIER_NYAN_PROGRESS_HEADERS.slice()]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function readAll() {
    var sheet = getSheet_(false);
    if (!sheet || sheet.getLastRow() < 2) return {};

    var values = sheet.getRange(
      1,
      1,
      sheet.getLastRow(),
      sheet.getLastColumn()
    ).getValues();
    var map = headerMap_(values[0]);
    ['案件ID', '品目ID', '問い合わせ済み', '問い合わせメモ']
      .forEach(function (header) {
        if (!Object.prototype.hasOwnProperty.call(map, header)) {
          throw new SupplierNyanError(
            'PROGRESS_HEADER_MISSING',
            '進捗保存シートの列が不足しています。管理者へ連絡してください。'
          );
        }
      });

    var progress = {};
    values.slice(1).forEach(function (row) {
      var caseId = text_(row[map['案件ID']]);
      var itemId = text_(row[map['品目ID']]);
      if (!caseId || !itemId) return;
      progress[caseId + '\u0000' + itemId] = {
        contacted: row[map['問い合わせ済み']] === true ||
          text_(row[map['問い合わせ済み']]).toLowerCase() === 'true',
        memo: text_(row[map['問い合わせメモ']]),
        researchStatus: Object.prototype.hasOwnProperty.call(map, '調査状態')
          ? normalizeResearchStatus_(
            row[map['調査状態']],
            row[map['問い合わせ済み']] === true ||
              text_(row[map['問い合わせ済み']]).toLowerCase() === 'true'
          )
          : normalizeResearchStatus_('', row[map['問い合わせ済み']] === true)
      };
    });
    return progress;
  }

  function attachItems(items, caseId, progress) {
    return (items || []).map(function (item) {
      var saved = progress[caseId + '\u0000' + item.itemId] || {};
      item.contacted = saved.contacted === true;
      item.inquiryMemo = saved.memo || '';
      item.researchStatus = saved.researchStatus ||
        normalizeResearchStatus_('', item.contacted);
      return item;
    });
  }

  function decorateCaseList(result) {
    var progress = readAll();
    (result.cases || []).forEach(function (caseData) {
      caseData.allItems = attachItems(
        caseData.allItems || [],
        caseData.caseId,
        progress
      );
      var contactedCount = 0;
      var statusCounts = createStatusCounts_();
      (caseData.allItems || []).forEach(function (item) {
        var saved = progress[caseData.caseId + '\u0000' + item.itemId];
        if (saved && saved.contacted) contactedCount++;
        var status = saved
          ? saved.researchStatus
          : normalizeResearchStatus_('', false);
        statusCounts[status]++;
      });
      caseData.contactedCount = contactedCount;
      caseData.researchStatusCounts = statusCounts;
    });
    return result;
  }

  function decorateCaseDetail(result) {
    var progress = readAll();
    result.case.items = attachItems(
      result.case.items,
      result.case.caseId,
      progress
    );
    result.case.contactedCount = result.case.items.filter(function (item) {
      return item.contacted;
    }).length;
    result.case.unknownEquivalentCount = result.case.items.filter(
      function (item) {
        return item.equivalentAllowed === null;
      }
    ).length;
    result.case.researchStatusCounts = countStatuses_(result.case.items);
    return result;
  }

  function normalizeResearchStatus_(value, contacted) {
    var normalized = text_(value);
    var allowed = ['未着手', '調査中', '回答待ち', '完了'];
    if (!normalized) return contacted ? '調査中' : '未着手';
    if (allowed.indexOf(normalized) < 0) {
      throw new SupplierNyanError(
        'PROGRESS_STATUS_INVALID',
        '調査状態を正しく選択してください。'
      );
    }
    return normalized;
  }

  function createStatusCounts_() {
    return { '未着手': 0, '調査中': 0, '回答待ち': 0, '完了': 0 };
  }

  function countStatuses_(items) {
    var counts = createStatusCounts_();
    (items || []).forEach(function (item) {
      counts[normalizeResearchStatus_(item.researchStatus, item.contacted)]++;
    });
    return counts;
  }

  function saveItemProgress(caseId, itemId, contacted, memo, researchStatus) {
    var normalizedCaseId = text_(caseId);
    var normalizedItemId = text_(itemId);
    if (!normalizedCaseId || !normalizedItemId) {
      throw new SupplierNyanError(
        'PROGRESS_KEY_REQUIRED',
        '案件または品目を特定できません。再読み込みしてください。'
      );
    }
    var normalizedMemo = text_(memo);
    var normalizedStatus = normalizeResearchStatus_(researchStatus, contacted);
    if (normalizedMemo.length > 1000) {
      throw new SupplierNyanError(
        'PROGRESS_MEMO_TOO_LONG',
        '問い合わせメモは1000文字以内で入力してください。'
      );
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new SupplierNyanError(
        'PROGRESS_LOCK_TIMEOUT',
        '保存が混み合っています。少し待って再度お試しください。'
      );
    }
    try {
      var sheet = getSheet_(true);
      var lastColumn = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
      var map = headerMap_(headers);
      SUPPLIER_NYAN_PROGRESS_HEADERS.forEach(function (header) {
        if (!Object.prototype.hasOwnProperty.call(map, header)) {
          headers.push(header);
          map[header] = headers.length - 1;
          sheet.getRange(1, headers.length).setValue(header);
          lastColumn = headers.length;
        }
      });

      var rows = sheet.getLastRow() > 1
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues()
        : [];
      var rowNumber = 0;
      for (var i = 0; i < rows.length; i++) {
        if (
          text_(rows[i][map['案件ID']]) === normalizedCaseId &&
          text_(rows[i][map['品目ID']]) === normalizedItemId
        ) {
          rowNumber = i + 2;
          break;
        }
      }

      var now = new Date();
      var row = rowNumber
        ? sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0]
        : new Array(lastColumn).fill('');
      row[map['案件ID']] = normalizedCaseId;
      row[map['品目ID']] = normalizedItemId;
      row[map['問い合わせ済み']] = contacted === true;
      row[map['問い合わせメモ']] = normalizedMemo;
      row[map['調査状態']] = normalizedStatus;
      if (!row[map['作成日時']]) row[map['作成日時']] = now;
      row[map['更新日時']] = now;
      row[map['更新元']] = '仕入先にゃん';
      if (!rowNumber) rowNumber = sheet.getLastRow() + 1;
      sheet.getRange(rowNumber, 1, 1, lastColumn).setValues([row]);

      return {
        caseId: normalizedCaseId,
        itemId: normalizedItemId,
        contacted: contacted === true,
        memo: normalizedMemo,
        researchStatus: normalizedStatus
      };
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({
    getCatName: getCatName,
    saveCatName: saveCatName,
    decorateCaseList: decorateCaseList,
    decorateCaseDetail: decorateCaseDetail,
    saveItemProgress: saveItemProgress,
    _test: Object.freeze({
      propertyKey: propertyKey_,
      headerMap: headerMap_
    })
  });
})();
