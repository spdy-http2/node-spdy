var spdy = exports;

// Exports utils
spdy.utils = require('./spdy/utils');

// Export parser&framer
spdy.protocol = {};

function loadProtocol(protocol) {
  try {
    return require('./spdy/protocol/' + protocol + '.node');
  } catch (e) {
    return require('./spdy/protocol/' + protocol + '.js');
  }
}
spdy.protocol.generic = loadProtocol('generic');

// Only SPDY v2 is supported now
spdy.protocol[2] = loadProtocol('v2');

spdy.parser = require('./spdy/parser');

// Export ServerResponse
spdy.response = require('./spdy/response');

// Export Scheduler
spdy.scheduler = require('./spdy/scheduler');

// Export ZlibPool
spdy.zlibpool = require('./spdy/zlib-pool');

// Export server
spdy.server = require('./spdy/server');
spdy.createServer = spdy.server.create;
