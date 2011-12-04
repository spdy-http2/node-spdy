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

  // Init streams list
  this.streams = {};

  // Initialize parser
  this.parser = spdy.parser.create();
  this.parser.on('frame', function (frame) {
    if (frame.type === 'SYN_STREAM') {
      self.emit('stream', self.streams[frame.id] = new Stream(frame));
    } else {
    }
  });

  // Store socket and pipe it to parser
  this.socket = socket;
  this.socket.pipe(this.parser);
}
util.inherits(Connection, process.EventEmitter);

//
// ### function Stream (frame)
// #### @frame {Object} SYN_STREAM data
// Abstract stream @constructor
//
function Stream(frame) {
  var self = this;
  stream.Stream.call(this);

  // Store id
  this.id = frame.id;

  // Create compression streams
  this.deflate = frame.deflate;
  this.inflate = frame.inflate;

  var headers = frame.headers;
  process.nextTick(function () {
    var req = [headers.method + ' ' + headers.url + ' ' + headers.version];

    // Remove internal headers
    delete headers.method;
    delete headers.url;
    delete headers.version;
    delete headers.scheme;

    Object.keys(headers).forEach(function (key) {
      req.push(key + ': ' + headers[key]);
    });

    req.push('', '');

    req = new Buffer(req.join('\r\n'));

    self.ondata(req, 0, req.length);
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
// ### function write (data, encoding)
// #### @data {Buffer} data
// #### @encoding {String} data encoding
// Writes data to connection
//
Stream.prototype.write = function write(data, encoding) {
};
