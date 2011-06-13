/**
 * SPDY server implementation
 */

var spdy = exports;

/**
 * zlib wrapper
 */
spdy.ZLib = require('./spdy/zlib').ZLib;
spdy.createZLib = require('./spdy/zlib').createZLib;

/**
 * enums
 */
spdy.enums = require('./spdy/enums').enums;

/**
 * protocol
 */
spdy.createControlFrame = require('./spdy/protocol').createControlFrame;
spdy.createRstFrame = require('./spdy/protocol').createRstFrame;
spdy.createSettingsFrame = require('./spdy/protocol').createSettingsFrame;
spdy.createDataFrame = require('./spdy/protocol').createDataFrame;

/**
 * parser
 */
spdy.createParser = require('./spdy/parser').createParser;
spdy.Parser = require('./spdy/parser').Parser;

/**
 * request
 */
spdy.Request = require('./spdy/request').Request;
spdy.createRequest = require('./spdy/request').createRequest;

/**
 * push stream
 */
spdy.PushStream = require('./spdy/push_stream').PushStream;
spdy.createPushStream = require('./spdy/push_stream').createPushStream;

/**
 * response
 */
spdy.Response = require('./spdy/response').Response;
spdy.createResponse = require('./spdy/response').createResponse;

/**
 * core
 */
spdy.createServer = require('./spdy/core').createServer;
spdy.Server = require('./spdy/core').Server;

