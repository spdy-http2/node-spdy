var parser = exports;

var spdy = require('../../../spdy');
var base = spdy.protocol.base;
var constants = require('./').constants;

var assert = require('assert');
var util = require('util');
var Buffer = require('buffer').Buffer;

function Parser(options) {
  base.Parser.call(this, options);

  this.waiting = constants.PREFACE_SIZE;
  this.state = 'preface';
  this.pendingHeader = null;

  // Header Block queue
  this.headers = {};
  this.maxFrameSize = constants.INITIAL_MAX_FRAME_SIZE;
  this.maxHeaderListSize = constants.DEFAULT_MAX_HEADER_LIST_SIZE;
}
util.inherits(Parser, base.Parser);

parser.create = function create(options) {
  return new Parser(options);
};

// Only for testing
Parser.prototype.skipPreface = function skipPreface() {
  // Just some number bigger than 3.1, doesn't really matter for HTTP2
  this.setVersion(4);

  // Parse frame header!
  this.state = 'frame-head';
  this.waiting = constants.FRAME_HEADER_SIZE;
};

Parser.prototype.execute = function execute(buffer, callback) {
  if (this.state === 'preface')
    return this.onPreface(buffer, callback);

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

Parser.prototype.onPreface = function onPreface(buffer, callback) {
  if (buffer.take(buffer.size).toString() !== constants.PREFACE) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid preface'));
  }

  this.skipPreface();
  callback(null, null);
};

Parser.prototype.onFrameHead = function onFrameHead(buffer, callback) {
  var header = {
    length: buffer.readUInt24BE(),
    control: true,
    type: buffer.readUInt8(),
    flags: buffer.readUInt8(),
    id: buffer.readUInt32BE() & 0x7fffffff
  };

  if (header.length >= this.maxFrameSize) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'Frame length OOB'));
  }

  header.control = header.type !== constants.frameType.DATA;

  this.state = 'frame-body';
  this.pendingHeader = header;
  this.waiting = header.length;

  callback(null, null);
};

Parser.prototype.onFrameBody = function onFrameBody(header, buffer, callback) {
  var frameType = constants.frameType;

  if (header.type === frameType.DATA)
    this.onDataFrame(header, buffer, callback);
  // Emulated SYN_STREAM or SYN_REPLY
  else if (header.type === frameType.HEADERS)
    this.onHeadersFrame(header, buffer, callback);
  else if (header.type === frameType.RST_STREAM)
    this.onRSTFrame(header, buffer, callback);
  else if (header.type === frameType.SETTINGS)
    this.onSettingsFrame(header, buffer, callback);
  else if (header.type === frameType.PING)
    this.onPingFrame(header, buffer, callback);
  else if (header.type === frameType.GOAWAY)
    this.onGoawayFrame(header, buffer, callback);
  else if (header.type === frameType.CONTINUATION)
    this.onContinuationFrame(header, buffer, callback);
  else if (header.type === frameType.WINDOW_UPDATE)
    this.onWindowUpdateFrame(header, buffer, callback);
  else if (header.type === frameType.X_FORWARDED_FOR)
    this.onXForwardedFrame(header, buffer, callback);
  else
    callback(null, { type: 'unknown: ' + header.type });
};

Parser.prototype.unpadData = function unpadData(header, body, callback) {
  var isPadded = (header.flags & constants.flags.PADDED) !== 0;

  if (!isPadded)
    return callback(null, body);

  if (!body.has(1)) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'Not enough space for padding'));
  }

  var pad = body.readUInt8();
  if (!body.has(pad)) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid padding size'));
  }

  var contents = body.clone(body.size - pad);
  body.skip(body.size);
  callback(null, contents);
};

Parser.prototype.onDataFrame = function onDataFrame(header, body, callback) {
  var isEndStream = (header.flags & constants.flags.END_STREAM) !== 0;

  this.unpadData(header, body, function(err, data) {
    if (err)
      return callback(err);

    callback(null, {
      type: 'DATA',
      id: header.id,
      fin: isEndStream,
      compressed: false,
      data: data.take(data.size)
    });
  });
};

Parser.prototype.initHeaderBlock = function initHeaderBlock(header,
                                                            frame,
                                                            block,
                                                            callback) {

  if (this.headers[header.id]) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Duplicate Stream ID'));
  }

  this.headers[header.id] = {
    frame: frame,
    queue: [],
    size: 0
  };
  this.queueHeaderBlock(header, block, callback);
};

Parser.prototype.queueHeaderBlock = function queueHeaderBlock(header,
                                                              block,
                                                              callback) {
  var self = this;
  var item = this.headers[header.id];
  if (!item) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'No matching stream for continuation'));
  }

  var fin = (header.flags & constants.flags.END_HEADERS) !== 0;

  var chunks = block.toChunks();
  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    item.queue.push(chunk);
    item.size += chunk.length;
  }

  if (item.size >= self.maxHeaderListSize) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Compressed header list is too large'));
  }

  if (!fin)
    return callback(null, null);

  for (var i = 0; i < item.queue.length; i++)
    this.decompress.write(item.queue[i]);
  this.decompress.execute(function(err) {
    if (err) {
      return callback(self.error(constants.error.COMPRESSION_ERROR,
                                 err.message));
    }

    var headers = {};
    var size = 0;
    while (true) {
      var header = self.decompress.read();
      if (!header)
        break;

      size += header.name.length + header.value.length + 32;
      if (size >= self.maxHeaderListSize) {
        return callback(self.error(constants.error.PROTOCOL_ERROR,
                                   'Header list is too large'));
      }

      headers[header.name.toLowerCase()] = header.value;
    }

    item.frame.headers = headers;
    item.frame.url = headers[':path'];

    callback(null, item.frame);
  });
};

