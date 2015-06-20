'use strict';

var parser = exports;

var spdy = require('../../../spdy');
var base = spdy.protocol.base;
var constants = require('./constants');

var assert = require('assert');
var util = require('util');
var OffsetBuffer = require('obuf');

function Parser(options) {
  base.Parser.call(this, options);

  this.isServer = options.isServer;
  this.waiting = constants.FRAME_HEADER_SIZE;
  this.state = 'frame-head';
  this.pendingHeader = null;
}
util.inherits(Parser, base.Parser);

parser.create = function create(options) {
  return new Parser(options);
};

// Only for testing
Parser.prototype.skipPreface = function skipPreface() {
};

Parser.prototype.execute = function execute(buffer, callback) {
  if (this.state === 'frame-head')
    return this.onFrameHead(buffer, callback);

  assert(this.state === 'frame-body' && this.pendingHeader !== null);

  var self = this;
  var header = this.pendingHeader;
  this.pendingHeader = null;

  this.onFrameBody(header, buffer, function(err, frame) {
    if (err)
      return callback(err);

    self.state = 'frame-head';
    self.waiting = constants.FRAME_HEADER_SIZE;
    callback(null, frame);
  });
};

Parser.prototype.onFrameHead = function onFrameHead(buffer, callback) {
  var header = {
    control: (buffer.peekUInt8() & 0x80) === 0x80 ? true : false,
    version: null,
    type: null,
    id: null,
    flags: null,
    length: null
  };

  if (header.control) {
    header.version = buffer.readUInt16BE() & 0x7fff;
    header.type = buffer.readUInt16BE();
  } else {
    header.id = buffer.readUInt32BE(0) & 0x7fffffff;
  }
  header.flags = buffer.readUInt8();
  header.length = buffer.readUInt24BE();

  if (this.version === null && header.control) {
    if (header.version !== 2 && header.version !== 3)
      return callback(new Error('Unsupported spdy version: ' + header.version));
    this.setVersion(header.version);
  }

  this.state = 'frame-body';
  this.waiting = header.length;
  this.pendingHeader = header;
  callback(null, null);
};

Parser.prototype.onFrameBody = function onFrameBody(header, buffer, callback) {
  // Data frame
  if (!header.control) {
    // No support for compressed DATA
    if ((header.flags & 0x02) !== 0)
      return callback(new Error('DATA compression not supported'));

    return callback(null, {
      type: 'DATA',
      id: header.id,
      fin: (header.flags & 0x01) === 0x01,
      data: buffer.take(buffer.size)
    });
  }

  // Count received bytes
  if (this.window)
    this.window.recv.update(-buffer.size);

  // SYN_STREAM or SYN_REPLY
  if (header.type === 0x01 || header.type === 0x02)
    this.onSynHeadFrame(header.type, header.flags, buffer, callback);
  // RST_STREAM
  else if (header.type === 0x03)
    this.onRSTFrame(buffer, callback);
  // SETTINGS
  else if (header.type === 0x04)
    this.onSettingsFrame(buffer, callback);
  else if (header.type === 0x05)
    callback(null, { type: 'NOOP' });
  // PING
  else if (header.type === 0x06)
    this.onPingFrame(buffer, callback);
  // GOAWAY
  else if (header.type === 0x07)
    this.onGoawayFrame(buffer, callback);
  // HEADERS
  else if (header.type === 0x08)
    this.onHeaderFrames(buffer, callback);
  // WINDOW_UPDATE
  else if (header.type === 0x09)
    this.onWindowUpdateFrame(buffer, callback);
  // X-FORWARDED
  else if (header.type === 0xf000)
    this.onXForwardedFrame(buffer, callback);
  else
    callback(null, { type: 'unknown: ' + header.type });
};

Parser.prototype.onSynHeadFrame = function onSynHeadFrame(type,
                                                          flags,
                                                          body,
                                                          callback) {
  var stream = type === 0x01;
  var offset = stream ? 10 : this.version === 2 ? 6 : 4;

  if (!body.has(offset))
    return callback(new Error('SynHead OOB'));

  var head = body.clone(offset);
  body.skip(offset);
  this.parseKVs(body, function(err, headers) {
    if (err)
      return callback(err);

    if (stream &&
        (!headers[':method'] || !headers[':path'])) {
      return callback(new Error('Missing `:method` and/or `:path` header'));
    }

    var id = head.readUInt32BE() & 0x7fffffff;
    var associated = stream ? head.readUInt32BE() & 0x7fffffff : 0;
    var priority = stream ? head.readUInt8() >> 5 : 0;
    var fin = (flags & 0x01) !== 0;
    var path = headers[':path'];

    var isPush = stream && associated !== 0;

    if (!isPush) {
      callback(null, {
        type: 'HEADERS',
        dependent: 0,
        id: id,
        priority: priority,
        fin: fin,
        headers: headers,
        path: path
      });
    } else {
      callback(null, {
        type: 'PUSH_PROMISE',
        id: associated,
        promisedId: id,
        priority: priority,
        fin: fin,
        headers: headers,
        path: path
      });
    }
  });
};

