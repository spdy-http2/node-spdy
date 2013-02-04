var spdy = require('../spdy'),
    util = require('util'),
    https = require('https'),
    stream = require('stream'),
    Buffer = require('buffer').Buffer;

var legacy = !/^v0\.(9|10)\..*$/.test(process.version);

if (legacy) {
  var DuplexStream = stream;
} else {
  var DuplexStream = stream.Duplex;
}

//
// ### function instantiate (HTTPSServer)
// #### @HTTPSServer {https.Server|Function} Base server class
// Will return constructor for SPDY Server, based on the HTTPSServer class
//
function instantiate(HTTPSServer) {
  //
  // ### function Server (options, requestListener)
  // #### @options {Object} tls server options
  // #### @requestListener {Function} (optional) request callback
  // SPDY Server @constructor
  //
  function Server(options, requestListener) {
    if (!options) options = {};
    if (!options.maxStreams) options.maxStreams = 100;
    if (!options.sinkSize) {
      options.sinkSize = 1 << 16;
    }
    if (!options.windowSize) {
      options.windowSize = 1 << 20; // 1mb
    }

    options.NPNProtocols = ['spdy/3', 'spdy/2', 'http/1.1', 'http/1.0'];

    if (options.plain) {
      HTTPSServer.call(this, requestListener);
    } else {
      HTTPSServer.call(this, options, requestListener);
    }

    // Use https if NPN is not supported
    if (!process.features.tls_npn && !options.debug) return;

    // Wrap connection handler
    var self = this,
        event = options.plain ? 'connection' : 'secureConnection',
        connectionHandler = this.listeners(event)[0];

    var pool = spdy.zlibpool.create();

    this.removeAllListeners(event);
    this.on(event, function onConnection(socket) {
      // Fallback to HTTPS if needed
      if ((!socket.npnProtocol || !socket.npnProtocol.match(/spdy/)) &&
          !options.debug && !options.plain) {
        return connectionHandler.call(this, socket);
      }

      // Wrap incoming socket into abstract class
      var connection = new Connection(socket, pool, options);

      // Emulate each stream like connection
      connection.on('stream', connectionHandler);

      connection.on('connect', function onconnect(req, socket) {
        socket.streamID = req.streamID = req.socket.id;
        socket.isSpdy = req.isSpdy = true;
        socket.spdyVersion = req.spdyVersion = req.socket.version;

        socket.on('finish', function onfinish() {
          req.connection.end();
        });

        self.emit('connect', req, socket);
      });

      connection.on('request', function onrequest(req, res) {
        res._renderHeaders = spdy.response._renderHeaders;
        res.writeHead = spdy.response.writeHead;
        res.push = spdy.response.push;
        res.streamID = req.streamID = req.socket.id;
        res.spdyVersion = req.spdyVersion = req.socket.version;
        res.isSpdy = req.isSpdy = true;

        // Chunked encoding is not supported in SPDY
        res.useChunkedEncodingByDefault = false;

        res.on('finish', function onfinish() {
          req.connection.end();
        });

        self.emit('request', req, res);
      });

      connection.on('error', function onerror(e) {
        console.log('[secureConnection] error ' + e);
        socket.destroy(e.errno === 'EPIPE' ? undefined : e);
      });
    });
  }
  util.inherits(Server, HTTPSServer);

  return Server;
}
exports.instantiate = instantiate;

// Export Server instantiated from https.Server
var Server = instantiate(https.Server);
exports.Server = Server;

//
// ### function create (base, options, requestListener)
// #### @base {Function} (optional) base server class (https.Server)
// #### @options {Object} tls server options
// #### @requestListener {Function} (optional) request callback
// @constructor wrapper
//
exports.create = function create(base, options, requestListener) {
  var server;
  if (typeof base === 'function') {
    server = instantiate(base);
  } else {
    server = Server;

    requestListener = options;
    options = base;
    base = null;
  }

  return new server(options, requestListener);
};

