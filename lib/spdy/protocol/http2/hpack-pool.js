'use strict';

var spdy = require('../../../spdy');
var constants = require('./').constants;

var hpack = require('hpack.js');

function Pool() {
}
module.exports = Pool;

Pool.create = function create() {
  return new Pool();
};

Pool.prototype.get = function get(version) {
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

Pool.prototype.put = function put() {
};
