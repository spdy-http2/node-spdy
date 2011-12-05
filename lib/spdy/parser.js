var parser = exports;

var spdy = require('../spdy'),
    util = require('util'),
    stream = require('stream'),
    Buffer = require('buffer').Buffer;

//
// ### function Parser (connection)
// #### @connection {Connection} SPDY connection
// SPDY protocol frames parser's @constructor
//
function Parser(connection) {
  stream.Stream.call(this);

  this.paused = false;
  this.buffer = [];
  this.buffered = 0;
  this.waiting = 8;

  this.state = { type: 'frame-head' };
  this.connection = connection;

  this.readable = this.writable = true;
}
util.inherits(Parser, stream.Stream);

//
// ### function create (connection)
// #### @connection {Connection} SPDY connection
// @constructor wrapper
//
parser.create = function create(connection) {
  return new Parser(connection);
};

//
// ### function write (data)
// #### @data {Buffer} chunk of data
// Writes or buffers data to parser
//
Parser.prototype.write = function write(data) {
  if (data !== undefined) {
    // Buffer data
    this.buffer.push(data);
    this.buffered += data.length;
  }

  // Notify caller about state (for piping)
  if (this.paused) return false;

  // We shall not do anything until we get all expected data
  if (this.buffered < this.waiting) return;

  var self = this,
      buffer = new Buffer(this.waiting),
      sliced = 0,
      offset = 0;

  while (this.buffered >= this.waiting && sliced < this.buffer.length) {
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
  this.execute(this.connection, this.state, buffer, function (err, waiting) {
    // And unpause once execution finished
    self.paused = false;

    // Propagate errors
    if (err) return self.emit('error', err);

    // Set new `waiting`
    self.waiting = waiting;

    if (self.waiting <= self.buffered) self.write();
  });
};

//
// ### function end ()
// Stream's end() implementation
//
Parser.prototype.end = function end() {
  this.emit('end');
};

//
// ### function execute (connection, state, data, callback)
// #### @connection {Connection} SPDY connection
// #### @state {Object} Parser's state
// #### @data {Buffer} Incoming data
// #### @callback {Function} continuation callback
// Parse buffered data
//
Parser.prototype.execute = function execute(connection, state, data, callback) {
  if (state.type === 'frame-head') {
    var header = state.header = {
      control: (data.readUInt8(0) & 0x80) === 0x80 ? true : false,
      version: null,
      type: null,
      id: null,
      flags: data.readUInt8(4),
      length: data.readUInt32BE(4) & 0x00ffffff
    };

    if (header.control) {
      header.version = data.readUInt16BE(0) & 0x7fff;
      header.type = data.readUInt16BE(2);
    } else {
      header.id = data.readUInt32BE(0) & 0x7fffffff;
    }

    state.type = 'frame-body';
    callback(null, header.length);
  } else if (state.type === 'frame-body') {
    var self = this;

    spdy.framer.execute(connection, state.header, data, function(err, frame) {
      if (err) return callback(err);

      self.emit('frame', frame);

      state.type = 'frame-head';
      callback(null, 8);
    });
  }
};
