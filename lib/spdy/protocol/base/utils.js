var utils = exports;

var util = require('util');

function ProtocolError(code, message) {
  this.code = code;
  this.message = message;
}
util.inherits(ProtocolError, Error);
utils.ProtocolError = ProtocolError;

utils.error = function error(code, message) {
  return new ProtocolError(code, message);
};
