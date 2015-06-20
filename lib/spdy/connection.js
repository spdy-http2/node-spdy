'use strict';

var util = require('util');
var spdy = require('../spdy');

var debug = {
  server: require('debug')('spdy:connection:server'),
  client: require('debug')('spdy:connection:client')
};
var EventEmitter = require('events').EventEmitter;

var Stream = spdy.Stream;

//
// ### function Connection (socket, options)
// #### @socket {net.Socket} server's connection
// #### @options {Object} Connection options
// Abstract connection @constructor
//
function Connection(socket, options, server) {
  EventEmitter.call(this);

  var state = {};
  this._spdyState = state;

  // NOTE: There's a big trick here. Connection is used as a `this` argument
  // to the wrapped `connection` event listener.
  // socket end doesn't necessarly mean connection drop
  this.httpAllowHalfOpen = true;

  // Socket timeout
  this.timeout = options.server && options.server.timeout || 0;

  // Protocol info
  state.protocol = options.protocol;
  state.version = null;
  state.constants = state.protocol.constants;
  state.pair = null;
  state.isServer = options.isServer;

  // Defaults
  state.maxStreams = options.maxStreams ||
                     state.constants.MAX_CONCURRENT_STREAMS;

  state.autoSpdy31 = options.protocol.name !== 'h2' && options.autoSpdy31;

  // Connection-level flow control
  var windowSize = options.windowSize || 1 << 20;
  state.window = new spdy.Window({
    id: 0,
    isServer: state.isServer,
    recv: {
      size: state.constants.DEFAULT_WINDOW,
      lowWaterMark: windowSize / 2
    },
    send: {
      size: state.constants.DEFAULT_WINDOW,

      // TODO(indutny): is there a point in making this configurable
      lowWaterMark: state.constants.DEFAULT_WINDOW / 2
    }
  });

  // It starts with DEFAULT_WINDOW, update must be sent to change it on client
  state.window.recv.setMax(windowSize);

  // Interleaving configuration
  state.maxChunk = options.maxChunk === undefined ? 8 * 1024 : options.maxChunk;

  // Various state info
  state.pool = state.protocol.compressionPool.create(options.headerCompression);
  state.counters = {
    push: 0,
    stream: 0
  };

  // Init streams list
  state.stream = {
    map: {},
    count: 0,
    nextId: state.isServer ? 2 : 1,
    pushEnabled: !state.isServer
  };
  state.ping = {
    nextId: state.isServer ? 2 : 1,
    map: {}
  };
  state.goaway = false;

  // Debug
  state.debug = state.isServer ? debug.server : debug.client;

  // X-Forwarded feature
  state.xForward = null;

  // Create parser and hole for framer
  state.parser = state.protocol.parser.create({
    // NOTE: needed to distinguish ping from ping ACK in SPDY
    isServer: state.isServer,
    window: state.window
  });
  state.framer = state.protocol.framer.create({
    window: state.window
  });

  if (!state.isServer)
    state.parser.skipPreface();

  this.socket = socket;
  this.encrypted = socket.encrypted;

  this._init();
}
util.inherits(Connection, EventEmitter);
exports.Connection = Connection;

Connection.prototype._init = function init() {
  var self = this;
  var state = this._spdyState;
  var pool = state.pool;

  // Initialize session window
  state.window.recv.on('drain', function() {
    self._onSessionWindowDrain();
  });

  // Initialize parser
  state.parser.on('data', function(frame) {
    self._handleFrame(frame);
  });
  state.parser.once('version', function(version) {
    self._onVersion(version);
  });

  // Propagate parser errors
  state.parser.on('error', function(err) {
    self._onParserError(err);
  });

  // Propagate framer errors
  state.framer.on('error', function(err) {
    self.emit('error', err);
  });

  this.socket.pipe(state.parser);
  state.framer.pipe(this.socket);

  // 2 minutes socket timeout
  if (this.socket.setTimeout)
    this.socket.setTimeout(this.timeout);
  this.socket.once('timeout', function ontimeout() {
    if (self.socket.destroy)
      self.socket.destroy();
  });

  // Allow high-level api to catch socket errors
  this.socket.on('error', function onSocketError(e) {
    self.emit('error', e);
  });

  this.socket.once('close', function onclose() {
    var err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    self.destroyStreams(err);
    self.emit('close');

    if (state.pair)
      pool.put(state.pair);
  });

  // Do not allow half-open connections
  this.socket.allowHalfOpen = false;
};

