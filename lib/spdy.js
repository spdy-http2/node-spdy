var spdy = exports;

// Exports utils
spdy.utils = require('./spdy/utils');

// Export parser&framer
spdy.framer = require('./spdy/framer');
spdy.parser = require('./spdy/parser');

// Export ServerResponse
spdy.response = require('./spdy/response');

// Export server
spdy.server = require('./spdy/server');
spdy.createServer = spdy.server.create;
