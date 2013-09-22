var spdy = require('../../spdy');
var Buffer = require('buffer').Buffer;

function Framer(version, deflate, inflate) {
  this.version = version;
  this.deflate = spdy.utils.zwrap(deflate);
  this.inflate = spdy.utils.zwrap(inflate);
};
module.exports = Framer;

Framer.create = function create(version, deflate, inflate) {
  return new Framer(version, deflate, inflate);
};

//
// internal, converts object into spdy dictionary
//
Framer.prototype.headersToDict = function headersToDict(headers, preprocess) {
  function stringify(value) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        return value.join('\x00');
      } else if (typeof value === 'string') {
        return value;
      } else {
        return value.toString();
      }
    } else {
      return '';
    }
  }

  // Lower case of all headers keys
  var loweredHeaders = {};
  Object.keys(headers || {}).map(function(key) {
    loweredHeaders[key.toLowerCase()] = headers[key];
  });

  // Allow outer code to add custom headers or remove something
  if (preprocess) preprocess(loweredHeaders);

  // Transform object into kv pairs
  var size = this.version === 2 ? 2 : 4,
      len = size,
      pairs = Object.keys(loweredHeaders).filter(function(key) {
        var lkey = key.toLowerCase();
        return lkey !== 'connection' && lkey !== 'keep-alive' &&
               lkey !== 'proxy-connection' && lkey !== 'transfer-encoding';
      }).map(function(key) {
        var klen = Buffer.byteLength(key),
            value = stringify(loweredHeaders[key]),
            vlen = Buffer.byteLength(value);

        len += size * 2 + klen + vlen;
        return [klen, key, vlen, value];
      }),
      result = new Buffer(len);

  if (this.version === 2)
    result.writeUInt16BE(pairs.length, 0, true);
  else
    result.writeUInt32BE(pairs.length, 0, true);

  var offset = size;
  pairs.forEach(function(pair) {
    // Write key length
    if (this.version === 2)
      result.writeUInt16BE(pair[0], offset, true);
    else
      result.writeUInt32BE(pair[0], offset, true);
    // Write key
    result.write(pair[1], offset + size);

    offset += pair[0] + size;

    // Write value length
    if (this.version === 2)
      result.writeUInt16BE(pair[2], offset, true);
    else
      result.writeUInt32BE(pair[2], offset, true);
    // Write value
    result.write(pair[3], offset + size);

    offset += pair[2] + size;
  }, this);

  return result;
};

Framer.prototype._synFrame = function _synFrame(type,
                                                id,
                                                assoc,
                                                priority,
                                                dict,
                                                callback) {
  var self = this;

  // Compress headers
  this.deflate(dict, function (err, chunks, size) {
    if (err) return callback(err);

    var offset = type === 'SYN_STREAM' ? 18 : self.version === 2 ? 14 : 12,
        total = offset - 8 + size,
        frame = new Buffer(offset + size);

    // Control + Version
    frame.writeUInt16BE(0x8000 | self.version, 0, true);
    // Type
    frame.writeUInt16BE(type === 'SYN_STREAM' ? 1 : 2, 2, true);
    // Size
    frame.writeUInt32BE(total & 0x00ffffff, 4, true);
    // Stream ID
    frame.writeUInt32BE(id & 0x7fffffff, 8, true);

    if (type === 'SYN_STREAM') {
      // Unidirectional
      frame[4] = 2;

      // Associated Stream-ID
      frame.writeUInt32BE(assoc & 0x7fffffff, 12, true);

      // Priority
      var priorityValue;
      if (self.version === 2)
        priorityValue = Math.max(Math.min(priority, 3), 0) << 6;
      else
        priorityValue = Math.max(Math.min(priority, 7), 0) << 5;
      frame.writeUInt8(priorityValue, 16, true);
    }

    for (var i = 0; i < chunks.length; i++) {
      chunks[i].copy(frame, offset);
      offset += chunks[i].length;
    }

    callback(null, frame);
  });
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
  var self = this;
  var dict = this.headersToDict(headers, function(headers) {
    if (self.version === 2) {
      headers.status = code + ' ' + reason;
      headers.version = 'HTTP/1.1';
    } else {
      headers[':status'] = code + ' ' + reason;
      headers[':version'] = 'HTTP/1.1';
    }
  });

  this._synFrame('SYN_REPLY', id, null, 0, dict, callback);
};

//
// ### function streamFrame (id, assoc, headers, callback)
// #### @id {Number} stream id
// #### @assoc {Number} associated stream id
// #### @meta {Object} meta headers ( method, scheme, url, version )
// #### @headers {Object} stream headers
// #### @callback {Function} continuation callback
// Create SYN_STREAM frame
// (needed for server push and testing)
//
Framer.prototype.streamFrame = function streamFrame(id,
                                                    assoc,
                                                    meta,
                                                    headers,
                                                    callback) {
  var self = this;
  var dict = this.headersToDict(headers, function(headers) {
    if (self.version === 2) {
      headers.status = 200;
      headers.version = 'HTTP/1.1';
      headers.url = meta.url;
    } else {
      headers[':status'] = 200;
      headers[':version'] = meta.version || 'HTTP/1.1';
      headers[':path'] = meta.path;
      headers[':scheme'] = meta.scheme || 'https';
      headers[':host'] = meta.host;
    }
  });

  this._synFrame('SYN_STREAM', id, assoc, meta.priority, dict, callback);
};

