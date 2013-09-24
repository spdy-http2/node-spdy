var util = require('util');
var assert = require('assert');
var spdy = require('../spdy');

var Stream = spdy.Stream;

//
// ### function Connection (socket, state)
// #### @socket {net.Socket} server's connection
// #### @state {Object} spdy state
// Abstract connection @constructor
//
function Connection(socket, state) {
  process.EventEmitter.call(this);

  var options = state.options;

  this._spdyState = state;

  this._closed = false;

  this.pool = spdy.zlibpool.create();

  this._version = null;
  this._deflate = null;
  this._inflate = null;

  this.encrypted = socket.encrypted;

  // Init streams list
  this.streams = {};
  this.streamsCount = 0;
  this.pushId = 0;
  this._goaway = false;

  // Data transfer window defaults to 64kb
  this.windowSize = options.windowSize;
  this.sinkSize = options.sinkSize;

  // Initialize scheduler
  this.scheduler = spdy.scheduler.create(this);

  // Store socket and pipe it to parser
  this.socket = socket;

  // Create parser and hole for framer
  this._parser = spdy.protocol.parser.create(this);
  this._framer = spdy.protocol.framer.create();

  // Lock data
  this._locked = false;
  this._lockQueue = [];

  this._init();
}
util.inherits(Connection, process.EventEmitter);
exports.Connection = Connection;

Connection.prototype._init = function init() {
  var self = this;
  var pool = this.pool;
  var options = this._spdyState.options;
  var pair = null;

  // Initialize parser
  this._parser.on('frame', function (frame) {
    if (this._closed)
      return;

    var stream;

    // Create new stream
    if (frame.type === 'SYN_STREAM') {
      self.streamsCount++;

      stream = self.streams[frame.id] = new Stream(self, frame);

      // If we reached stream limit
      if (self.streamsCount > options.maxStreams) {
        stream.once('error', function onerror() {});
        // REFUSED_STREAM
        stream._rstCode = 3;
        stream.destroy(true);
      } else {
        self.emit('stream', stream);

        stream._init();
      }
    } else {
      if (frame.id !== undefined) {
        // Load created one
        stream = self.streams[frame.id];

        // Fail if not found
        if (stream === undefined) {
          if (frame.type === 'RST_STREAM')
            return;
          self._rst(frame.id, 2);
          return;
        }
      }

      // Emit 'data' event
      if (frame.type === 'DATA') {
        if (frame.data.length > 0){
          if (stream._closedBy.client) {
            stream._rstCode = 2;
            stream.emit('error', 'Writing to half-closed stream');
          } else {
            stream._recv(frame.data);
          }
        }

      // Reply for client stream
      } else if (frame.type === 'SYN_REPLY') {
        // If stream not client - send RST
        if (!stream._client) {
          self._rst(frame.id, 2);
          return;
        }

        stream._handleResponse(frame);

      // Destroy stream if we was asked to do this
      } else if (frame.type === 'RST_STREAM') {
        stream._rstCode = 0;
        if (frame.status === 5) {
          // If client "cancels" connection - close stream and
          // all associated push streams without error
          stream.pushes.forEach(function(stream) {
            stream.close();
          });
          stream.close();
        } else {
          // Emit error on destroy
          stream.destroy(new Error('Received rst: ' + frame.status));
        }
      // Respond with same PING
      } else if (frame.type === 'PING') {
        self._framer.pingFrame(frame.pingId, function(err, frame) {
          if (err)
            return self.emit('error', err);
          self.write(frame);
        });
      } else if (frame.type === 'SETTINGS') {
        self._setDefaultWindow(frame.settings);
      } else if (frame.type === 'GOAWAY') {
        self._goaway = frame.lastId;
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
      if (stream._closedBy.client) {
        stream._rstCode = 2;
        stream.emit('error', 'Already half-closed');
      } else {
        stream._closedBy.client = true;

        // Emulate last chunked fragment
        if (stream._forceChunked)
          stream._recv(last_frag, true);

        stream._handleClose();
      }
    }
  });

  this._parser.on('version', function onversion(version) {
    if (!pair) {
      pair = pool.get('spdy/' + version);
      self._version = version;
      self._deflate = pair.deflate;
      self._inflate = pair.inflate;

      // Send settings frame
      self._framer.setCompression(pair.deflate, pair.inflate);
      self._framer.setVersion(version);
      self._framer.settingsFrame(options, function(err, frame) {
        if (err)
          return self.emit('error', err);
        self.write(frame);
      });
    }
  });

  // Propagate parser errors
  this._parser.on('error', function onParserError(err) {
    self.emit('error', err);
  });

  this.socket.pipe(this._parser);

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
    self._closed = true;
    if (pair)
      pool.put(pair);
  });

  if (spdy.utils.legacy) {
    this.socket.on('drain', function ondrain() {
      self.emit('drain');
    });
  }
};

//
// ### function setVersion (version)
// #### @version {Number} Protocol version
// Set protocol version to use
//
Connection.prototype._setVersion = function setVersion(version) {
  this._parser.setVersion(version);
};

//
// ### function _rst (streamId, code)
// #### @streamId {Number}
// #### @code {Number}
// Send RST frame
//
Connection.prototype._rst = function rst(streamId, code) {
  var self = this;
  this._framer.rstFrame(streamId, code, function(err, frame) {
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

  if (this._locked) {
    this._lockQueue.push(callback);
  } else {
    this._locked = true;
    callback(null);
  }
};

//
// ### function unlock ()
// Release lock and call all buffered callbacks
//
Connection.prototype._unlock = function unlock() {
  if (this._locked) {
    if (this._lockQueue.length) {
      var cb = this._lockQueue.shift();
      cb(null);
    } else {
      this._locked = false;
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

  this.sinkSize = settings.initial_window_size.value;

  Object.keys(this.streams).forEach(function(id) {
    this.streams[id]._updateSinkSize(settings.initial_window_size.value);
  }, this);
};
