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
    createSettingsFrame = require('../spdy').createSettingsFrame,
    createZLib = require('../spdy').createZLib,
    enums = require('../spdy').enums;

var core = exports;

/**
 * Class @constructor
 */
var Server = core.Server = function(options, requestListener) {
  var that = this,
      connectionSettings = options.connectionSettings || {
        SETTINGS_MAX_CONCURRENT_STREAMS: 100
      };

  if (!(this instanceof Server)) return new Server(options, requestListener);

  tls.Server.call(this, options, function(c) {
    if (tls.hasNPN && c.npnProtocol != 'spdy/2' && !options.debug) {
      // Fallback on regular https
      http._connectionListener.apply(this, arguments);
      return;
    }

    var parser = createParser(c),
        streams = [];

    c.zlib = createZLib();
  
    // Send settings
    c.write(createSettingsFrame(c.zlib, connectionSettings));

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
      } else if (cframe.headers.type == enums.RST_STREAM) {
        streams[cframe.data.streamID] = undefined;
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
      } else {
        console.log('frame from hell', dframe);
      }
    });

    parser.on('error', function(streamID) {
      // Send RST_STREAM
      if (streamID) {
        c.write(createRstFrame(c.zlib, streamID, enums.PROTOCOL_ERROR));
        streams[streamID] = undefined;
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
