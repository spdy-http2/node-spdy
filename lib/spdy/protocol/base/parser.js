var spdy = require('../../../spdy');
var utils = spdy.utils;
var util = require('util');
var stream = require('stream');
var Buffer = require('buffer').Buffer;

var legacy = !stream.Duplex;

if (legacy) {
  var DuplexStream = stream;
} else {
  var DuplexStream = stream.Duplex;
}

//
// ### function Parser (connection)
// #### @connection {spdy.Connection} connection
// SPDY protocol frames parser's @constructor
//
function Parser(connection) {
  DuplexStream.call(this);

  this.paused = false;
  this.buffer = [];
  this.buffered = 0;
  this.waiting = 8;

  this.socket = connection.socket;
  this.connection = connection;

  this.version = null;
  this.compress = null;
  this.decompress = null;

  this.connection = connection;

  if (legacy)
    this.readable = this.writable = true;
}
module.exports = Parser;
util.inherits(Parser, DuplexStream);

//
// ### function destroy ()
// Just a stub.
//
Parser.prototype.destroy = function destroy() {
};

//
// ### function _write (data, encoding, cb)
// #### @data {Buffer} chunk of data
// #### @encoding {Null} encoding
// #### @cb {Function} callback
// Writes or buffers data to parser
//
Parser.prototype._write = function write(data, encoding, cb) {
  // Legacy compatibility
  if (!cb) cb = function() {};

  if (data !== undefined) {
    // Buffer data
    this.buffer.push(data);
    this.buffered += data.length;
  }

  // Notify caller about state (for piping)
  if (this.paused) {
    this.needDrain = true;
    cb();
    return false;
  }

  // We shall not do anything until we get all expected data
  if (this.buffered < this.waiting) {
    if (this.needDrain) {
      // Mark parser as drained
      this.needDrain = false;
      this.emit('drain');
    }

    cb();
    return;
  }

  var self = this,
      buffer = new Buffer(this.waiting),
      sliced = 0,
      offset = 0;

  while (this.waiting > offset && sliced < this.buffer.length) {
    var chunk = this.buffer[sliced++],
        overmatched = false;

    // Copy chunk into `buffer`
    if (chunk.length > this.waiting - offset) {
      chunk.copy(buffer, offset, 0, this.waiting - offset);

      this.buffer[--sliced] = chunk.slice(this.waiting - offset);
      this.buffered += this.buffer[sliced].length;

      overmatched = true;
    } else {
      chunk.copy(buffer, offset);
    }

    // Move offset and decrease amount of buffered data
    offset += chunk.length;
    this.buffered -= chunk.length;

    if (overmatched) break;
  }

  // Remove used buffers
  this.buffer = this.buffer.slice(sliced);

  // Executed parser for buffered data
  this.paused = true;
  var sync = true;
  this.execute(this.state, buffer, function (err, waiting) {
    // Propagate errors
    if (err) {
      // And unpause once execution finished
      self.paused = false;

      cb();
      return self.emit('error', err);
    }

    // Set new `waiting`
    self.waiting = waiting;

    if (sync) {
      utils.nextTick(function() {
        // Unpause right before entering new `_write()` call
        self.paused = false;
        self._write(undefined, null, cb);
      });
    } else {
      // Unpause right before entering new `_write()` call
      self.paused = false;
      self._write(undefined, null, cb);
    }
  });
  sync = false;
};

if (legacy) {
  //
  // ### function write (data, encoding, cb)
  // #### @data {Buffer} chunk of data
  // #### @encoding {Null} encoding
  // #### @cb {Function} callback
  // Legacy method
  //
  Parser.prototype.write = Parser.prototype._write;

  //
  // ### function end ()
  // Stream's end() implementation
  //
  Parser.prototype.end = function end() {
    this.emit('end');
  };
}

//
// ### function setVersion (version)
// #### @version {Number} Protocol version
// Set protocol version to use
//
Parser.prototype.setVersion = function setVersion(version) {
  this.version = version;
  this.emit('version', version);
  this.compress = spdy.utils.zwrap(this.connection._spdyState.compress);
  this.decompress = spdy.utils.zwrap(this.connection._spdyState.decompress);
};
