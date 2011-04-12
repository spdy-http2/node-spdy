/**
 * Protocol Parser
 */

var Buffer = require('buffer').Buffer,
    Stream = require('stream').Stream,
    util = require('util');

var enums = require('../spdy').enums;

/**
 * Class @constructor
 */
var Parser = exports.Parser = function(zlib) {
  Stream.call(this);

  this.writable = this.readable = true;

  this.zlib = zlib;
  this.buffer = new Buffer(0);
};
util.inherits(Parser, Stream);

exports.createParser = function(zlib) {
  return new Parser(zlib);
};

/**
 * Bufferize written data
 */
Parser.prototype.write = function(chunk) {
  var buffer = new Buffer(this.buffer.length +
                          chunk.length);
  this.buffer.copy(buffer, 0);
  chunk.copy(buffer, this.buffer.length);

  this.buffer = buffer;

  this.parse();
};


/**
 * Parse buffered data
 */
Parser.prototype.parse = function() {
  var buffer = this.buffer;

  // Headers are at least 8 bytes
  if (buffer.length < 8) return;
  var len = (buffer[5] << 16) +
            (buffer[6] << 8) +
            buffer[7];

  // Buffered data less than packet
  if (buffer.length < (8 + len)) return;

  var headers = {
    c: ((buffer[0] & 128) >> 7) === 1,
    length: len
  };

  if (headers.c) {
    headers.version = ((buffer[0] & 127) << 8) + buffer[1];
    headers.type = (buffer[2] << 8) + buffer[3];
  } else {
    headers.streamID = (buffer[0] & 127 << 24) +
                       (buffer[1] << 16) +
                       (buffer[2] << 8) +
                       buffer[3];
  }
  
  headers.flags = buffer[4];
  
  var data = buffer.slice(8, 8 + headers.length);

  this.buffer = buffer.slice(8 + headers.length);

  if (headers.c) {
    if (headers.type === enums.SYN_STREAM) {
      var parsed = {
        streamID: ((data[0] & 127) << 24) +
                  (data[1] << 16) +
                  (data[2] << 8) +
                  data[3],
        assocStreamID: ((data[4] & 127) << 24) +
                       (data[5] << 16) +
                       (data[6] << 8) +
                       data[7],
        priority: (data[8] && 192) >> 6,
        nameValues: {}
      };
    }
    if (headers.type === enums.SYN_REPLY) {
      var parsed = {
        streamID: ((data[0] & 127) << 24) +
                  (data[1] << 16) +
                  (data[2] << 8) +
                  data[3],
        nameValues: {}
      };
    }
    if (headers.type === enums.RST_STREAM) {
      // TODO: Parse StreamID
      var parsed = {
        streamID: ((data[0] & 127) << 24) +
                  (data[1] << 16) +
                  (data[2] << 8) +
                  data[3],
        statusCode: (data[4] << 24) +
                    (data[5] << 16) +
                    (data[6] << 8) +
                    data[7]
      };
      data = parsed;
    }

    if (headers.type === enums.SYN_STREAM ||
        headers.type === enums.SYN_REPLY) {
      try {
        var offset = headers.type === enums.SYN_STREAM ? 10 : 6,
            nvs = this.zlib.inflate(data.slice(offset)),
            nvsCount = (nvs[0] << 8) + nvs[1];

        nvs = nvs.slice(2);
        while (nvsCount > 0) {
          var nameLen = (nvs[0] << 8) + nvs[1],
              name = nvs.slice(2, 2 + nameLen);
          nvs = nvs.slice(2 + nameLen);

          var valueLen = (nvs[0] << 8) + nvs[1],
              value = nvs.slice(2, 2 + valueLen);
          nvs = nvs.slice(2 + valueLen);

          parsed.nameValues[name.toString()] = value.toString();
          nvsCount --;
        }

        data = parsed;
      } catch(e) {
        this.emit('error', parsed.streamID);
        return;
      }
    }
  }

  this.emit(headers.c ? 'cframe' : 'dframe', {
    headers: headers,
    data: data
  });

  // Probably we have more data buffered - so continue
  process.nextTick(this.parse.bind(this));
};
