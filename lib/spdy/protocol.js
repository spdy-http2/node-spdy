/**
 * Protocol classes
 */

var Buffer = require('buffer').Buffer,
    enums = require('../spdy').enums;

/**
 * Create and return dataframe buffer
 */
exports.createDataFrame = function(zlib, headers, data) {
  if (headers.flags & enums.DATA_FLAG_COMPRESSED) {
    data = zlib.deflate(data);
  }

  var result = insertCommonData(headers, data, result);

  // Insert stream id
  result.writeUInt32(headers.streamID & 0x7fffffff, 0, 'big');
  return result;
};

/**
 * Create and return controlframe buffer
 */
var createControlFrame =
exports.createControlFrame = function(zlib, headers, data) {
  if (headers.type === enums.SYN_STREAM ||
      headers.type === enums.SYN_REPLY) {
    // Data is headers (ie name values)
    // Convert it and deflate
    data = nvsToBuffer(zlib, headers, data);
  }
  var result = insertCommonData(headers, data, result);

  // Default version is 2
  headers.version || (headers.version = 2);

  // Insert version
  result.writeUInt16(headers.version | 0x8000, 0, 'big');

  // Insert type
  result.writeUInt16(headers.type, 2, 'big');

  return result;
};

/**
 * Create RST_STREAM Frame from zlib, STREAM_ID and error code
 */
exports.createRstFrame = function(zlib, streamID, error) {
  return createControlFrame(zlib, {
    type: enums.RST_STREAM
  }, new Buffer([
    (streamID >> 24) & 127, (streamID >> 16) & 255,
    (streamID >> 8) & 255, streamID & 255,

    (error >> 24) & 255, (error >> 16) & 255,
    (error >> 8) & 255, error & 255
  ]));
};

/**
 * Create SETTINGS frame
 */
exports.createSettingsFrame = function(zlib, settings) {
  var keys = Object.keys(settings),
      keysLen = keys.length,
      buff = new Buffer(4 + 8 * keysLen);

  // Insert keys count
  buff.writeUInt32(keysLen, 0, 'big');

  keys.reduce(function(offset, key) {
    var raw_key = enums[key];

    buff.writeUInt32(raw_key, offset, 'big');

    var value = settings[key];
    buff.writeUInt32(value, offset + 4, 'big');

    return offset + 8;
  }, 4);

  return createControlFrame(zlib, {
    type: enums.SETTINGS
  }, buff);
};

/**
 * Create new buffer and insert common data for both control
 * and dataframe
 */
function insertCommonData(headers, data) {
  var result = new Buffer(8 + (data ? data.length : 0));

  // Insert flags
  result[4] = headers.flags & 255;

  // Insert length
  if (data) {
    result[5] = (data.length >> 16) & 255;
    result[6] = (data.length >> 8) & 255;
    result[7] = data.length & 255;
  } else {
    result[5] = result[6] = result[7] = 0;
  }

  // Insert data
  data.copy(result, 8);

  return result;
};

/**
 * Convert Name values to buffer (deflated)
 */
function nvsToBuffer(zlib, headers, nvs) {
  var streamID = headers.streamID,
      priority = headers.priority || 0,
      nvsCount = Object.keys(nvs).length,
      buffLen = Object.keys(nvs).filter(function(key) {
        return key && nvs[key];
      }).reduce(function(prev, key) {
        return prev + 4 + Buffer.byteLength(key) +
               Buffer.byteLength(nvs[key].toString());
      }, 2),
      buff = new Buffer(buffLen);

  // Insert nvs count
  buff.writeUInt16(nvsCount, 0, 'big');

  Object.keys(nvs).filter(function(key) {
    return key && nvs[key];
  }).reduce(function(prev, key) {
    var nameLen = Buffer.byteLength(key),
        valueLen = Buffer.byteLength(nvs[key].toString());

    buff.writeUInt16(nameLen, prev, 'big');
    buff.write(key.toString().toLowerCase(), prev + 2);

    prev += 2 + nameLen;

    buff.writeUInt16(valueLen, prev, 'big');
    buff.write(nvs[key].toString(), prev + 2);

    prev += 2 + valueLen;

    return prev;
  }, 2);

  var deflated = zlib.deflate(buff);

  if (headers.type === enums.SYN_STREAM) {
    var buff = new Buffer(10 + deflated.length),
        assocStreamID = headers.assocStreamID || 0;

    // Insert assocStreamID for SYN_STREAM
    buff.writeUInt32(assocStreamID & 0x7fffffff, 6, 'big');

    deflated.copy(buff, 10);
  } else {
    var buff = new Buffer(6 + deflated.length);
    deflated.copy(buff, 6);
  }

  // Insert streamID
  buff.writeUInt32(streamID & 0x7fffffff, 0, 'big');

  // Insert priority
  buff[4] = (priority & 3) << 6;
  buff[5] = 0;

  return buff;
};