//
// ### function dataFrame (id, fin, data)
// #### @id {Number} Stream id
// #### @fin {Bool} Is this data frame last frame
// #### @data {Buffer} Response data
// Sends DATA frame
//
Framer.prototype.dataFrame = function dataFrame(id, fin, data) {
  if (!fin && !data.length) return [];

  var frame = new Buffer(8 + data.length);

  frame.writeUInt32BE(id & 0x7fffffff, 0, true);
  frame.writeUInt32BE(data.length & 0x00ffffff, 4, true);
  frame.writeUInt8(fin ? 0x01 : 0x0, 4, true);

  if (data.length) data.copy(frame, 8);

  return frame;
};

//
// ### function pingFrame (id)
// #### @id {Buffer} Ping ID
// Sends PING frame
//
Framer.prototype.pingFrame = function pingFrame(id) {
  var header = new Buffer(12);

  // Version and type
  header.writeUInt32BE(0x80000006 | (this.version << 16), 0, true);
  // Length
  header.writeUInt32BE(0x00000004, 4, true);
  // ID
  id.copy(header, 8, 0, 4);

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

    // Version and type
    header.writeUInt32BE(0x80000003 | (this.version << 16), 0, true);
    // Length
    header.writeUInt32BE(0x00000008, 4, true);
    // Stream ID
    header.writeUInt32BE(id & 0x7fffffff, 8, true);
    // Status Code
    header.writeUInt32BE(code, 12, true);

    Framer.rstCache[code] = header;
  }

  return header;
};
Framer.rstCache = {};

//
// ### function settingsFrame (options)
// #### @options {Object} settings frame options
// Sends SETTINGS frame with MAX_CONCURRENT_STREAMS and initial window
//
Framer.prototype.settingsFrame = function settingsFrame(options) {
  var settings,
      key = this.version === 2 ? '2/' + options.maxStreams :
                                 '3/' + options.maxStreams + ':' +
                                     options.windowSize;

  if (!(settings = Framer.settingsCache[key])) {
    var params = [];
    if (this.version === 2) {
      params.push({ key: 4, value: options.maxStreams });
    } else {
      params.push({ key: 4, value: options.maxStreams });
      params.push({ key: 7, value: options.windowSize });
    }

    settings = new Buffer(12 + 8 * params.length);

    // Version and type
    settings.writeUInt32BE(0x80000004 | (this.version << 16), 0, true);
    // Length
    settings.writeUInt32BE((4 + 8 * params.length) & 0x00FFFFFF, 4, true);
    // Count of entries
    settings.writeUInt32BE(params.length, 8, true);

    var offset = 12;
    params.forEach(function(param) {
      if (this.version === 2)
        settings.writeUInt32LE(0x01000000 | param.key, offset, true);
      else
        settings.writeUInt32BE(0x01000000 | param.key, offset, true);
      offset += 4;
      settings.writeUInt32BE(param.value & 0x7fffffff, offset, true);
      offset += 4;
    }, this);

    Framer.settingsCache[key] = settings;
  }

  return settings;
};
Framer.settingsCache = {};

//
// ### function windowSizeFrame (size)
// #### @size {Number} data transfer window size
// Sends SETTINGS frame with window size
//
Framer.prototype.windowSizeFrame = function windowSizeFrame(size) {
  // Unreachable
  if (this.version === 2)
    return null;

  var settings;

  if (!(settings = Framer.windowSizeCache[size])) {
    settings = new Buffer(20);

    // Version and type
    settings.writeUInt32BE(0x80000004 | (this.version << 16), 0, true);
    // Length
    settings.writeUInt32BE((4 + 8) & 0x00FFFFFF, 4, true);
    // Count of entries
    settings.writeUInt32BE(0x00000001, 8, true);
    // Entry ID and Persist flag
    settings.writeUInt32BE(0x01000007, 12, true);
    // Window Size (KB)
    settings.writeUInt32BE(size & 0x7fffffff, 16, true);

    Framer.windowSizeCache[size] = settings;
  }

  return settings;
};
Framer.windowSizeCache = {};

//
// ### function windowUpdateFrame (id)
// #### @id {Buffer} WindowUpdate ID
// Sends WINDOW_UPDATE frame
//
Framer.prototype.windowUpdateFrame = function windowUpdateFrame(id, delta) {
  var header = new Buffer(16);

  // Version and type
  header.writeUInt32BE(0x80000009 | (this.version << 16), 0, true);
  // Length
  header.writeUInt32BE(0x00000008, 4, true);
  // ID
  header.writeUInt32BE(id & 0x7fffffff, 8, true);
  // Delta
  header.writeUInt32BE(delta & 0x7fffffff, 12, true);

  return header;
};
