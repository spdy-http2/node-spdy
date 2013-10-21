var spdy = require('../spdy');
var assert = require('assert');
var util = require('util');
var stream = require('stream');
var Buffer = require('buffer').Buffer;
var constants = spdy.protocol.constants;

var crlf = new Buffer('\r\n');


//
// ### function Stream (connection, options)
// #### @connection {Connection} SPDY Connection
// #### @options {Object} Stream options
// Abstract stream @constructor
//
function Stream(connection, options) {
  var self = this;

  spdy.utils.DuplexStream.call(this);

  this.connection = connection;
  this.socket = connection.socket;
  this.encrypted = connection.encrypted;
  this.associated = null;

  // 0.10 hack
  this._handle = {
    readStop: function() { self._readStop() },
    readStart: function() { self._readStart() }
  };

  var state = {};
  this._spdyState = state;
  state.framer = connection._spdyState.framer;
  state.initialized = false;
  state.paused = false;
  state.finishAttached = false;

  // Store id
  state.id = options.id;
  state.associated = options.associated;

  // Increment counters
  state.isPush = !connection._spdyState.isServer && state.associated;
  connection._spdyState.counters.streamCount++;
  if (state.isPush)
    connection._spdyState.counters.pushCount++;

  // Useful for PUSH streams
  state.scheme = options.headers && options.headers.scheme;
  state.host = options.headers && options.headers.host;

  // True if inside chunked write
  state.chunkedWrite = false;

  // Should chunked encoding be forced
  state.forceChunked = false;

  // Store options
  state.options = options;
  state.isClient = !!options.client;
  state.parseRequest = !!options.client;

  // RST_STREAM code if any
  state.rstCode = constants.rst.PROTOCOL_ERROR;
  state.destroyed = false;

  state.closedBy = {
    them: false,
    us: false
  };

  // Store priority
  state.priority = options.priority;

  // Array of push streams associated to that one
  state.pushes = [];

  // How much data can be sent TO client before next WINDOW_UPDATE
  state.sinkSize = connection._spdyState.sinkSize;
  state.initialSinkSize = state.sinkSize;

  // When data needs to be send, but window is too small for it - it'll be
  // queued in this buffer
  state.sinkBuffer = [];

  // How much data can be sent BY client before next WINDOW_UPDATE
  state.windowSize = connection._spdyState.windowSize;
  state.initialWindowSize = state.windowSize;

  this._init();
};
util.inherits(Stream, spdy.utils.DuplexStream);
exports.Stream = Stream;

//
// ### function init ()
// Initialize stream
//
Stream.prototype._init = function init() {
  var state = this._spdyState;

  this.ondata = this.onend = null;

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
    if (state.chunkedWrite)
      return this.once('_chunkDone', onfinish);

    var self = this;
    this._writeData(true, [], function() {
      state.closedBy.us = true;
      if (state.sinkBuffer.length !== 0)
        return;
      self._handleClose();
    });
  });

  if (state.isClient) {
    var httpMessage;
    Object.defineProperty(this, '_httpMessage', {
      set: function(val) {
        if (val)
          this._attachToRequest(val);
        httpMessage = val;
      },
      get: function() {
        return httpMessage;
      },
      configurable: true,
      enumerable: true
    });
  }
};

Stream.prototype._readStop = function readStop() {
  this._spdyState.paused = true;
};

Stream.prototype._readStart = function readStart() {
  this._spdyState.paused = false;

  // Send window update if needed
  this._read();
};

if (spdy.utils.isLegacy) {
  Stream.prototype.pause = function pause() {
    this._readStop();
  };
  Stream.prototype.resume = function resume() {
    this._readStart();
  };
}

//
// ### function _isGoaway ()
// Returns true if any writes to that stream should be ignored
//
Stream.prototype._isGoaway = function _isGoaway() {
  return this.connection._spdyState.goaway &&
         this._spdyState.id > this.connection._spdyState.goaway;
};

