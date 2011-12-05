var spdy = require('../spdy'),
    util = require('util'),
    https = require('https'),
    stream = require('stream'),
    Buffer = require('buffer').Buffer;

//
// ### function Server (options, requestListener)
// #### @options {Object} tls server options
// #### @requestListener {Function} (optional) request callback
// SPDY Server @constructor
//
function Server(options, requestListener) {
  https.Server.call(this, options, requestListener);

  // Wrap connection handler
  var self = this,
      connectionHandler = this.listeners('secureConnection')[0];

  this.removeAllListeners('secureConnection');
  this.on('secureConnection', function secureConnection(socket) {
    // Wrap incoming socket into abstract class
    var connection = new Connection(socket);

    // Emulate each stream like connection
    connection.on('stream', connectionHandler);

    // Fallback to regular https if parser failed
    connection.once('fallback', function () {
      connectionHandler(socket);
    });

    connection.on('request', function(req, res) {
      res.writeHead = spdy.response.writeHead;
      req.streamID = req.socket.id;
      res.on('finish', function() {
        req.connection.end();
      });
      self.emit('request', req, res);
    });
  });
}
util.inherits(Server, https.Server);

//
// ### function create (options, requestListener)
// #### @options {Object} tls server options
// #### @requestListener {Function} (optional) request callback
// @constructor wrapper
//
exports.create = function create(options, requestListener) {
  return new Server(options, requestListener);
};

//
// ### function Connection (socket)
// #### @socket {net.Socket} server's connection
// Abstract connection @constructor
//
function Connection(socket) {
  process.EventEmitter.call(this);

  var self = this;

  this.deflate = spdy.utils.createDeflate();
  this.inflate = spdy.utils.createInflate();

  // Init streams list
  this.streams = {};

  // Initialize parser
  this.parser = spdy.parser.create(this);
  this.parser.on('frame', function (frame) {
    var stream;

    // Create new stream
    if (frame.type === 'SYN_STREAM') {
      stream = self.streams[frame.id] = new Stream(self, frame);
      self.emit('stream', stream);
    } else {
      if (frame.id) {
        // Load created one
        stream = self.streams[frame.id];

        // Fail if not found
        if (stream === undefined) {
          return self.emit('error', 'Stream ' + frame.id + ' not found');
        }
      }

      // Emit 'data' event
      if (frame.type === 'DATA') {
        if (frame.data.length > 0) {
          stream.ondata(frame.data, 0, frame.data.length);
          stream.emit('data', frame.data);
        }
      // Destroy stream if we was asked to do this
      } else if (frame.type === 'RST_STREAM') {
        stream.destroy(frame.status);
      // Respond with same PING
      } else if (frame.type === 'PING') {
        spdy.framer.sendPing(self, frame.pingId);
      } else {
        console.error('Unknown type: ', frame.type);
      }
    }

    // Handle half-closed
    if (frame.fin) {
      // Don't allow to close stream twice
      if (stream.halfClosed) {
        return self.emit('stream:error', stream.id, 'Already half-closed');
      }
      stream.halfClosed = true;
      stream.emit('end');
    }
  });

  this.locked = false;
  this.lockBuffer = [];

  // Store socket and pipe it to parser
  this.socket = socket;
  this.socket.pipe(this.parser);
}
util.inherits(Connection, process.EventEmitter);

//
// ### function lock (callback)
// #### @callback {Function} continuation callback
// Acquire lock
//
Connection.prototype.lock = function lock(callback) {
  if (!callback) return;

  if (this.locked) {
    this.lockBuffer.push(callback);
  } else {
    this.locked = true;
    callback(null);
  }
};

//
// ### function unlock ()
// Release lock and call all buffered callbacks
//
Connection.prototype.unlock = function unlock() {
  if (this.locked) {
    this.locked = false;
    this.lock(this.lockBuffer.shift());
  }
};

//
// ### function write (data, encoding)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// Writes data to socket
//
Connection.prototype.write = function write(data, encoding) {
  this.socket.write(data, encoding);
};

//
// ### function Stream (frame)
// #### @connection {Connection} SPDY Connection
// #### @frame {Object} SYN_STREAM data
// Abstract stream @constructor
//
function Stream(connection, frame) {
  var self = this;
  stream.Stream.call(this);

  this.connection = connection;

  this.ondata = this.onend = null;

  // Store id
  this.id = frame.id;

  // Create compression streams
  this.deflate = connection.deflate;
  this.inflate = connection.inflate;

  var headers = frame.headers;

  process.nextTick(function () {
    var req = [headers.method + ' ' + headers.url + ' ' + headers.version];

    Object.keys(headers).forEach(function (key) {
      if (key !== 'method' && key !== 'url' && key !== 'version' &&
          key !== 'scheme') {
        req.push(key + ': ' + headers[key]);
      }
    });

    // Add '\r\n\r\n'
    req.push('', '');

    req = new Buffer(req.join('\r\n'));

    self.ondata(req, 0, req.length);
    self.emit('data', req);
  });

  this.readable = this.writable = true;
}
util.inherits(Stream, stream.Stream);

//
// ### function setTimeout ()
// TODO: use timers.enroll, timers.active, timers.unenroll
//
Stream.prototype.setTimeout = function setTimeout(time) {};

//
// ### function close ()
// Destroys stream
//
Stream.prototype.close = function close() {
  this.destroy();
};

//
// ### function destroy (error)
// #### @error {Error} (optional) error
// Destroys stream
//
Stream.prototype.destroy = function destroy(error) {
  delete this.connection.streams[this.id];
  this.emit('error', error);
};

//
// ### function write (data, encoding)
// #### @data {Buffer|String} data
// #### @encoding {String} data encoding
// Writes data to connection
//
Stream.prototype.write = function write(data, encoding) {
  // Send DATA
  if (typeof data === 'string') {
    data = new Buffer(data, encoding);
  }
  spdy.framer.sendData(this, false, data);
};

//
// ### function end ()
// Send FIN data frame
//
Stream.prototype.end = function end() {
  spdy.framer.sendData(this, true, new Buffer(0));
};
