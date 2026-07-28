var SUPPLIER_NYAN_CASE_SHEET = '01_案件管理';
var SUPPLIER_NYAN_ITEM_SHEET = '案件品目DB';
var SUPPLIER_NYAN_TARGET_STATUSES = Object.freeze(['検討中', '見積中']);
var SUPPLIER_NYAN_CASE_HEADER_ALIASES = Object.freeze({
  caseId: ['案件ID'],
  caseName: ['案件名', '件名'],
  agency: ['発注機関'],
  deadline: ['提出締切', '提出期限', '締切日'],
  status: ['状態', 'ステータス'],
  researchTarget: ['仕入先調査対象', '調査対象']
});
var SUPPLIER_NYAN_ITEM_HEADERS = Object.freeze([
  '案件ID',
  '品目ID',
  '品目名',
  '仕様',
  'メーカー',
  'ブランド',
  '型番',
  '数量',
  '単位',
  '同等品可',
  '表示順',
  '有効フラグ'
]);

function api_listResearchCases() {
  return runSupplierNyanApi_(function () {
    return SupplierNyanCaseService.listResearchCases();
  });
}

function api_getResearchCaseDetail(caseId) {
  return runSupplierNyanApi_(function () {
    return SupplierNyanCaseService.getCaseDetail(caseId);
  });
}

