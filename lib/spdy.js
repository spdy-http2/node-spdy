var spdy = exports;

// Export tools
spdy.handle = require('./spdy/handle');
spdy.response = require('./spdy/response');

// Export server
spdy.server = require('./spdy/server');
spdy.Server = spdy.server;
spdy.createServer = spdy.server.create;
