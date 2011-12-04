var spdy = exports;

// Exports utils
spdy.utils = require('./spdy/utils');

// Export parser&framer
spdy.parser = require('./spdy/parser');
spdy.framer = require('./spdy/framer');

// Export server
spdy.server = require('./spdy/server');
spdy.createServer = spdy.server.create;
