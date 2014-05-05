var assert = require('assert'),
    http = require('http'),
    spdy = require('../../'),
    keys = require('../fixtures/keys'),
    net = require('net'),
    url = require('url'),
    PORT = 8081;

suite('A SPDY server / Proxy', function() {
  test('should emit connect event on CONNECT requests', function(done) {
    var agent;
    var proxyServer = spdy.createServer(keys);
    proxyServer.on('connect', function(req, socket) {
      assert.equal(req.method, 'CONNECT');
      assert(socket.isSpdy);
      agent.close(function(){
        proxyServer.close(done);
      });
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

      req.on('error', function(err) {
        // Tolerate this error here since I believe this is caused by the
        //   incomplete handling of CONNECT requests on the client side,
        //   and this is intended as a test of the server side.
        if (err.code && err.code === 'ECONNRESET')
          return;
        throw err;
      });
    });
  });
});