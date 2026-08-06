var SUPPLIER_NYAN_QUOTE_SHEET = '仕入先見積書DB';
var SUPPLIER_NYAN_QUOTE_FOLDER_PROPERTY =
  'SUPPLIER_NYAN_QUOTE_FOLDER_ID_TEST';
var SUPPLIER_NYAN_QUOTE_MAX_BYTES = 8 * 1024 * 1024;
var SUPPLIER_NYAN_QUOTE_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png'
]);
var SUPPLIER_NYAN_QUOTE_HEADERS = Object.freeze([
  '見積ID',
  '案件ID',
  '品目ID',
  '仕入先名',
  'ファイル名',
  'DriveURL',
  '見積金額',
  '税区分',
  '納期',
  '送料',
  'AI読取状態',
  '登録日時',
  '更新日時',
  '採用フラグ',
  '有効フラグ'
]);

var SupplierNyanQuoteService = (function () {
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

  function getSheet_() {
    var sheet = SupplierNyanSpreadsheet.openSupplierResearch()
      .getSheetByName(SUPPLIER_NYAN_QUOTE_SHEET);
    if (!sheet) {
      throw new SupplierNyanError(
        'QUOTE_SHEET_MISSING',
        '見積書DBがありません。管理者へ連絡してください。'
      );
    }
    return sheet;
  }

  function getFolder_() {
    var id = PropertiesService.getScriptProperties()
      .getProperty(SUPPLIER_NYAN_QUOTE_FOLDER_PROPERTY);
    if (!id) {
      throw new SupplierNyanError(
        'QUOTE_FOLDER_MISSING',
        '見積書の保存先が設定されていません。管理者へ連絡してください。'
      );
    }
    try {
      var folder = Drive.Files.get(id, {
        fields: 'id,name,mimeType,trashed'
      });
      if (
        folder.trashed ||
        folder.mimeType !== 'application/vnd.google-apps.folder'
      ) {
        throw new Error('Quote folder is unavailable.');
      }
      return folder;
    } catch (error) {
      throw new SupplierNyanError(
        'QUOTE_FOLDER_UNAVAILABLE',
        '見積書の保存先を開けません。管理者へ連絡してください。'
      );
    }
  }

  function validateUpload_(caseId, itemId, fileName, mimeType, bytes) {
    if (!text_(caseId) || !text_(itemId)) {
      throw new SupplierNyanError(
        'QUOTE_ITEM_REQUIRED',
        '案件と品目を確認してから見積書を追加してください。'
      );
    }
    if (!text_(fileName)) {
      throw new SupplierNyanError(
        'QUOTE_FILE_NAME_REQUIRED',
        'ファイル名を確認してください。'
      );
    }
    if (SUPPLIER_NYAN_QUOTE_MIME_TYPES.indexOf(text_(mimeType)) < 0) {
      throw new SupplierNyanError(
        'QUOTE_FILE_TYPE_INVALID',
        'PDF、JPG、PNGのいずれかを選択してください。'
      );
    }
    if (!bytes.length || bytes.length > SUPPLIER_NYAN_QUOTE_MAX_BYTES) {
      throw new SupplierNyanError(
        'QUOTE_FILE_SIZE_INVALID',
        '見積書は8MB以内のファイルを選択してください。'
      );
    }
  }

  function listByCase_(caseId) {
    var sheet = getSheet_();
    if (sheet.getLastRow() < 2) return [];

    var values = sheet.getDataRange().getValues();
    var map = headerMap_(values[0]);
    ['見積ID', '案件ID', '品目ID', 'ファイル名', 'DriveURL']
      .forEach(function (header) {
        if (!Object.prototype.hasOwnProperty.call(map, header)) {
          throw new SupplierNyanError(
            'QUOTE_HEADER_MISSING',
            '見積書DBの列が不足しています。管理者へ連絡してください。'
          );
        }
      });

    return values.slice(1).filter(function (row) {
      var active = !Object.prototype.hasOwnProperty.call(map, '有効フラグ') ||
        row[map['有効フラグ']] === true ||
        text_(row[map['有効フラグ']]).toLowerCase() === 'true';
      return active && text_(row[map['案件ID']]) === text_(caseId);
    }).map(function (row) {
      return {
        quoteId: text_(row[map['見積ID']]),
        caseId: text_(row[map['案件ID']]),
        itemId: text_(row[map['品目ID']]),
        supplierName: Object.prototype.hasOwnProperty.call(map, '仕入先名')
          ? text_(row[map['仕入先名']]) : '',
        fileName: text_(row[map['ファイル名']]),
        driveUrl: text_(row[map['DriveURL']]),
        registeredAt: Object.prototype.hasOwnProperty.call(map, '登録日時')
          ? text_(row[map['登録日時']]) : '',
        adopted: Object.prototype.hasOwnProperty.call(map, '採用フラグ') &&
          (row[map['採用フラグ']] === true ||
            text_(row[map['採用フラグ']]).toLowerCase() === 'true')
      };
    });
  }

  function attachToDetail(result) {
    var quotes = listByCase_(result.case.caseId);
    (result.case.items || []).forEach(function (item) {
      item.quotes = quotes.filter(function (quote) {
        return quote.itemId === item.itemId;
      });
    });
    return result;
  }

  function upload(
    caseId,
    itemId,
    supplierName,
    fileName,
    mimeType,
    base64Data
  ) {
    if (SupplierNyanConfig.getEnvironment() !== 'test') {
      throw new SupplierNyanError(
        'TEST_ONLY_OPERATION',
        '現在、見積書アップロードはTEST環境でのみ利用できます。'
      );
    }

    var bytes;
    try {
      bytes = Utilities.base64Decode(String(base64Data || ''));
    } catch (error) {
      throw new SupplierNyanError(
        'QUOTE_FILE_INVALID',
        'ファイルを読み取れませんでした。'
      );
    }
    validateUpload_(caseId, itemId, fileName, mimeType, bytes);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new SupplierNyanError(
        'QUOTE_UPLOAD_BUSY',
        '別の保存処理中です。少し待ってから再度お試しください。'
      );
    }

    try {
      var sheet = getSheet_();
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      var map = headerMap_(headers);
      SUPPLIER_NYAN_QUOTE_HEADERS.forEach(function (header) {
        if (!Object.prototype.hasOwnProperty.call(map, header)) {
          throw new SupplierNyanError(
            'QUOTE_HEADER_MISSING',
            '見積書DBの列が不足しています。管理者へ連絡してください。'
          );
        }
      });

      var quoteId = 'QUOTE-' + Utilities.getUuid();
      var safeName = quoteId + '_' + text_(fileName).replace(/[\\/:*?"<>|]/g, '_');
      var blob = Utilities.newBlob(bytes, mimeType, safeName);
      var folder = getFolder_();
      var file = Drive.Files.create(
        {
          name: safeName,
          parents: [folder.id]
        },
        blob,
        {
          fields: 'id,name,webViewLink'
        }
      );
      var now = new Date();
      var values = new Array(headers.length).fill('');
      values[map['見積ID']] = quoteId;
      values[map['案件ID']] = text_(caseId);
      values[map['品目ID']] = text_(itemId);
      values[map['仕入先名']] = text_(supplierName);
      values[map['ファイル名']] = text_(fileName);
      values[map['DriveURL']] = file.webViewLink;
      values[map['AI読取状態']] = '未処理';
      values[map['登録日時']] = now;
      values[map['更新日時']] = now;
      values[map['採用フラグ']] = false;
      values[map['有効フラグ']] = true;
      sheet.appendRow(values);

      return {
        quoteId: quoteId,
        caseId: text_(caseId),
        itemId: text_(itemId),
        supplierName: text_(supplierName),
        fileName: text_(fileName),
        driveUrl: file.webViewLink,
        registeredAt: now.toISOString(),
        adopted: false
      };
    } finally {
      lock.releaseLock();
    }
  }

  return {
    attachToDetail: attachToDetail,
    upload: upload,
    getHeaders: function () {
      return SUPPLIER_NYAN_QUOTE_HEADERS.slice();
    }
  };
})();

function setupSupplierNyanQuoteSheetTest() {
  if (SupplierNyanConfig.getEnvironment() !== 'test') {
    throw new SupplierNyanError(
      'TEST_ONLY_OPERATION',
      'この初期化処理はTEST環境でのみ実行できます。'
    );
  }

  var spreadsheet = SupplierNyanSpreadsheet.openSupplierResearch();
  var sheet = spreadsheet.getSheetByName(SUPPLIER_NYAN_QUOTE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SUPPLIER_NYAN_QUOTE_SHEET);
    sheet.getRange(1, 1, 1, SUPPLIER_NYAN_QUOTE_HEADERS.length)
      .setValues([SUPPLIER_NYAN_QUOTE_HEADERS.slice()]);
    sheet.setFrozenRows(1);
  }
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty(SUPPLIER_NYAN_QUOTE_FOLDER_PROPERTY);
  var folder;
  if (folderId) {
    try {
      folder = Drive.Files.get(folderId, {
        fields: 'id,name,mimeType,trashed'
      });
      if (
        folder.trashed ||
        folder.mimeType !== 'application/vnd.google-apps.folder'
      ) {
        folder = null;
      }
    } catch (error) {
      folder = null;
    }
  }
  if (!folder) {
    folder = Drive.Files.create(
      {
        name: '仕入先にゃんOS TEST｜見積書',
        mimeType: 'application/vnd.google-apps.folder'
      },
      null,
      {
        fields: 'id,name,mimeType,trashed'
      }
    );
    properties.setProperty(
      SUPPLIER_NYAN_QUOTE_FOLDER_PROPERTY,
      folder.id
    );
  }
  return {
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    headers: SUPPLIER_NYAN_QUOTE_HEADERS.slice(),
    folderName: folder.name
  };
}
function api_uploadQuoteFile(
  caseId,
  itemId,
  supplierName,
  fileName,
  mimeType,
  base64Data
) {
  return runSupplierNyanApi_(function () {
    return SupplierNyanQuoteService.upload(
      caseId,
      itemId,
      supplierName,
      fileName,
      mimeType,
      base64Data
    );
  });
}
