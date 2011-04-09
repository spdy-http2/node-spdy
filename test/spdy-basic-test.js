/**
 * Test for SPDY module
 */
var vows = require('vows'),
    assert = require('assert');

var spdy = require('../lib/spdy');

var server,
    connection,
    zlib,
    PORT = 8000;

vows.describe('SPDY/basic test').addBatch({
  'spdy.createServer': {
    topic: function() {
      return spdy.createServer();
    },
    'should return spdy.Server instance': function (_server) {
      assert.instanceOf(_server, spdy.Server);
      server = _server;
    }
  }
}).addBatch({
  'Listening on this server instance': {
    topic: function() {
      server.listen(PORT, 'localhost', this.callback);
      server.on('request', function(req, res) {
        res.end('hello world!');
      });
    },
    'should be successfull': function() {
    }
  }
}).addBatch({
  'Creating new connection to this server': {
    topic: function() {
      connection = require('net').createConnection(PORT, 'localhost');
      connection.on('connect', this.callback);
    },
    'should receive connect event': function() {
    }
  },
  'Calling spdy.createZLib': {
    topic: function() {
      return spdy.createZLib();
    },
    'should return instance of spdy.ZLib': function(_zlib) {
      zlib = _zlib;
      assert.instanceOf(zlib, spdy.ZLib);
    }
  }
}).addBatch({
  'Sending control SYN_STREAM frame': {
    topic: function() {
      var cframe = spdy.createControlFrame(zlib, {
        type: spdy.types.SYN_STREAM,
        streamID: 1,
        priority: 0,
        flags: spdy.types.FLAG_FIN
      }, {
        version: 'HTTP/1.1',
        url: '/',
        method: 'GET'
      });

      connection.write(cframe, this.callback);
    },
    'should be successfull': function() {
    }
  },
  'Waiting for SYN_REPLY frame': {
    topic: function() {
      connection.zlib = zlib;
      var parser = spdy.createParser(connection),
          callback = this.callback;

      parser.on('cframe', function(cframe) {
        callback(null, cframe);
      });
    },
    'should end up w/ that frame': function(cframe) {
      assert.equal(cframe.headers.type, spdy.types.SYN_REPLY);
      assert.equal(cframe.headers.version, 2);
      assert.equal(cframe.headers.flags, 0);
      assert.ok(cframe.headers.c);
    }
  }
}).addBatch({
  'When calling server.close': {
    topic: function() {
      server.close();
      return true;
    },
    'all connections will be dropped': function() {
    }
  }
}).export(module);
