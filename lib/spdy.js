'use strict';

var spdy = exports;

// Exports utils
spdy.utils = require('./spdy/utils');

// Export parser&framer
spdy.protocol = {};
spdy.protocol.base = require('./spdy/protocol/base');
spdy.protocol.spdy = require('./spdy/protocol/spdy');
spdy.protocol.http2 = require('./spdy/protocol/http2');

// Export ServerResponse
spdy.response = require('./spdy/response');

// Export Scheduler
spdy.scheduler = require('./spdy/scheduler');

// Export Connection and Stream
spdy.Stream = require('./spdy/stream').Stream;
spdy.Connection = require('./spdy/connection').Connection;

// Export server
spdy.server = require('./spdy/server');
spdy.Server = spdy.server.Server;
spdy.createServer = spdy.server.create;

// Export client
spdy.Agent = require('./spdy/client').Agent;
spdy.createAgent = require('./spdy/client').create;