//
// ### function start (url, headers)
// #### @url {String}
// #### @headers {Object}
// Start stream, internal
//
Stream.prototype._start = function start(url, headers) {
  var state = this._spdyState,
      isPush = state.isPush,
      req = [(isPush ? 'POST' : headers.method) + ' ' +
             url + ' ' + headers.version];

  Object.keys(headers).forEach(function (key) {
    if (key !== 'method' &&
        key !== 'url' &&
        key !== 'version' &&
        key !== 'scheme' &&
        key !== 'status' &&
        key !== 'path') {
      req.push(key + ': ' + headers[key]);
    }
  });

  // Force chunked encoding
  if (!headers['content-length'] &&
      !headers['transfer-encoding'] &&
      ((headers.method !== 'CONNECT' &&
        headers.method !== 'GET' &&
        headers.method !== 'HEAD') ||
       isPush)) {
    req.push('Transfer-Encoding: chunked');
    state.forceChunked = true;
  }

  // Make sure that node.js won't think that this stream can be reused
  req.push('Connection: close');

  // Add '\r\n\r\n'
  req.push('', '');

  req = new Buffer(req.join('\r\n'));

  this._recv(req, true);
  state.initialized = true;
};

//
// ### function attachToRequest (req)
// #### @req {ClientRequest}
// Attach to node.js' response
//
Stream.prototype._attachToRequest = function attachToRequest(res) {
  res.addTrailers = this.sendHeaders.bind(this);

  this.on('headers', function(headers) {
    var req = res.parser.incoming;
    if (req) {
      Object.keys(headers).forEach(function(key) {
        req.trailers[key] = headers[key];
      });
      req.emit('trailers', headers);
    }
  });
};

