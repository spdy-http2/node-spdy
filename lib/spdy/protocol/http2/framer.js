var spdy = require('../../../spdy');
var util = require('util');
var WriteBuffer = require('wbuf');
var base = spdy.protocol.base;
var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;
var constants = require('./').constants;

function Framer() {
  base.Framer.call(this);

  this.maxFrameSize = constants.INITIAL_MAX_FRAME_SIZE;
};
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(version, compress, decompress) {
  return new Framer(version, compress, decompress);
};

Framer.prototype._frame = function _frame(header, cb) {
  // TODO(indutny): use WriteBuffer in spdy protocol too
  var buffer = new WriteBuffer();

  buffer.reserve(constants.FRAME_HEADER_SIZE);
  buffer.writeUInt24BE(header.length);
  buffer.writeUInt8(constants.frameType[header.type]);
  buffer.writeUInt8(header.flags);
  buffer.writeUInt32BE(header.id & 0x7fffffff);

  cb(buffer);

  // TODO(indutny): support bulk-writing
  return Buffer.concat(buffer.render());
};

//
// ### function _continuationWrite (buf, size, chunks)
// #### @buf {WBuf} output buffer
// #### @size {Number} total size of all chunks
// #### @chunks {Array} array of chunks to write
// Write chunks to buffer and append continuation framing
//
Framer.prototype._continuationWrite = function _continuationWrite(buf,
                                                                  size,
                                                                  chunks) {
  // TODO(indutny): implement me
  for (var i = 0; i < chunks.length; i++)
    buf.copyFrom(chunks[i]);

  return;
  var maxSize = constants.FRAME_HEADER_SIZE + this.maxFrameSize;

  var currentOff = buf.size % maxSize;
  var afterOff = (buf.size + data.length) % maxSize;

  // Fast case - it fits into the buffer
  if (currentOff <= afterOff && data.length < maxSize) {
    buf.copyFrom(data);
    return;
  }

  // Slice the buffer and append continuation
};

//
// ### function _compressHeaders (headers, pairs, cb)
// #### @headers {Object} Map of header-name + value pairs
// #### @pairs {Array} Array of internal pairs
// #### @cb {Function} Continuation
//
Framer.prototype._compressHeaders = function _compressHeaders(headers,
                                                              pairs,
                                                              cb) {
  Object.keys(headers).forEach(function(name) {
    // TODO(indutny): Never index cookies
    pairs.push({ name: name.toLowerCase(), value: headers[name] + '' });
  });

  var self = this;
  this.compress.write(pairs, function(err) {
    if (err)
      return cb(err);

    var chunks = [];
    var size = 0;
    while (true) {
      var chunk = self.compress.read();
      if (!chunk)
        break;
      chunks.push(chunk);
      size += chunk.length;
    }
    cb(null, size, chunks);
  });
};

//
// ### function replyFrame (id, code, reason, headers, callback)
// #### @id {Number} Stream ID
// #### @code {Number} HTTP Status Code
// #### @reason {String} (optional)
// #### @headers {Object|Array} (optional) HTTP headers
// #### @callback {Function} Continuation function
// Sends SYN_REPLY frame
//
Framer.prototype.replyFrame = function replyFrame(id,
                                                  code,
                                                  reason,
                                                  headers,
                                                  callback) {
  var pairs = [];
  pairs.push({ name: ':status', value: code + '' });

  var self = this;
  this._compressHeaders(headers, pairs, function(err, size, packed) {
    if (err)
      return callback(err);

    // TODO(indutny): send multiple headers and continuations if frame size is
    // exceeded
    var frame = self._frame({
      id: id,
      type: 'HEADERS',
      flags: constants.flags.END_HEADERS,
      length: size
    }, function(buf) {
      buf.reserve(size);
      self._continuationWrite(buf, packed);
    });

    callback(null, frame);
  });
};