Parser.prototype.onHeadersFrame = function onHeadersFrame(header,
                                                          body,
                                                          callback) {
  var self = this;
  var stream = header.id % 2 === 1;

  if (header.id === 0) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid stream id for HEADERS'));
  }

  this.unpadData(header, body, function(err, data) {
    if (err)
      return callback(err);

    var isPriority = (header.flags & constants.flags.PRIORITY) !== 0;
    if (!data.has(isPriority ? 5 : 0)) {
      return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                                 'Not enough data for HEADERS'));
    }

    var isExclusive = false;
    var dependentStream = 0;
    var weight = 0;
    if (isPriority) {
      dependentStream = data.readUInt32BE();
      isExclusive = (dependentStream >>> 31) !== 0;
      dependentStream &= 0x7fffffff;
      weight = data.readUInt8();
    }

    var streamInfo = {
      // Emulate SPDY
      type: stream ? 'SYN_STREAM' : 'SYN_REPLY',
      id: header.id,
      associated: dependentStream,
      priority: weight,
      fin: (header.flags & constants.END_STREAM) !== 0,
      unidir: false,
      headers: null,
      url: null
    };

    self.initHeaderBlock(header, streamInfo, data, callback);
  });
};

Parser.prototype.onContinuationFrame = function onContinuationFrame(header,
                                                                    body,
                                                                    callback) {
  this.queueHeaderBlock(header, body, callback);
};

Parser.prototype.onRSTFrame = function onRSTFrame(header, body, callback) {
  if (body.size !== 4) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'RST_STREAM length not 4'));
  }

  if (header.id === 0) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid stream id for RST_STREAM'));
  }

  callback(null, {
    type: 'RST_STREAM',
    id: header.id,
    status: body.readUInt32BE()
  });
};

Parser.prototype.onSettingsFrame = function onSettingsFrame(header,
                                                            body,
                                                            callback) {

  if (header.id !== 0) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid stream id for SETTINGS'));
  }

  var isAck = (header.flags & constants.flags.ACK) !== 0;
  if (isAck && body.size !== 0) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'SETTINGS with ACK and non-zero length'));
  }

  if (isAck)
    return callback(null, { type: 'ACK_SETTINGS' });

  if (body.size % 6 !== 0) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'SETTINGS length not multiple of 6'));
  }

  var settings = {};
  while (!body.isEmpty()) {
    var id = body.readUInt16BE();
    var value = body.readUInt32BE();
    var name = constants.settingsIndex[id];

    settings[id] = {
      value: value
    };

    if (name)
      settings[name] = settings[id];
  }

  callback(null, {
    type: 'SETTINGS',
    settings: settings
  });
};

Parser.prototype.onPingFrame = function onPingFrame(header, body, callback) {
  if (body.size !== 8) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'PING length < 8'));
  }

  if (header.id !== 0) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid stream id for GOAWAY'));
  }

  var ack = (header.flags & constants.flags.ACK) !== 0;
  callback(null, { type: 'PING', opaque: body.take(body.size), ack: ack });
};

Parser.prototype.onGoawayFrame = function onGoawayFrame(header,
                                                        body,
                                                        callback) {
  if (!body.has(8)) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'GOAWAY length < 8'));
  }

  if (header.id !== 0) {
    return callback(this.error(constants.error.PROTOCOL_ERROR,
                               'Invalid stream id for GOAWAY'));
  }

  callback(null, {
    type: 'GOAWAY',
    lastId: body.readUInt32BE(),
    errorCode: body.readUInt32BE(),
    debug: body.take(body.size)
  });
};

Parser.prototype.onWindowUpdateFrame = function onWindowUpdateFrame(header,
                                                                    body,
                                                                    callback) {
  if (body.size !== 4) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'WINDOW_UPDATE length != 4'));
  }

  callback(null, {
    type: 'WINDOW_UPDATE',
    id: header.id,
    delta: body.readUInt32BE() & 0x7fffffff
  });
};

Parser.prototype.onXForwardedFrame = function onXForwardedFrame(header,
                                                                body,
                                                                callback) {
  if (body.size !== 4) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'X_FORWARDED_FOR length != 4'));
  }

  var len = body.readUInt32BE();
  if (body.size !== len) {
    return callback(this.error(constants.error.FRAME_SIZE_ERROR,
                               'X_FORWARDED_FOR host length OOB'));
  }

  callback(null, {
    type: 'X_FORWARDED',
    host: body.take(len)
  });
};
