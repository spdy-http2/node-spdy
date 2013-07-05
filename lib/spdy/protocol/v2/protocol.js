var protocol = exports;

//
// ### function parseSynHead (type, flags, data)
// #### @type {Number} Frame type
// #### @flags {Number} Frame flags
// #### @data {Buffer} input data
// Returns parsed syn_* frame's head
//
protocol.parseSynHead = function parseSynHead(type, flags, data, callback) {
  var stream = type === 0x01;

  if (data.length < (stream ? 10 : 6)) {
    return callback(new Error('SynHead OOB'));
  }

  callback(null, {
    type: stream ? 'SYN_STREAM' : 'SYN_REPLY',
    id: data.readUInt32BE(0, true) & 0x7fffffff,
    version: 2,
    associated: stream ? data.readUInt32BE(4, true) & 0x7fffffff : 0,
    priority: stream ? data[8] >> 6 : 0,
    fin: (flags & 0x01) === 0x01,
    unidir: (flags & 0x02) === 0x02,
    _offset: stream ? 10 : 6
  });
};

//
// ### function parseHeaders (pairs)
// #### @pairs {Buffer} header pairs
// Returns hashmap of parsed headers
//
protocol.parseHeaders = function parseHeaders(pairs, callback) {
  var count = pairs.readUInt16BE(0, true),
      headers = {};

  pairs = pairs.slice(2);

  function readString() {
    if (pairs.length < 2) {
      return null;
    }
    var len = pairs.readUInt16BE(0, true);

    if (pairs.length < 2 + len) {
      return null;
    }
    var value = pairs.slice(2, 2 + len);

    pairs = pairs.slice(2 + len);

    return value.toString();
  }

  while(count > 0) {
    var key = readString(),
        value = readString();
    if (key === null || value === null) {
      return callback(new Error('Headers OOB'));
    }
    headers[key] = value;
    count--;
  }

  callback(null, headers);
};

//
// ### function parsesRst frame
protocol.parseRst = function parseRst(data, callback) {
  if (data.length < 8) return callback(new Error('RST OOB'));

  callback(null, {
    type: 'RST_STREAM',
    id: data.readUInt32BE(0, true) & 0x7fffffff,
    status: data.readUInt32BE(4, true)
  });
};

protocol.parseGoaway = function parseGoaway(data, callback) {
  if (data.length < 4) return callback(new Error('GOAWAY OOB'));

  callback(null, {
    type: 'GOAWAY',
    lastId: data.readUInt32BE(0, true) & 0x7fffffff
  });
};