Connection.prototype._onVersion = function _onVersion(version) {
  var self = this;
  var state = this._spdyState;
  var prev = state.version;
  var parser = state.parser;
  var framer = state.framer;
  var pool = state.pool;

  state.version = version;

  // Ignore transition to 3.1
  if (!prev) {
    state.pair = pool.get(version);
    parser.setCompression(state.pair);
    framer.setCompression(state.pair);
  }
  framer.setVersion(version);

  if (!state.isServer)
    framer.prefaceFrame();

  // Send preface+settings frame (once)
  framer.settingsFrame({
    max_header_list_size: state.constants.DEFAULT_MAX_HEADER_LIST_SIZE,
    max_concurrent_streams: state.maxStreams,
    initial_window_size: state.window.recv.max
  });

  // Update session window
  if (state.version >= 3.1 || (state.isServer && state.autoSpdy31))
    this._onSessionWindowDrain();
};

Connection.prototype._onParserError = function _onParserError(err) {
  var state = this._spdyState;

  // Prevent further errors
  this.socket.unpipe(this.parser);

  // Send GOAWAY
  if (err instanceof spdy.protocol.base.utils.ProtocolError) {
    state.framer.goawayFrame({
      lastId: state.stream.nextId - 2,
      code: err.code,
      extra: err.message
    });
  }

  this.emit('error', err);
};

Connection.prototype._handleFrame = function _handleFrame(frame) {
  var state = this._spdyState;

  state.debug('frame', frame);

  // For testing purposes
  this.emit('frame', frame);

  var stream;

  // Session window update
  if (frame.type === 'WINDOW_UPDATE' && frame.id === 0) {
    if (state.version < 3.1 && state.autoSpdy31)
      state.version = 3.1;
    state.window.send.update(frame.delta);
    return;
  }

  if (!stream && frame.id !== undefined) {
    // Load created one
    stream = state.stream.map[frame.id];

    // RST maybe out of sync
    if (!stream && frame.type === 'RST_STREAM')
      return;

    // Fail if not found
    if (stream === undefined && frame.type !== 'HEADERS') {
      state.debug('stream %d not found', frame.id);
      state.framer.rstFrame({ id: frame.id, code: 'INVALID_STREAM' });
      return;
    }
  }

  // Create new stream
  if (!stream && frame.type === 'HEADERS') {
    this._createStream(frame);

    return;
  }

  if (stream) {
    stream._handleFrame(frame);
  } else if (frame.type === 'SETTINGS') {
    this._handleSettings(frame.settings);
  } else if (frame.type === 'GOAWAY') {
    // TODO(indutny): close connection if no streams are present
    state.goaway = frame.lastId;
  } else if (frame.type === 'X_FORWARDED') {
    state.xForward = frame.host;
  } else {
    console.error('Unknown type: ', frame.type);
  }
};

Connection.prototype._isGoaway = function _isGoaway(id) {
  var state = this._spdyState;
  if (state.goaway && state.goaway < id)
    return true;
  return false;
};

Connection.prototype._createStream = function _createStream(frame) {
  var state = this._spdyState;
  if (this._isGoaway(frame.id)) {
    state.framer.rstFrame({ id: frame.id, code: 'REFUSED_STREAM' });
    return;
  }

  var isPush = (frame.id + state.stream.nextId) % 2 === 0;
  if (isPush && !state.stream.pushEnabled) {
    state.framer.rstFrame({ id: frame.id, code: 'PROTOCOL_ERROR' });
    return;
  }

  var associated;

  // Fetch associated stream for push
  if (isPush) {
    associated = state.streams[frame.associated];

    // Fail if not found
    if (associated === undefined) {
      state.framer.rstFrame({ id: frame.id, code: 'INVALID_STREAM' });
      return;
    }
  }

  var stream = new Stream(this, {
    id: frame.id,
    request: false,
    method: frame.headers[':method'],
    path: frame.headers[':path'],
    host: frame.headers[':authority'],
    headers: frame.headers
  });
  this._addStream(stream);

  // Associate streams
  if (associated)
    stream.setAssociated(associated);

  // TODO(indutny) handle stream limit
  this.emit('stream', stream);

  return stream;
};

Connection.prototype._onSessionWindowDrain = function _onSessionWindowDrain() {
  var state = this._spdyState;
  if (state.version < 3.1 && (!state.isServer || !state.autoSpdy31))
    return;


  var self = this;
  var delta = state.window.recv.getDelta();
  state.debug('window draining, update by %d', delta);

  state.framer.windowUpdateFrame({
    id: 0,
    delta: delta
  });
  state.window.recv.update(delta);
};

