/**
 * SPDY server core
 */

var util = require('util'),
    tls = require('tls'),
    Buffer = require('buffer').Buffer;

var createParser = require('../spdy').createParser,
    createRequest = require('../spdy').createRequest,
    createResponse = require('../spdy').createResponse,
    createRstFrame = require('../spdy').createRstFrame,
    createZLib = require('../spdy').createZLib,
    enums = require('../spdy').enums;

var core = exports;

/**
 * Class @constructor
 */
var Server = core.Server = function(options, requestListener) {
  var that = this;

  if (!(this instanceof Server)) return new Server(options, requestListener);

  tls.Server.call(this, options, function(c) {
    var parser = createParser(c);

    c.zlib = createZLib();

    parser.on('cframe', function(cframe) {
      if (cframe.headers.type == enums.SYN_STREAM) {
        var req = createRequest(cframe),
            res = createResponse(cframe, c);

  
        that.emit('spdyRequest', req, res);
      }
    });

    parser.on('dframe', function(dframe) {
      console.log(dframe);
    });

    parser.on('error', function(stream_id) {
      // Send RST_STREAM
      if (stream_id) {
        c.write(createRstFrame(c.zlib, stream_id, enums.PROTOCOL_ERROR));
      }
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
