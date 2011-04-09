/**
 * SPDY server core
 */

var util = require('util'),
    net = require('net'),
    Buffer = require('buffer').Buffer;

var createParser = require('../spdy').createParser,
    createRequest = require('../spdy').createRequest,
    createResponse = require('../spdy').createResponse,
    createZLib = require('../spdy').createZLib,
    types = require('../spdy').types;

var core = exports;

/**
 * Class @constructor
 */
var Server = core.Server = function(requestListener) {
  process.EventEmitter.call(this);
  
  var that = this;
  this._server = net.createServer({}, function(c) {
    var parser = createParser(c);

    c.zlib = createZLib();

    parser.on('cframe', function(cframe) {
      if (cframe.headers.type == types.SYN_STREAM) {
        var req = createRequest(cframe),
            res = createResponse(cframe, c);

        that.emit('request', req, res);
      }
    });

    parser.on('dframe', function(dframe) {
      console.log(dframe);
    });

    c.on('end', function() {
    });

    c.on('error', function() {
    });
  });

  if (requestListener) {
    this.on('request', requestListener);
  }
};
util.inherits(Server, process.EventEmitter);

core.createServer = function(requestListener) {
  return new Server(requestListener);
};

/**
 * Wrapper for netServer listen
 */
Server.prototype.listen = function(port, host, callback) {
  this._server.listen(port, host, callback);
};

/**
 * Wrapper for netServer close
 */
Server.prototype.close = function() {
  this._server.close();
};

