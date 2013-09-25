var spdy = require('../spdy');
var assert = require('assert');
var util = require('util');
var net = require('net');
var https = require('https');
var EventEmitter = require('events').EventEmitter;

var proto = {};

function instantiate(base) {
  function Agent(options) {
    base.call(this, options);

    if (!this.options.spdy)
      this.options.spdy = {};

    // Find super's `createConnection` method
    var createConnection;
    var cons = base;
    do {
      createConnection = cons.prototype.createConnection;

      if (cons.super_ === EventEmitter || !cons.super_)
        break;
      cons = cons.super_;
    } while (!createConnection);

    if (!createConnection)
      createConnection = this.createConnection || net.createConnection;

    // TODO(indutny): Think about falling back to http/https
    var socket = createConnection.call(this, util._extend({
      NPNProtocols: ['spdy/2', 'spdy/3']
    }, this.options));
    var connection = new spdy.Connection(socket, {
      options: this.options.spdy
    });

    if (this.options.spdy.ssl !== false) {
      // SSL, wait for NPN to happen
      socket.once('secureConnect', function() {
        if (socket.npnProtocol === 'spdy/2')
          connection._setVersion(2);
        else if (socket.npnProtocol === 'spdy/3')
          connection._setVersion(3);
        else
          socket.emit('error', new Error('No supported SPDY version'));
      });
    } else {
      // No SSL, use fixed version
      connection._setVersion(this.options.spdy.version || 3);
    }

    this._spdyState = {
      isServer: false,
      socket: socket,
      connection: connection,
      id: 1
    };

    // Hack for node.js v0.10
    this.createConnection = Agent.prototype.createConnection;
  };
  util.inherits(Agent, base);

  // Copy prototype methods
  Object.keys(proto).forEach(function(key) {
    this[key] = proto[key];
  }, Agent.prototype);

  return Agent;
};

//
// ### function createConnection (options)
//
proto.createConnection = function createConnection(options) {
  if (!options)
    options = {};

  var state = this._spdyState;
  var stream = new spdy.Stream(state.connection, {
    id: state.id,
    priority: options.priority || 7,
    client: true
  });
  state.id += 2;

  return stream;
};

//
// ### function close (callback)
// #### @callback {Function}
// Close underlying socket and terminate all streams
//
proto.close = function close(callback) {
  this._spdyState.socket.destroy();
  if (callback)
    this._spdyState.socket.once('close', callback);
};

//
// Default Agent
//
exports.Agent = instantiate(https.Agent);

//
// ### function create (base, options)
// #### @base {Function} (optional) base server class (https.Server)
// #### @options {Object} tls server options
// @constructor wrapper
//
exports.create = function create(base, options) {
  var agent;
  if (typeof base === 'function') {
    agent = instantiate(base);
  } else {
    agent = exports.Agent;

    options = base;
    base = null;
  }

  // Instantiate http server if `ssl: false`
  if (!base && options && options.plain && options.ssl === false)
    return exports.create(require('http').Agent, options);

  return new agent(options);
};
