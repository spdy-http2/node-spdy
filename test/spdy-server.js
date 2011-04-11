var fs = require('fs'),
    http = require('http'),
    spdy = require('../lib/spdy'),
    tls = require('tls'),
    buffer = require('buffer').Buffer,
    NPNProtocols = new Buffer(7);

if (!tls.hasNPN) throw 'You\'re using not NPN-enabled version of node.js';

NPNProtocols[0] = 6;
NPNProtocols.write('spdy/2', 1);

var options = {
  key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
  cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
  ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem'),
  NPNProtocols: NPNProtocols
};

var page = new Buffer([
  '<!DOCTYPE html>',
  '<html>',
  '<head>',
  '</head>',
  '<body>',
  '<h1>SPDY via TLS NPN just works!</h1>',
  '</body>',
  '</html>'
].join(''));

spdy.createServer(options, function(req, res) {
  res.writeHead(200, 'SPDY WORKS!', {
    'Content-Type': 'text/html'
  });
  res.end(page);
}).listen(8081);