var SupplierNyanCaseService = (function () {
  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function headerMap_(headers) {
    var map = {};
    (headers || []).forEach(function (header, index) {
      var name = text_(header);
      if (name && !Object.prototype.hasOwnProperty.call(map, name)) {
        map[name] = index;
      }
    });
    return map;
  }

  function resolveHeader_(map, aliases, required, label) {
    for (var i = 0; i < aliases.length; i++) {
      if (Object.prototype.hasOwnProperty.call(map, aliases[i])) {
        return map[aliases[i]];
      }
    }
    if (required) {
      throw new SupplierNyanError(
        'SHEET_HEADER_MISSING',
        label + 'の必須列が見つかりません。',
        { aliases: aliases }
      );
    }
    return -1;
  }

  function requireSheet_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw new SupplierNyanError(
        'SHEET_NOT_FOUND',
        '必要なデータシートが見つかりません。',
        { sheetName: name }
      );
    }
    return sheet;
  }

  function readTable_(sheet) {
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 1 || lastColumn < 1) {
      throw new SupplierNyanError(
        'SHEET_HEADER_MISSING',
        'データシートのヘッダーが見つかりません。'
      );
    }
    var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    return {
      headers: values[0],
      map: headerMap_(values[0]),
      rows: values.slice(1)
    };
  }

  function booleanOrNull_(value) {
    if (value === true) return true;
    if (value === false) return false;
    var normalized = text_(value).toLowerCase();
    if (['true', '1', 'yes', '可', '同等品可'].indexOf(normalized) >= 0) {
      return true;
    }
    if (['false', '0', 'no', '不可', '同等品不可'].indexOf(normalized) >= 0) {
      return false;
    }
    return null;
  }

  function isActive_(value) {
    var normalized = booleanOrNull_(value);
    return normalized !== false;
  }

  function isResearchTargetValue_(value) {
    return booleanOrNull_(value) === true;
  }

  function displayDate_(value) {
    if (!value) return '';
    if (
      Object.prototype.toString.call(value) === '[object Date]' &&
      !isNaN(value.getTime())
    ) {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        'yyyy/MM/dd'
      );
    }
    return text_(value);
  }

  function caseColumns_(map) {
    return {
      caseId: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.caseId,
        true,
        SUPPLIER_NYAN_CASE_SHEET
      ),
      caseName: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.caseName,
        true,
        SUPPLIER_NYAN_CASE_SHEET
      ),
      agency: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.agency,
        true,
        SUPPLIER_NYAN_CASE_SHEET
      ),
      deadline: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.deadline,
        false,
        SUPPLIER_NYAN_CASE_SHEET
      ),
      status: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.status,
        true,
        SUPPLIER_NYAN_CASE_SHEET
      ),
      researchTarget: resolveHeader_(
        map,
        SUPPLIER_NYAN_CASE_HEADER_ALIASES.researchTarget,
        false,
        SUPPLIER_NYAN_CASE_SHEET
      )
    };
  }

  function itemColumns_(map) {
    SUPPLIER_NYAN_ITEM_HEADERS.forEach(function (header) {
      resolveHeader_(map, [header], true, SUPPLIER_NYAN_ITEM_SHEET);
    });
    return {
      caseId: map['案件ID'],
      itemId: map['品目ID'],
      name: map['品目名'],
      specification: map['仕様'],
      manufacturer: map['メーカー'],
      brand: map['ブランド'],
      modelNumber: map['型番'],
      quantity: map['数量'],
      unit: map['単位'],
      equivalentAllowed: map['同等品可'],
      displayOrder: map['表示順'],
      active: map['有効フラグ']
    };
  }

  function mapItem_(row, columns) {
    return {
      itemId: text_(row[columns.itemId]),
      name: text_(row[columns.name]),
      quantity: row[columns.quantity] === null ||
        row[columns.quantity] === undefined
        ? ''
        : row[columns.quantity],
      unit: text_(row[columns.unit]),
      specification: text_(row[columns.specification]),
      manufacturer: text_(row[columns.manufacturer]),
      brand: text_(row[columns.brand]),
      modelNumber: text_(row[columns.modelNumber]),
      equivalentAllowed: booleanOrNull_(row[columns.equivalentAllowed]),
      displayOrder: Number(row[columns.displayOrder] || 0)
    };
  }

  function readItemsByCase_(spreadsheet) {
    var table = readTable_(
      requireSheet_(spreadsheet, SUPPLIER_NYAN_ITEM_SHEET)
    );
    var columns = itemColumns_(table.map);
    var byCase = {};
    table.rows.forEach(function (row) {
      var caseId = text_(row[columns.caseId]);
      var itemId = text_(row[columns.itemId]);
      if (!caseId || !itemId || !isActive_(row[columns.active])) return;
      if (!byCase[caseId]) byCase[caseId] = [];
      byCase[caseId].push(mapItem_(row, columns));
    });
    Object.keys(byCase).forEach(function (caseId) {
      byCase[caseId].sort(function (a, b) {
        return a.displayOrder - b.displayOrder ||
          a.itemId.localeCompare(b.itemId);
      });
    });
    return byCase;
  }

  function mapCase_(row, columns) {
    return {
      caseId: text_(row[columns.caseId]),
      caseName: text_(row[columns.caseName]),
      agency: text_(row[columns.agency]),
      deadline:
        columns.deadline >= 0 ? displayDate_(row[columns.deadline]) : '',
      status: text_(row[columns.status])
    };
  }

  function isTargetCase_(row, columns) {
    if (columns.researchTarget >= 0) {
      return isResearchTargetValue_(row[columns.researchTarget]);
    }
    return (
      SUPPLIER_NYAN_TARGET_STATUSES.indexOf(text_(row[columns.status])) >= 0
    );
  }

  function addItemSummary_(caseData, items) {
    var safeItems = items || [];
    caseData.itemCount = safeItems.length;
    caseData.primaryItems = safeItems.slice(0, 3).map(function (item) {
      return {
        itemId: item.itemId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit
      };
    });
    caseData.remainingItemCount = Math.max(
      0,
      safeItems.length - caseData.primaryItems.length
    );
    caseData.unknownEquivalentCount = safeItems.filter(function (item) {
      return item.equivalentAllowed === null;
    }).length;
    return caseData;
  }

  function listResearchCases() {
    var spreadsheet = SupplierNyanSpreadsheet.openNyusatsu();
    var caseTable = readTable_(
      requireSheet_(spreadsheet, SUPPLIER_NYAN_CASE_SHEET)
    );
    var columns = caseColumns_(caseTable.map);
    var itemsByCase = readItemsByCase_(spreadsheet);
    var cases = caseTable.rows
      .filter(function (row) {
        return text_(row[columns.caseId]) && isTargetCase_(row, columns);
      })
      .map(function (row) {
        var caseData = mapCase_(row, columns);
        return addItemSummary_(caseData, itemsByCase[caseData.caseId] || []);
      });

    return {
      cases: cases,
      total: cases.length,
      targetRule:
        columns.researchTarget >= 0 ? 'researchTargetFlag' : 'status'
    };
  }

  function getCaseDetail(caseId) {
    var normalizedCaseId = text_(caseId);
    if (!normalizedCaseId) {
      throw new SupplierNyanError(
        'CASE_ID_REQUIRED',
        '案件IDを指定してください。'
      );
    }

    var spreadsheet = SupplierNyanSpreadsheet.openNyusatsu();
    var caseTable = readTable_(
      requireSheet_(spreadsheet, SUPPLIER_NYAN_CASE_SHEET)
    );
    var columns = caseColumns_(caseTable.map);
    var matchedRow = null;
    for (var i = 0; i < caseTable.rows.length; i++) {
      if (text_(caseTable.rows[i][columns.caseId]) === normalizedCaseId) {
        matchedRow = caseTable.rows[i];
        break;
      }
    }
    if (!matchedRow) {
      throw new SupplierNyanError(
        'CASE_NOT_FOUND',
        '指定された案件が見つかりません。'
      );
    }
    if (!isTargetCase_(matchedRow, columns)) {
      throw new SupplierNyanError(
        'CASE_NOT_RESEARCH_TARGET',
        'この案件は現在の調査対象ではありません。'
      );
    }

    var items = readItemsByCase_(spreadsheet)[normalizedCaseId] || [];
    var caseData = mapCase_(matchedRow, columns);
    caseData.items = items;
    caseData.itemCount = items.length;
    return { case: caseData };
  }

  return Object.freeze({
    listResearchCases: listResearchCases,
    getCaseDetail: getCaseDetail,
    _test: Object.freeze({
      booleanOrNull: booleanOrNull_,
      isActive: isActive_,
      headerMap: headerMap_
    })
  });
})();
