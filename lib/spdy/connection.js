var util = require('util');
var assert = require('assert');
var spdy = require('../spdy');
var constants = spdy.protocol.constants;

var Stream = spdy.Stream;

var last_frag = new Buffer('0\r\n\r\n');

//
// ### function Connection (socket, state)
// #### @socket {net.Socket} server's connection
// #### @options {Object} Connection options
// Abstract connection @constructor
//
function Connection(socket, options) {
  process.EventEmitter.call(this);

  var state = {};
  this._spdyState = state;

  // Defaults
  state.maxStreams = options.maxStreams || 100;
  state.sinkSize = options.sinkSize || (1 << 16);
  state.windowSize = options.windowSize || (1 << 20);

  // Interleaving configuration
  state.maxChunk = options.maxChunk === undefined ? 8 * 1024 : options.maxChunk;

  // Various state info
  state.closed = false;
  state.pool = spdy.zlibpool.create();
  state.counters = {
    pushCount: 0,
    streamCount: 0
  };

  state.version = null;
  state.deflate = null;
  state.inflate = null;

  // Init streams list
  state.isServer = options.isServer;
  state.streams = {};
  state.streamCount = 0;
  state.pushId = 0;
  state.pingId = state.isServer ? 0 : 1;
  state.pings = {};
  state.goaway = false;

  // Initialize scheduler
  state.scheduler = spdy.scheduler.create(this);

  // Create parser and hole for framer
  state.parser = spdy.protocol.parser.create(this);
  state.framer = spdy.protocol.framer.create();

  // Lock data
  state.locked = false;
  state.lockQueue = [];

  this.socket = socket;
  this.encrypted = socket.encrypted;

  this._init();
}
util.inherits(Connection, process.EventEmitter);
exports.Connection = Connection;

Connection.prototype._init = function init() {
  var self = this;
  var state = this._spdyState;
  var pool = state.pool;
  var pair = null;

  // Initialize parser
  this._spdyState.parser.on('frame', this._handleFrame.bind(this));

  this._spdyState.parser.on('version', function onversion(version) {
    if (!pair) {
      pair = pool.get('spdy/' + version);
      state.version = version;
      state.deflate = pair.deflate;
      state.inflate = pair.inflate;

      // Send settings frame
      var framer = state.framer;
      framer.setCompression(pair.deflate, pair.inflate);
      framer.setVersion(version);
      framer.settingsFrame(state, function(err, frame) {
        if (err)
          return self.emit('error', err);
        self.write(frame);
      });
    }
  });

  // Propagate parser errors
  state.parser.on('error', function onParserError(err) {
    self.emit('error', err);
  });

  this.socket.pipe(state.parser);

  // 2 minutes socket timeout
  this.socket.setTimeout(2 * 60 * 1000);
  this.socket.once('timeout', function ontimeout() {
    self.socket.destroy();
  });

  // Allow high-level api to catch socket errors
  this.socket.on('error', function onSocketError(e) {
    self.emit('error', e);
  });

  this.socket.once('close', function onclose() {
    self._destroyStreams(new Error('Socket hangup'));

    state.closed = true;
    if (pair)
      pool.put(pair);
  });

  // Do not allow half-open connections
  this.socket.allowHalfOpen = false;

  if (spdy.utils.isLegacy) {
    this.socket.on('drain', function ondrain() {
      self.emit('drain');
    });
  }
};

//
// ### function handleFrame (frame)
// #### @frame {Object} SPDY frame
//
Connection.prototype._handleFrame = function handleFrame(frame) {
  var state = this._spdyState;

  if (state.closed)
    return;

  var stream;

  // Create new stream
  if (frame.type === 'SYN_STREAM') {
    stream = this._handleSynStream(frame);
  } else {
    if (frame.id !== undefined) {
      // Load created one
      stream = state.streams[frame.id];

      // Fail if not found
      if (stream === undefined) {
        if (frame.type === 'RST_STREAM')
          return;
        this._rst(frame.id, constants.rst.INVALID_STREAM);
        return;
      }
    }

    // Emit 'data' event
    if (frame.type === 'DATA') {
      this._handleData(stream, frame);
    // Reply for client stream
    } else if (frame.type === 'SYN_REPLY') {
      // If stream not client - send RST
      if (!stream._spdyState.isClient) {
        this._rst(frame.id, constants.rst.PROTOCOL_ERROR);
        return;
      }

      stream._handleResponse(frame);

    // Destroy stream if we was asked to do this
    } else if (frame.type === 'RST_STREAM') {
      stream._spdyState.rstCode = 0;
      stream._spdyState.closedBy.us = true;
      stream._spdyState.closedBy.them = true;
      if (frame.status === 5) {
        // If client "cancels" connection - close stream and
        // all associated push streams without error
        stream._spdyState.pushes.forEach(function(stream) {
          stream.close();
        });
        stream.close();
      } else {
        // Emit error on destroy
        stream.destroy(new Error('Received rst: ' + frame.status));
      }
    // Respond with same PING
    } else if (frame.type === 'PING') {
      this._handlePing(frame.pingId);
    } else if (frame.type === 'SETTINGS') {
      this._setDefaultWindow(frame.settings);
    } else if (frame.type === 'GOAWAY') {
      state.goaway = frame.lastId;
    } else if (frame.type === 'WINDOW_UPDATE') {
      stream._drainSink(frame.delta);
    } else if (frame.type === 'HEADERS') {
      stream.emit('headers', frame.headers);
    } else {
      console.error('Unknown type: ', frame.type);
    }
  }

  // Handle half-closed
  if (frame.fin) {
    // Don't allow to close stream twice
    if (stream._spdyState.closedBy.them) {
      stream._spdyState.rstCode = constants.rst.PROTOCOL_ERROR;
      stream.emit('error', 'Already half-closed');
    } else {
      stream._spdyState.closedBy.them = true;

      // Emulate last chunked fragment
      if (stream._spdyState.forceChunked)
        stream._recv(last_frag, true);

      stream._handleClose();
    }
  }
};

