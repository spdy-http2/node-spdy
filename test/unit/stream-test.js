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
  var pair = null;

  setup(function(done) {
    pair = { server: null, client: null };

    server = spdy.createServer(keys, function(req, res) {
      pair.server = { req: req, res: res };
      done();
    });

    server.listen(PORT, function() {
      agent = spdy.createAgent({
        host: '127.0.0.1',
        port: PORT,
        rejectUnauthorized: false
      });

      pair.client = https.request({
        path: '/',
        method: 'POST',
        agent: agent
      });
      pair.client.write('shame');
    });
  });

  teardown(function(done) {
    pair = null;
    agent.close(function() {
      server.close(done);
    });
  });

  test('should support PING from client', function(done) {
    agent.ping(done);
  });

  test('should support PING from server', function(done) {
    pair.server.res.socket.ping(done);
  });
});
