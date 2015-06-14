var parser = exports;

var spdy = require('../../../spdy');
var constants = require('./constants');
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

  if (header.type === frameType.DATA) {
    this.parseData(header, body, callback);
  }
  // Emulated SYN_STREAM or SYN_REPLY
  if (header.type === frameType.HEADERS)
    this.parseSynHead(header, body, callback);
  // RST_STREAM
  else if (header.type === frameType.RST_STREAM)
    this.parseRst(body, callback);
  // SETTINGS
  else if (header.type === frameType.SETTINGS)
    this.parseSettings(header, body, callback);
  else if (header.type === 0x05)
    callback(null, { type: 'NOOP' });
  // PING
  else if (header.type === 0x06)
    this.parsePing(body, callback);
  // GOAWAY
  else if (header.type === 0x07)
    this.parseGoaway(body, callback);
  // HEADERS
  else if (header.type === 0x08)
    this.parseHeaders(body, callback);
  // WINDOW_UPDATE
  else if (header.type === 0x09)
    this.parseWindowUpdate(body, callback);
  // X-FORWARDED
  else if (header.type === 0xf000)
    this.parseXForwarded(body, callback);
  else
    callback(null, { type: 'unknown: ' + header.type, body: body });
};


//
// ### function parseData (type, flags, data)
// #### @type {Number} Frame type
// #### @flags {Number} Frame flags
// #### @data {Buffer} input data
//
Parser.prototype.parseData = function parseData(header, body, callback) {
  var isEndStream = (state.header.flags & constants.flags.END_STREAM) !== 0;
  var isPadded = (state.header.flags & constants.flags.PADDED) !== 0;

  var data = body;
  if (isPadded) {
    var pad = data.readUInt8(0);

    if (pad + 1 >= body.length) {
      return callback(base.utils.error(constants.error.PROTOCOL_ERROR,
                                       'Invalid padding size'));
    }

    data = body.slice(1, pad + 1);
  }

  return onFrame(null, {
    type: 'DATA',
    id: state.header.id,
    fin: isEndStream,
    compressed: false,
    data: data
  });
};


//
// ### function parseSynHead (header, data, callback)
// #### @header {Object} header
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Returns parsed syn_* frame's head
//
Parser.prototype.parseSynHead = function parseSynHead(header, data, callback) {
  var stream = type === 0x01;
  var offset = stream ? 10 : this.version === 2 ? 6 : 4;

  if (data.length < offset)
    return callback(new Error('SynHead OOB'));

  var kvs = data.slice(offset);
  this.parseKVs(kvs, function(err, headers) {
    if (err)
      return callback(err);

    if (stream === 'SYN_STREAM' &&
        (!headers.method || !(headers.path || headers.url))) {
      return callback(new Error('Missing `:method` and/or `:path` header'));
    }

    callback(null, {
      type: stream ? 'SYN_STREAM' : 'SYN_REPLY',
      id: data.readUInt32BE(0, true) & 0x7fffffff,
      associated: stream ? data.readUInt32BE(4, true) & 0x7fffffff : 0,
      priority: stream ? data[8] >> 5 : 0,
      fin: (flags & 0x01) === 0x01,
      unidir: (flags & 0x02) === 0x02,
      headers: headers,
      url: headers.path || headers.url || ''
    });
  });
};


//
// ### function parseHeaders (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse HEADERS
//
Parser.prototype.parseHeaders = function parseHeaders(data, callback) {
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
// ### function parseKVs (pairs, callback)
// #### @pairs {Buffer} header pairs
// #### @callback {Function} continuation
// Returns hashmap of parsed headers
//
Parser.prototype.parseKVs = function parseKVs(pairs, callback) {
  var self = this;
  this.decompress(pairs, function(err, chunks, length) {
    if (err)
      return callback(err);

    var pairs = Buffer.concat(chunks, length);

    var size = self.version === 2 ? 2 : 4;
    if (pairs.length < size)
      return callback(new Error('KV OOB'));

    var count = size === 2 ? pairs.readUInt16BE(0, true) :
                             pairs.readUInt32BE(0, true),
        headers = {};

    pairs = pairs.slice(size);

    function readString() {
      if (pairs.length < size)
        return null;
      var len = size === 2 ? pairs.readUInt16BE(0, true) :
                             pairs.readUInt32BE(0, true);

      if (pairs.length < size + len) {
        return null;
      }
      var value = pairs.slice(size, size + len);

      pairs = pairs.slice(size + len);

      return value.toString();
    }

    while(count > 0) {
      var key = readString(),
          value = readString();

      if (key === null || value === null)
        return callback(new Error('Headers OOB'));

      if (self.version >= 3)
        headers[key.replace(/^:/, '')] = value;
      else
        headers[key] = value;
      count--;
    }

    callback(null, headers);
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

  console.log(settings);
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
// ### function parseWindowUpdate (data, callback)
// #### @data {Buffer} input data
// #### @callback {Function} continuation
// Parse WINDOW_UPDATE
//
Parser.prototype.parseWindowUpdate = function parseWindowUpdate(data, callback) {
  if (data.length < 8)
    return callback(new Error('WINDOW_UPDATE OOB'));

  callback(null, {
    type: 'WINDOW_UPDATE',
    id: data.readUInt32BE(0, true) & 0x7fffffff,
    delta: data.readUInt32BE(4, true) & 0x7fffffff
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