Parser.prototype.onHeaderFrames = function onHeaderFrames(body, callback) {
  var offset = this.version === 2 ? 6 : 4;
  if (!body.has(offset))
    return callback(new Error('HEADERS OOB'));

  var streamId = body.readUInt32BE() & 0x7fffffff;
  if (this.version === 2)
    body.skip(2);

  this.parseKVs(body, function(err, headers) {
    if (err)
      return callback(err);

    callback(null, {
      type: 'HEADERS',
      dependent: 0,
      id: streamId,
      priority: 0,
      fin: false,
      path: undefined,
      headers: headers
    });
  });
};

Parser.prototype.parseKVs = function parseKVs(buffer, callback) {
  var self = this;

  this.decompress.write(buffer.toChunks(), function(err, chunks) {
    if (err)
      return callback(err);

    var buffer = new OffsetBuffer();
    for (var i = 0; i < chunks.length; i++)
      buffer.push(chunks[i]);

    var size = self.version === 2 ? 2 : 4;
    if (!buffer.has(size))
      return callback(new Error('KV OOB'));

    var count = self.version === 2 ? buffer.readUInt16BE() :
                                     buffer.readUInt32BE();
    var headers = {};

    function readString() {
      if (!buffer.has(size))
        return null;
      var len = self.version === 2 ? buffer.readUInt16BE() :
                                     buffer.readUInt32BE();

      if (!buffer.has(len))
        return null;

      var value = buffer.take(len);
      return value.toString();
    }

    while (count > 0) {
      var key = readString();
      var value = readString();

      if (key === null || value === null)
        return callback(new Error('Headers OOB'));

      if (self.version < 3) {
        var isInternal = /^(method|version|url|host|scheme|status)$/.test(key);
        if (key === 'url')
          key = 'path';
        if (isInternal)
          key = ':' + key;
      }

      count--;
      if (key === ':host')
        key = ':authority';

      // Skip version, not present in HTTP2
      if (key === ':version')
        continue;

      headers[key] = value;
    }

    callback(null, headers);
  });
};

Parser.prototype.onRSTFrame = function onRSTFrame(body, callback) {
  if (!body.has(8))
    return callback(new Error('RST OOB'));

  var frame = {
    type: 'RST',
    id: body.readUInt32BE() & 0x7fffffff,
    code: body.readUInt32BE(),
  };
  if (body.size !== 0)
    frame.extra = body.take(body.size);
  callback(null, frame);
};

Parser.prototype.onSettingsFrame = function onSettingsFrame(body, callback) {
  if (!body.has(4))
    return callback(new Error('SETTINGS OOB'));

  var settings = {},
      number = body.readUInt32BE(),
      idMap = {
        1: 'upload_bandwidth',
        2: 'download_bandwidth',
        3: 'round_trip_time',
        4: 'max_concurrent_streams',
        5: 'current_cwnd',
        6: 'download_retrans_rate',
        7: 'initial_window_size',
        8: 'client_certificate_vector_size'
      };

  if (!body.has(number * 8))
    return callback(new Error('SETTINGS OOB#2'));

  for (var i = 0; i < number; i++) {
    var id = this.version === 2 ? body.readUInt32LE() :
                                   body.readUInt32BE();
    var flags = (id >> 24) & 0xff;
    id = id & 0xffffff;

    // Skip persisted settings
    if (flags & 0x2)
      continue;

    var name = idMap[id];

    settings[name] = body.readUInt32BE();
  }

  callback(null, {
    type: 'SETTINGS',
    settings: settings
  });
};

Parser.prototype.onPingFrame = function onPingFrame(body, callback) {
  if (!body.has(4))
    return callback(new Error('PING OOB'));

  var isServer = this.isServer;
  var opaque = body.clone(body.size).take(body.size);
  var id = body.readUInt32BE();
  var ack = isServer ? (id % 2 === 0) : (id % 2 === 1);

  callback(null, { type: 'PING', opaque: opaque, ack: ack });
};

Parser.prototype.onGoawayFrame = function onGoawayFrame(body, callback) {
  if (!body.has(8))
    return callback(new Error('GOAWAY OOB'));

  callback(null, {
    type: 'GOAWAY',
    lastId: body.readUInt32BE() & 0x7fffffff,
    code: body.readUInt32BE()
  });
};

Parser.prototype.onWindowUpdateFrame = function onWindowUpdateFrame(body,
                                                                    callback) {
  if (!body.has(8))
    return callback(new Error('WINDOW_UPDATE OOB'));

  callback(null, {
    type: 'WINDOW_UPDATE',
    id: body.readUInt32BE() & 0x7fffffff,
    delta: body.readInt32BE()
  });
};

Parser.prototype.onXForwardedFrame = function onXForwardedFrame(body,
                                                                callback) {
  if (!body.has(4))
    return callback(new Error('X_FORWARDED OOB'));

  var len = body.readUInt32BE();
  if (!body.has(len))
    return callback(new Error('X_FORWARDED host length OOB'));

  callback(null, {
    type: 'X_FORWARDED',
    host: body.take(len).toString()
  });
};
