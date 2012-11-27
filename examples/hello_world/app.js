var fs = require('fs'),
    spdy = require('../../');

var options = {
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

server.listen(3232);
