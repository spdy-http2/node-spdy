var zlibpool = exports,
    spdy = require('../../../spdy');

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
  return {
    version: version,

    // TODO(indutny): use hpack
    compress: spdy.utils.createDeflate(3, this.compression),
    decompress: spdy.utils.createInflate(3)
  };
};

//
// ### function put (pair)
// Puts pair into pool
//
Pool.prototype.put = function put(pair) {
};
