var spdy = require('../../../spdy');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

function Framer() {
  EventEmitter.call(this);

  this.version = null;
  this.compress = null;
  this.decompress = null;
  this.debug = false;
};
util.inherits(Framer, EventEmitter);
module.exports = Framer;

//
// ### function setCompression (compress, decompress)
// #### @compress {Deflate}
// #### @decompress {Inflate}
// Set framer compression
//
Framer.prototype.setCompression = function setCompresion(compress, decompress) {
  this.compress = spdy.utils.zwrap(compress);
  this.decompress = spdy.utils.zwrap(decompress);
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
