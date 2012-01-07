var framer = exports;

var spdy = require('../spdy'),
    Buffer = require('buffer').Buffer;


//
// ### function Framer (inflate, deflate)
// #### @inflate {zlib.Inflate} Inflate stream
// #### @deflate {zlib.Deflate} Deflate stream
// Framer constructor
//
function Framer(inflate, deflate) {
  this.inflate = inflate;
  this.deflate = deflate;
};

//
// ### function create (inflate, deflate)
// #### @inflate {zlib.Inflate} Inflate stream
// #### @deflate {zlib.Deflate} Deflate stream
// Framer constructor wrapper
//
framer.create = function create(inflate, deflate) {
  return new Framer(inflate, deflate);
};

//
// ### function execute (header, body, callback)
// #### @header {Object} Frame headers
// #### @body {Buffer} Frame's body
// #### @callback {Function} Continuation callback
// Parse frame (decompress data and create streams)
//
Framer.prototype.execute = function execute(header, body, callback) {
  // Data frame
  if (!header.control) {
    return callback(null, {
      type: 'DATA',
      id: header.id,
      fin: (header.flags & 0x01) === 0x01,
      compressed: (header.flags & 0x02) === 0x02,
      data: body
    });
  }

  // SYN_STREAM or SYN_REPLY
  if (header.type === 0x01 || header.type === 0x02) {
    // Init compressors
    var syn_stream = header.type === 0x01,
        id = body.readUInt32BE(0) & 0x7fffffff,
        associated = syn_stream ? body.readUInt32BE(4) & 0x7fffffff : 0,
        headers = {};

    body = body.slice(syn_stream ? 10 : 6);
    spdy.utils.zstream(this.inflate, body, function(err, chunks, length) {
      var pairs = new Buffer(length);
      for (var i = 0, offset = 0; i < chunks.length; i++) {
        chunks[i].copy(pairs, offset);
        offset += chunks[i].length;
      }

      var count = pairs.readUInt16BE(0);
      pairs = pairs.slice(2);

      function readString() {
        var len = pairs.readUInt16BE(0),
            value = pairs.slice(2, 2 + len);

        pairs = pairs.slice(2 + len);

        return value.toString();
      }

      while(count > 0) {
        headers[readString()] = readString();
        count--;
      }

      callback(null, {
        type: syn_stream ? 'SYN_STREAM' : 'SYN_REPLY',
        id: id,
        associated: associated,
        headers: headers,

        fin: (header.flags & 0x01) === 0x01,
        unidir: (header.flags & 0x02) === 0x02
      });
    });
  // RST_STREAM
  } else if (header.type === 0x03) {
    callback(null, {
      type: 'RST_STREAM',
      id: body.readUInt32BE(0) & 0x7fffffff,
      status: body.readUInt32BE(4)
    });
  // SETTINGS
  } else if (header.type === 0x04) {
    callback(null, { type: 'SETTINGS' });
  } else if (header.type === 0x05) {
    callback(null, { type: 'NOOP' });
  // PING
  } else if (header.type === 0x06) {
    callback(null, { type: 'PING', pingId: body });
  } else if (header.type === 0x07) {
    callback(null, {
      type: 'GOAWAY',
      lastId: body.readUInt32BE(0) & 0x7fffffff
    });
  } else {
    callback(null, { type: 'unknown: ' + header.type, body: body });
  }
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
Framer.prototype.replyFrame = function replyFrame(id, code, reason, headers,
                                                  callback) {
  var self = this,
      pairs = headers || {},
      size = 2;

  pairs['status'] = code + ' ' + reason;
  pairs['version'] = 'HTTP/1.1';

  function stringify(value) {
    if (Array.isArray(value)) {
      return value.join('\0');
    } else if (value) {
      return value.toString();
    } else {
      return '';
    }
  };

  pairs = Object.keys(pairs).map(function (key) {
    var keySize = Buffer.byteLength(key),
        value = stringify(pairs[key]),
        valueSize = Buffer.byteLength(value);

    size += 2 + keySize + 2 + valueSize;

    return [keySize, key.toLowerCase(), valueSize, value];
  });

  var pairsBuf = new Buffer(size),
      offset = 2;

  pairsBuf.writeUInt16BE(pairs.length, 0);
  pairs.forEach(function (pair) {
    // Write sizes
    pairsBuf.writeUInt16BE(pair[0], offset);
    pairsBuf.writeUInt16BE(pair[2], offset + 2 + pair[0]);

    // Write values
    pairsBuf.write(pair[1], offset + 2);
    pairsBuf.write(pair[3], offset + 2 + pair[0] + 2);

    offset += 2 + pair[0] + 2 + pair[2];
  });

  // Compress headers
  spdy.utils.zstream(self.deflate, pairsBuf, function (err, chunks, size) {
    if (err) return callback(err);

    var header = new Buffer(14);
    header.writeUInt16BE(0x8002, 0); // Control + Version
    header.writeUInt16BE(0x0002, 2); // SYN_REPLY
    header.writeUInt32BE((size + 6) & 0x00ffffff, 4); // No flag support

    // Write body start
    header.writeUInt32BE(id & 0x7fffffff, 8); // Stream-ID
    header.writeUInt16BE(0, 12); // Unused

    callback(null, [header].concat(chunks));
  });
};

//
// ### function dataFrame (id, fin, data)
// #### @id {Number} Stream id
// #### @fin {Bool} Is this data frame last frame
// #### @data {Buffer} Response data
// Sends DATA frame
//
Framer.prototype.dataFrame = function dataFrame(id, fin, data) {
  if (!fin && data.length === 0) return [];
  var header = new Buffer(8);

  header.writeUInt32BE(id & 0x7fffffff, 0);
  header.writeUInt32BE(data.length & 0x00ffffff, 4);
  header.writeUInt8(fin ? 0x01 : 0x0, 4);

  return data.length > 0 ? [header, data] : [header];
};

//
// ### function pingFrame (id)
// #### @id {Buffer} Ping ID
// Sends PING frame
//
Framer.prototype.pingFrame = function pingFrame(id) {
  var header = new Buffer(12);

  header.writeUInt32BE(0x80020006, 0); // Version and type
  header.writeUInt32BE(0x00000004, 4); // Length
  id.copy(header, 8, 0, 4); // ID

  return header;
};

//
// ### function rstFrame (id, code)
// #### @id {Number} Stream ID
// #### @code {NUmber} RST Code
// Sends PING frame
//
Framer.prototype.rstFrame = function rstFrame(id, code) {
  var header;

  if (!(header = Framer.rstCache[code])) {
    header = new Buffer(16);

    header.writeUInt32BE(0x80020003, 0); // Version and type
    header.writeUInt32BE(0x00000008, 4); // Length
    header.writeUInt32BE(id & 0x7fffffff, 8); // Stream ID
    header.writeUInt32BE(code, 12); // Status Code

    Framer.rstCache[code] = header;
  }

  return header;
};
Framer.rstCache = {};

//
// ### function maxStreamsFrame (count)
// #### @count {Number} Max Concurrent Streams count
// Sends SETTINGS frame with MAX_CONCURRENT_STREAMS
//
Framer.prototype.maxStreamsFrame = function maxStreamsFrame(count) {
  var settings;

  if (!(settings = Framer.settingsCache[count])) {
    settings = new Buffer(20);

    settings.writeUInt32BE(0x80020004, 0); // Version and type
    settings.writeUInt32BE(0x0000000C, 4); // length
    settings.writeUInt32BE(0x00000001, 8); // Count of entries
    settings.writeUInt32LE(0x01000004, 12); // Entry ID and Persist flag
    settings.writeUInt32BE(count, 16); // 100 Streams

    Framer.settingsCache[count] = settings;
  }

  return settings;
};
Framer.settingsCache = {};
