var assert = require('assert'),
    spdy = require('../../'),
    keys = require('../fixtures/keys'),
    https = require('https'),
    tls = require('tls'),request
    Buffer = require('buffer').Buffer,
    PORT = 8081;

suite('A SPDY Server / Stream', function() {
  var server;
  var agent;
  var pair = null;

  setup(function(done) {
    var waiting = 2;
    pair = { server: null, client: null };

    server = spdy.createServer(keys, function(req, res) {
      pair.server = { req: req, res: res };

      // Just to remove junk from stream's buffer
      req.once('readable', function() {
        assert.equal(req.read().toString(), 'shame');
        if (--waiting === 0)
          done();
      });

      res.writeHead(200);
    });

    server.listen(PORT, function() {
      agent = spdy.createAgent({
        host: '127.0.0.1',
        port: PORT,
        rejectUnauthorized: false
      });

      pair.client = {
        req: https.request({
          path: '/',
          method: 'POST',
          agent: agent
        }, function(res) {
          pair.client.res = res;
          if (--waiting === 0)
            done();
        }),
        res: null
      };
      pair.client.req.write('shame');
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

  test('piping a lot of data', function(done) {
    var big = new Buffer(2 * 1024 * 1024);
    for (var i = 0; i < big.length; i++)
      big[i] = ~~(Math.random() * 256);
    pair.client.res.on('readable', function() {
      var bigEcho = pair.client.res.read(big.length);
      if (bigEcho) {
        assert.equal(big.toString('hex'), bigEcho.toString('hex'));
        done();
      }
    });

    pair.server.req.pipe(pair.server.res);
    pair.client.req.end(big);
  });
});
