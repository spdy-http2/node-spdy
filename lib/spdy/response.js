var spdy = require('../spdy'),
    http = require('http');

//
// ### function writeHead (statusCode)
// #### @statusCode {Number} HTTP Status code
// .writeHead() wrapper
// (Sorry, copy pasted from lib/http.js)
//
exports.writeHead = function(statusCode) {
  if (this._headerSent) return;
  this._headerSent = true;

  var reasonPhrase, headers, headerIndex;

  if (typeof arguments[1] == 'string') {
    reasonPhrase = arguments[1];
    headerIndex = 2;
  } else {
    reasonPhrase = http.STATUS_CODES[statusCode] || 'unknown';
    headerIndex = 1;
  }
  this.statusCode = statusCode;

  var obj = arguments[headerIndex];

  if (obj && this._headers) {
    // Slow-case: when progressive API and header fields are passed.
    headers = this._renderHeaders();

    // handle object case
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k) headers[k] = obj[k];
    }
  } else if (this._headers) {
    // only progressive api is used
    headers = this._renderHeaders();
  } else {
    // only writeHead() called
    headers = obj;
  }

  // cleanup
  this._header = '';

  // Do not send data to new connections after GOAWAY
  if (this.socket.isGoaway()) return;

  this.socket.lock(function() {
    var socket = this;

    this.framer.replyFrame(
      this.id,
      statusCode,
      reasonPhrase,
      headers,
      function (err, chunks) {
        // TODO: Handle err
        chunks.forEach(function(chunk) {
          socket.connection.write(chunk);
        });
        socket.unlock();
      }
    );
  });
};
