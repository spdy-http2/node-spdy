/**
 * SPDY server core
 */

var util = require('util'),
    tls = require('tls'),
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
var Server = core.Server = function(options, requestListener) {
  var that = this;

  if (!(this istance of Server)) return new Server(options, requestListener);

  tls.Server.call(this, options, function(c) {
    var parser = createParser(c);

    c.zlib = createZLib();

    parser.on('cframe', function(cframe) {
      if (cframe.headers.type == types.SYN_STREAM) {
        var req = createRequest(cframe),
            res = createResponse(cframe, c);

  
        that.emit('spdyRequest', req, res);
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
    this.on('spdyRequest', requestListener);
  }
};
util.inherits(Server, tls.Server);

core.createServer = function(options, requestListener) {
  return new Server(options, requestListener);
};