//
// ### function sendHeaders (headers)
// #### @headers {Object}
//
Stream.prototype.sendHeaders = function sendHeaders(headers) {
  var self = this;
  var state = this._spdyState;

  this._lock(function() {
    state.framer.headersFrame(state.id, headers, function(err, frame) {
      if (err) {
        self._unlock();
        return self.emit('error', err);
      }
      var scheduler = self.connection._spdyState.scheduler;

      scheduler.schedule(self, frame);
      scheduler.tick();
      self._unlock();
    });
  });
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
  var state = this._spdyState;
  if (state.closedBy.them && state.closedBy.us)
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
  var state = this._spdyState;
  if (state.destroyed)
    return;
  state.destroyed = true;

  // Decrement counters
  this.connection._spdyState.counters.streamCount--;
  if (state.isPush)
    this.connection._spdyState.counters.pushCount--;

  // Just for http.js in v0.10
  this.writable = false;
  this.connection._removeStream(this);

  // If stream is not finished, RST frame should be sent to notify client
  // about sudden stream termination.
  if (error || !state.closedBy.us) {
    if (!state.closedBy.us)
      // CANCEL
      if (state.isClient)
        state.rstCode = constants.rst.CANCEL;
      // REFUSED_STREAM if terminated before 'finish' event
      else
        state.rstCode = constants.rst.REFUSED_STREAM;

    if (state.rstCode) {
      this._lock(function() {
        var self = this;
        state.framer.rstFrame(state.id, state.rstCode, function(err, frame) {
          if (err) {
            self._unlock();
            return self.emit('error', err);
          }
          var scheduler = self.connection._spdyState.scheduler;

          scheduler.scheduleLast(self, frame);
          scheduler.tick();
          self._unlock();
        });
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

//
// ### function ping (callback)
// #### @callback {Function}
// Send PING frame and invoke callback once received it back
//
Stream.prototype.ping = function ping(callback) {
  return this.connection.ping(callback);
};

//
// ### function destroySoon (err)
// #### @err {Error} *optional*
//
Stream.prototype.destroySoon = function destroySoon(error) {
  var self = this;

  // Hack for http.js, when running in client mode
  this.writable = false;

  // Write frame and destroy socket
  this._writeData(true, [], function() {
    self.destroy(error);
  });
};

//
// ### function drainSink (size)
// #### @size {Number}
// Change sink size
//
Stream.prototype._drainSink = function drainSink(size) {
  var state = this._spdyState;
  var oldBuffer = state.sinkBuffer;

  state.sinkBuffer = [];
  state.sinkSize += size;

  for (var i = 0; i < oldBuffer.length; i++) {
    var item = oldBuffer[i];
    this._writeData(item.fin, item.buffer, item.cb, item.chunked);
  }

  // Handle half-close
  if (state.sinkBuffer.length === 0 && state.closedBy.us)
    this._handleClose();

  if (spdy.utils.isLegacy)
    this.emit('drain');
};

//
// ### function _writeData (fin, buffer, cb, chunked)
// #### @fin {Boolean}
// #### @buffer {Buffer}
// #### @cb {Function} **optional**
// #### @chunked {Boolean} **internal**
// Internal function
//
Stream.prototype._writeData = function _writeData(fin, buffer, cb, chunked) {
  // If client is gone - notify caller about it
  if (!this.connection.socket || !this.connection.socket.writable)
    return false;

  var state = this._spdyState;
  if (!state.framer.version) {
    var self = this;
    state.framer.on('version', function() {
      self._writeData(fin, buffer, cb, chunked);
      if (spdy.utils.isLegacy)
        self.emit('drain');
    });
    return false;
  }

  if (state.framer.version === 3) {
    // Window was exhausted, queue data
    if (state.sinkSize <= 0) {
      state.sinkBuffer.push({
        fin: fin,
        buffer: buffer,
        cb: cb,
        chunked: chunked
      });
      return false;
    }
  }

  if (state.chunkedWrite && !chunked) {
    var self = this;
    function attach() {
      self.once('_chunkDone', function() {
        if (state.chunkedWrite)
          return attach();
        self._writeData(fin, buffer, cb, false);
      });
    }
    attach();
    return true;
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
      function done(err) {
        state.chunkedWrite = false;
        self.emit('_chunkDone');
        if (cb)
          cb(err);
      }

      if (err)
        return done(err);

      var chunk = chunks.shift();
      if (chunks.length === 0) {
        self._writeData(fin, chunk, function(err) {
          // Ensure that `finish` listener will catch this
          done(err);
        }, true);
      } else {
        self._writeData(false, chunk, send, true);
      }
    }

    state.chunkedWrite = true;
    send();
    return true;
  }

  if (state.framer.version === 3) {
    var len = Math.min(state.sinkSize, buffer.length);
    state.sinkSize -= len;

    // Only partial write is possible, queue rest for later
    if (len < buffer.length) {
      state.sinkBuffer.push({
        fin: fin,
        buffer: buffer.slice(len),
        cb: cb,
        chunked: chunked
      });
      buffer = buffer.slice(0, len);
      fin = false;
      cb = null;
    }
  }

  this._lock(function() {
    var stream = this;

    state.framer.dataFrame(state.id, fin, buffer, function(err, frame) {
      if (err) {
        stream._unlock();
        return stream.emit('error', err);
      }

      var scheduler = stream.connection._spdyState.scheduler;
      scheduler.schedule(stream, frame);
      scheduler.tick(cb);

      stream._unlock();
    });
  });

  return true;
};

//
// ### function parseClientRequest (data, cb)
// #### @data {Buffer|String} Input data
// #### @cb {Function} Continuation to proceed to
// Parse first outbound message in client request
//
Stream.prototype._parseClientRequest = function parseClientRequest(data, cb) {
  var state = this._spdyState;

  state.parseRequest = false;

  var lines = data.toString().split('\r\n\r\n');
  var body = data.slice(Buffer.byteLength(lines[0]) + 4);
  lines = lines[0].split(/\r\n/g);
  var status = lines[0].match(/^([a-z]+)\s([^\s]+)\s(.*)$/i);
  var headers = {};

  assert(status !== null);
  var method = status[1].toUpperCase();
  var url = status[2];
  var version = status[3].toUpperCase();
  var host = '';

  // Transform headers and determine host
  lines.slice(1).forEach(function(line) {
    // Last line
    if (!line)
      return;

    // Normal line - `Key: Value`
    var match = line.match(/^(.*):\s*(.*)$/);
    assert(match !== null);

    var key = match[1].toLowerCase();
    var value = match[2];

    if (key === 'host')
      host = value;
    else if (key !== 'connection')
      headers[key] = value;
  }, this);

  // Disable chunked encoding for all future writes
  assert(this._httpMessage);
  var chunkedEncoding = this._httpMessage.chunkedEncoding;
  this._httpMessage.chunkedEncoding = false;

  // Yeah, node.js gave us a body with the request
  if (body) {
    if (chunkedEncoding) {
      // Skip length and \r\n
      for (var i = 0; i + 1 < body.length; i++)
        if (body[i] === 0xd && body[i + 1] === 0xa)
          break;

      // Write rest (without trailing \r\n)
      if (i + 4 < body.length)
        this._write(body.slice(i + 2, body.length - 2), null, null);
    }
  }

  var self = this;
  var connection = this.connection;
  connection._lock(function() {
    state.framer.streamFrame(state.id, 0, {
      method: method,
      host: host,
      url: url,
      version: version,
      priority: self.priority
    }, headers, function(err, frame) {
      if (err) {
        connection._unlock();
        return self.emit('error', err);
      }
      connection.write(frame);
      connection._unlock();
      connection._addStream(self);

      self.emit('_spdyRequest');
      state.initialized = true;
      if (cb)
        cb();
    })
  });

  return true;
};

//
// ### function handleResponse (frame)
// #### @frame {Object} SYN_REPLY frame
// Handle SYN_REPLY
//
Stream.prototype._handleResponse = function handleResponse(frame) {
  var state = this._spdyState;
  assert(state.isClient);

  var headers = frame.headers,
      req = [headers.version.toUpperCase() + ' ' + headers.status];

  Object.keys(headers).forEach(function (key) {
    if (key !== 'status' && key !== 'version')
      req.push(key + ': ' + headers[key]);
  });

  // Force chunked encoding
  delete headers['transfer-encoding'];
  req.push('Transfer-Encoding: chunked');
  state.forceChunked = true;

  // Make sure that node.js won't think that this stream can be reused
  req.push('Connection: close');

  // Add '\r\n\r\n'
  req.push('', '');

  req = new Buffer(req.join('\r\n'));

  this._recv(req, true);
  state.initialized = true;
};

//
// ### function write (data, encoding)
// #### @data {Buffer|String} data
// #### @encoding {String} data encoding
// Writes data to connection
//
Stream.prototype._write = function write(data, encoding, cb) {
  var r = true;
  var state = this._spdyState;

  // Ignore all outgoing data for PUSH streams, they're unidirectional
  if (state.isClient && state.associated)
    return cb();

  // First write is a client request
  if (state.parseRequest) {
    this._parseClientRequest(data, cb);
  } else {
    // No chunked encoding is allowed at this point
    assert(!this._httpMessage || !this._httpMessage.chunkedEncoding);

    // Do not send data to new connections after GOAWAY
    if (this._isGoaway()) {
      if (cb)
        cb();
      r = false;
    } else {
      r = this._writeData(false, data, cb);
    }
  }

  if (this._httpMessage && state.isClient && !state.finishAttached) {
    state.finishAttached = true;
    var self = this;

    // If client request was ended - send FIN data frame
    this._httpMessage.once('finish', function() {
      if (self._httpMessage.output && !self._httpMessage.output.length)
        self.end();
    });
  }

  return r;
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
  var state = this._spdyState;

  // Update window if exhausted
  if (!chunked && state.framer.version >= 3 && state.initialized) {
    state.windowSize -= data.length;

    // If running on node.js 0.8 - don't send WINDOW_UPDATE if paused
    if (spdy.utils.isLegacy && !state.paused)
      this._read();
  }

  // Emulate chunked encoding
  if (state.forceChunked && !chunked) {
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
// ### function _read (bytes)
// #### @bytes {Number} number of bytes to read
// Streams2 API
//
Stream.prototype._read = function read(bytes) {
  var state = this._spdyState;

  // Send update frame if read is requested
  if (state.framer.version >= 3 && state.initialized && state.windowSize <= 0) {
    var delta = state.initialWindowSize - state.windowSize;
    state.windowSize += delta;
    var self = this;
    state.framer.windowUpdateFrame(state.id, delta, function(err, frame) {
      if (err)
        return self.emit('error', err);
      self.connection.write(frame);
    });
  }
};

//
// ### function _updateSinkSize (size)
// #### @size {Integer}
// Update the internal data transfer window
//
Stream.prototype._updateSinkSize = function _updateSinkSize(size) {
  var state = this._spdyState;
  var diff = size - state.initialSinkSize;

  state.initialSinkSize = size;
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
