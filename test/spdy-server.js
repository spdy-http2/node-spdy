var fs = require('fs'),
    spdy = require('../lib/spdy');

// Don't crash on errors
process.on('uncaughtException', function (err) {
  console.log('Caught uncaughtException: ' + err.stack);
  console.log('Arg1 constructor: ' + err.arguments[1].constructor.toString());
});

var options = {
  key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
  cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
  ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem'),
};

var static = require('connect').static(__dirname + '/../pub');

var server = spdy.createServer(options, function(req, res) {
  if (req.method == 'POST') {
    res.writeHead(200);
    req.pause();
    setTimeout(function() {
      req.pipe(res);
      req.resume();
    }, 5000);
    return;
  }
  if (req.streamID && req.url == '/') {
    req.url = '/index-spdy.html';
  }

  static(req, res, function() {
    res.writeHead(404);
    res.end();
  });
});
server.listen(8081, function() {
  console.log('TLS NPN Server is running on port : %d', 8081);
});
