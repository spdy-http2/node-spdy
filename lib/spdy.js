'use strict'
var origWarning = process.emitWarning;
process.emitWarning = function (...args) {
  if (args[2] !== 'DEP0066' && args[2] !== 'DEP0111') {
    // pass any other warnings through normally
    return origWarning.apply(process, args);
  }
};

var spdy = exports

// Export tools
spdy.handle = require('./spdy/handle')
spdy.request = require('./spdy/request')
spdy.response = require('./spdy/response')
spdy.Socket = require('./spdy/socket')

// Export client
spdy.agent = require('./spdy/agent')
spdy.Agent = spdy.agent.Agent
spdy.createAgent = spdy.agent.create

// Export server
spdy.server = require('./spdy/server')
spdy.Server = spdy.server.Server
spdy.PlainServer = spdy.server.PlainServer
spdy.createServer = spdy.server.create
