var fs = require('fs'),
    spdy = require('../../');

var options = {
  key: fs.readFileSync('keys/spdy-key.pem'),
  cert: fs.readFileSync('keys/spdy-cert.pem'),
  ca: fs.readFileSync('keys/spdy-csr.pem')
};

var server = spdy.createServer(options, function(req, response) {
  response.writeHead(200, {
    "Content-Type": "text/html"
  });

  response.push('/1.js', {}, 0, function(err, strm) {
    if (err) throw err;

    strm.end('alert("hello world: ' + req.spdyVersion+ '")');

    response.end("<script src='/1.js'></script><b>hello world</b>\n");
  });
});

server.listen(3232);
