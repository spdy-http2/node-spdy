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

  this._written = false;

  // For stream.pipe and others
  this.writable = true;
};
util.inherits(PushStream, stream.Stream);

exports.createPushStream = function(cframe, c) {
  return new PushStream(cframe, c);
};

/**
 * Initiate SYN_STREAM
 */
Response.prototype.writeHead = function(code, reasonPhrase, headers) {
  // TODO: I *think* this should only be built inside this class
  throw new Error("PushStream#writeHead invoked externally");
};

/**
 * Write data
 */
Response.prototype.write = function(data, encoding) {
  return this._write(data, encoding, false);
};

/**
 * Write any data (Internal)
 */
Response.prototype._write = function(data, encoding, fin) {
  throw new Error("Please implement");
};

/**
 * End stream
 */
Response.prototype.end = function(data, encoding) {
  this.writable = false;
  return this._write(data, encoding, true);
};

/**
 * Mirroring node.js default API
 */
Response.prototype.setHeader = function(name, value) {
  throw new Error("Not implemented for push stream");
};

/**
 * Mirroring node.js default API
 */
Response.prototype.getHeader = function(name) {
  throw new Error("Not implemented for push stream");
};

/**
 * Cloning node.js default API
 */
Response.prototype.removeHeader = function(name) {
  throw new Error("Not implemented for push stream");
};