//
// ### function Connection (socket, pool, options)
// #### @socket {net.Socket} server's connection
// #### @pool {spdy.ZlibPool} zlib pool
// #### @options {Object} server's options
// Abstract connection @constructor
//
function Connection(socket, pool, options) {
  process.EventEmitter.call(this);

  var self = this;

  this._closed = false;

  this.pool = pool;
  var pair = pool.get(options.plain || socket.npnProtocol);

  this._deflate = pair.deflate;
  this._inflate = pair.inflate;

  this.encrypted = socket.encrypted;

  // Init streams list
  this.streams = {};
  this.streamsCount = 0;
  this.pushId = 0;
  this._goaway = false;

  this._framer = null;

  // Data transfer window defaults to 64kb
  this.windowSize = options.windowSize;
  this.sinkSize = options.sinkSize;

  // Initialize scheduler
  this.scheduler = spdy.scheduler.create(this);

  // Store socket and pipe it to parser
  this.socket = socket;

  // Initialize parser
  this.parser = spdy.parser.create(this);
  this.parser.on('frame', function (frame) {
    if (this._closed) return;

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
      if (frame.id) {
        // Load created one
        stream = self.streams[frame.id];

        // Fail if not found
        if (stream === undefined) {
          if (frame.type === 'RST_STREAM') return;
          self.write(self._framer.rstFrame(frame.id, 2));
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
        self.write(self._framer.pingFrame(frame.pingId));
      } else if (frame.type === 'SETTINGS') {
        self._setDefaultWindow(frame.settings);
      } else if (frame.type === 'GOAWAY') {
        self._goaway = frame.lastId;
      } else if (frame.type === 'WINDOW_UPDATE') {
        stream._drainSink(frame.delta);
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
        stream._handleClose();
      }
    }
  });

  this.parser.on('framer', function onframer(framer) {
    // Generate custom settings frame and send
    self.write(framer.settingsFrame(options));
  });

  // Propagate parser errors
  this.parser.on('error', function onParserError(err) {
    self.emit('error', err);
  });

  socket.pipe(this.parser);

  // 2 minutes socket timeout
  socket.setTimeout(2 * 60 * 1000);
  socket.once('timeout', function ontimeout() {
    socket.destroy();
  });

  // Allow high-level api to catch socket errors
  socket.on('error', function onSocketError(e) {
    self.emit('error', e);
  });

  socket.on('close', function onclose() {
    self._closed = true;
    pool.put(options.plain || socket.npnProtocol, pair);
  });

  socket.on('drain', function ondrain() {
    self.emit('drain');
  });
}
util.inherits(Connection, process.EventEmitter);
exports.Connection = Connection;

//
// ### function write (data, encoding)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// Writes data to socket
//
Connection.prototype.write = function write(data, encoding) {
  if (this.socket.writable) {
    return this.socket.write(data, encoding);
  }
};

//
// ### function _setDefaultWindow (settings)
// #### @settings {Object}
// Update the default transfer window -- in the connection and in the
// active streams
//
Connection.prototype._setDefaultWindow = function _setDefaultWindow(settings) {
  if (!settings) return;
  if (!settings.initial_window_size ||
      settings.initial_window_size.persisted) {
    return;
  }

  this.sinkSize = settings.initial_window_size.value;

  Object.keys(this.streams).forEach(function(id) {
    this.streams[id]._updateSinkSize(settings.initial_window_size.value);
  }, this);
};

//
// ### function Stream (connection, frame)
// #### @connection {Connection} SPDY Connection
// #### @frame {Object} SYN_STREAM data
// Abstract stream @constructor
//
function Stream(connection, frame) {
  var self = this;
  DuplexStream.call(this);

  this.connection = connection;
  this.socket = connection.socket;
  this.encrypted = connection.encrypted;
  this._framer = connection._framer;
  this._initialized = false;

  this.ondata = this.onend = null;

  // RST_STREAM code if any
  this._rstCode = 1;
  this._destroyed = false;

  this._closedBy = {
    client: false,
    server: false
  };

  // Lock data
  this._locked = false;
  this._lockBuffer = [];

  // Store id
  this.id = frame.id;
  this.version = frame.version;

  // Store priority
  this.priority = frame.priority;

  // Array of push streams associated to that one
  this.pushes = [];

  // How much data can be sent TO client before next WINDOW_UPDATE
  this._sinkSize = connection.sinkSize;
  this._initialSinkSize = connection.sinkSize;

  // When data needs to be send, but window is too small for it - it'll be
  // queued in this buffer
  this._sinkBuffer = [];

  // How much data can be sent BY client before next WINDOW_UPDATE
  this._initialWindowSize = connection.windowSize;
  this._windowSize = connection.windowSize;

  // Create compression streams
  this._deflate = connection._deflate;
  this._inflate = connection._inflate;

  // Store headers
  this.headers = frame.headers;
  this.url = frame.url;

  this._frame = frame;

  if (legacy) {
    this.readable = this.writable = true;
  }
};
util.inherits(Stream, DuplexStream);
exports.Stream = Stream;

