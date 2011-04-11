var fs = require('fs'),
    http = require('http'),
    spdy = require('../lib/spdy');

var options = {
  key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
  cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
  ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem')
};

http.createServer(function(req, res) {
  res.writeHead(200, {
    'Alternate-Protocol': '8081:npn-spdy/2',
    'Connection': 'close'
  });
  res.end();
  return;
  res.end('<!DOCTYPE html><html><head>' +
          '<body></body></html>');
}).listen(8080);

spdy.createServer(options, function(req, res) {
  console.log(req);
  res.end('hello world!');
}).listen(8081);
