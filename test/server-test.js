var assert = require('assert');
var tls = require('tls');
var transport = require('spdy-transport');

var fixtures = require('./fixtures');
var spdy = require('../');

describe('SPDY Server', function() {
  var server;
  var client;

  beforeEach(function(done) {
    server = spdy.createServer(fixtures.keys);

    server.listen(fixtures.port, function() {
      var socket = tls.connect({
        rejectUnauthorized: false,
        port: fixtures.port,
        NPNProtocols: [ 'h2' ]
      }, function() {
        client = transport.connection.create(socket, {
          protocol: 'http2',
          isServer: false
        });
        client.start(4);
        done();
      });
    });
  });

  afterEach(function(done) {
    client.socket.destroy();
    server.close(done);
  });

  it('should process GET request', function(done) {
    var stream = client.request({
      method: 'GET',
      path: '/get',
      headers: {
        a: 'b'
      }
    }, function(err) {
      assert(!err);

      stream.on('response', function(status, headers) {
        assert.equal(status, 200);
        assert.equal(headers.ok, 'yes');

        fixtures.expectData(stream, 'response', done);
      });

      stream.end();
    });

    server.on('request', function(req, res) {
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/get');
      assert.equal(req.headers.a, 'b');

      req.on('end', function() {
        res.writeHead(200, {
          ok: 'yes'
        });
        res.end('response');
      });
      req.resume();
    });
  });

  it('should process POST request', function(done) {
    var stream = client.request({
      method: 'POST',
      path: '/post'
    }, function(err) {
      assert(!err);

      stream.on('response', function(status, headers) {
        assert.equal(status, 200);
        assert.equal(headers.ok, 'yes');

        fixtures.expectData(stream, 'response', next);
      });

      stream.end('request');
    });

    server.on('request', function(req, res) {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/post');

      res.writeHead(200, {
        ok: 'yes'
      });
      res.end('response');

      fixtures.expectData(req, 'request', next);
    });

    var waiting = 2;
    function next() {
      if (--waiting === 0)
        return done();
    }
  });

  it('should send PUSH_PROMISE', function(done) {
    var stream = client.request({
      method: 'POST',
      path: '/page'
    }, function(err) {
      assert(!err);

      stream.on('pushPromise', function(push) {
        assert.equal(push.path, '/push');
        assert.equal(push.headers.yes, 'push');

        fixtures.expectData(push, 'push', next);
      });

      stream.end('request');
      fixtures.expectData(stream, 'response', next);
    });

    server.on('request', function(req, res) {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/page');

      res.writeHead(200, {
        ok: 'yes'
      });

      var push = res.push('/push', {
        yes: 'push'
      });
      push.end('push');

      res.end('response');

      fixtures.expectData(req, 'request', next);
    });

    var waiting = 3;
    function next() {
      if (--waiting === 0)
        return done();
    }
  });
});
