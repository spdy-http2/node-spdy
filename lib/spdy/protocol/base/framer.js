var spdy = require('../../../spdy');
var util = require('util');
var Readable = require('stream').Readable;

function Framer() {
  Readable.call(this);

  this.version = null;
  this.compress = null;
  this.decompress = null;
  this.debug = false;
};
util.inherits(Framer, Readable);
module.exports = Framer;

//
// ### function setCompression (compress, decompress)
// #### @compress {Deflate}
// #### @decompress {Inflate}
// Set framer compression
//
Framer.prototype.setCompression = function setCompresion(compress, decompress) {
  this.compress = compress;
  this.decompress = decompress;
};


//
// ### function setCompression (compress, decompress)
// #### @compress {Deflate}
// #### @decompress {Inflate}
// Set framer compression
//
Framer.prototype.setVersion = function setVersion(version) {
  this.version = version;
  this.emit('version');
};
