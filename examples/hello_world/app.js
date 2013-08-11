var fs = require('fs'),
    spdy = require('../../');
var Buffer = require('buffer').Buffer;

var options = {
  key: fs.readFileSync('keys/spdy-key.pem'),
  cert: fs.readFileSync('keys/spdy-cert.pem'),
  ca: fs.readFileSync('keys/spdy-csr.pem')
};

var big = new Buffer(16 * 1024);
for (var i = 0; i < big.length; i++) {
  big[i] = '0'.charCodeAt(0) + (i % 10);
}

var server = spdy.createServer(options, function(req, res) {
  if (req.url !== '/') {
    res.writeHead(404);
    res.end();
    return;
  }

  res.push('/' + Math.random() + '.txt', {
    'Content-Type': 'text/plain'
  }, function(err, stream) {
    console.log('Push start');
    if (err)
      return console.error(err);
    stream.on('error', function(err) {
      console.error('Push error', err);
    });
    stream.write(big, function() {
      console.error('Push done');
    });
    stream.end();
  });
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });
  res.end('ok good');
});

server.listen(3232, function() {
  var addr = this.address();
  console.log('Server is listening on %s:%d', addr.address, addr.port);
});
