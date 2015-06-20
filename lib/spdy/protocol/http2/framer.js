'use strict';

var spdy = require('../../../spdy');
var base = spdy.protocol.base;
var constants = require('./').constants;

var util = require('util');
var WriteBuffer = require('wbuf');
var OffsetBuffer = require('obuf');
var Buffer = require('buffer').Buffer;
var debug = require('debug')('spdy:framer');

function Framer(options) {
  base.Framer.call(this, options);

  this.maxFrameSize = constants.INITIAL_MAX_FRAME_SIZE;
}
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(options) {
  return new Framer(options);
};

Framer.prototype.setMaxFrameSize = function setMaxFrameSize(size) {
  this.maxFrameSize = size;
};

Framer.prototype._frame = function _frame(frame, body, callback) {
  debug('id=%d type=%s', frame.id, frame.type);

  var buffer = new WriteBuffer();

  buffer.reserve(constants.FRAME_HEADER_SIZE);
  var len = buffer.skip(3);
  buffer.writeUInt8(constants.frameType[frame.type]);
  buffer.writeUInt8(frame.flags);
  buffer.writeUInt32BE(frame.id & 0x7fffffff);

  body(buffer);

  var frameSize = buffer.size - constants.FRAME_HEADER_SIZE;
  len.writeUInt24BE(frameSize);

  var chunks = buffer.render();
  var toWrite = {
    stream: frame.id,
    priority: frame.priority === undefined ? false : frame.priority,
    chunks: chunks,
    callback: callback
  };

  if (this.window) {
    var self = this;
    this.window.send.update(-frameSize, function() {
      self.write(toWrite);
    });
  } else {
    this.write(toWrite);
  }

  return chunks;
};

Framer.prototype._continuationFrame = function _continuationFrame(frame,
                                                                  body,
                                                                  callback) {
  var buf = new OffsetBuffer();
  for (var i = 0; i < frame.chunks.length; i++)
    buf.push(frame.chunks[i]);

  var frames = [];
  while (!buf.isEmpty()) {
    // First frame may have reserved bytes in it
    var size = this.maxFrameSize;
    if (frames.length === 0)
      size -= frame.reserve;
    size = Math.min(size, buf.size);

    var frameBuf = buf.clone(size);
    buf.skip(size);

    frames.push({
      size: frameBuf.size,
      chunks: frameBuf.toChunks()
    });
  }

  frames.forEach(function(subFrame, i) {
    var isFirst = i === 0;
    var isLast = i === frames.length - 1;

    this._frame({
      id: frame.id,
      priority: false,
      type: isFirst ? frame.type : 'CONTINUATION',
      flags: isLast ? constants.flags.END_HEADERS : 0,
    }, function(buf) {
      // Fill those reserved bytes
      if (isFirst && body)
        body(buf);

      buf.reserve(subFrame.size);
      for (var i = 0; i < subFrame.chunks.length; i++)
        buf.copyFrom(subFrame.chunks[i]);
    }, isLast ? callback : null);
  }, this);
};

Framer.prototype._compressHeaders = function _compressHeaders(headers,
                                                              pairs,
                                                              callback) {
  Object.keys(headers).forEach(function(name) {
    // TODO(indutny): Never index cookies
    pairs.push({ name: name.toLowerCase(), value: headers[name] + '' });
  });

  var self = this;
  this.compress.write([ pairs ], callback);
};

Framer.prototype.requestFrame = function requestFrame(frame, callback) {
  var pairs = [];

  if (frame.method)
    pairs.push({ name: ':method', value: frame.method });
  if (frame.path)
    pairs.push({ name: ':path', value: frame.path });
  if (frame.status) {
    pairs.push({ name: ':status', value: frame.status + '' });
  } else {
    pairs.push({ name: ':scheme', value: frame.scheme || 'https' });
    pairs.push({ name: ':authority', value: frame.host });
  }

  var self = this;
  this._compressHeaders(frame.headers, pairs, function(err, chunks) {
    if (err) {
      if (callback)
        return callback(err);
      else
        return self.emit('error', err);
    }

    self._continuationFrame({
      id: frame.id,
      type: 'HEADERS',
      reserve: 0,
      chunks: chunks
    }, null, callback);
  });
};

