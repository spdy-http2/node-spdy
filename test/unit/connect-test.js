var assert = require('assert'),
    spdy = require('../../'),
    zlib = require('zlib'),
    keys = require('../fixtures/keys'),
    https = require('https'),
    tls = require('tls'),
    Buffer = require('buffer').Buffer,
    PORT = 8081;

suite('A SPDY Server / Connect', function() {
  var server;
  var fox = 'The quick brown fox jumps over the lazy dog';

  setup(function(done) {
    server = spdy.createServer(keys, function(req, res) {
      var comp = req.url === '/gzip' ? zlib.createGzip() :
                 req.url === '/deflate' ? zlib.createDeflate() :
                 null;

      if (!comp)
        return res.end(fox);

      res.writeHead(200, { 'Content-Encoding' : req.url.slice(1) });
      comp.on('data', function(chunk) {
        res.write(chunk);
      });
      comp.once('end', function() {
        res.end();
      });
      comp.end(fox);
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
      var received = '';
      res.on('data', function(chunk) {
        received += chunk;
      });
      res.once('end', function() {
        assert.equal(received, fox);
        done();
      });
      assert.equal(res.statusCode, 200);
    });
    req.end();
  });

  function spdyReqTest(url) {
    test('should respond on spdy requests on ' + url, function(done) {
      var agent = spdy.createAgent({
        host: '127.0.0.1',
        port: PORT,
        rejectUnauthorized: false
      });

      var req = https.request({
        path: url,
        method: 'GET',
        agent: agent,
      }, function(res) {
        var received = '';
        res.on('data', function(chunk) {
          received += chunk;
        });
        res.once('end', function() {
          assert.equal(received, fox);
          agent.close();
          done();
        });
        assert.equal(res.statusCode, 200);
      });
      req.end();
    });
  }

  spdyReqTest('/');
  spdyReqTest('/gzip');
  spdyReqTest('/deflate');
});
