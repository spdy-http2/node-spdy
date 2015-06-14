var spdy = require('../../../spdy');
var util = require('util');
var WriteBuffer = require('wbuf');
var base = spdy.protocol.base;
var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;
var constants = require('./').constants;

function Framer() {
  base.Framer.call(this);
};
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(version, compress, decompress) {
  return new Framer(version, compress, decompress);
};

Framer.prototype._frame = function _frame(header, cb) {
  // TODO(indutny): use WriteBuffer in spdy protocol too
  var buffer = new WriteBuffer();

  buffer.reserve(9);
  buffer.writeUInt24BE(header.length);
  buffer.writeUInt8(constants.frameType[header.type]);
  buffer.writeUInt8(header.flags);
  buffer.writeUInt32BE(header.id & 0x7fffffff);

  cb(buffer);

  // TODO(indutny): support bulk-writing
  return Buffer.concat(buffer.render());
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
    pairs.push({ name: name, value: headers[name] });
  });

  this.compress(pairs, function(err, packed) {
    var size = 0;
    for (var i = 0; i < packed.length; i++)
      size += packed[i].length;
    cb(null, size, packed);
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
  pairs.push({ name: ':status', value: code + ' ' + reason });

  var self = this;
  this._compressHeaders(headers, pairs, function(err, size, packed) {
    if (err)
      return callback(err);

    var frame = self._frame({
      id: id,
      type: 'HEADERS',
      flags: 0,
      length: size
    }, function(buf) {
      for (var i = 0; i < packed.length; i++)
        buf.copyFrom(packed[i]);
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
  var pairs = [];

  if (meta.status)
    pairs.push({ name: ':status', value: meta.status });
  pairs.push({ name: ':path', value: meta.path || meta.url });
  pairs.push({ name: ':scheme', value: meta.scheme || 'https' });
  pairs.push({ name: 'host', value: meta.host });
  if (meta.method)
    pairs.push({ name: ':method', value: meta.method });

  var self = this;
  this._compressHeaders(headers, pairs, function(err, size, packed) {
    if (err)
      return callback(err);

    // TODO(indutny): PUSH_PROMISE
    var frame = self._frame({
      id: id,
      type: 'PUSH_PROMISE',
      flags: 0,
      length: size
    }, function(buf) {
      for (var i = 0; i < packed.length; i++)
        buf.copyFrom(packed[i]);
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
  if (!fin && !data.length)
    return callback(null, []);

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
// ### function pingFrame (id)
// #### @id {Number} Ping ID
// Sends PING frame
//
Framer.prototype.pingFrame = function pingFrame(id, callback) {
  if (!this.version) {
    return this.on('version', function() {
      this.pingFrame(id, callback);
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

  var params = [];
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
