var assert = require('assert');

var spdy = require('../../');
var http2 = spdy.protocol.http2;

describe('HTTP2 Framer', function() {
  var framer;

  beforeEach(function() {
    var pool = http2.compressionPool.create();
    framer = http2.framer.create({});
    var comp = pool.get();
    framer.setCompression(comp.compress, comp.decompress);
  });
});
