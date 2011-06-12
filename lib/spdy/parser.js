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
  this.buffers = [];
};
util.inherits(Parser, Stream);

exports.createParser = function(zlib) {
  return new Parser(zlib);
};

/**
 * Bufferize written data
 */
Parser.prototype.write = function(chunk) {
  this.buffers.push(chunk);

  this.parse();
};

/**
 * Concatenates first N buffers to get chunk of `len` size
 */
Parser.prototype.concat = function(len) {
  var buffers = this.buffers,
      total = buffers.length,
      newSize = 0;

  for (var i = 0; i < total && newSize < len; i++) {
    newSize += buffers[i].length;
  }

  if (newSize < len) return new Buffer(0);

  if (i < total) i++;

  // In case that we already have a chunk of needed size
  // Just return it
  if (i == 1) return buffers[0];

  var result = new Buffer(newSize);
  for (var j = 0, offset = 0; offset < newSize && j < i; j++) {
    buffers[j].copy(result, offset);
    offset += buffers[j].length;
  }

  buffers = this.buffers = buffers.slice(i - 1);
  buffers[0] = result;

  return result;
};


/**
 * Parse buffered data
 */
Parser.prototype.parse = function() {
  var buffer = this.concat(8);

  // Headers are at least 8 bytes
  if (buffer.length < 8) return;

  var len = buffer.readUInt32(4, 'big') & 0xffffff;

  buffer = this.concat(8 + len);

  // Buffered data less than packet
  if (buffer.length < (8 + len)) return;

  var headers = {
    c: ((buffer[0] & 128) >> 7) === 1,
    length: len
  };

  if (headers.c) {
    headers.version = buffer.readUInt16(0, 'big') & 0x7fff;
    headers.type = buffer.readUInt16(2, 'big');
  } else {
    headers.streamID = buffer.readUInt32(0, 'big');
  }

  headers.flags = buffer[4];

  var data = buffer.slice(8, 8 + headers.length);

  this.buffers[0] = buffer.slice(8 + headers.length);
  if (!this.buffers[0].length) {
    this.buffers.shift();
  }

  if (headers.c) {
    if (headers.type === enums.SYN_STREAM) {
      var parsed = {
        streamID: data.readUInt32(0, 'big') & 0x7fffffff,
        assocStreamID: data.readUInt32(4, 'big') & 0x7fffffff,
        priority: (data[8] && 192) >> 6,
        nameValues: {}
      };
    }
    if (headers.type === enums.SYN_REPLY) {
      var parsed = {
        streamID: data.readUInt32(0, 'big') & 0x7fffffff,
        nameValues: {}
      };
    }
    if (headers.type === enums.RST_STREAM) {
      var parsed = {
        streamID: data.readUInt32(0, 'big') & 0x7fffffff,
        statusCode: data.readUInt32(4, 'big')
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

          var valueLen = nvs.readUInt16(0, 'big'),
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

/**
 * End of stream
 */
Parser.prototype.end = function() {};

Parser.prototype.destroy = function() {};
