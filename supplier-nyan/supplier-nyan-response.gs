function SupplierNyanError(code, publicMessage, details) {
  this.name = 'SupplierNyanError';
  this.code = code || 'INTERNAL_ERROR';
  this.publicMessage =
    publicMessage || '処理に失敗しました。時間をおいて再度お試しください。';
  this.details = details || null;
  this.message = this.publicMessage;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, SupplierNyanError);
  }
}

SupplierNyanError.prototype = Object.create(Error.prototype);
SupplierNyanError.prototype.constructor = SupplierNyanError;

var SupplierNyanResponse = (function () {
  function success(data) {
    return {
      success: true,
      data: data === undefined ? null : data,
      error: null
    };
  }

  function failure(code, message) {
    return {
      success: false,
      data: null,
      error: {
        code: code || 'INTERNAL_ERROR',
        message:
          message || '処理に失敗しました。時間をおいて再度お試しください。'
      }
    };
  }

  return Object.freeze({
    success: success,
    failure: failure
  });
})();

function handleSupplierNyanError_(error) {
  var isKnownError = error instanceof SupplierNyanError;
  var code = isKnownError ? error.code : 'INTERNAL_ERROR';
  var message = isKnownError
    ? error.publicMessage
    : '処理に失敗しました。時間をおいて再度お試しください。';

  if (typeof console !== 'undefined' && console.error) {
    console.error('[SupplierNyan][' + code + ']', error && (error.stack || error));
  }

  return SupplierNyanResponse.failure(code, message);
}

function runSupplierNyanApi_(operation) {
  try {
    return SupplierNyanResponse.success(operation());
  } catch (error) {
    return handleSupplierNyanError_(error);
  }
}


