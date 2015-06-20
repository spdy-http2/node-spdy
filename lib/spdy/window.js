var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = {
  server: require('debug')('spdy:window:server'),
  client: require('debug')('spdy:window:client')
};

function Window(options) {
  this.id = options.id;
  this.isServer = options.isServer;
  this.debug = this.isServer ? debug.server : debug.client;

  this.recv = new Side(this, 'recv', options.recv);
  this.send = new Side(this, 'send', options.send);
}
module.exports = Window;

Window.prototype.clone = function clone(id) {
  return new Window({
    id: id,
    isServer: this.isServer,
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

function Side(window, name, options) {
  EventEmitter.call(this);

  this.name = name;
  this.window = window;
  this.current = options.size;
  this.max = options.size;
  this.lowWaterMark = options.lowWaterMark;
}
util.inherits(Side, EventEmitter);

Side.prototype.setMax = function setMax(max) {
  this.max = max;
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

  this.window.debug('side=%s id=%d update by=%d [%d/%d]',
                    this.name,
                    this.window.id,
                    size,
                    this.current,
                    this.max);

  // Time to send WINDOW_UPDATE
  if (size < 0 && this.isDraining()) {
    this.window.debug('side=%s id=%d drained', this.name, this.window.id);
    this.emit('drain');
  }

  // Time to write
  if (size > 0 && this.current > 0 && this.current <= size) {
    this.window.debug('side=%s id=%d full', this.name, this.window.id);
    this.emit('full');
  }
};

Side.prototype.getDelta = function getDelta() {
  return this.max - this.current;
};

Side.prototype.isDraining = function isDraining() {
  return this.current <= this.lowWaterMark;
};

Side.prototype.isEmpty = function isEmpty() {
  return this.current <= 0;
};
