/**
 * Test for SPDY module
 */
var fs = require('fs'),
    vows = require('vows'),
    assert = require('assert');

var spdy = require('../lib/spdy');

var server,
    connection,
    req,
    zlib,
    PORT = 8000,
    options = {
      push: function(req, c) {
        spdy
          .createPushStream(req.cframe, c, "http://example.com/foo")
          .write("push data")
          .end();
      },
      key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
      cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
      ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem'),
      npnProtocols: ['spdy/2'],
      debug: true
    };

vows.describe('SPDY/basic test').addBatch({
  'spdy.createServer': {
    topic: function() {
      return spdy.createServer(options);
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
      server.on('request', function(_req, res) {
        req = _req;
        res.end('hello world!');
      });
    },
    'should be successfull': function() {
    }
  }
}).addBatch({
  'Creating new connection to this server': {
    topic: function() {
      connection = require('tls').connect(PORT, 'localhost', options, this.callback);
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
        type: spdy.enums.SYN_STREAM,
        streamID: 1,
        priority: 0,
        flags: 0
      }, {
        version: 'HTTP/1.1',
        url: '/',
        method: 'GET'
      });

      connection.write(cframe, this.callback);
    },
    'should be successfull': {
      'and sending request body': {
        topic: function() {
          var dframe = spdy.createDataFrame(zlib, {
            streamID: 1,
            flags: spdy.enums.DATA_FLAG_FIN
          }, new Buffer('npn-spdy'));

          var buffer = '',
              callback = this.callback;

          req.on('data', function(data) {
            buffer += data;
          });

          req.on('end', function() {
            callback(null, buffer);
          });
          connection.write(dframe);
        },
        'should emit `data` and `end` events on request': function(data) {
          assert.equal(data, 'npn-spdy');
        }
      }
    }
  },
  'Creating parser': {
    topic: function() {
      var parser = spdy.createParser(zlib);

      connection.pipe(parser);

      return parser;
    },
    'and waiting for SYN_REPLY': {
      topic: function(parser) {
        var callback = this.callback;
        parser.on('cframe', function(cframe) {
          if (cframe.headers.type == spdy.enums.SYN_REPLY) {
            callback(null, cframe);
          }
        });
      },
      'should end up w/ that frame': function(cframe) {
        assert.ok(cframe.headers.c);
        assert.equal(cframe.headers.type, spdy.enums.SYN_REPLY);
        assert.equal(cframe.headers.version, 2);
        assert.equal(cframe.headers.flags, 0);
      }
    },
    'and waiting for Data packet': {
      topic: function(parser) {
        var callback = this.callback;
        var called = false;
        parser.on('dframe', function(dframe) {
          if (!called) {
            callback(null, dframe);
          }
          called = true;
        });
      },
      'should end up with the push frame': function(dframe) {
        assert.ok(!dframe.headers.c);
        assert.equal(dframe.headers.flags & spdy.enums.DATA_FLAG_FIN, 0);
      }
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
