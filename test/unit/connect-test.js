var assert = require('assert'),
    spdy = require('../../'),
    keys = require('../fixtures/keys'),
    https = require('https'),
    tls = require('tls'),request
    Buffer = require('buffer').Buffer,
    PORT = 8081;

suite('A SPDY Server / Connect', function() {
  var server;
  setup(function(done) {
    server = spdy.createServer(keys, function(req, res) {
      res.end('ok');
    });

    server.listen(PORT, done);
  });

  teardown(function(done) {
    server.close(done);
  });

  test('should respond on regular https requests', function(done) {
    var req = https.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/',
      method: 'GET',
      agent: false,
      rejectUnauthorized: false
    }, function(res) {
      res.on('data', function() {
        // Ignore incoming data
      });
      assert.equal(res.statusCode, 200);
      done();
    });
    req.end();
  });

  test('should respond on spdy requests', function(done) {
    var agent = spdy.createAgent({
      host: '127.0.0.1',
      port: PORT,
      rejectUnauthorized: false
    });

    var req = https.request({
      path: '/',
      method: 'GET',
      agent: agent,
    }, function(res) {
      res.on('data', function() {
        // Ignore incoming data
      });
      assert.equal(res.statusCode, 200);
      agent.close();
      done();
    });
    req.end();
  });
});
