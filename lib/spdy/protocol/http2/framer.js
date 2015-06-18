'use strict';

var spdy = require('../../../spdy');
var base = spdy.protocol.base;
var constants = require('./').constants;

var util = require('util');
var WriteBuffer = require('wbuf');
var Buffer = require('buffer').Buffer;

function Framer(options) {
  base.Framer.call(this, options);

  this.maxFrameSize = constants.INITIAL_MAX_FRAME_SIZE;
}
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(options) {
  return new Framer(options);
};

Framer.prototype._frame = function _frame(header, body, cb) {
  var buffer = new WriteBuffer();

  buffer.reserve(constants.FRAME_HEADER_SIZE);
  var len = buffer.skip(3);
  buffer.writeUInt8(constants.frameType[header.type]);
  buffer.writeUInt8(header.flags);
  buffer.writeUInt32BE(header.id & 0x7fffffff);

  body(buffer);

  var frameSize = buffer.size - constants.FRAME_HEADER_SIZE;
  len.writeUInt24BE(frameSize);
  if (this.window)
    this.window.send.update(-frameSize);

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

Framer.prototype.replyFrame = function replyFrame(frame) {
  var pairs = [];
  pairs.push({ name: ':status', value: frame.code + '' });

  var self = this;
  this._compressHeaders(frame.headers, pairs, function(err, size, packed) {
    if (err)
      return self.emit(err);

    self._frame({
      id: frame.id,
      priority: false,
      type: 'HEADERS',
      flags: constants.flags.END_HEADERS
    }, function(buf) {
      buf.reserve(size);
      self._continuationWrite(buf, size, packed);
    });
  });
};

Framer.prototype.streamFrame = function streamFrame(frame) {
  var isPush = frame.assoc !== 0;
  var pairs = [];

  if (frame.status)
    pairs.push({ name: ':status', value: frame.status + '' });
  pairs.push({ name: ':path', value: frame.path || frame.url });
  pairs.push({ name: ':scheme', value: frame.scheme || 'https' });
  pairs.push({ name: ':authority', value: frame.host });
  if (frame.method)
    pairs.push({ name: ':method', value: frame.method });

  // TODO(indutny): do not send PUSH_PROMISE when they are disabled
  var self = this;
  this._compressHeaders(frame.headers, pairs, function(err, size, packed) {
    if (err)
      return self.emit('error', err);

    var totalSize = size;
    if (isPush)
      totalSize += 4;

    self._frame({
      id: isPush ? frame.assoc : frame.id,
      priority: false,
      type: isPush ? 'PUSH_PROMISE' : 'HEADERS',
      flags: constants.flags.END_HEADERS
    }, function(buf) {
      buf.reserve(totalSize);
      if (isPush)
        buf.writeUInt32BE(id);

      self._continuationWrite(buf, size, packed);
    });
  });
};

Framer.prototype.headersFrame = function headersFrame(id, headers) {
  // TODO(indutny): implement me
};

Framer.prototype.dataFrame = function dataFrame(frame, callback) {
  this._frame({
    id: frame.id,
    priority: frame.priority,
    type: 'DATA',
    flags: frame.fin ? constants.flags.END_STREAM : 0
  }, function(buf) {
    buf.copyFrom(frame.data);
  });
};

Framer.prototype.pingFrame = function pingFrame(frame) {
  this._frame({
    id: 0,
    priority: false,
    type: 'PING',
    flags: ack ? constants.flags.ACK : 0
  }, function(buf) {
    buf.copyFrom(opaque);
  });
};

Framer.prototype.rstFrame = function rstFrame(frame) {
  // TODO(indutny): implement me
};

Framer.prototype.settingsFrame = function settingsFrame(options) {
  var key = options.maxStreams + ':' + options.windowSize;

  var settings = Framer.settingsCache[key];
  if (settings) {
    this.write({
      id: 0,
      priority: false,
      chunks: settings
    });
    return;
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
      return self.emit('error', err);

    Framer.settingsCache[key] = chunks;
  });
};
Framer.settingsCache = {};

Framer.prototype.windowUpdateFrame = function windowUpdateFrame(frame) {
  this._frame({
    id: frame.id,
    priority: false,
    type: 'WINDOW_UPDATE',
    flags: 0
  }, function(buffer) {
    buffer.reserve(4);
    buffer.writeUInt32BE(frame.delta & 0x7fffffff);
  });
};

Framer.prototype.goawayFrame = function goawayFrame(frame) {
  // TODO(indutny): implement me
};
