'use strict';

var spdy = require('../../../spdy');
var constants = require('./').constants;
var base = spdy.protocol.base;

var util = require('util');
var Buffer = require('buffer').Buffer;
var WriteBuffer = require('wbuf');

function Framer() {
  base.Framer.call(this);
}
util.inherits(Framer, base.Framer);
module.exports = Framer;

Framer.create = function create(version, compress, decompress) {
  return new Framer(version, compress, decompress);
};

Framer.prototype.headersToDict = function headersToDict(headers,
                                                        preprocess,
                                                        out,
                                                        callback) {
  function stringify(value) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        return value.join('\x00');
      } else if (typeof value === 'string') {
        return value;
      } else {
        return value.toString();
      }
    } else {
      return '';
    }
  }

  // Lower case of all headers keys
  var loweredHeaders = {};
  Object.keys(headers || {}).map(function(key) {
    loweredHeaders[key.toLowerCase()] = headers[key];
  });

  // Allow outer code to add custom headers or remove something
  if (preprocess)
    preprocess(loweredHeaders);

  // Transform object into kv pairs
  var size = this.version === 2 ? 2 : 4;
  var len = size;
  var pairs = Object.keys(loweredHeaders).filter(function(key) {
    var lkey = key.toLowerCase();
    return lkey !== 'connection' && lkey !== 'keep-alive' &&
           lkey !== 'proxy-connection' && lkey !== 'transfer-encoding';
  }).map(function(key) {
    var klen = Buffer.byteLength(key),
        value = stringify(loweredHeaders[key]),
        vlen = Buffer.byteLength(value);

    len += size * 2 + klen + vlen;
    return [klen, key, vlen, value];
  });

  var block = new WriteBuffer();
  block.reserve(len);

  if (this.version === 2)
    block.writeUInt16BE(pairs.length);
  else
    block.writeUInt32BE(pairs.length);

  pairs.forEach(function(pair) {
    // Write key length
    if (this.version === 2)
      block.writeUInt16BE(pair[0]);
    else
      block.writeUInt32BE(pair[0]);

    // Write key
    block.write(pair[1]);

    // Write value length
    if (this.version === 2)
      block.writeUInt16BE(pair[2]);
    else
      block.writeUInt32BE(pair[2]);
    // Write value
    block.write(pair[3]);
  }, this);

  this.compress(Buffer.concat(block.render()), function(err, chunks) {
    if (err)
      return callback(err);

    for (var i = 0; i < chunks.length; i++)
      out.copyFrom(chunks[i]);

    callback(null);
  });
};

Framer.prototype._frame = function _frame(frame, body, cb) {
  if (!this.version) {
    this.on('version', function() {
      this._frame(frame, body, cb);
    });
    return;
  }

  var buffer = new WriteBuffer();

  buffer.writeUInt16BE(0x8000 | this.version);
  buffer.writeUInt16BE(constants.frameType[frame.type]);
  buffer.writeUInt8(frame.flags);
  var len = buffer.skip(3);

  var self = this;
  body(buffer, function(err) {
    if (err) {
      if (cb)
        return cb(err);
      else
        self.emit('error', err);
    }

    len.writeUInt24BE(buffer.size - constants.FRAME_HEADER_SIZE);

    var chunks = buffer.render();
    self.write({
      stream: frame.id,
      priority: false,
      chunks: chunks
    }, function(err) {
      if (cb)
        cb(err, chunks);
    });
  });
};

Framer.prototype.replyFrame = function replyFrame(id,
                                                  code,
                                                  reason,
                                                  headers,
                                                  callback) {
  var self = this;

  this._frame({
    type: 'SYN_REPLY',
    id: id,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(self.version === 2 ? 6 : 4);

    buf.writeUInt32BE(id & 0x7fffffff);

    // Unused data
    if (self.version === 2)
      buf.writeUInt16BE(0);

    self.headersToDict(headers, function(headers) {
      if (self.version === 2) {
        headers.status = code + ' ' + reason;
        headers.version = 'HTTP/1.1';
      } else {
        headers[':status'] = code + ' ' + reason;
        headers[':version'] = 'HTTP/1.1';
      }
    }, buf, callback);
  }, callback);
};

Framer.prototype.streamFrame = function streamFrame(id,
                                                    assoc,
                                                    meta,
                                                    headers,
                                                    callback) {
  var self = this;

  this._frame({
    type: 'SYN_STREAM',
    id: id,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(10);

    buf.writeUInt32BE(id & 0x7fffffff);
    buf.writeUInt32BE(assoc & 0x7fffffff);
    buf.writeUInt8(meta.priority << 5);

    // CREDENTIALS slot
    buf.writeUInt8(0);

    self.headersToDict(headers, function(headers) {
      if (self.version === 2) {
        if (meta.status)
          headers.status = meta.status;
        headers.version = meta.version || 'HTTP/1.1';
        headers.url = meta.url;
        if (meta.method)
          headers.method = meta.method;
      } else {
        if (meta.status)
          headers[':status'] = meta.status;
        headers[':version'] = meta.version || 'HTTP/1.1';
        headers[':path'] = meta.path || meta.url;
        headers[':scheme'] = meta.scheme || 'https';
        headers[':host'] = meta.host;
        if (meta.method)
          headers[':method'] = meta.method;
      }
    }, buf, callback);
  }, callback);
};

