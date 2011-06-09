var fs = require('fs'),
    http = require('http'),
    spdy = require('../lib/spdy'),
    tls = require('tls'),
    buffer = require('buffer').Buffer,
    NPNProtocols = new Buffer(7);

if (!tls.NPN_ENABLED) throw 'You\'re using not NPN-enabled version of node.js';

// Don't crash on errors
process.on('uncaughtException', function (err) {
  console.log('Caught uncaughtException: ' + err.stack);
  console.log('Arg1 constructor: ' + err.arguments[1].constructor.toString());
});

var options = {
  key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
  cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
  ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem'),
  NPNProtocols: ['spdy/2'],
  push: function(pusher) {
    pusher.push_file("pub/style.css", "https://localhost:8082/style.css");
    pusher.push_file("pub/spdy.jpg", "https://localhost:8082/spdy.jpg");
  }
};

var static = require('connect').static(__dirname + '/../pub');

var bigBuffer = new Buffer(JSON.stringify({ok: true}));

var server = spdy.createServer(options, function(req, res) {
  if (req.method == 'POST') {
    res.writeHead(200);
    req.pipe(res);
    return;
  }
  static(req, res, function() {
    res.writeHead(404);
    res.end();
  });
});
server.listen(8082, function() {
  console.log('TLS NPN Server is running on port : %d', 8082);
});
