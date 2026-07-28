function api_healthCheck() {
  return runSupplierNyanApi_(function () {
    var config = SupplierNyanConfig.load();
    var nyusatsuSpreadsheet = SupplierNyanSpreadsheet.openNyusatsu();
    var supplierResearchSpreadsheet =
      SupplierNyanSpreadsheet.openSupplierResearch();

    return {
      application: 'supplier-nyan',
      version: SUPPLIER_NYAN_VERSION,
      environment: config.environment,
      status: 'ok',
      checkedAt: new Date().toISOString(),
      dependencies: {
        nyusatsuSpreadsheet: {
          status: 'ok',
          name: nyusatsuSpreadsheet.getName()
        },
        supplierResearchSpreadsheet: {
          status: 'ok',
          name: supplierResearchSpreadsheet.getName()
        }
      }
    };
  });
}

function doGet() {
  var result = api_healthCheck();
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
