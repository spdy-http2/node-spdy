'use strict';

var zlibpool = exports;
var zlib = require('zlib');

var spdy = require('../../../spdy');

function createDeflate(version, compression) {
  var deflate = zlib.createDeflate({
    dictionary: spdy.protocol.spdy.dictionary[version],
    flush: zlib.Z_SYNC_FLUSH,
    windowBits: 11,
    level: compression ? zlib.Z_DEFAULT_COMPRESSION : zlib.Z_NO_COMPRESSION
  });

  return deflate;
}

function createInflate(version) {
  var inflate = zlib.createInflate({
    dictionary: spdy.protocol.spdy.dictionary[version],
    flush: zlib.Z_SYNC_FLUSH,
    windowBits: 0
  });

  return inflate;
}

function Pool(compression) {
  this.compression = compression;
  this.pool = {
    2: [],
    3: [],
    3.1: []
  };
}

zlibpool.create = function create(compression) {
  return new Pool(compression);
};

Pool.prototype.get = function get(version) {
  if (this.pool[version].length > 0) {
    return this.pool[version].pop();
  } else {
    var id = version;

    return {
      version: version,
      compress: createDeflate(id, this.compression),
      decompress: createInflate(id)
    };
  }
};

Pool.prototype.put = function put(pair) {
  this.pool[pair.version].push(pair);
};
