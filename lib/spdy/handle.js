'use strict';

var assert = require('assert');
var thing = require('handle-thing');
var httpDeceiver = require('http-deceiver');
var util = require('util');

function Handle(options, stream, socket) {
  var state = {};
  this._spdyState = state;

  state.options = options || {};

  state.stream = stream;
  state.socket = null;
  state.rawSocket = socket || stream.connection.socket;
  state.deceiver = null;
  state.ending = false;

  var self = this;
  thing.call(this, stream, {
    getPeerName: function() {
      return self._getPeerName();
    },
    close: function(callback) {
      return self._closeCallback(callback);
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

Handle.create = function create(options, stream, socket) {
  return new Handle(options, stream, socket);
};

Handle.prototype._getPeerName = function _getPeerName() {
  var state = this._spdyState;

  if (state.rawSocket._getpeername)
    return state.rawSocket._getpeername();

  return null;
};

Handle.prototype._closeCallback = function _closeCallback(callback) {
  var state = this._spdyState;

  if (state.ending)
    state.stream.end(callback);
  else
    state.stream.abort(callback);

  // Only a single end is allowed
  state.ending = false;
};

Handle.prototype.getStream = function getStream(callback) {
  var state = this._spdyState;

  if (!callback) {
    assert(state.stream);
    return state.stream;
  }

  if (state.stream) {
    process.nextTick(function() {
      callback(state.stream);
    });
    return;
  }

  this.on('stream', callback);
};

Handle.prototype.assignSocket = function assignSocket(socket, options) {
  var state = this._spdyState;

  state.socket = socket;
  state.deceiver = httpDeceiver.create(socket, options);

  function onStreamError(err) {
    state.socket.emit('error', err);
  }

  this.getStream(function(stream) {
    stream.on('error', onStreamError);
  });
};

Handle.prototype.assignClientRequest = function assignClientRequest(req) {
  var state = this._spdyState;
  var oldSend = req._send;

  // Catch the headers before request will be sent
  var self = this;
  req._send = function send() {
    var headers = this._headers;
    this._headerSent = true;

    // To prevent exception
    this.connection = state.socket;

    self.getStream(function(stream) {
      stream.sendHeaders(headers);
    });

    req._send = oldSend;
    return req._send.apply(this, arguments);
  };

  // No chunked encoding
  req.useChunkedEncodingByDefault = false;

  req.on('finish', function() {
    req.socket.end();
  });
};

Handle.prototype.assignRequest = function assignRequest(req) {
  // Emit trailing headers
  this.getStream(function(stream) {
    stream.on('headers', function(headers) {
      req.emit('trailers', headers);
    });
  });
};

Handle.prototype.assignResponse = function assignResponse(res) {
  var self = this;

  res.addTrailers = function addTrailers(headers) {
    self.getStream(function(stream) {
      stream.sendHeaders(headers);
    });
  };
};

Handle.prototype._transformHeaders = function _transformHeaders(kind, headers) {
  var state = this._spdyState;

  var res = {};
  var keys = Object.keys(headers);

  if (kind === 'request' && state.options['x-forwarded-for']) {
    var xforwarded = state.stream.connection.getXForwardedFor();
    if (xforwarded !== null)
      res['x-forwarded-for'] = xforwarded;
  }

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = headers[key];

    if (key === ':authority')
      res.host = value;
    if (/^:/.test(key))
      continue;

    res[key] = value;
  }
  return res;
};

Handle.prototype.emitRequest = function emitRequest() {
  var state = this._spdyState;
  var stream = state.stream;

  state.deceiver.emitRequest({
    method: stream.method,
    path: stream.path,
    headers: this._transformHeaders('request', stream.headers)
  });
};

Handle.prototype.emitResponse = function emitResponse(status, headers) {
  var state = this._spdyState;

  state.deceiver.emitResponse({
    status: status,
    headers: this._transformHeaders('response', headers)
  });
};
