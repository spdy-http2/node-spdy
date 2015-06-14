var zlibpool = exports;
var spdy = require('../../../spdy');
var constants = require('./').constants;

var hpack = require('hpack.js');

//
// ### function Pool (compression)
// #### @compression {Boolean} whether to enable compression
// Zlib streams pool
//
function Pool(compression) {
  this.compression = compression;
}

//
// ### function create (compression)
// #### @compression {Boolean} whether to enable compression
// Returns instance of Pool
//
zlibpool.create = function create(compression) {
  return new Pool(compression);
};

//
// ### function get ()
// Returns pair from pool or a new one
//
Pool.prototype.get = function get(version, callback) {
  var options = {
    table: {
      size: constants.HEADER_TABLE_SIZE
    }
  };

  var compress = hpack.compressor.create(options);
  var decompress = hpack.decompressor.create(options);

  spdy.utils.initZStream(compress);
  spdy.utils.initZStream(decompress);

  return {
    version: version,

    compress: compress,
    decompress: decompress
  };
};

//
// ### function put (pair)
// Puts pair into pool
//
Pool.prototype.put = function put(pair) {
};