function __setupSupplierNyanTestData() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('NYUSATSU_SPREADSHEET_ID');
  if (spreadsheetId !== '1Mu-IHZGOTvjVm-dFxPqTfxN74H7JtQVEoytXlHc-kwo') {
    throw new Error('TEST spreadsheet ID mismatch; aborted.');
  }
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var caseSheet = ss.getSheetByName('01_案件管理');
  if (!caseSheet) throw new Error('01_案件管理 not found');
  var requiredCaseHeaders = ['案件ID','案件名','発注機関','提出締切','状態','仕入先調査対象'];
  var caseLastCol = Math.max(1, caseSheet.getLastColumn());
  var caseHeaders = caseSheet.getRange(1,1,1,caseLastCol).getValues()[0].map(String);
  requiredCaseHeaders.forEach(function(h){
    if (caseHeaders.indexOf(h) < 0) {
      caseHeaders.push(h);
      caseSheet.getRange(1,caseHeaders.length).setValue(h);
    }
  });
  var caseMap = {};
  caseHeaders.forEach(function(h,i){if(h && caseMap[h] === undefined) caseMap[h]=i;});
  var caseRows = [
    {'案件ID':'TEST-SUP-001','案件名':'【TEST】防災帽子調達','発注機関':'テスト市役所','提出締切':new Date(2026,7,15),'状態':'検討中','仕入先調査対象':true},
    {'案件ID':'TEST-SUP-002','案件名':'【TEST】複数品目・長い案件名のスマートフォン表示確認用調達案件','発注機関':'テスト県庁','提出締切':new Date(2026,7,20),'状態':'見積中','仕入先調査対象':true},
    {'案件ID':'TEST-SUP-003','案件名':'【TEST】品目0件案件','発注機関':'テスト区役所','提出締切':new Date(2026,7,25),'状態':'検討中','仕入先調査対象':true}
  ];
  var existingCases = caseSheet.getLastRow() > 1 ? caseSheet.getRange(2,1,caseSheet.getLastRow()-1,caseHeaders.length).getValues() : [];
  var caseRowById = {};
  existingCases.forEach(function(r,i){var id=String(r[caseMap['案件ID']]||'').trim(); if(id) caseRowById[id]=i+2;});
  caseRows.forEach(function(data){
    var rowNumber=caseRowById[data['案件ID']] || (caseSheet.getLastRow()+1);
    var current=rowNumber<=caseSheet.getLastRow()?caseSheet.getRange(rowNumber,1,1,caseHeaders.length).getValues()[0]:new Array(caseHeaders.length).fill('');
    Object.keys(data).forEach(function(h){current[caseMap[h]]=data[h];});
    caseSheet.getRange(rowNumber,1,1,caseHeaders.length).setValues([current]);
  });

  var itemHeaders=['案件ID','品目ID','品目名','仕様','メーカー','ブランド','型番','数量','単位','同等品可','表示順','有効フラグ','作成日時','更新日時','更新元'];
  var itemSheet=ss.getSheetByName('案件品目DB') || ss.insertSheet('案件品目DB');
  var existingHeaders=itemSheet.getLastColumn()>0?itemSheet.getRange(1,1,1,itemSheet.getLastColumn()).getValues()[0].map(String):[];
  itemHeaders.forEach(function(h){if(existingHeaders.indexOf(h)<0){existingHeaders.push(h);itemSheet.getRange(1,existingHeaders.length).setValue(h);}});
  itemSheet.setFrozenRows(1);
  var itemMap={}; existingHeaders.forEach(function(h,i){if(h&&itemMap[h]===undefined)itemMap[h]=i;});
  var now=new Date();
  var items=[
    {'案件ID':'TEST-SUP-001','品目ID':'TEST-SUP-001-001','品目名':'防災帽子','仕様':'折りたたみ式・あご紐付き','メーカー':'テスト防災','ブランド':'テストセーフ','型番':'TS-001','数量':308,'単位':'個','同等品可':true,'表示順':1,'有効フラグ':true,'作成日時':now,'更新日時':now,'更新元':'仕入先にゃんTEST'},
    {'案件ID':'TEST-SUP-002','品目ID':'TEST-SUP-002-001','品目名':'エコバッグ','仕様':'コットン製・A4対応','メーカー':'テスト商会','ブランド':'エコテスト','型番':'EB-100','数量':100,'単位':'枚','同等品可':false,'表示順':1,'有効フラグ':true,'作成日時':now,'更新日時':now,'更新元':'仕入先にゃんTEST'},
    {'案件ID':'TEST-SUP-002','品目ID':'TEST-SUP-002-002','品目名':'防災用品セット','仕様':'非常用ライト、携帯トイレ、保存水を含む長い仕様文の折り返し表示確認用テストデータ','メーカー':'','ブランド':'','型番':'','数量':25,'単位':'セット','同等品可':'','表示順':2,'有効フラグ':true,'作成日時':now,'更新日時':now,'更新元':'仕入先にゃんTEST'},
    {'案件ID':'TEST-SUP-002','品目ID':'TEST-SUP-002-999','品目名':'【無効】表示されない品目','仕様':'無効品目除外テスト','メーカー':'','ブランド':'','型番':'','数量':1,'単位':'個','同等品可':true,'表示順':99,'有効フラグ':false,'作成日時':now,'更新日時':now,'更新元':'仕入先にゃんTEST'}
  ];
  var existingItems=itemSheet.getLastRow()>1?itemSheet.getRange(2,1,itemSheet.getLastRow()-1,existingHeaders.length).getValues():[];
  var itemRowByKey={}; existingItems.forEach(function(r,i){var k=String(r[itemMap['案件ID']]||'')+'|'+String(r[itemMap['品目ID']]||'');if(k!=='|')itemRowByKey[k]=i+2;});
  items.forEach(function(data){var key=data['案件ID']+'|'+data['品目ID'];var rn=itemRowByKey[key]||(itemSheet.getLastRow()+1);var current=rn<=itemSheet.getLastRow()?itemSheet.getRange(rn,1,1,existingHeaders.length).getValues()[0]:new Array(existingHeaders.length).fill('');Object.keys(data).forEach(function(h){current[itemMap[h]]=data[h];});itemSheet.getRange(rn,1,1,existingHeaders.length).setValues([current]);});
  itemSheet.autoResizeColumns(1,itemHeaders.length);
  var result={spreadsheetId:ss.getId(),caseSheet:caseSheet.getName(),itemSheet:itemSheet.getName(),caseIds:caseRows.map(function(x){return x['案件ID'];}),itemRows:items.length};
  console.log(JSON.stringify(result));
  return result;
}
