var assert = require('assert'),
    spdy = require('../../'),
    keys = require('../fixtures/keys'),
    https = require('https'),
    tls = require('tls'),request
    Buffer = require('buffer').Buffer,
    PORT = 8081;

suite('A SPDY Server', function() {
  var server;
  var agent;

  setup(function(done) {
    server = spdy.createServer(keys);

    server.listen(PORT, function() {
      agent = spdy.createAgent({
        host: '127.0.0.1',
        port: PORT,
        rejectUnauthorized: false
      });
      done();
    });
  });

  teardown(function(done) {
    agent.close(function() {
      server.close(done);
    });
  });

  test('should support PING from client', function(done) {
    agent.ping(done);
  });
});
