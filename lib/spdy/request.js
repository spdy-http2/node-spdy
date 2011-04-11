/**
 * Request class
 */

var util = require('util'),
    stream = require('stream'),
    enums = require('../spdy').enums;

/**
 * Class constructor
 */
var Request = exports.Request = function(cframe, c) {
  stream.Stream.call(this);

  this.headers = cframe.data.nameValues;
  this.method = cframe.data.nameValues.method;
  this.url = cframe.data.nameValues.url;
  this.httpVersion = cframe.data.nameValues.version.replace(/^http/i, '');
  this.encoding = null;
  this.hasBody = (cframe.headers.flags & enums.CONTROL_FLAG_FIN) !==
                 enums.CONTROL_FLAG_FIN;
};
util.inherits(Request, stream.Stream);

exports.createRequest = function(cframe) {
  return new Request(cframe);
};

/**
 * Just stubbed
 */
Request.prototype.setEncoding = function(encoding) {
  this.encoding = null;
};

/**
 * Handle Dframe
 */
Request.prototype._handleDframe = function(dframe) {
  if (!this.hasBody) return this.emit('error', 'Received double body');

  var data = dframe.data;
  
  // Decompress body if needed
  if (dframe.headers.flags & enums.DATA_FLAG_COMPRESSED) {
    try {
      data = this.c.zlib.inflate(data);
    } catch(e) {
      this.emit('error', e);
      return;
    }
  }

  this.emit('data', data);
};

/**
 * Handle Dframes and Cframe w/ FLAG_FIN
 */
Request.prototype._end = function(initial) {
  if (!initial && !this.hasBody) {
    this.emit('error', 'Called _end twice');
    return;
  }

  // We has received all that we wanted
  this.hasBody = false;

  this.emit('end');
};

