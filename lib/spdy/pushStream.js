/**
 * PushStream class
 */

var Buffer = require('buffer').Buffer,
    util = require('util'),
    stream = require('stream'),
    enums = require('../spdy').enums,
    createControlFrame = require('../spdy').createControlFrame,
    createDataFrame = require('../spdy').createDataFrame,
    createParser = require('../spdy').createParser;

/**
 * Class constructor
 */
var PushStream = exports.PushStream = function(cframe, c) {
  stream.Stream.call(this);
  this.streamID = 2; // TODO auto-increment even numbers per: http://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft2#TOC-Stream-creation

  this.associatedStreamId = cframe.data.streamID;
  this.c = c;

  this._headers = {
    foo: "bar"
  };
};
util.inherits(PushStream, stream.Stream);

exports.createPushStream = function(cframe, c) {
  return new PushStream(cframe, c);
};

/**
 * Initiate SYN_STREAM
 */
PushStream.prototype.writeHead = function(code, reasonPhrase, headers) {
  // TODO: I *think* this should only be built inside this class
  throw new Error("PushStream#writeHead invoked externally");
};

/**
 * Write data
 */
PushStream.prototype.write = function(data, encoding) {
  return this._write(data, encoding, false);
};

/**
 * Write any data (Internal)
 */
PushStream.prototype._write = function(data, encoding, fin) {
  throw new Error("Please implement");
};

/**
 * End stream
 */
PushStream.prototype.end = function(data, encoding) {
  this.writable = false;
  return this._write(data, encoding, true);
};

/**
 * Mirroring node.js default API
 */
PushStream.prototype.setHeader = function(name, value) {
  throw new Error("Not implemented for push stream");
};

/**
 * Mirroring node.js default API
 */
PushStream.prototype.getHeader = function(name) {
  throw new Error("Not implemented for push stream");
};

/**
 * Cloning node.js default API
 */
PushStream.prototype.removeHeader = function(name) {
  throw new Error("Not implemented for push stream");
};
