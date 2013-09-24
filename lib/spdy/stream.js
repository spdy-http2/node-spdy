var spdy = require('../spdy');
var assert = require('assert');
var util = require('util');
var stream = require('stream');
var Buffer = require('buffer').Buffer;

var crlf = new Buffer('\r\n');
var last_frag = new Buffer('0\r\n\r\n');


//
// ### function Stream (connection, frame)
// #### @connection {Connection} SPDY Connection
// #### @frame {Object} SYN_STREAM data
// Abstract stream @constructor
//
function Stream(connection, frame) {
  spdy.utils.DuplexStream.call(this);

  this.connection = connection;
  this.socket = connection.socket;
  this.encrypted = connection.encrypted;
  this._framer = connection._framer;
  this._initialized = false;

  // True if inside chunked write
  this._chunkedWrite = false;

  // Should chunked encoding be forced
  this._forceChunked = false;

  // Store frame
  this._frame = frame;

  this.ondata = this.onend = null;

  // RST_STREAM code if any
  this._rstCode = 1;
  this._destroyed = false;

  this._closedBy = {
    client: false,
    server: false
  };

  // Store id
  this.id = frame.id;
  this.version = connection.version;

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

  if (spdy.utils.isLegacy)
    this.readable = this.writable = true;

  // Call .onend()
  this.once('end', function() {
    var self = this;
    process.nextTick(function() {
      if (self.onend)
        self.onend();
    });
  });

  // Handle half-close
  this.once('finish', function onfinish() {
    if (this._chunkedWrite)
      return this.once('_chunkDone', onfinish);
    this._writeData(true, []);
    this._closedBy.server = true;
    if (this._sinkBuffer.length !== 0)
      return;
    this._handleClose();
  });
};
util.inherits(Stream, spdy.utils.DuplexStream);
exports.Stream = Stream;

if (spdy.utils.isLegacy) {
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
    if (key !== 'method' &&
        key !== 'url' &&
        key !== 'version' &&
        key !== 'scheme' &&
        key !== 'path') {
      req.push(key + ': ' + headers[key]);
    }
  });

  // Force chunked encoding
  if (!headers['content-length'] &&
      !headers['transfer-encoding'] &&
      headers.method !== 'CONNECT' &&
      headers.method !== 'GET' &&
      headers.method !== 'HEAD') {
    req.push('Transfer-Encoding: chunked');
    this._forceChunked = true;
  }

  // Add '\r\n\r\n'
  req.push('', '');

  req = new Buffer(req.join('\r\n'));

  this._recv(req, true);
  this._initialized = true;
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
  if (this._closedBy.client && this._closedBy.server)
    this.close();
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
  if (this._destroyed)
    return;
  this._destroyed = true;

  delete this.connection.streams[this.id];
  if (this.id % 2 === 1)
    this.connection.streamsCount--;

  // If stream is not finished, RST frame should be sent to notify client
  // about sudden stream termination.
  if (error || !this._closedBy.server) {
    // REFUSED_STREAM if terminated before 'finish' event
    if (!this._closedBy.server)
      this._rstCode = 3;

    if (this._rstCode) {
      this._lock(function() {
        this.connection.scheduler.schedule(
          this,
          this._framer.rstFrame(this.id, this._rstCode));
        this.connection.scheduler.tick();

        this._unlock();
      });
    }
  }

  if (spdy.utils.isLegacy)
    this.emit('end');
  else
    this.push(null);

  if (error)
    this.emit('error', error);

  var self = this;
  process.nextTick(function() {
    self.emit('close', !!error);
  });
};

Stream.prototype.destroySoon = function destroySoon(error) {
  return this.destroy(error);
};

Stream.prototype._drainSink = function _drainSink(size) {
  var oldBuffer = this._sinkBuffer;
  this._sinkBuffer = [];

  this._sinkSize += size;

  for (var i = 0; i < oldBuffer.length; i++)
    this._writeData(oldBuffer[i][0], oldBuffer[i][1], oldBuffer[i][2]);

  // Handle half-close
  if (this._sinkBuffer.length === 0 && this._closedBy.server)
    this._handleClose();

  if (spdy.utils.isLegacy)
    this.emit('drain');
};

//
// ### function _writeData (fin, buffer, cb)
// #### @fin {Boolean}
// #### @buffer {Buffer}
// #### @cb {Function} **optional**
// Internal function
//
Stream.prototype._writeData = function _writeData(fin, buffer, cb) {
  // If client is gone - notify caller about it
  if (!this.connection.socket || !this.connection.socket.writable)
    return false;

  if (this._framer.version === 3) {
    // Window was exhausted, queue data
    if (this._sinkSize <= 0) {
      this._sinkBuffer.push([fin, buffer, cb]);
      return false;
    }
  }

  var maxChunk = this.connection._spdyState.maxChunk;

  // Slice buffer into parts with size <= `maxChunk`
  if (maxChunk && maxChunk < buffer.length) {
    var preend = buffer.length - maxChunk;
    var chunks = [];
    for (var i = 0; i < preend; i += maxChunk)
      chunks.push(buffer.slice(i, i + maxChunk));

    // Last chunk
    chunks.push(buffer.slice(i));

    var self = this;
    function send(err) {
      if (err)
        return cb(err);

      var chunk = chunks.shift();
      if (chunks.length === 0) {
        self._writeData(fin, chunk, function(err) {
          self._chunkedWrite = false;
          // Ensure that `finish` listener will catch this
          self.emit('_chunkDone');
          if (cb)
            cb(err);
        });
      } else {
        self._writeData(false, chunk, send);
      }
    }

    this._chunkedWrite = true;
    send();
    return true;
  }

  if (this._framer.version === 3) {
    var len = Math.min(this._sinkSize, buffer.length);
    this._sinkSize -= len;

    // Only partial write is possible, queue rest for later
    if (len < buffer.length) {
      this._sinkBuffer.push([fin, buffer.slice(len), cb]);
      buffer = buffer.slice(0, len);
      fin = false;
      cb = null;
    }
  }

  this._lock(function() {
    var stream = this,
        frame = this._framer.dataFrame(this.id, fin, buffer);

    stream.connection.scheduler.schedule(stream, frame);
    stream.connection.scheduler.tick(cb);

    this._unlock();
  });

  return true;
};