//
// ### function streamFrame (id, assoc, headers, callback)
// #### @id {Number} stream id
// #### @assoc {Number} associated stream id
// #### @meta {Object} meta headers ( method, scheme, url, version )
// #### @headers {Object} stream headers
// #### @callback {Function} continuation callback
// Create SYN_STREAM frame
// (needed for server push and testing)
//
Framer.prototype.streamFrame = function streamFrame(id,
                                                    assoc,
                                                    meta,
                                                    headers,
                                                    callback) {
  var isPush = assoc !== 0;
  var pairs = [];

  if (meta.status)
    pairs.push({ name: ':status', value: meta.status + '' });
  pairs.push({ name: ':path', value: meta.path || meta.url });
  pairs.push({ name: ':scheme', value: meta.scheme || 'https' });
  pairs.push({ name: ':authority', value: meta.host });
  if (meta.method)
    pairs.push({ name: ':method', value: meta.method });

  // TODO(indutny): do not send PUSH_PROMISE when they are disabled
  var self = this;
  this._compressHeaders(headers, pairs, function(err, size, packed) {
    if (err)
      return callback(err);

    var totalSize = size;
    if (isPush)
      totalSize += 4;

    var frame = self._frame({
      id: isPush ? assoc : id,
      type: isPush ? 'PUSH_PROMISE' : 'HEADERS',
      flags: constants.flags.END_HEADERS,
      length: totalSize
    }, function(buf) {
      buf.reserve(totalSize);
      if (isPush)
        buf.writeUInt32BE(id);

      self._continuationWrite(buf, packed);
    });

    callback(null, frame);
  });
};

//
// ### function headersFrame (id, headers, callback)
// #### @id {Number} Stream id
// #### @headers {Object} Headers
// #### @callback {Function}
// Sends HEADERS frame
//
Framer.prototype.headersFrame = function headersFrame(id, headers, callback) {
  if (!this.version) {
    return this.on('version', function() {
      this.headersFrame(id, headers, callback);
    });
  }

  var self = this;
  var dict = this.headersToDict(headers, function(headers) {});

  this.compress(dict, function (err, chunks, size) {
    if (err)
      return callback(err);

    var offset = self.version === 2 ? 14 : 12,
        total = offset - 8 + size,
        frame = new Buffer(offset + size);

    // Control + Version
    frame.writeUInt16BE(0x8000 | self.version, 0, true);
    // Type
    frame.writeUInt16BE(8, 2, true);
    // Length
    frame.writeUInt32BE(total & 0x00ffffff, 4, true);
    // Stream ID
    frame.writeUInt32BE(id & 0x7fffffff, 8, true);

    // Copy chunks
    for (var i = 0; i < chunks.length; i++) {
      chunks[i].copy(frame, offset);
      offset += chunks[i].length;
    }

    callback(null, frame);
  });
};

//
// ### function dataFrame (id, fin, data, callback)
// #### @id {Number} Stream id
// #### @fin {Bool} Is this data frame last frame
// #### @data {Buffer} Response data
// #### @callback {Function}
// Sends DATA frame
//
Framer.prototype.dataFrame = function dataFrame(id, fin, data, callback) {
  var frame = this._frame({
    id: id,
    type: 'DATA',
    flags: fin ? constants.flags.END_STREAM : 0,
    length: data.length
  }, function(buf) {
    buf.copyFrom(data);
  });

  return callback(null, frame);
};

//
// ### function pingFrame (opaque, ack, callback)
// #### @opaque {Buffer} Ping ID
// #### @ack {Boolean} Is ACK
// #### @callback {Function} continuation
// Sends PING frame
//
Framer.prototype.pingFrame = function pingFrame(opaque, callback) {
  if (!this.version) {
    return this.on('version', function() {
      this.pingFrame(opaque, callback);
    });
  }

  var header = new Buffer(12);

  // Version and type
  header.writeUInt32BE(0x80000006 | (this.version << 16), 0, true);
  // Length
  header.writeUInt32BE(0x00000004, 4, true);
  // ID
  header.writeUInt32BE(id, 8, true);

  return callback(null, header);
};

