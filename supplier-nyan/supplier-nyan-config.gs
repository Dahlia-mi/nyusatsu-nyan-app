var SUPPLIER_NYAN_VERSION = '0.3.0';

var SUPPLIER_NYAN_PROPERTY_KEYS = Object.freeze({
  ENVIRONMENT: 'ENVIRONMENT',
  NYUSATSU_SPREADSHEET_ID: 'NYUSATSU_SPREADSHEET_ID',
  SUPPLIER_RESEARCH_SPREADSHEET_ID: 'SUPPLIER_RESEARCH_SPREADSHEET_ID',
  ALLOWED_USERS: 'ALLOWED_USERS',
  APP_USER_KEY_HASH: 'APP_USER_KEY_HASH'
});

var SUPPLIER_NYAN_ENVIRONMENTS = Object.freeze({
  TEST: 'test',
  PRODUCTION: 'production'
});

var SupplierNyanConfig = (function () {
  var REQUIRED_KEYS = Object.freeze([
    SUPPLIER_NYAN_PROPERTY_KEYS.ENVIRONMENT,
    SUPPLIER_NYAN_PROPERTY_KEYS.NYUSATSU_SPREADSHEET_ID,
    SUPPLIER_NYAN_PROPERTY_KEYS.SUPPLIER_RESEARCH_SPREADSHEET_ID,
    SUPPLIER_NYAN_PROPERTY_KEYS.ALLOWED_USERS
  ]);

  function getScriptProperties_() {
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

  function readProperties_() {
    return getScriptProperties_().getProperties();
  }

  function trim_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function validateRequiredProperties_(properties) {
    var missingKeys = REQUIRED_KEYS.filter(function (key) {
      return !trim_(properties[key]);
    });

    if (missingKeys.length > 0) {
      throw new SupplierNyanError(
        'CONFIG_MISSING',
        'アプリ設定が不足しています。管理者へ連絡してください。',
        { missingKeys: missingKeys }
      );
    }
  }

  function normalizeEnvironment_(value) {
    var environment = trim_(value).toLowerCase();
    var allowed = [
      SUPPLIER_NYAN_ENVIRONMENTS.TEST,
      SUPPLIER_NYAN_ENVIRONMENTS.PRODUCTION
    ];

    if (allowed.indexOf(environment) === -1) {
      throw new SupplierNyanError(
        'CONFIG_INVALID_ENVIRONMENT',
        '実行環境の設定が不正です。管理者へ連絡してください。',
        { configuredEnvironment: environment }
      );
    }
    return environment;
  }

  function parseAllowedUsers_(value) {
    return trim_(value)
      .split(',')
      .map(function (email) {
        return email.trim().toLowerCase();
      })
      .filter(function (email, index, users) {
        return email && users.indexOf(email) === index;
      });
  }

  function load() {
    var properties = readProperties_();
    validateRequiredProperties_(properties);

    var allowedUsers = parseAllowedUsers_(
      properties[SUPPLIER_NYAN_PROPERTY_KEYS.ALLOWED_USERS]
    );
    if (allowedUsers.length === 0) {
      throw new SupplierNyanError(
        'CONFIG_INVALID_ALLOWED_USERS',
        '利用者設定が不正です。管理者へ連絡してください。'
      );
    }

    return Object.freeze({
      environment: normalizeEnvironment_(
        properties[SUPPLIER_NYAN_PROPERTY_KEYS.ENVIRONMENT]
      ),
      nyusatsuSpreadsheetId: trim_(
        properties[SUPPLIER_NYAN_PROPERTY_KEYS.NYUSATSU_SPREADSHEET_ID]
      ),
      supplierResearchSpreadsheetId: trim_(
        properties[
          SUPPLIER_NYAN_PROPERTY_KEYS.SUPPLIER_RESEARCH_SPREADSHEET_ID
        ]
      ),
      allowedUsers: Object.freeze(allowedUsers),
      hasAppUserKeyHash: Boolean(
        trim_(properties[SUPPLIER_NYAN_PROPERTY_KEYS.APP_USER_KEY_HASH])
      )
    });
  }

  function getEnvironment() {
    return load().environment;
  }

  function isTest() {
    return getEnvironment() === SUPPLIER_NYAN_ENVIRONMENTS.TEST;
  }

  return Object.freeze({
    load: load,
    getEnvironment: getEnvironment,
    isTest: isTest
  });
})();