if (legacy) {
  Stream.prototype.pause = function pause() {};
  Stream.prototype.resume = function resume() {};
}

//
// ### function _isGoaway ()
// Returns true if any writes to that stream should be ignored
//
Stream.prototype._isGoaway = function _isGoaway() {
  return this.connection._goaway && this.id > this.connection._goaway;
};

//
// ### function init ()
// Initialize stream, internal
//
Stream.prototype._init = function init() {
  var headers = this.headers,
      req = [headers.method + ' ' + this.url + ' ' + headers.version];

  Object.keys(headers).forEach(function (key) {
    if (key !== 'method' && key !== 'url' && key !== 'version' &&
        key !== 'scheme') {
      req.push(key + ': ' + headers[key]);
    }
  });

  // Add '\r\n\r\n'
  req.push('', '');

  req = new Buffer(req.join('\r\n'));

  this._recv(req);
  this._initialized = true;

  // Right now, http module expects socket to be working in streams1 mode.
  var self = this;
  this.on('data', function(chunk) {
    if (self.ondata) self.ondata(chunk, 0, chunk.length);
  });
};

//
// ### function lock (callback)
// #### @callback {Function} continuation callback
// Acquire lock
//
Stream.prototype._lock = function lock(callback) {
  if (!callback) return;

  if (this._locked) {
    this._lockBuffer.push(callback);
  } else {
    this._locked = true;
    callback.call(this, null);
  }
};

//
// ### function unlock ()
// Release lock and call all buffered callbacks
//
Stream.prototype._unlock = function unlock() {
  if (this._locked) {
    this._locked = false;
    this._lock(this._lockBuffer.shift());
  }
};

//
// ### function setTimeout ()
// TODO: use timers.enroll, timers.active, timers.unenroll
//
Stream.prototype.setTimeout = function setTimeout(time) {};

//
// ### function _handleClose ()
// Close stream if it was closed by both server and client
//
Stream.prototype._handleClose = function _handleClose() {
  if (this._closedBy.client && this._closedBy.server) {
    this.close();
  }
};

//
// ### function close ()
// Destroys stream
//
Stream.prototype.close = function close() {
  this.destroy();
};

//
// ### function destroy (error)
// #### @error {Error} (optional) error
// Destroys stream
//
Stream.prototype.destroy = function destroy(error) {
  if (this._destroyed) return;
  this._destroyed = true;

  delete this.connection.streams[this.id];
  if (this.id % 2 === 1) {
    this.connection.streamsCount--;
  }

  if (error) {
    if (this._rstCode) {
      this.connection.write(this._framer.rstFrame(this.id, this._rstCode));
    }
  }

  var self = this;
  this.emit('end');
  process.nextTick(function() {
    if (error) self.emit('error', error);
    self.emit('close', !!error);
  });
};

Stream.prototype._drainSink = function _drainSink(size) {
  var oldBuffer = this._sinkBuffer;
  this._sinkBuffer = [];

  this._sinkSize += size;

  for (var i = 0; i < oldBuffer.length; i++) {
    this._writeData(oldBuffer[i][0], oldBuffer[i][1]);
  }

  // XXX Is it needed in node 0.9.x ?
  this.emit('drain');
}

