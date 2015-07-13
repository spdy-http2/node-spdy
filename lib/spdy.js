'use strict';

var spdy = exports;

// Export tools
spdy.handle = require('./spdy/handle');
spdy.request = require('./spdy/request');
spdy.response = require('./spdy/response');

// Export client
spdy.agent = require('./spdy/agent');
spdy.Agent = spdy.agent;
spdy.createAgent = spdy.agent.create;

// Export server
spdy.server = require('./spdy/server');
spdy.Server = spdy.server;
spdy.createServer = spdy.server.create;
