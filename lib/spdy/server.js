var assert = require('assert');
var https = require('https');
var net = require('net');
var util = require('util');
var transport = require('spdy-transport');
var debug = require('debug')('spdy:server');

var spdy = require('../spdy');

var proto = {};

function instantiate(base) {
  function Server(options, handler) {
    this._init(base, options, handler);
  }
  util.inherits(Server, base);

  Server.create = function create(options, handler) {
    return new Server(options, handler);
  };

  Object.keys(proto).forEach(function(key) {
    Server.prototype[key] = proto[key];
  });

  return Server;
}

proto._init = function _init(base, options, handler) {
  var state = {};
  this._spdyState = state;

  var protocols = [
    'h2',
    'spdy/3.1', 'spdy/3', 'spdy/2',
    'http/1.1', 'http/1.0'
  ];

  var actualOptions = util._extend({
    NPNProtocols: protocols,

    // Future-proof
    ALPNProtocols: protocols
  }, options);

  base.call(this, actualOptions);

  // Support HEADERS+FIN
  this.httpAllowHalfOpen = true;

  state.options = options.spdy || {};

  state.secure = this.listeners('secureConnection').length !== 0;
  var event = state.secure ? 'secureConnection' : 'connection';

  state.listeners = this.listeners(event).slice();
  assert(state.listeners.length > 0, 'Server does not have default listeners');
  this.removeAllListeners(event);

  this.on(event, this._onConnection);

  // Patch response
  this.on('request', this._onRequest);
  if (handler)
    this.on('request', handler);

  debug('server init secure=%d', state.secure);
};

proto._onConnection = function _onConnection(socket) {
  var state = this._spdyState;

  var protocol;
  if (state.secure)
    protocol = socket.npnProtocol || socket.alpnProtocol;
  else
    protocol = state.options.protocol;

  debug('incoming socket protocol=%j', protocol);

  // No way we can do anything with the socket
  if (!protocol || protocol === 'http/1.1' || protocol === 'http/1.0')
    return this._invokeDefault(socket);

  var connection = transport.connection.create(socket, util._extend({
    protocol: /spdy/.test(protocol) ? 'spdy' : 'http2',
    isServer: true
  }, state.options.connection || {}));

  // Set version when we are certain
  if (protocol === 'spdy/3.1')
    connection.start(3.1);
  else if (protocol === 'spdy/3')
    connection.start(3);
  else if (protocol === 'spdy/2')
    connection.start(2);

  connection.on('error', function(err) {
    socket.destroy();
  });

  var self = this;
  connection.on('stream', function(stream) {
    self._onStream(stream);
  });
};

proto._invokeDefault = function _invokeDefault(socket) {
  var state = this._spdyState;

  for (var i = 0; i < state.listeners.length; i++)
    state.listeners[i].call(this, socket);
};

proto._onStream = function _onStream(stream) {
  var handle = spdy.handle.create(stream);
  var socket = new net.Socket({
    handle: handle,
    allowHalfOpen: true
  });
  handle.assignSocket(socket);

  // For v0.8
  socket.readable = true;
  socket.writable = true;

  this._invokeDefault(socket);

  handle.emitRequest();
};

proto._onRequest = function _onRequest(req, res) {
  res.writeHead = spdy.response.writeHead;
  res.end = spdy.response.end;
};

module.exports = instantiate(https.Server);