//
// ### function _writeData (fin, buffer)
// #### @fin {Boolean}
// #### @buffer {Buffer}
// Internal function
//
Stream.prototype._writeData = function _writeData(fin, buffer) {
  if (this._framer.version === 3) {
    // Window was exhausted, queue data
    if (this._sinkSize <= 0) {
      this._sinkBuffer.push([fin, buffer]);
      return false;
    }

    var len = Math.min(this._sinkSize, buffer.length);
    this._sinkSize -= len;

    // Only partial write is possible, queue rest for later
    if (len < buffer.length) {
      this._sinkBuffer.push([fin, buffer.slice(len)]);
      buffer = buffer.slice(0, len);
      fin = false;
    }
  }

  this._lock(function() {
    var stream = this,
        frame = this._framer.dataFrame(this.id, fin, buffer);

    stream.connection.scheduler.schedule(stream, frame);
    stream.connection.scheduler.tick();

    if (fin) this.close();

    this._unlock();
  });
};

//
// ### function write (data, encoding)
// #### @data {Buffer|String} data
// #### @encoding {String} data encoding
// Writes data to connection
//
Stream.prototype.write = function write(data, encoding) {
  // Do not send data to new connections after GOAWAY
  if (this._isGoaway()) return false;

  var buffer;

  // Send DATA
  if (typeof data === 'string') {
    buffer = new Buffer(data, encoding);
  } else {
    buffer = data;
  }

  // TCP Frame size is equal to:
  // data frame size + data frame headers (8 bytes) +
  // tls frame headers and data (encrypted) ~ 140 bytes
  // So setting MTU equal to 1300 is most optimal
  // as end packet will have size ~ 1442 bytes
  // (My MTU is 1492 bytes)
  var MTU = 1300;

  // Try to fit MTU
  if (buffer.length < MTU) {
    return this._writeData(false, buffer);
  } else {
    var len = buffer.length - MTU,
        r = true;

    for (var offset = 0; offset < len; offset += MTU) {
      var res = this._writeData(false, buffer.slice(offset, offset + MTU));
      if (res === false) r = res;
    }
    if (this._writeData(false, buffer.slice(offset)) === false) {
      r = false;
    }
    return r;
  }
};

//
// ### function end (data)
// #### @data {Buffer|String} (optional) data to write before ending stream
// #### @encoding {String} (optional) string encoding
// Send FIN data frame
//
Stream.prototype.end = function end(data, encoding) {
  // Do not send data to new connections after GOAWAY
  if (this._isGoaway()) return;

  if (data) this.write(data, encoding);

  this._writeData(true, []);
  this._closedBy.server = true;
  if (this._sinkBuffer.length !== 0) return;
  this._handleClose();
};

//
// ### function _recv (data)
// #### @data {Buffer} buffer to receive
// (internal)
//
Stream.prototype._recv = function _recv(data) {
  // Update window if exhausted
  if (this._framer.version >= 3 && this._initialized) {
    this._windowSize -= data.length;

    if (this._windowSize <= 0) {
      var delta = this._initialWindowSize - this._windowSize;
      this._windowSize += delta;
      this.connection.write(this._framer.windowUpdateFrame(this.id, delta));
    }
  }

  if (legacy) {
    var self = this;
    process.nextTick(function() {
      self.emit('data', data);
    });
  } else {
    this.push(data);
  }
};

//
// ### function _read (bytes, cb)
// #### @bytes {Number} number of bytes to read
// #### @cb {Function} callback
// Streams2 API
//
Stream.prototype._read = function read(bytes, cb) {
  // NOP
};

//
// ### function _updateSinkSize (size)
// #### @size {Integer}
// Update the internal data transfer window
//
Stream.prototype._updateSinkSize = function _updateSinkSize(size) {
  var diff = size - this._initialSinkSize;

  this._initialSinkSize = size;
  this._drainSink(diff);
};

//
// `net` compatibility layer
// (Copy pasted from lib/tls.js from node.js)
//
Stream.prototype.address = function address() {
  return this.socket && this.socket.address();
};

Stream.prototype.__defineGetter__('remoteAddress', function remoteAddress() {
  return this.socket && this.socket.remoteAddress;
});

Stream.prototype.__defineGetter__('remotePort', function remotePort() {
  return this.socket && this.socket.remotePort;
});