//
// ### function rstFrame (id, code, extra, callback)
// #### @id {Number} Stream ID
// #### @code {Number} RST Code
// #### @extra {String} Extra debugging info
// #### @callback {Function}
// Sends PING frame
//
Framer.prototype.rstFrame = function rstFrame(id, code, extra, callback) {
  if (!this.version) {
    return this.on('version', function() {
      this.rstFrame(id, code, extra, callback);
    });
  }

  var header = new Buffer(16 +
                          (this.debug ? Buffer.byteLength(extra || '') : 0));

  // Version and type
  header.writeUInt32BE(0x80000003 | (this.version << 16), 0, true);
  // Length
  header.writeUInt32BE(0x00000008, 4, true);
  // Stream ID
  header.writeUInt32BE(id & 0x7fffffff, 8, true);
  // Status Code
  header.writeUInt32BE(code, 12, true);

  // Extra debugging information
  if (this.debug && extra)
    header.write(extra, 16);

  return callback(null, header);
};

//
// ### function settingsFrame (options, callback)
// #### @options {Object} settings frame options
// #### @callback {Function}
// Sends SETTINGS frame with MAX_CONCURRENT_STREAMS and initial window
//
Framer.prototype.settingsFrame = function settingsFrame(options, callback) {
  var key = options.maxStreams + ':' + options.windowSize;

  var settings = Framer.settingsCache[key];
  if (settings)
    return callback(null, settings);

  var params = [{
    key: constants.settings.SETTINGS_MAX_HEADER_LIST_SIZE,
    value: constants.DEFAULT_MAX_HEADER_LIST_SIZE
  }];
  if (isFinite(options.maxStreams)) {
    params.push({
      key: constants.settings.SETTINGS_MAX_CONCURRENT_STREAMS,
      value: options.maxStreams
    });
  }
  if (this.version > 2) {
    params.push({
      key: constants.settings.SETTINGS_INITIAL_WINDOW_SIZE,
      value: options.windowSize
    });
  }

  // TODO(indutny): disable push streams on server?

  var bodySize = params.length * 6;

  var settings = this._frame({
    id: 0,
    type: 'SETTINGS',
    flags: 0,
    length: bodySize
  }, function(buffer) {
    buffer.reserve(bodySize);
    for (var i = 0; i < params.length; i++) {
      var param = params[i];

      buffer.writeUInt16BE(param.key);
      buffer.writeUInt32BE(param.value);
    }
  });

  Framer.settingsCache[key] = settings;

  return callback(null, settings);
};
Framer.settingsCache = {};

//
// ### function windowUpdateFrame (id)
// #### @id {Buffer} WindowUpdate ID
// Sends WINDOW_UPDATE frame
//
Framer.prototype.windowUpdateFrame = function windowUpdateFrame(id, delta, cb) {
  var out = this._frame({
    id: id,
    type: 'WINDOW_UPDATE',
    flags: 0,
    length: 4
  }, function(buffer) {
    buffer.reserve(4);
    buffer.writeUInt32BE(delta & 0x7fffffff);
  });

  return cb(null, out);
};

Framer.prototype.goawayFrame = function goawayFrame(lastId, status, cb) {
  if (!this.version) {
    return this.on('version', function() {
      this.goawayFrame(lastId, status, cb);
    });
  }

  var header = new Buffer(16);

  // Version and type
  header.writeUInt32BE(0x80000007 | (this.version << 16), 0, true);
  // Length
  header.writeUInt32BE(0x00000008, 4, true);
  // Last-good-stream-ID
  header.writeUInt32BE(lastId & 0x7fffffff, 8, true);
  // Status
  header.writeUInt32BE(status, 12, true);

  return cb(null, header);
};
