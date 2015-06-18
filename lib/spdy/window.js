var util = require('util');
var EventEmitter = require('events').EventEmitter;

function Window(options) {
  this.recv = new Side(options.recv, options.lowWaterMark)
  this.send = new Side(options.send, options.lowWaterMark)
}
module.exports = Window;

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
  this.size += size;

  // Time to send WINDOW_UPDATE
  if (size < 0 && this.size <= this.lowWaterMark)
    this.emit('drain');

  // Time to write
  if (size > 0 && this.size > 0)
    this.emit('full');
};

Side.prototype.getDelta = function getDelta() {
  return this.max - this.current;
};
