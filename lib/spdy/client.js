var spdy = require('../spdy');
var util = require('util');
var net = require('net');
var http = require('http');

var proto = {};

function instantiate(base) {
  function Agent(options) {
    Agent.call(this, options);

    if (!this.options.spdy)
      this.options.spdy = { version: 3 };

    var socket = base.prototype.createConnection.call(this, this.options);
    var connection = new Connection(socket, {
      options: this.options.spdy
    });
    connection.setVersion(this.options.spdy.version);

    this.spdyState = {
      socket: socket,
      connection: connection,
      id: 1
    };
  };
  util.inherits(Agent, base);

  return Agent;
};

//
// ### function createConnection (options)
//
proto.createConnection = function createConnection(options) {
  if (!options)
    options = {};

  var state = this.spdyState;
  var stream = new Stream(state.connection, {
    id: state.id,
    priority: options.priority || 0,
    client: true
  });
  state.id += 2;

  return stream;
};

//
// APIs
//
exports.Agent = instantiate(http.Agent);

//
// ### function create (options)
// #### @options {Object} Agent options
// Returns Agent instance
//
exports.create = function create(options) {
  return new exports.Agent(options);
};
