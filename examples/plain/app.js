var fs = require('fs'),
    spdy = require('../../');

var options = {
  plain: true,
  ssl: true,
  key: fs.readFileSync('keys/spdy-key.pem'),
  cert: fs.readFileSync('keys/spdy-cert.pem'),
  ca: fs.readFileSync('keys/spdy-csr.pem')
};

var server = spdy.createServer(options, function(req, response) {
  response.writeHead(200, {
    "Content-Type": "text/plain"
  });
  response.end("Hello World!\n");
});

server.listen(3232, function() {
  var addr = this.address();
  console.log('Server is listening on %s:%d', addr.address, addr.port);
});