Framer.prototype.headersFrame = function headersFrame(id, headers, callback) {
  var self = this;

  this._frame({
    type: 'HEADERS',
    id: id,
    priority: false,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(4 + (self.version === 2 ? 2 : 0));
    buf.writeUInt32BE(id & 0x7fffffff);

    // Unused data
    if (self.version === 2)
      buf.writeUInt16BE(0);

    self.headersToDict(headers, null, buf, callback);
  }, callback);
};

Framer.prototype.dataFrame = function dataFrame(frame, callback) {
  if (!this.version) {
    return this.on('version', function() {
      this.dataFrame(frame, callback);
    });
  }

  var buffer = new WriteBuffer();
  buffer.reserve(8 + frame.data.length);

  buffer.writeUInt32BE(frame.id & 0x7fffffff);
  buffer.writeUInt8(frame.fin ? 0x01 : 0x0);
  buffer.writeUInt24BE(frame.data.length);
  buffer.copyFrom(frame.data);

  var chunks = buffer.render();
  this.write({
    stream: frame.id,
    priority: frame.priority,
    chunks: chunks
  }, callback);
};

Framer.prototype.pingFrame = function pingFrame(opaque, ack, callback) {
  this._frame({
    type: 'PING',
    id: 0,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(4);

    buf.writeUInt32BE(opaque.readUInt32BE(opaque.length - 4, true));

    callback(null);
  }, callback);
};

Framer.prototype.rstFrame = function rstFrame(id, code, extra, callback) {
  var self = this;

  this._frame({
    type: 'RST_STREAM',
    id: id,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(8);

    // Stream ID
    buf.writeUInt32BE(id & 0x7fffffff);
    // Status Code
    buf.writeUInt32BE(code);

    // Extra debugging information
    if (self.debug && extra)
      buf.write(extra);

    callback(null);
  }, callback);
};

Framer.prototype.settingsFrame = function settingsFrame(options, callback) {
  var self = this;

  var key = this.version === 2 ? '2/' + options.maxStreams :
                                 '3/' + options.maxStreams + ':' +
                                     options.windowSize;

  var settings = Framer.settingsCache[key];
  if (settings)
    return callback(null, settings);

  this._frame({
    type: 'SETTINGS',
    id: 0,
    flags: 0
  }, function(buf, callback) {
    var params = [];
    if (isFinite(options.maxStreams)) {
      params.push({
        key: constants.settings.SETTINGS_MAX_CONCURRENT_STREAMS,
        value: options.maxStreams
      });
    }
    if (self.version > 2) {
      params.push({
        key: constants.settings.SETTINGS_INITIAL_WINDOW_SIZE,
        value: options.windowSize
      });
    }

    buf.reserve(4 + 8 * params.length);

    // Count of entries
    buf.writeUInt32BE(params.length);

    params.forEach(function(param) {
      var flag = constants.settings.FLAG_SETTINGS_PERSIST_VALUE << 24;

      if (self.version === 2)
        buf.writeUInt32LE(flag | param.key);
      else
        buf.writeUInt32BE(flag | param.key);
      buf.writeUInt32BE(param.value & 0x7fffffff);
    });

    callback(null);
  }, function(err, frame) {
    if (err)
      return callback(err);

    Framer.settingsCache[key] = frame;
    callback(null, frame);
  });
};
Framer.settingsCache = {};

Framer.prototype.windowUpdateFrame = function windowUpdateFrame(id, delta, cb) {
  this._frame({
    type: 'WINDOW_UPDATE',
    id: id,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(8);

    // ID
    buf.writeUInt32BE(id & 0x7fffffff);

    // Delta
    if (delta > 0)
      buf.writeUInt32BE(delta & 0x7fffffff);
    else
      buf.writeUInt32BE(delta);

    callback(null);
  }, cb);
};

Framer.prototype.goawayFrame = function goawayFrame(lastId, status, cb) {
  this._frame({
    type: 'GOAWAY',
    id: 0,
    flags: 0
  }, function(buf, callback) {
    buf.reserve(8);

    // Last-good-stream-ID
    buf.writeUInt32BE(lastId & 0x7fffffff);
    // Status
    buf.writeUInt32BE(status);

    callback(null);
  }, cb);
};
