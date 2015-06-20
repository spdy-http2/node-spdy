var assert = require('assert');
var async = require('async');
var streamPair = require('stream-pair');

var spdy = require('../../');

describe('Transport', function() {
  var server = null;
  var client = null;

  function expectData(stream, expected, callback) {
    var actual = '';

    stream.on('data', function(chunk) {
      actual += chunk;
    });
    stream.on('end', function() {
      assert.equal(actual, expected);
      callback();
    });
  }

  function protocol(name, version, body) {
    describe(name + ' (v' + version + ')', function() {
      beforeEach(function() {
        var pair = streamPair.create();

        server = new spdy.Connection(pair, {
          protocol: spdy.protocol[name],
          windowSize: 256,
          isServer: true
        });
        client = new spdy.Connection(pair.other, {
          protocol: spdy.protocol[name],
          windowSize: 256,
          isServer: false
        });

        client.start(version);
      });

      body(name, version);
    });
  }

  function everyProtocol(body) {
    protocol('http2', 4, body);
    protocol('spdy', 2, body);
    protocol('spdy', 3, body);
    protocol('spdy', 3.1, body);
  }

  everyProtocol(function(name, version) {
    it('should send SETTINGS frame on both ends', function(done) {
      async.map([ server, client ], function(side, callback) {
        side.on('frame', function(frame) {
          if (frame.type !== 'SETTINGS')
            return;

          callback();
        });
      }, done);
    });

    it('should send request', function(done) {
      var sent = false;
      var received = false;

      client.request({
        method: 'GET',
        path: '/hello',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);
        sent = true;

        stream.on('response', function(code, headers) {
          assert(received);

          assert.equal(code, 200);
          assert.equal(headers.ohai, 'yes');
          done();
        });
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        received = true;

        assert(sent);
        assert.equal(stream.method, 'GET');
        assert.equal(stream.path, '/hello');
        assert.equal(stream.headers.a, 'b');
        assert.equal(stream.headers.c, 'd');
      });
    });

    it('should send data on request', function(done) {
      client.request({
        method: 'GET',
        path: '/hello',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        stream.write('hello ');
        stream.end('world');
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        assert.equal(stream.method, 'GET');
        assert.equal(stream.path, '/hello');
        assert.equal(stream.headers.a, 'b');
        assert.equal(stream.headers.c, 'd');

        expectData(stream, 'hello world', done);
      });
    });

    it('should control the flow of the request', function(done) {
      var a = new Buffer(256);
      a.fill('a');
      var b = new Buffer(256);
      b.fill('b');

      client.request({
        method: 'GET',
        path: '/hello',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        stream.write(a);
        stream.end(b);
      });

      server.on('stream', function(stream) {
        assert.equal(stream.method, 'GET');
        assert.equal(stream.path, '/hello');
        assert.equal(stream.headers.a, 'b');
        assert.equal(stream.headers.c, 'd');

        expectData(stream, a + b, done);
      });
    });
  });
});
