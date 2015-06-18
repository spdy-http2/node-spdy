'use strict';

var util = require('util');
var utils = require('./').utils;
var OffsetBuffer = require('obuf');
var Transform = require('stream').Transform;

function Parser(options) {
  Transform.call(this, {
    readableObjectMode: true
  });

  this.buffer = new OffsetBuffer();
  this.waiting = 0;

  this.window = options.window;

  this.version = null;
  this.decompress = null;
}
module.exports = Parser;
util.inherits(Parser, Transform);

Parser.prototype.error = utils.error;

Parser.prototype._transform = function transform(data, encoding, cb) {
  this.buffer.push(data);

  this._consume(cb);
};

Parser.prototype._consume = function _consume(cb) {
  // We shall not do anything until we get all expected data
  if (this.buffer.size < this.waiting)
    return cb();

  var self = this;
  var sync = true;

  var content = this.buffer.clone(this.waiting);
  this.buffer.skip(this.waiting);
  this.execute(content, function(err, frame) {
    if (err)
      return cb(err);

    if (frame)
      self.push(frame);

    // Consume more packets
    if (!sync)
      return self._consume(cb);

    process.nextTick(function() {
      self._consume(cb);
    });
  });
  sync = false;
};

Parser.prototype.setVersion = function setVersion(version) {
  this.version = version;
  this.emit('version', version);
};

Parser.prototype.setCompression = function setCompresion(pair) {
  this.decompress = pair.decompress;
};
