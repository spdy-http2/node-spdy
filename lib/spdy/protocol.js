/**
 * Protocol classes
 */

var Buffer = require('buffer').Buffer,
    types = require('../spdy').types;

/**
 * Create and return dataframe buffer
 */
exports.createDataFrame = function(headers, data) {
  var result = insertCommonData(headers, data, result);

  // Insert stream id
  result[0] = (headers.streamID >> 24) & 127;
  result[1] = (headers.streamID >> 16) & 255;
  result[2] = (headers.streamID >> 8) & 255;
  result[3] = headers.streamID & 255;

  return result;
};

/**
 * Create and return controlframe buffer
 */
exports.createControlFrame = function(zlib, headers, data) {
  if (headers.type == types.SYN_STREAM ||
      headers.type == types.SYN_REPLY) {
    // Data is headers (ie name values)
    // Convert it and deflate
    data = nvsToBuffer(zlib, headers, data);
  }
  var result = insertCommonData(headers, data, result);

  // Default version is 2
  headers.version || (headers.version = 2);

  // Insert version
  result[0] = 128 | ((headers.version >> 8) & 255);
  result[1] = headers.version & 255;

  // Insert type
  result[2] = (headers.type >> 8) & 255;
  result[3] = headers.type & 255;

  return result;
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
  buff[0] = (nvsCount >> 8) & 255;
  buff[1] = nvsCount & 255;

  Object.keys(nvs).filter(function(key) {
    return key && nvs[key];
  }).reduce(function(prev, key) {
    var nameLen = Buffer.byteLength(key),
        valueLen = Buffer.byteLength(nvs[key].toString());

    buff[prev] = (nameLen >> 8) & 255;
    buff[prev + 1] = nameLen & 255;
    buff.write(key, prev + 2);

    prev += 2 + nameLen;

    buff[prev] = (valueLen >> 8) & 255;
    buff[prev + 1] = valueLen & 255;
    buff.write(nvs[key].toString(), prev + 2);

    prev += 2 + valueLen;

    return prev;
  }, 2);

  var deflated = zlib.deflate(buff);

  if (headers.type == types.SYN_STREAM) {
    var buff = new Buffer(10 + deflated.length),
        assocStreamID = headers.assocStreamID || 0;

    // Insert assocStreamID for SYN_STREAM
    buff[6] = (assocStreamID >> 24) & 127;
    buff[7] = (assocStreamID >> 16) & 255;
    buff[8] = (assocStreamID >> 8) & 255;
    buff[9] = assocStreamID & 255;

    deflated.copy(buff, 10);
  } else {
    var buff = new Buffer(6 + deflated.length);
    deflated.copy(buff, 6);
  }

  // Insert streamID
  buff[0] = (streamID >> 24) & 127;
  buff[1] = (streamID >> 16) & 255;
  buff[2] = (streamID >> 8) & 255;
  buff[3] = streamID & 255;

  // Insert priority
  buff[4] = (priority & 3) << 6;
  buff[5] = 0;

  return buff;
};

