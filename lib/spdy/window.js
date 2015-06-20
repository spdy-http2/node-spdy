var util = require('util');
var EventEmitter = require('events').EventEmitter;

function Window(options) {
  this.recv = new Side(options.recv, options.lowWaterMark)
  this.send = new Side(options.send, options.lowWaterMark)
}
module.exports = Window;

Window.prototype.clone = function clone() {
  return new Window({
    recv: this.recv.max,
    send: this.send.max,
    lowWaterMark: this.recv.watermark
  });
};

function Side(size, watermark) {
  EventEmitter.call(this);

  this.current = size;
  this.max = size;
  this.watermark = watermark;
}
util.inherits(Side, EventEmitter);

Side.prototype.setCurrent = function setCurrent(size) {
  this.current = size;
};

Side.prototype.update = function update(size) {
  this.current += size;

  // Time to send WINDOW_UPDATE
  if (size < 0 && this.isDrained())
    this.emit('drain');

  // Time to write
  if (size > 0 && this.current > 0)
    this.emit('full');
};

Side.prototype.getDelta = function getDelta() {
  return this.max - this.current;
};

Side.prototype.isDrained = function isDrained() {
  return this.current <= this.lowWaterMark;
};
