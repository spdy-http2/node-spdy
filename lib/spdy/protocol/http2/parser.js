var parser = exports;

var spdy = require('../../../spdy');
var constants = require('./').constants;
var utils = spdy.utils;
var base = spdy.protocol.base;
var util = require('util');
var Buffer = require('buffer').Buffer;

//
// ### function Parser (connection)
// #### @connection {spdy.Connection} connection
// SPDY protocol frames parser's @constructor
//
function Parser(connection) {
  base.Parser.call(this, connection);

  this.paused = false;
  this.buffer = [];
  this.buffered = 0;
  this.waiting = constants.PREFACE_SIZE;

  this.state = { type: 'preface' };
  this.socket = connection.socket;
  this.connection = connection;

  this.version = null;
  this.compress = null;
  this.decompress = null;

  this.connection = connection;
  this.maxFrameSize = constants.DEFAULT_MAX_FRAME_SIZE;
}
util.inherits(Parser, base.Parser);

//
// ### function create (connection)
// #### @connection {spdy.Connection} connection
// @constructor wrapper
//
parser.create = function create(connection) {
  return new Parser(connection);
};

//
// ### function execute (state, data, callback)
// #### @state {Object} Parser's state
// #### @data {Buffer} Incoming data
// #### @callback {Function} continuation callback
// Parse buffered data
//
Parser.prototype.execute = function execute(state, data, callback) {
  if (state.type === 'preface')
    return this.onPreface(state, data, callback);

  if (state.type === 'frame-head') {
    this.parseHeader(state, data, callback);
  } else if (state.type === 'frame-body') {
    var self = this;

    // Control frame
    this.parseBody(state.header, data, onFrame);

    function onFrame(err, frame) {
      if (err) return callback(err);

      self.emit('frame', frame);

      state.type = 'frame-head';
      callback(null, constants.FRAME_HEADER_SIZE);
    };
  }
};


//
// ### function onPreface (data, cb)
// ### @data {Buffer} incoming data
// ### @cb {Function} continuation
// Parses preface and moves the state machine forward
//
Parser.prototype.onPreface = function onPreface(state, data, cb) {
  if (data.toString() !== constants.PREFACE) {
    return cb(base.utils.error(constants.error.PROTOCOL_ERROR,
                               'Invalid preface'));
  }

  // Just some number, doesn't really matter for HTTP2
  this.setVersion('http2');

  // Parse frame header!
  state.type = 'frame-head';
  cb(null, constants.FRAME_HEADER_SIZE);
};


//
// ### function parseHeader (data)
// #### @state {Object} Parser's state
// ### @data {Buffer} incoming data
// ### @cb {Function} continuation
// Returns parsed SPDY frame header
//
Parser.prototype.parseHeader = function parseHeader(state, data, cb) {
  var header = {
    length: (data.readUInt16BE(0) << 8) | data.readUInt8(2),
    control: true,
    type: data.readUInt8(3),
    flags: data.readUInt8(4),
    id: data.readUInt32BE(5) & 0x7fffffff
  };

  if (header.length >= this.maxFrameSize) {
    return cb(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                               'Frame length OOB'));
  }

  header.control = header.type === constants.frameType.DATA;

  state.type = 'frame-body';
  state.header = header;

  cb(null, header.length);
};


//
// ### function execute (header, body, callback)
// #### @header {Object} Frame headers
// #### @body {Buffer} Frame's body
// #### @callback {Function} Continuation callback
// Parse frame (decompress data and create streams)
//
Parser.prototype.parseBody = function parseBody(header, body, callback) {
  var frameType = constants.frameType;

  if (header.type === frameType.DATA)
    this.parseData(header, body, callback);
  // Emulated SYN_STREAM or SYN_REPLY
  else if (header.type === frameType.HEADERS)
    this.parseHeaders(header, body, callback);
  // RST_STREAM
  else if (header.type === frameType.RST_STREAM)
    this.parseRst(body, callback);
  // SETTINGS
  else if (header.type === frameType.SETTINGS)
    this.parseSettings(header, body, callback);
  // GOAWAY
  else if (header.type === frameType.GOAWAY)
    this.parseGoaway(body, callback);
  // HEADERS
  else if (header.type === frameType.CONTINUATION)
    this.parseContinuation(body, callback);
  // WINDOW_UPDATE
  else if (header.type === frameType.WINDOW_UPDATE)
    this.parseWindowUpdate(header, body, callback);
  // X-FORWARDED
  else if (header.type === 0xf000)
    this.parseXForwarded(body, callback);
  else
    callback(null, { type: 'unknown: ' + header.type, body: body });
};


//
// ### function unpadData (header, body, callback)
// #### @header {Object} header data
// #### @body {Buffer} input data
// #### @callback {Function} continuation
//
Parser.prototype.unpadData = function unpadData(header, body, callback) {
  var isPadded = (header.flags & constants.flags.PADDED) !== 0;

  if (!isPadded)
    return body;

  body = this.unpadData(header, data);
  if (body.length < 1) {
    return callback(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                                     'Not enough space for padding'));
  }

  var pad = data.readUInt8(0);
  if (body.length <= pad + 1) {
    return callback(base.utils.error(constants.error.PROTOCOL_ERROR,
                                     'Invalid padding size'));
  }

  callback(null, body.slice(1, pad + 1));
};


