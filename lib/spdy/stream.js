'use strict';

var spdy = require('../spdy');
var utils = spdy.utils;

var assert = require('assert');
var util = require('util');
var httpCommon = require('_http_common');
var debug = require('debug')('spdy:stream');
var Buffer = require('buffer').Buffer;
var Duplex = require('stream').Duplex;

function Stream(connection, id) {
  Duplex.call(this);

  var connectionState = connection._spdyState;

  var state = {};
  this._spdyState = state;

  state.socket = null;

  state.id = id;
  state.priority = 0;
  state.connection = connection;
  state.version = state.connection.version;

  state.framer = connectionState.framer;
  state.parser = connectionState.parser;

  state.window = connectionState.window.clone();
  state.started = false;

  this.method = null;
  this.path = null;
  this.host = null;
  this.headers = null;
}
util.inherits(Stream, Duplex);
exports.Stream = Stream;

Stream.prototype._init = function _init(socket) {
  this.socket = socket;
};

Stream.prototype._handleFrame = function _handleFrame(frame) {
  var state = this._spdyState;

  if (frame.type === 'HEADERS' && !state.started)
    this._start(frame);
};

Stream.prototype._start = function _start(frame) {
  var state = this._spdyState;

  this.method = frame.headers[':method'];
  this.path = frame.path;
  this.host = frame.headers[':authority'];
  this.headers = frame.headers;

  state.started = true;
};
