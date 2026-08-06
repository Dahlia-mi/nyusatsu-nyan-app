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

function api_getAppContext() {
  return runSupplierNyanApi_(function () {
    var config = SupplierNyanConfig.load();
    return {
      application: 'supplier-nyan',
      version: SUPPLIER_NYAN_VERSION,
      environment: config.environment,
      deploymentVersion: config.deploymentVersion || '-',
      preferenceStorage: 'server',
      catName: SupplierNyanPreferenceService.getCatName()
    };
  });
}

function doGet(event) {
  if (event && event.parameter && event.parameter.api === 'health') {
    var result = api_healthCheck();
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  SupplierNyanConfig.load();
  return HtmlService.createTemplateFromFile('supplier-nyan-index')
    .evaluate()
    .setTitle('仕入先にゃん')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, viewport-fit=cover'
    );
}

function includeSupplierNyanFile_(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}