Stream.prototype._parseClientRequest = function parseClientRequest(data, cb) {
  this._frame.client = false;

  var lines = data.toString().split(/\r\n/g);
  var status = lines[0];
  var headers = {};

  // Transform headers
  lines.slice(1).forEach(function(line) {
    var match = line.match(/^(.*):(.*)$/);
    assert(match !== null);

    var key = match[1].toLowerCase();
    var value = match[2];

    headers[key] = value;
  }, this);
};

//
// ### function write (data, encoding)
// #### @data {Buffer|String} data
// #### @encoding {String} data encoding
// Writes data to connection
//
Stream.prototype._write = function write(data, encoding, cb) {
  // First write is a client request
  if (this._frame.client)
    return this._parseClientRequest(data, cb);

  // Do not send data to new connections after GOAWAY
  if (this._isGoaway()) {
    if (cb)
      cb();
    return false;
  }

  return this._writeData(false, data, cb);
};

if (spdy.utils.isLegacy) {
  Stream.prototype.write = function write(data, encoding, cb) {
    if (typeof encoding === 'function' && !cb) {
      cb = encoding;
      encoding = null;
    }
    if (!Buffer.isBuffer(data))
      return this._write(new Buffer(data, encoding), null, cb);
    else
      return this._write(data, encoding, cb);
  };

  //
  // ### function end (data)
  // #### @data {Buffer|String} (optional) data to write before ending stream
  // #### @encoding {String} (optional) string encoding
  // Send FIN data frame
  //
  Stream.prototype.end = function end(data, encoding) {
    // Do not send data to new connections after GOAWAY
    if (this._isGoaway())
      return;

    if (data)
      this.write(data, encoding);
    this.emit('finish');
  };
}

//
// ### function _recv (data)
// #### @data {Buffer} buffer to receive
// #### @chunked {Boolean}
// (internal)
//
Stream.prototype._recv = function _recv(data, chunked) {
  // Update window if exhausted
  if (!chunked && this._framer.version >= 3 && this._initialized) {
    this._windowSize -= data.length;

    if (this._windowSize <= 0) {
      var delta = this._initialWindowSize - this._windowSize;
      this._windowSize += delta;
      this.connection.write(this._framer.windowUpdateFrame(this.id, delta));
    }
  }

  // Emulate chunked encoding
  if (this._forceChunked && !chunked) {
    // Zero-chunks are treated as end, do not emit them
    if (data.length === 0)
      return;

    this._recv(new Buffer(data.length.toString(16)), true);
    this._recv(crlf, true);
    this._recv(data, true);
    this._recv(crlf, true);
    return;
  }

  if (spdy.utils.isLegacy) {
    var self = this;
    process.nextTick(function() {
      self.emit('data', data);
      if (self.ondata)
        self.ondata(data, 0, data.length);
    });
  } else {
    // Right now, http module expects socket to be working in streams1 mode.
    if (this.ondata)
      this.ondata(data, 0, data.length);
    else
      this.push(data);
  }
};

//
// ### function _read (bytes, cb)
// #### @bytes {Number} number of bytes to read
// Streams2 API
//
Stream.prototype._read = function read(bytes) {
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
// ### function lock (callback)
// #### @callback {Function} continuation callback
// Acquire lock
//
Stream.prototype._lock = function lock(callback) {
  if (!callback)
    return;

  var self = this;
  this.connection._lock(function(err) {
    callback.call(self, err);
  });
};

//
// ### function unlock ()
// Release lock and call all buffered callbacks
//
Stream.prototype._unlock = function unlock() {
  this.connection._unlock();
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

Stream.prototype.setNoDelay = function setNoDelay(enable) {
  return this.socket && this.socket.setNoDelay(enable);
};

Stream.prototype.setKeepAlive = function(setting, msecs) {
  return this.socket && this.socket.setKeepAlive(setting, msecs);
};

Stream.prototype.getPeerCertificate = function() {
  return this.socket && this.socket.getPeerCertificate();
};

Stream.prototype.getSession = function() {
  return this.socket && this.socket.getSession();
};

Stream.prototype.isSessionReused = function() {
  return this.socket && this.socket.isSessionReused();
};

Stream.prototype.getCipher = function() {
  return this.socket && this.socket.getCipher();
};
