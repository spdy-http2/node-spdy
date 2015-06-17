'use strict';

var util = require('util');

var base = require('./');
var Scheduler = base.Scheduler;

function Framer() {
  Scheduler.call(this);

  this.version = null;
  this.compress = null;
  this.decompress = null;
  this.debug = false;
}
util.inherits(Framer, Scheduler);
module.exports = Framer;

Framer.prototype.setCompression = function setCompresion(compress, decompress) {
  this.compress = compress;
  this.decompress = decompress;
};

Framer.prototype.setVersion = function setVersion(version) {
  this.version = version;
  this.emit('version');
};
;
