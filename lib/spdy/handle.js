'use strict';

var thing = require('handle-thing');
var httpDeceiver = require('http-deceiver');
var util = require('util');

function Handle(stream, socket) {
  var state = {};
  this._spdyState = state;

  state.stream = stream;
  state.socket = null;
  state.rawSocket = socket || stream.connection.socket;
  state.deceiver = null;

  var self = this;
  thing.call(this, stream, {
    getPeerName: function() {
      return self._getPeerName();
    },
    close: function(callback) {
      return self._close(callback);
    }
  });

  if (!state.stream) {
    this.on('stream', function(stream) {
      state.stream = stream;
    });
  }
}
util.inherits(Handle, thing);
module.exports = Handle;

Handle.create = function create(stream, socket) {
  return new Handle(stream, socket);
};

Handle.prototype._getPeerName = function _getPeerName() {
  var state = this._spdyState;

  if (state.rawSocket._getpeername)
    return state.rawSocket._getpeername();

  return null;
};

Handle.prototype._close = function _close(callback) {
  var state = this._spdyState;

  state.stream.abort(callback);
};

Handle.prototype.assignSocket = function assignSocket(socket, options) {
  var state = this._spdyState;

  state.socket = socket;
  state.deceiver = httpDeceiver.create(socket, options);

  function onStreamError(err) {
    state.socket.emit('error', err);
  }

  if (!state.stream) {
    this.on('stream', function(stream) {
      stream.on('error', onStreamError);
    });
    return;
  }
  state.stream.on('error', onStreamError);
};

function nop() {
}

Handle.prototype.assignClientRequest = function assignClientRequest(req) {
  var state = this._spdyState;

  var oldSend = req._send;

  // Catch the headers before request will be sent
  var self = this;
  req._send = function send() {
    var headers = this._headers;
    this._headerSent = true;

    // Just to prevent:
    // `TypeError: Cannot read property '_httpMessage' of null`
    // lib/_http_outgoing.js expects some header data to send
    this._buffer('', 'utf8', nop);

    if (!state.stream) {
      self.on('stream', function(stream) {
        stream.sendHeaders(headers);
      });
    } else {
      state.stream.sendHeaders(headers);
    }

    req._send = oldSend;
    return req._send.apply(this, arguments);
  };
};

Handle.prototype.emitRequest = function emitRequest() {
  var state = this._spdyState;
  var stream = state.stream;

  state.deceiver.emitRequest({
    method: stream.method,
    path: stream.path,
    headers: stream.headers
  });
};

Handle.prototype.emitResponse = function emitResponse(status, headers) {
  var state = this._spdyState;

  state.deceiver.emitResponse({
    status: status,
    headers: headers
  });
};

// TODO(indutny): emit trailing headers