Connection.prototype.start = function start(version) {
  this._spdyState.parser.setVersion(version);
};

Connection.prototype._handleSettings = function _handleSettings(settings) {
  var state = this._spdyState;

  this._setDefaultWindow(settings);
  if (settings.max_frame_size)
    state.parser.setMaxFrameSize(settings.max_frame_size.value);
  if (settings.header_table_size)
    state.decompress.updateTableSize(settings.header_table_size);

  // TODO(indutny): max_header_list size
};

Connection.prototype._setDefaultWindow = function _setDefaultWindow(settings) {
  if (!settings.initial_window_size)
    return;

  var state = this._spdyState;
  Object.keys(state.stream.map).forEach(function(id) {
    var stream = state.stream.map[id];
    var window = stream._spdyState.window;

    window.send.updateMax(settings.initial_window_size);
    window.send.setLowWaterMark(settings.initial_window_size / 2);
  });
};

Connection.prototype._handlePing = function handlePing(opaque, ack) {
  var self = this;
  var state = this._spdyState;

  // Handle incoming PING
  if (!ack) {
    state.framer.pingFrame({
      opaque: opaque,
      ack: true
    });

    self.emit('ping', opaque);
    return;
  }

  // Handle reply PING
  var hex = opaque.toString('hex');
  if (!state.ping.map[hex])
    return;
  var ping = state.ping.map[hex];
  delete state.ping.map[hex];

  if (ping.cb)
    ping.cb(null);
};

Connection.prototype.ping = function ping(callback) {
  var self = this;
  var state = this._spdyState;

  // HTTP2 is using 8-byte opaque
  var opaque = new Buffer(state.constants.PING_OPAQUE_SIZE);
  opaque.fill(0);
  opaque.writeUInt32BE(state.ping.nextId, opaque.length - 4);
  state.ping.nextId += 2;

  state.framer.pingFrame({
    opaque: opaque,
    ack: false
  }, function(err) {
    if (err)
      return self.emit('error', err);

    state.ping.map[opaque.toString('hex')] = { cb: callback };
  });
};

Connection.prototype.getCounter = function getCounter(name) {
  return this._spdyState.counters[name];
};

Connection.prototype.cork = function cork() {
  if (this.socket && this.socket.cork)
    this.socket.cork();
};

Connection.prototype.uncork = function uncork() {
  if (this.socket && this.socket.uncork)
    this.socket.uncork();
};

Connection.prototype.request = function request(uri, callback) {
  var state = this._spdyState;
  var id = state.stream.nextId;
  state.stream.nextId += 2;

  var self = this;
  this._spdyState.framer.requestFrame({
    id: id,
    method: uri.method,
    path: uri.path,
    host: uri.host || uri.headers.host || '127.0.0.1',
    headers: uri.headers || {}
  }, function(err) {
    if (err)
      return callback(err);

    var stream = new Stream(self, {
      id: id,
      request: true,
      method: uri.method,
      path: uri.path,
      host: uri.host,
      headers: uri.headers || {}
    });
    self._addStream(stream);

    callback(null, stream);
  });
};

Connection.prototype._addStream = function _addStream(stream) {
  var self = this;
  var state = this._spdyState;

  state.debug('add stream %d', stream.id);
  state.stream.map[stream.id] = stream;
  state.stream.count++;
  state.counters.stream++;

  stream.once('close', function() {
    self._removeStream(stream);
  });
};

Connection.prototype._removeStream = function _removeStream(stream) {
  var state = this._spdyState;

  state.debug('remove stream %d', stream.id);
  delete state.stream.map[stream.id];
  state.stream.count--;
};

Connection.prototype.end = function end() {
  var self = this;
  var state = this._spdyState;

  state.framer.goawayFrame(state.lastId,
                           state.constants.goaway.OK,
                           function(err) {
    if (err)
      return self.emit('error', err);

    state.goaway = state.lastId;

    // TODO(indutny): make it play with scheduler
    // Destroy socket if there are no streams
    if (!state.isServer &&
        state.goaway &&
        state.streamCount === 0 &&
        self.socket) {
      if (self.socket.destroySoon)
        self.socket.destroySoon();
    }
  });
};

Connection.prototype.destroyStreams = function destroyStreams(err) {
  var state = this._spdyState;
  Object.keys(state.stream.map).forEach(function(id) {
    var stream = state.stream.map[id];

    stream.emit('error', err);
  });
};

Connection.prototype.isServer = function isServer() {
  return this._spdyState.isServer;
};
