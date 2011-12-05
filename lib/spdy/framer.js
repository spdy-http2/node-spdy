var framer = exports;

var spdy = require('../spdy'),
    Buffer = require('buffer').Buffer;

//
// ### function execute (connection, header, body, callback)
// #### @connection {Connection} SPDY connection
// #### @header {Object} Frame headers
// #### @body {Buffer} Frame's body
// #### @callback {Function} Continuation callback
// Parse frame (decompress data and create streams)
//
framer.execute = function execute(connection, header, body, callback) {
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
        inflate = connection.inflate,
        id = body.readUInt32BE(0) & 0x7fffffff,
        associated = syn_stream ? body.readUInt32BE(4) & 0x7fffffff : 0,
        headers = {};

    body = body.slice(syn_stream ? 10 : 6);
    spdy.utils.zstream(inflate, body, function(err, chunks, length) {
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
  } else {
    callback(null, { type: 'unknown: ' + header.type, body: body });
  }
};

//
// ### function sendSynReply (stream, code, reason, headers)
// #### @stream {Stream} SPDY Stream
// #### @code {Number} HTTP Status Code
// #### @reason {String} (optional)
// #### @headers {Object|Array} (optional) HTTP headers
// Sends SYN_REPLY frame
//
framer.sendSynReply = function (stream, code, reason, headers) {
  var pairs = headers || {},
      size = 2;

  pairs['status'] = code + ' ' + reason;
  pairs['version'] = 'HTTP/1.1';

  pairs = Object.keys(pairs).map(function (key) {
    var keySize = Buffer.byteLength(key),
        value = (pairs[key] || '').toString(),
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

  stream.lock(function() {
    // Compress headers
    spdy.utils.zstream(stream.deflate, pairsBuf, function (err, chunks, size) {
      var header = new Buffer(14);
      header.writeUInt16BE(0x8002, 0); // Control + Version
      header.writeUInt16BE(0x0002, 2); // SYN_REPLY
      header.writeUInt32BE((size + 6) & 0x00ffffff, 4); // No flag support

      // Write body start
      header.writeUInt32BE(stream.id & 0x7fffffff, 8); // Stream-ID
      header.writeUInt16BE(0, 12); // Unused

      stream.connection.write(header);

      // Write body end
      chunks.forEach(function(chunk) {
        stream.connection.write(chunk);
      });

      stream.unlock();
    });
  });
};

//
// ### function sendData (stream, fin, data)
// #### @stream {Stream} SPDY Stream
// #### @fin {Bool} Is this data frame last frame
// #### @data {Buffer} Response data
// Sends DATA frame
//
framer.sendData = function (stream, fin, data) {
  if (!fin && data.length === 0) return;
  stream.lock(function() {
    var header = new Buffer(8);

    header.writeUInt32BE(stream.id & 0x7fffffff, 0);
    header.writeUInt32BE(data.length & 0x00ffffff, 4);
    header.writeUInt8(fin ? 0x01 : 0x0, 4);

    stream.connection.write(header);
    if (data.length > 0) stream.connection.write(data);

    if (fin) stream.close();

    stream.unlock();
  });
};

//
// ### function sendPing (stream, id)
// #### @connection {Connection} SPDY Connection
// #### @id {Buffer} Ping ID
// Sends PING frame
//
framer.sendPing = function (connection, id) {
  var header = new Buffer(12);

  header.writeUInt32BE(0x80020006, 0); // Version and type
  header.writeUInt32BE(0x00000004, 4); // Length
  id.copy(header, 8, 0, 4); // ID

  connection.write(header);
};
