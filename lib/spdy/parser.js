var parser = exports;

var spdy = require('../spdy'),
    util = require('util'),
    stream = require('stream'),
    Buffer = require('buffer').Buffer;

//
// ### function Parser (inflate, framer)
// #### @inflate {zlib.Inflate} Inflate stream
// #### @framer {spdy.Framer} Framer instance
// SPDY protocol frames parser's @constructor
//
function Parser(inflate, framer) {
  stream.Stream.call(this);

  this.paused = false;
  this.buffer = [];
  this.buffered = 0;
  this.waiting = 8;

  this.state = { type: 'frame-head' };
  this.inflate = inflate;
  this.framer = framer;

  this.readable = this.writable = true;
}
util.inherits(Parser, stream.Stream);

//
// ### function create (inflate, framer)
// #### @inflate {zlib.Inflate} Inflate stream
// #### @framer {spdy.Framer} Framer instance
// @constructor wrapper
//
parser.create = function create(inflate, framer) {
  return new Parser(inflate, framer);
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
  this.execute(this.state, buffer, function (err, waiting) {
    // And unpause once execution finished
    self.paused = false;
    self.emit('drain');

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
// ### function execute (state, data, callback)
// #### @state {Object} Parser's state
// #### @data {Buffer} Incoming data
// #### @callback {Function} continuation callback
// Parse buffered data
//
Parser.prototype.execute = function execute(state, data, callback) {
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

    this.framer.execute(state.header, data, function(err, frame) {
      if (err) return callback(err);

      self.emit('frame', frame);

      state.type = 'frame-head';
      callback(null, 8);
    });
  }
};
