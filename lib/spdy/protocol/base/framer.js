'use strict';

var util = require('util');

var base = require('./');
var Scheduler = base.Scheduler;

function Framer(options) {
  Scheduler.call(this);

  this.version = null;
  this.compress = null;
  this.window = options.window;
}
util.inherits(Framer, Scheduler);
module.exports = Framer;

Framer.prototype.setVersion = function setVersion(version) {
  this.version = version;
  this.emit('version');
};

Framer.prototype.setCompression = function setCompresion(pair) {
  this.compress = pair.compress;
};
