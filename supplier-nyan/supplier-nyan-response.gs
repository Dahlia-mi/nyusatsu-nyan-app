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
