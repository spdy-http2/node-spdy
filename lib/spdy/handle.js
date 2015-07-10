var thing = require('handle-thing');
var httpDeceiver = require('http-deceiver');
var util = require('util');

function Handle(stream) {
  var state = {};
  this._spdyState = state;

  state.stream = stream;
  state.socket = null;
  state.rawSocket = stream.connection.socket;
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
}
util.inherits(Handle, thing);
module.exports = Handle;

Handle.create = function create(stream) {
  return new Handle(stream);
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

  state.stream.on('error', function(err) {
    state.socket.emit('error', err);
  });
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
