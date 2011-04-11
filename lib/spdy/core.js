/**
 * SPDY server core
 */

var util = require('util'),
    tls = require('tls'),
    http = require('http'),
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
    if (c.npnProtocol != 'spdy/2') {
      // Fallback on regular https
      http._connectionListener.apply(this, arguments);
      return;
    }

    var parser = createParser(c),
        streams = [];

    c.zlib = createZLib();

    parser.on('cframe', function(cframe) {
      if (cframe.headers.type == enums.SYN_STREAM) {
        var req = createRequest(cframe),
            res = createResponse(cframe, c);

        streams[cframe.data.streamID] = {
          req: req,
          res: res
        };
        that.emit('request', req, res);

        // If request has no body - emit 'end' immediately
        if (cframe.headers.flags & enums.CONTROL_FLAG_FIN) {
          req._end(true);
        }

        // On any error send RST frame
        req.on('error', function() {
          c.write(createRstFrame(c.zlib, cframe.data.streamID,
                                 enums.PROTOCOL_ERROR));
        });
      }
    });

    // Parse request body
    parser.on('dframe', function(dframe) {
      var stream;
      if (stream = streams[dframe.headers.streamID]) {
        stream.req._handleDframe(dframe);
        if (dframe.headers.flags & enums.DATA_FLAG_FIN) {
          stream.req._end();
        }
      }
    });

    parser.on('error', function(streamID) {
      // Send RST_STREAM
      if (stream_id) {
        c.write(createRstFrame(c.zlib, streamID, enums.PROTOCOL_ERROR));
        streams[stream_id] = undefined;
      }
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
util.inherits(Server, tls.Server);

core.createServer = function(options, requestListener) {
  return new Server(options, requestListener);
};
