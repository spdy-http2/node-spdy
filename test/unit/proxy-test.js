var assert = require('assert'),
    http = require('http'),
    spdy = require('../../'),
    keys = require('../fixtures/keys'),
    net = require('net'),
    url = require('url'),
    PORT = 8081;

suite('A SPDY server / Proxy', function() {
  test( 'should emit connect event on CONNECT requests', function(done) {
    var agent;
    var proxyServer = spdy.createServer(keys, function (req, res) {});
    proxyServer.on('connect', function(req, socket) {
      assert.equal(req.method, 'CONNECT');
      assert(socket.isSpdy);
      proxyServer.close();
      done();
    });

    proxyServer.listen(PORT, '127.0.0.1', function() {
      agent = spdy.createAgent({
        host: '127.0.0.1',
        port: PORT,
        rejectUnauthorized: false
      });

      var options = {
        method: 'CONNECT',
        path: 'www.google.com:80',
        agent: agent
      };

      var req = http.request(options);
      req.end();
    });
  });
});