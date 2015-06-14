var zlibpool = exports;
var spdy = require('../../../spdy');

//
// ### function Pool (compression)
// #### @compression {Boolean} whether to enable compression
// Zlib streams pool
//
function Pool(compression) {
  this.compression = compression;
  this.pool = {
    'spdy/2': [],
    'spdy/3': [],
    'spdy/3.1': []
  };
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
  if (this.pool[version].length > 0) {
    return this.pool[version].pop();
  } else {
    var id = version.split('/', 2)[1];

    return {
      version: version,
      compress: spdy.utils.createDeflate(id, this.compression),
      decompress: spdy.utils.createInflate(id)
    };
  }
};

//
// ### function put (pair)
// Puts pair into pool
//
Pool.prototype.put = function put(pair) {
  var self = this,
      waiting = 2;

  spdy.utils.resetZlibStream(pair.decompress, done);
  spdy.utils.resetZlibStream(pair.compress, done);

  function done() {
    if (--waiting === 0)
      self.pool[pair.version].push(pair);
  }
};
