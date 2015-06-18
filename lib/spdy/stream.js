'use strict';

var spdy = require('../spdy');
var zlib = require('zlib');
var utils = spdy.utils;
var assert = require('assert');
var util = require('util');
var stream = require('stream');
var debug = require('debug')('spdy:stream');
var Buffer = require('buffer').Buffer;
var Duplex = require('stream').Duplex;

function Stream() {
  Duplex.call(this);
}
util.inherits(Stream, Duplex);
exports.Stream = Stream;

function StreamSink() {
  Duplex.call(this);
}
util.inherits(StreamSink, Duplex);

//
// `net` compatibility layer
// (Copy pasted from lib/tls.js from node.js)
//
Stream.prototype.address = function address() {
  return this.socket && this.socket.address();
};

Stream.prototype.__defineGetter__('remoteAddress', function remoteAddress() {
  return this.socket && this.socket.remoteAddress;
});

Stream.prototype.__defineGetter__('remotePort', function remotePort() {
  return this.socket && this.socket.remotePort;
});

Stream.prototype.setNoDelay = function setNoDelay(enable) {
  return this.socket && this.socket.setNoDelay(enable);
};

Stream.prototype.setKeepAlive = function(setting, msecs) {
  return this.socket && this.socket.setKeepAlive(setting, msecs);
};

Stream.prototype.getPeerCertificate = function() {
  return this.socket && this.socket.getPeerCertificate();
};

Stream.prototype.getSession = function() {
  return this.socket && this.socket.getSession();
};

Stream.prototype.isSessionReused = function() {
  return this.socket && this.socket.isSessionReused();
};

Stream.prototype.getCipher = function() {
  return this.socket && this.socket.getCipher();
};