//
// ### function parseData (header, flags, body)
// #### @header {Object} Header data
// #### @body {Buffer} input data
// #### @callback {Function} continuation
//
Parser.prototype.parseData = function parseData(header, body, callback) {
  var isEndStream = (header.flags & constants.flags.END_STREAM) !== 0;

  this.unpadData(header, body, function(err, data) {
    if (err)
      return callback(err);

    callback(null, {
      type: 'DATA',
      id: header.id,
      fin: isEndStream,
      compressed: false,
      data: data
    });
  });
};


//
// ### function parseHeaders (header, body, callback)
// #### @header {Object} header
// #### @body {Buffer} input data
// #### @callback {Function} continuation
// Returns parsed HEADERS frame
//
Parser.prototype.parseHeaders = function parseHeaders(header, body, callback) {
  var self = this;
  var stream = header.id % 2 === 1;

  this.unpadData(header, body, function(err, data) {
    if (err)
      return callback(err);

    var isPriority = (header.flags & constants.flags.PRIORITY) !== 0;
    var offset = 0;
    if (isPriority)
      offset = 5;

    if (data.length <= offset) {
      return callback(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                                       'Not enough data for HEADERS'));
    }

    var isExclusive = false;
    var dependentStream = 0;
    var weight = 0;
    if (offset !== 0) {
      dependentStream = body.readUInt32BE(0, true);
      isExclusive = (dependentStream >>> 31) !== 0;
      dependentStream &= 0x7fffffff;
      weight = body.readUInt8(4, true);
    }

    var headerBlock = body;
    if (offset !== 0)
      headerBlock = headerBlock.slice(offset);

    self.decompress(headerBlock, function(err, data) {
      if (err)
        return callback(err);

      console.log(data);
    });
  });
};


//
// ### function parseHeaders (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse CONTINUATION
//
Parser.prototype.parseContinuation = function parseContinuation(data, callback) {
  var offset = this.version === 2 ? 6 : 4;
  if (data.length < offset)
    return callback(new Error('HEADERS OOB'));

  var streamId = data.readUInt32BE(0, true) & 0x7fffffff;

  this.parseKVs(data.slice(offset), function(err, headers) {
    if (err)
      return callback(err);

    callback(null, {
      type: 'HEADERS',
      id: streamId,
      headers: headers
    });
  });
};


//
// ### function parseRst (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse RST
//
Parser.prototype.parseRst = function parseRst(data, callback) {
  if (data.length < 8)
    return callback(new Error('RST OOB'));

  callback(null, {
    type: 'RST_STREAM',
    id: data.readUInt32BE(0, true) & 0x7fffffff,
    status: data.readUInt32BE(4, true),
    extra: data.length > 8 ? data.slice(8) : null
  });
};


//
// ### function parseSettings (header, data, callback)
// #### @header {Object} header data
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse SETTINGS
//
Parser.prototype.parseSettings = function parseSettings(header, data, callback) {
  var isAck = (header.flags & constants.flags.ACK) !== 0;
  if (isAck && data.length !== 0) {
    return callback(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                                     'SETTINGS with ACK and non-zero length'));
  }

  if (isAck)
    return callback(null, { type: 'ACK_SETTINGS' });

  if (data.length % 6 !== 0) {
    return callback(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                                     'SETTINGS length not multiple of 6'));
  }

  var settings = {};
  for (var i = 0; i < data.length; i += 6) {
    var id = data.readUInt16BE(i, true);
    var value = data.readUInt32BE(i + 2, true);
    var name = constants.settingsIndex[id];

    settings[id] = {
      persist: false,
      persisted: false,
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


//
// ### function parseGoaway (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse PING
//
Parser.prototype.parsePing = function parsePing(body, callback) {
  if (body.length < 4)
    return callback(new Error('PING OOB'));
  callback(null, { type: 'PING', pingId: body.readUInt32BE(0, true) });
};


//
// ### function parseGoaway (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse GOAWAY
//
Parser.prototype.parseGoaway = function parseGoaway(data, callback) {
  if (data.length < 4)
    return callback(new Error('GOAWAY OOB'));

  callback(null, {
    type: 'GOAWAY',
    lastId: data.readUInt32BE(0, true) & 0x7fffffff
  });
};


//
// ### function parseWindowUpdate (header, data, callback)
// #### @header {Object} header data
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse WINDOW_UPDATE
//
Parser.prototype.parseWindowUpdate = function parseWindowUpdate(header,
                                                                data,
                                                                callback) {
  if (data.length !== 4) {
    return cb(base.utils.error(constants.error.FRAME_SIZE_ERROR,
                               'WINDOW_UPDATE length != 4'));
  }

  callback(null, {
    type: 'WINDOW_UPDATE',
    id: header.id,
    delta: data.readUInt32BE(0, true) & 0x7fffffff
  });
};


//
// ### function parseXForwarded (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse X_FORWARDED
//
Parser.prototype.parseXForwarded = function parseXForwarded(data, callback) {
  if (data.length < 4)
    return callback(new Error('X_FORWARDED OOB'));

  var len = data.readUInt32BE(0, true);
  if (len + 4 > data.length)
    return callback(new Error('X_FORWARDED host length OOB'));

  callback(null, {
    type: 'X_FORWARDED',
    host: data.slice(4, 4 + len).toString()
  });
};
