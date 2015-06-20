var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('spdy:window');

function Window(options) {
  this.recv = new Side('recv', options.recv);
  this.send = new Side('send', options.send);
}
module.exports = Window;

Window.prototype.clone = function clone() {
  return new Window({
    recv: {
      size: this.recv.max,
      lowWaterMark: this.recv.lowWaterMark
    },
    send: {
      size: this.send.max,
      lowWaterMark: this.send.lowWaterMark
    }
  });
};

function Side(name, options) {
  EventEmitter.call(this);

  this.name = name;
  this.current = options.size;
  this.max = options.size;
  this.lowWaterMark = options.lowWaterMark;
}
util.inherits(Side, EventEmitter);

Side.prototype.setCurrent = function setCurrent(current) {
  this.current = current;
};

Side.prototype.updateMax = function updateMax(max) {
  var delta = max - this.max;
  this.update(delta);
};

Side.prototype.setLowWaterMark = function setLowWaterMark(lwm) {
  this.lowWaterMark = lwm;
};

Side.prototype.update = function update(size) {
  this.current += size;

  debug('side=%s update by=%d current=%d', this.name, size, this.current);

  // Time to send WINDOW_UPDATE
  if (size < 0 && this.isDrained()) {
    debug('side=%s drained', this.name);
    this.emit('drain');
  }

  // Time to write
  if (size > 0 && this.current > 0) {
    debug('side=%s full', this.name);
    this.emit('full');
  }
};

Side.prototype.getDelta = function getDelta() {
  return this.max - this.current;
};

Side.prototype.isDrained = function isDrained() {
  return this.current <= this.lowWaterMark;
};
