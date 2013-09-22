var spdy = exports;

// Exports utils
spdy.utils = require('./spdy/utils');

// Export parser&framer
spdy.protocol = require('./spdy/protocol');

// Export ServerResponse
spdy.response = require('./spdy/response');

// Export Scheduler
spdy.scheduler = require('./spdy/scheduler');

// Export ZlibPool
spdy.zlibpool = require('./spdy/zlib-pool');

// Export server
spdy.server = require('./spdy/server');
spdy.createServer = spdy.server.create;
