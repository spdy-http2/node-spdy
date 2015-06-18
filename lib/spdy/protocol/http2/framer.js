'use strict';

var spdy = require('../../../spdy');
var base = spdy.protocol.base;
var constants = require('./').constants;

var util = require('util');
var WriteBuffer = require('wbuf');
var Buffer = require('buffer').Buffer;

function Framer() {
  base.Framer.call(this);

  this.maxFrameSize = constants.INITIAL_MAX_FRAME_SIZE;
}
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(version, compress, decompress) {
  return new Framer(version, compress, decompress);
};

Framer.prototype._frame = function _frame(header, body, cb) {
  var buffer = new WriteBuffer();

  buffer.reserve(constants.FRAME_HEADER_SIZE);
  var len = buffer.skip(3);
  buffer.writeUInt8(constants.frameType[header.type]);
  buffer.writeUInt8(header.flags);
  buffer.writeUInt32BE(header.id & 0x7fffffff);

  body(buffer);
  len.writeUInt24BE(buffer.size - constants.FRAME_HEADER_SIZE);

  var chunks = buffer.render();
  this.write({
    stream: header.id,
    priority: header.priority,
    chunks: chunks
  }, function(err) {
    if (cb)
      cb(err, chunks);
  });
};

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
    self._frame({
      id: id,
      priority: false,
      type: 'HEADERS',
      flags: constants.flags.END_HEADERS
    }, function(buf) {
      buf.reserve(size);
      self._continuationWrite(buf, size, packed);
    }, callback);
  });
};

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

    self._frame({
      id: isPush ? assoc : id,
      priority: false,
      type: isPush ? 'PUSH_PROMISE' : 'HEADERS',
      flags: constants.flags.END_HEADERS
    }, function(buf) {
      buf.reserve(totalSize);
      if (isPush)
        buf.writeUInt32BE(id);

      self._continuationWrite(buf, size, packed);
    }, callback);
  });
};

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

Framer.prototype.dataFrame = function dataFrame(frame, callback) {
  this._frame({
    id: frame.id,
    priority: frame.priority,
    type: 'DATA',
    flags: frame.fin ? constants.flags.END_STREAM : 0
  }, function(buf) {
    buf.copyFrom(frame.data);
  }, callback);
};

Framer.prototype.pingFrame = function pingFrame(opaque, ack, callback) {
  this._frame({
    id: 0,
    priority: false,
    type: 'PING',
    flags: ack ? constants.flags.ACK : 0
  }, function(buf) {
    buf.copyFrom(opaque);
  }, callback);
};

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

Framer.prototype.settingsFrame = function settingsFrame(options, callback) {
  var key = options.maxStreams + ':' + options.windowSize;

  var settings = Framer.settingsCache[key];
  if (settings) {
    this.schedule({
      id: 0,
      priority: false,
      chunks: settings
    });
    return callback(null);
  }

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

  this._frame({
    id: 0,
    priority: false,
    type: 'SETTINGS',
    flags: 0
  }, function(buffer) {
    buffer.reserve(bodySize);
    for (var i = 0; i < params.length; i++) {
      var param = params[i];

      buffer.writeUInt16BE(param.key);
      buffer.writeUInt32BE(param.value);
    }
  }, function(err, chunks) {
    if (err)
      return callback(err);

    Framer.settingsCache[key] = chunks;

    return callback(null);
  });
};
Framer.settingsCache = {};

Framer.prototype.windowUpdateFrame = function windowUpdateFrame(id, delta, cb) {
  this._frame({
    id: id,
    priority: false,
    type: 'WINDOW_UPDATE',
    flags: 0
  }, function(buffer) {
    buffer.reserve(4);
    buffer.writeUInt32BE(delta & 0x7fffffff);
  }, cb);
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