//
// ### function handleSynStream (frame)
// #### @frame {Object} SPDY frame
//
Connection.prototype._handleSynStream = function handleSynStream(frame) {
  var state = this._spdyState;
  var associated;

  // PUSH stream
  if (!state.isServer) {
    // Incorrect frame id
    if (frame.id % 2 === 1 || frame.associated % 2 === 0)
      return this._rst(frame.id, constants.rst.PROTOCOL_ERROR);

    associated = state.streams[frame.associated];

    // Fail if not found
    if (associated === undefined) {
      if (frame.type === 'RST_STREAM')
        return;
      this._rst(frame.id, constants.rst.INVALID_STREAM);
      return;
    }
  }

  var stream = new Stream(this, frame);
  this._addStream(stream);

  // Associate streams
  if (associated) {
    associated._spdyState.pushes.push(stream);
    stream.associated = associated;
  }

  // If we reached stream limit
  this.emit('stream', stream);
  stream._start(frame.url, frame.headers);

  return stream;
};

//
// ### function _handleData (stream, frame)
// #### @stream {Stream} SPDY Stream
// #### @frame {Object} SPDY frame
//
Connection.prototype._handleData = function handleData(stream, frame) {
  if (frame.data.length > 0) {
    if (stream._spdyState.closedBy.them) {
      stream._spdyState.rstCode = constants.rst.PROTOCOL_ERROR;
      stream.emit('error', 'Writing to half-closed stream');
    } else {
      stream._recv(frame.data);
    }
  }
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
// ### function addStream (stream)
// #### @stream {Stream}
//
Connection.prototype._addStream = function addStream(stream) {
  var state = this._spdyState;
  var id = stream._spdyState.id;
  if (state.streams[id])
    return;
  state.streams[id] = stream;

  var isClient = id % 2 == 1;
  if (isClient && state.isServer || !isClient && !state.isServer)
    state.streamCount++;
};

//
// ### function removeStream (stream)
// #### @stream {Stream}
//
Connection.prototype._removeStream = function removeStream(stream) {
  var state = this._spdyState;
  var id = stream._spdyState.id;
  if (!state.streams[id])
    return;

  delete state.streams[id];

  var isClient = id % 2 == 1;
  if (isClient && state.isServer || !isClient && !state.isServer)
    state.streamCount--;
};

//
// ### function destroyStreams (err)
// #### @err {Error} *optional*
// Destroys all active streams
//
Connection.prototype._destroyStreams = function destroyStreams(err) {
  var state = this._spdyState;
  var streams = state.streams;
  state.streams = {};
  state.streamCount = 0;
  Object.keys(state.streams).forEach(function(id) {
    state.streams[id].destroy();
  });
};

//
// ### function _rst (streamId, code)
// #### @streamId {Number}
// #### @code {Number}
// Send RST frame
//
Connection.prototype._rst = function rst(streamId, code) {
  var self = this;
  this._spdyState.framer.rstFrame(streamId, code, function(err, frame) {
    if (err)
      return self.emit('error', err);
    self.write(frame);
  });
};

//
// ### function lock (callback)
// #### @callback {Function} continuation callback
// Acquire lock
//
Connection.prototype._lock = function lock(callback) {
  if (!callback)
    return;

  var state = this._spdyState;
  if (state.locked) {
    state.lockQueue.push(callback);
  } else {
    state.locked = true;
    callback(null);
  }
};

//
// ### function unlock ()
// Release lock and call all buffered callbacks
//
Connection.prototype._unlock = function unlock() {
  var state = this._spdyState;
  if (state.locked) {
    if (state.lockQueue.length) {
      var cb = state.lockQueue.shift();
      cb(null);
    } else {
      state.locked = false;
    }
  }
};

//
// ### function write (data, encoding)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// Writes data to socket
//
Connection.prototype.write = function write(data, encoding) {
  if (this.socket.writable)
    return this.socket.write(data, encoding);
};

//
// ### function _setDefaultWindow (settings)
// #### @settings {Object}
// Update the default transfer window -- in the connection and in the
// active streams
//
Connection.prototype._setDefaultWindow = function _setDefaultWindow(settings) {
  if (!settings)
    return;
  if (!settings.initial_window_size ||
      settings.initial_window_size.persisted) {
    return;
  }

  var state = this._spdyState;
  state.sinkSize = settings.initial_window_size.value;

  Object.keys(state.streams).forEach(function(id) {
    state.streams[id]._updateSinkSize(settings.initial_window_size.value);
  });
};

//
// ### function handlePing (id)
// #### @id {Number} PING id
//
Connection.prototype._handlePing = function handlePing(id) {
  var self = this;
  var state = this._spdyState;

  var ours = state.isServer && (id % 2 === 0) ||
             !state.isServer && (id % 2 === 1);

  // Handle incoming PING
  if (!ours) {
    state.framer.pingFrame(id, function(err, frame) {
      if (err)
        return self.emit('error', err);
      self.write(frame);
    });
    return;
  }

  // Handle reply PING
  if (!state.pings[id])
    return;
  var ping = state.pings[id];
  delete state.pings[id];

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
  var id = state.pingId;

  state.pingId += 2;

  state.framer.pingFrame(id, function(err, frame) {
    if (err)
      return self.emit('error', err);

    state.pings[id] = { cb: callback };
    self.write(frame);
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
