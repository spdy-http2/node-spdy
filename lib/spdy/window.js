'use strict';

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

  this._refilling = false;
  this._refillQueue = [];
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

Side.prototype.update = function update(size, callback) {
  // Not enough space for the update, wait for refill
  if (size < 0 && callback && !this.has(-size)) {
    this._refillQueue.push({
      size: size,
      callback: callback
    });
    return;
  }

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

  this._processRefillQueue();

  if (callback)
    process.nextTick(callback);
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

Side.prototype.has = function has(size) {
  // If size is bigger than maximum amount - allow overflowing the window
  return this.current > size || this.max < size;
};

Side.prototype._processRefillQueue = function _processRefillQueue() {
  // Prevent recursion
  if (this._refilling)
    return;
  this._refilling = true;

  while (this._refillQueue.length > 0) {
    var item = this._refillQueue[0];

    if (!this.has(item.size))
      break;

    this.debug('refill queue shift size=%d', item.size);

    this._refillQueue.shift();
    item.callback();
  }

  this._refilling = false;
};
