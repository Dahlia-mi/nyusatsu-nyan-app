var SupplierNyanSpreadsheet = (function () {
  function requireSpreadsheetService_() {
    if (
      typeof SpreadsheetApp === 'undefined' ||
      !SpreadsheetApp.openById
    ) {
      throw new SupplierNyanError(
        'SPREADSHEET_SERVICE_UNAVAILABLE',
        'スプレッドシートへ接続できません。管理者へ連絡してください。'
      );
    }
  }

  function openById_(spreadsheetId, dependencyName) {
    requireSpreadsheetService_();

    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw new SupplierNyanError(
        'SPREADSHEET_OPEN_FAILED',
        dependencyName + 'へ接続できません。管理者へ連絡してください。',
        {
          dependencyName: dependencyName,
          cause: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  function openNyusatsu() {
    var config = SupplierNyanConfig.load();
    return openById_(
      config.nyusatsuSpreadsheetId,
      '入札にゃんOS'
    );
  }

  function openSupplierResearch() {
    var config = SupplierNyanConfig.load();
    return openById_(
      config.supplierResearchSpreadsheetId,
      '仕入先調査マスター'
    );
  }

  return Object.freeze({
    openNyusatsu: openNyusatsu,
    openSupplierResearch: openSupplierResearch
  });
})();
