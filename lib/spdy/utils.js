var utils = exports;

var spdy = require('../spdy');
var zlib = require('zlib');
var Buffer = require('buffer').Buffer;

utils.isArgvParser = !/^v(0\.12|0\.11|0\.10|0\.8|0\.9)\./.test(process.version);

// TODO(indutny): remove this junk
utils.initZStream = function initZStream(stream) {
  stream.locked = false;
  stream.lockQueue = [];
};

//
// ### function createDeflate (version, compression)
// #### @version {Number} SPDY version
// #### @compression {Boolean} whether to enable compression
// Creates deflate stream with SPDY dictionary
//
utils.createDeflate = function createDeflate(version, compression) {
  var deflate = zlib.createDeflate({
    dictionary: spdy.protocol.spdy.dictionary[version],
    flush: zlib.Z_SYNC_FLUSH,
    windowBits: 11,
    level: compression ? zlib.Z_DEFAULT_COMPRESSION : zlib.Z_NO_COMPRESSION
  });

  // Define lock information early
  utils.initZStream(deflate);
  if (spdy.utils.isLegacy)
    deflate._flush = zlib.Z_SYNC_FLUSH;

  return utils.zwrap(deflate);
};

//
// ### function createInflate (version)
// #### @version {Number} SPDY version
// Creates inflate stream with SPDY dictionary
//
utils.createInflate = function createInflate(version) {
  var inflate = zlib.createInflate({
    dictionary: spdy.protocol.spdy.dictionary[version],
    flush: zlib.Z_SYNC_FLUSH,
    windowBits: 0
  });

  // Define lock information early
  utils.initZStream(inflate);
  if (spdy.utils.isLegacy)
    inflate._flush = zlib.Z_SYNC_FLUSH;

  return utils.zwrap(inflate);
};

//
// ### function resetZlibStream (wrap)
// #### @wrap {Object} stream wrap
// Resets zlib stream and associated locks
//
utils.resetZlibStream = function resetZlibStream(wrap, callback) {
  var stream = wrap.stream;
  if (stream.locked) {
    stream.lockQueue.push(function() {
      resetZlibStream(stream, callback);
    });
    return;
  }

  stream.reset();
  stream.lockQueue = [];

  callback(null);
};

// TODO(indutny): remove this thing and replace it with normal class

//
// ### function zstream (stream, buffer, callback)
// #### @stream {Deflate|Inflate} One of streams above
// #### @buffer {Buffer} Input data (to compress or to decompress)
// #### @callback {Function} Continuation to callback
// Compress/decompress data and pass it to callback
//
utils.zstream = function zstream(stream, buffer, callback) {
  var chunks = [],
      total = 0;

  if (stream.locked) {
    stream.lockQueue.push(function() {
      zstream(stream, buffer, callback);
    });
    return;
  }
  stream.locked = true;

  function collect(chunk) {
    chunks.push(chunk);
    total += chunk.length;
  }
  stream.on('data', collect);

  stream.write(buffer, done);

  function done() {
    stream.removeAllListeners('data');
    stream.removeAllListeners('error');

    if (callback)
      callback(null, chunks, total);

    stream.locked = false;
    var deferred = stream.lockQueue.shift();
    if (deferred)
      deferred();
  };

  stream.once('error', function(err) {
    stream.removeAllListeners('data');
    callback(err);
    callback = null;
  });
};

//
// ### function zwrap (stream)
// #### @stream {zlib.Stream} stream to wrap
// Wraps stream within function to allow simple deflate/inflate
//
utils.zwrap = function zwrap(stream) {
  var ret = function(data, callback) {
    utils.zstream(stream, data, callback);
  };
  ret.stream = stream;
  return ret;
};

if (typeof setImmediate === 'undefined')
  utils.nextTick = process.nextTick.bind(process);
else
  utils.nextTick = setImmediate;
