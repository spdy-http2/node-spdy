'use strict';

var spdy = require('../spdy');
var utils = spdy.utils;

var assert = require('assert');
var util = require('util');
var httpCommon = require('_http_common');
var debug = require('debug')('spdy:stream');
var Buffer = require('buffer').Buffer;
var Duplex = require('stream').Duplex;

function Stream(connection, options) {
  Duplex.call(this);

  var connectionState = connection._spdyState;

  var state = {};
  this._spdyState = state;

  state.socket = null;
  state.protocol = connectionState.protocol;
  state.constants = state.protocol.constants;

  // TODO(indutny): fill priority
  state.priority = 0;
  state.connection = connection;
  state.version = state.connection.version;

  state.framer = connectionState.framer;
  state.parser = connectionState.parser;

  state.request = options.request;
  state.needResponse = options.request;
  state.window = connectionState.window.clone();

  this.id = options.id;
  this.method = options.method;
  this.path = options.path;
  this.host = options.host;
  this.headers = options.headers;

  this.on('finish', this._onFinish);
}
util.inherits(Stream, Duplex);
exports.Stream = Stream;

Stream.prototype._init = function _init(socket) {
  this.socket = socket;
};

Stream.prototype._handleFrame = function _handleFrame(frame) {
  var state = this._spdyState;

  if (frame.type == 'DATA')
    this._handleData(frame);
  else if (frame.type == 'HEADERS')
    this._handleHeaders(frame);
  else if (frame.type === 'RST')
    this._handleRST(frame);

  if (frame.fin)
    this.push(null);
};

Stream.prototype._write = function _write(data, enc, callback) {
  var state = this._spdyState;

  state.window.send.update(-data.length);
  state.framer.dataFrame({
    id: this.id,
    priority: state.priority,
    fin: false,
    data: data
  }, function(err) {
    if (err)
      return callback(err);

    if (state.window.send.isDrained())
      state.window.send.once('full', callback);
    else
      callback();
  });
};

Stream.prototype._read = function _read() {
  // We push
};

Stream.prototype._handleData = function _handleData(frame) {
  var state = this._spdyState;

  state.window.recv.update(-frame.data.length);

  this.push(frame.data);
};

Stream.prototype._handleRST = function _handleRST(frame) {
  this.emit('error', new Error('Got RST: ' + frame.code));
};

Stream.prototype._handleHeaders = function _handleHeaders(frame) {
  var state = this._spdyState;

  if (state.needResponse)
    return this._handleResponse(frame);

  // TODO(indutny): support trailers
};

Stream.prototype._handleResponse = function _handleResponse(frame) {
  var state = this._spdyState;

  if (frame.headers[':status'] === undefined) {
    state.framer.rstFrame({ id: this.id, code: 'PROTOCOL_ERROR' });
    return;
  }

  state.needResponse = false;
  this.emit('response', frame.headers[':status'], frame.headers);
};

Stream.prototype._onFinish = function _onFinish() {
  var state = this._spdyState;

  state.framer.dataFrame({
    id: this.id,
    priority: state.priority,
    fin: true,
    data: new Buffer(0)
  });
};

// Public API

Stream.prototype.respond = function respond(status, headers, callback) {
  var state = this._spdyState;
  assert(!state.request, 'Can\'t respond on request');

  state.framer.responseFrame({
    id: this.id,
    status: status,
    headers: headers
  }, callback);
};
