'use strict';

var util = require('util');
var spdy = require('../spdy');

var debug = require('debug')('spdy:connection');
var EventEmitter = require('events').EventEmitter;

var Stream = spdy.Stream;

//
// ### function Connection (socket, state, server)
// #### @socket {net.Socket} server's connection
// #### @options {Object} Connection options
// #### @server {net.Server} server
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
  this.timeout = server && server.timeout || 0;

  // Protocol info
  state.protocol = options.protocol;
  state.version = null;
  state.constants = state.protocol.constants;
  state.pair = null;

  // Defaults
  state.maxStreams = options.maxStreams ||
                     state.constants.MAX_CONCURRENT_STREAMS;

  state.autoSpdy31 = options.protocol.name !== 'h2' && options.autoSpdy31;

  // Connection-level flow control
  var windowSize = options.windowSize || 1 << 20;
  state.window = new spdy.Window({
    recv: windowSize,
    send: state.constants.DEFAULT_WINDOW,

    // TODO(indutny): is there a point in making this configurable
    lowWaterMark: windowSize / 2
  });

  // It starts with DEFAULT_WINDOW, update must be sent to change it on client
  state.window.recv.setCurrent(state.constants.DEFAULT_WINDOW);

  // Interleaving configuration
  state.maxChunk = options.maxChunk === undefined ? 8 * 1024 : options.maxChunk;

  // Various state info
  state.pool = state.protocol.compressionPool.create(options.headerCompression);
  state.counters = {
    push: 0,
    stream: 0
  };

  // Init streams list
  state.isServer = options.isServer;
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
  state.parser.on('version', function(version) {
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
  this.socket.setTimeout(this.timeout);
  this.socket.once('timeout', function ontimeout() {
    self.socket.destroy();
  });

  // Allow high-level api to catch socket errors
  this.socket.on('error', function onSocketError(e) {
    self.emit('error', e);
  });

  this.socket.once('close', function onclose() {
    var err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    self._destroyStreams(err);
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

  // Send preface+settings frame (once)
  framer.settingsFrame({
    maxStreams: state.maxStreams,
    windowSize: state.initialWindowSize
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
    framer.goawayFrame({
      lastId: state.stream.nextId - 2,
      code: err.code,
      extra: err.message
    });
  }

  this.emit('error', err);
};

Connection.prototype._handleFrame = function _handleFrame(frame) {
  var state = this._spdyState;

  debug('frame (is_client=%d)', !state.isServer, frame);
  var stream;

  // Create new stream
  if (frame.type === 'SYN_STREAM') {
    stream = this._createStream(frame);

    // Error prevented stream creation
    if (!stream)
      return;
  }

  // Session window update
  if (frame.type === 'WINDOW_UPDATE' && frame.id === 0) {
    if (state.version < 3.1 && state.autoSpdy31)
      state.version = 3.1;
    state.window.send.update(frame.delta);
    return;
  }

  if (!stream && frame.id !== undefined) {
    // Load created one
    stream = state.streams[frame.id];

    // RST maybe out of sync
    if (!stream && frame.type === 'RST_STREAM')
      return;

    // Fail if not found
    if (stream === undefined) {
      state.framer.rstFrame({
        id: frame.id,
        code: state.constants.error.INVALID_STREAM
      });
      return;
    }
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

Connection.prototype._createStream = function _createStream(frame) {
  var state = this._spdyState;
  if (state.goaway && state.goaway < frame.id) {
    state.framer.rstFrame({
      id: frame.id,
      code: state.constants.error.REFUSED_STREAM
    });
    return;
  }

  var isPush = (frame.id + state.stream.nextId) % 2 === 1;
  if (isPush && !state.stream.pushEnabled) {
    state.framer.rstFrame({
      id: frame.id,
      code: state.constants.error.PROTOCOL_ERROR
    });
    return;
  }

  var associated;

  // Fetch associated stream for push
  if (isPush) {
    associated = state.streams[frame.associated];

    // Fail if not found
    if (associated === undefined) {
      state.framer.rstFrame({
        id: frame.id,
        code: state.constants.error.INVALID_STREAM
      });
      return;
    }
  }

  var stream = new Stream(this);

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
  state.framer.windowUpdateFrame({
    id: 0,
    delta: delta
  });
  state.window.recv.update(delta);
};

//
// ### function setVersion (version)
// #### @version {Number} Protocol version
// Set protocol version to use
//
Connection.prototype._setVersion = function setVersion(version) {
  this._spdyState.parser.setVersion(version);
};

//
// ### function _rst (streamId, code, extra)
// #### @streamId {Number}
// #### @code {Number}
// #### @extra {String}
// Send RST frame
//
Connection.prototype._rst = function rst(streamId, code, extra) {
  var self = this;
  this._spdyState.framer.rstFrame(streamId, code, extra, function(err) {
    if (err)
      return self.emit('error', err);
  });
};

//
// ### function _handleSettings (settings)
// #### @settings {Object}
// Update frame size, window size, table size using settings frame
//
Connection.prototype._handleSettings = function _handleSettings(settings) {
  var state = this._spdyState;

  this._setDefaultWindow(settings);
  if (settings.max_frame_size)
    state.parser.setMaxFrameSize(settings.max_frame_size.value);
  if (settings.header_table_size)
    state.decompress.updateTableSize(settings.header_table_size);

  // TODO(indutny): max_header_list size
};

//
// ### function _setDefaultWindow (settings)
// #### @settings {Object}
// Update the default transfer window -- in the connection and in the
// active streams
//
Connection.prototype._setDefaultWindow = function _setDefaultWindow(settings) {
  if (!settings.initial_window_size ||
      settings.initial_window_size.persisted) {
    return;
  }
  var state = this._spdyState;
  state.initialSinkSize = settings.initial_window_size.value;

  Object.keys(state.stream.map).forEach(function(id) {
    state.stream.map[id].window.send.update(settings.initial_window_size.value);
  });
};

//
// ### function handlePing (opaque, ack)
// #### @opaque {Buffer} PING id
// #### @ack {Boolean}
//
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

//
// ### function ping (callback)
// #### @callback {Function}
// Send PING frame and invoke callback once received it back
//
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

//
// ### function getCounter (name)
// #### @name {String} Counter name
// Get counter value
//
Connection.prototype.getCounter = function getCounter(name) {
  return this._spdyState.counters[name];
};

//
// ### function cork ()
// Accumulate data before writing out
//
Connection.prototype.cork = function cork() {
  if (this.socket && this.socket.cork)
    this.socket.cork();
};

//
// ### function uncork ()
// Write out accumulated data
//
Connection.prototype.uncork = function uncork() {
  if (this.socket && this.socket.uncork)
    this.socket.uncork();
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
      self.socket.destroySoon();
    }
  });
};
