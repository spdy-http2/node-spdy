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
  var stream = state.stream;

  state.deceiver.emitResponse({
    status: status,
    headers: headers
  });
};

// TODO(indutny): emit trailing headers