Framer.prototype.responseFrame = function responseFrame(frame, callback) {
  return this.requestFrame(frame, callback);
};

Framer.prototype.pushFrame = function pushFrame(frame, callback) {
  var pairs = [];

  pairs.push({ name: ':status', value: frame.status + '' });
  pairs.push({ name: ':method', value: frame.method });
  pairs.push({ name: ':path', value: frame.path || frame.url });
  pairs.push({ name: ':scheme', value: frame.scheme || 'https' });
  pairs.push({ name: ':authority', value: frame.host });

  // TODO(indutny): do not send PUSH_PROMISE when they are disabled
  var self = this;
  this._compressHeaders(frame.headers, pairs, function(err, chunks) {
    if (err) {
      if (callback)
        return callback(err);
      else
        return self.emit('error', err);
    }

    self._continuationFrame({
      id: frame.id,
      type: 'PUSH_PROMISE',
      reserve: 4,
      chunks: chunks
    }, function(buf) {
      buf.writeUInt32BE(frame.promisedId);
    }, callback);
  });
};

Framer.prototype.headersFrame = function headersFrame(frame, callback) {
  var self = this;
  this._compressHeaders(frame.headers, [], function(err, chunks) {
    if (err) {
      if (callback)
        return callback(err);
      else
        return self.emit('error', err);
    }

    self._continuationFrame({
      id: frame.id,
      type: 'HEADERS',
      reserve: 0,
      chunks: chunks
    }, null, callback);
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

Framer.prototype.pingFrame = function pingFrame(frame, callback) {
  this._frame({
    id: 0,
    type: 'PING',
    flags: frame.ack ? constants.flags.ACK : 0
  }, function(buf) {
    buf.copyFrom(frame.opaque);
  }, callback);
};

Framer.prototype.rstFrame = function rstFrame(frame, callback) {
  this._frame({
    id: frame.id,
    type: 'RST_STREAM',
    flags: 0
  }, function(buf) {
    buf.writeUInt32BE(constants.error[frame.code]);
  }, callback);
};

Framer.prototype.prefaceFrame = function prefaceFrame(callback) {
  debug('preface');
  this.write({
    stream: 0,
    priority: false,
    chunks: [ constants.PREFACE_BUFFER ],
    callback: callback
  });
};

Framer.prototype.settingsFrame = function settingsFrame(options, callback) {
  var key = JSON.stringify(options);

  var settings = Framer.settingsCache[key];
  if (settings) {
    debug('cached settings');
    this.write({
      id: 0,
      priority: false,
      chunks: settings,
      callback: callback
    });
    return;
  }

  var params = [];
  for (var i = 0; i < constants.settingsIndex.length; i++) {
    var name = constants.settingsIndex[i];
    if (!name)
      continue;

    // value: Infinity
    if (!isFinite(options[name]))
      continue;

    if (options[name] !== undefined)
      params.push({ key: i, value: options[name] });
  }

  // TODO(indutny): disable push streams on server?

  var bodySize = params.length * 6;

  var chunks = this._frame({
    id: 0,
    type: 'SETTINGS',
    flags: 0
  }, function(buffer) {
    buffer.reserve(bodySize);
    for (var i = 0; i < params.length; i++) {
      var param = params[i];

      buffer.writeUInt16BE(param.key);
      buffer.writeUInt32BE(param.value);
    }
  }, callback);

  Framer.settingsCache[key] = chunks;
};
Framer.settingsCache = {};

Framer.prototype.windowUpdateFrame = function windowUpdateFrame(frame,
                                                                callback) {
  this._frame({
    id: frame.id,
    type: 'WINDOW_UPDATE',
    flags: 0
  }, function(buffer) {
    buffer.reserve(4);
    buffer.writeInt32BE(frame.delta);
  }, callback);
};

Framer.prototype.goawayFrame = function goawayFrame(frame, callback) {
  this._frame({
    type: 'GOAWAY',
    id: 0,
    flags: 0
  }, function(buf) {
    buf.reserve(8);

    // Last-good-stream-ID
    buf.writeUInt32BE(frame.lastId & 0x7fffffff);
    // Code
    buf.writeUInt32BE(frame.code);

    // Extra debugging information
    if (frame.extra)
      buf.write(frame.extra);
  }, callback);
};
