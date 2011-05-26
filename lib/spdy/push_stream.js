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
  this.associatedStreamId = cframe.data.streamID;
  this.c = c;

  this._headers = {
  };
  this._written = false;

  // For stream.pipe and others
  this.writable = true;
};
util.inherits(PushStream, stream.Stream);

exports.createPushStream = function(cframe, c) {
  return new PushStream(cframe, c);
};

