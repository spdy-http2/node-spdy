var framer = exports;

var spdy = require('../spdy'),
    Buffer = require('buffer').Buffer;

//
// ### function execute (header, body, callback)
// #### @header {Object} Frame headers
// #### @body {Buffer} Frame's body
// #### @callback {Function} Continuation callback
// Parse frame (decompress data and create streams)
//
framer.execute = function execute(header, body, callback) {
  // SYN_STREAM or SYN_REPLY
  if (header.type === 0x01 || header.type === 0x02) {
    // Init compressors
    var syn_stream = header.type === 0x01,
        deflate = syn_stream && spdy.utils.createDeflate(),
        inflate = syn_stream && spdy.utils.createInflate(),

        id = body.readUInt32BE(0) & 0x7fffffff,
        associated = syn_stream ? body.readUInt32BE(4) & 0x7fffffff : 0,
        headers = {};

    var chunks = [],
        length = 0;
    inflate.on('data', function(chunk) {
      chunks.push(chunk);
      length += chunk.length;
    });

    inflate.write(body.slice(syn_stream ? 10 : 6));
    inflate.flush(function() {
      var pairs = new Buffer(length)
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
        deflate: deflate,
        inflate: inflate,
        id: id,
        associated: associated,
        headers: headers
      });
    });
  }
};
