/**
 * Request class
 */

var util = require('util'),
    stream = require('stream');

/**
 * Class constructor
 */
var Request = exports.Request = function(cframe) {
  stream.Stream.call(this);

  this.headers = cframe.data.nameValues;
  this.method = cframe.data.nameValues.method;
  this.url = cframe.data.nameValues.url;
  this.httpVersion = cframe.data.nameValues.version.replace(/^http/i, '');
  this.encoding = null;
};
util.inherits(Request, stream.Stream);

exports.createRequest = function(cframe) {
  return new Request(cframe);
};

Request.prototype.setEncoding = function(encoding) {
  this.encoding = null;
};
