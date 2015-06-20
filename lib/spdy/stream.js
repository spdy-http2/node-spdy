'use strict';

var spdy = require('../spdy');
var utils = spdy.utils;

var assert = require('assert');
var util = require('util');
var httpCommon = require('_http_common');
var debug = {
  client: require('debug')('spdy:stream:client'),
  server: require('debug')('spdy:stream:server')
};
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
  state.isServer = state.connection.isServer();
  state.debug = state.isServer ? debug.server : debug.client;

  state.framer = connectionState.framer;
  state.parser = connectionState.parser;

  state.request = options.request;
  state.needResponse = options.request;
  state.window = connectionState.window.clone(options.id);

  this.id = options.id;
  this.method = options.method;
  this.path = options.path;
  this.host = options.host;
  this.headers = options.headers;

  this.on('emptying', this._onEmptying);
  this.on('finish', this._onFinish);
  this.on('end', this._onEnd);
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
  else if (frame.type === 'WINDOW_UPDATE')
    this._handleWindowUpdate(frame);

  if (frame.fin) {
    state.debug('id=%d end', this.id);
    this.push(null);
  }
};

Stream.prototype._write = function _write(data, enc, callback) {
  var state = this._spdyState;

  state.debug('id=%d send=%d', this.id, data.length);

  state.window.send.update(-data.length);
  state.framer.dataFrame({
    id: this.id,
    priority: state.priority,
    fin: false,
    data: data
  }, function(err) {
    if (err)
      return callback(err);

    if (state.window.send.isEmpty())
      state.window.send.once('full', callback);
    else
      callback();
  });
};

Stream.prototype._read = function _read() {
  var state = this._spdyState;

  // We push
  // TODO(indutny): move this to core, and get the event from them
  if (this._readableState.length >= this._readableState.highWaterMark)
    return;

  this.emit('emptying');
};

Stream.prototype._handleData = function _handleData(frame) {
  var state = this._spdyState;

  state.debug('id=%d recv=%d', this.id, frame.data.length);
  state.window.recv.update(-frame.data.length);

  this.push(frame.data);
};

Stream.prototype._handleRST = function _handleRST(frame) {
  this.emit('error', new Error('Got RST: ' + frame.code));
};

Stream.prototype._handleWindowUpdate = function _handleWindowUpdate(frame) {
  var state = this._spdyState;

  state.window.send.update(frame.delta);
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

  this._maybeClose();
};

Stream.prototype._onEnd = function _onEnd() {
  this._maybeClose();
};

Stream.prototype._maybeClose = function _maybeClose() {
  if (this._readableState.ended && this._writableState.finished)
    this.emit('close');
};

Stream.prototype._onEmptying = function _onEmptying() {
  var state = this._spdyState;

  if (!state.window.recv.isDraining())
    return;

  var delta = state.window.recv.getDelta();

  state.debug('stream id=%d window emptying, update by %d', this.id, delta);

  state.window.recv.update(delta);
  state.framer.windowUpdateFrame({
    id: this.id,
    delta: delta
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
