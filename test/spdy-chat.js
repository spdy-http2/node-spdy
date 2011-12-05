var fs = require('fs'),
    connect = require('connect'),
    io = require('socket.io'),
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

var static = connect.static(__dirname + '/../pub/chat');

var server = spdy.createServer(options, function(req, res) {
  static(req, res, function() {
    res.writeHead(404);
    res.end();
  });
});

io = io.listen(server);
io.set('transports', ['xhr-polling']);
io.disable('log');

setInterval(function () {
  io.sockets.emit('news', { time: +new Date });
}, 1000);

io.sockets.on('ack', function() {
  console.error('ack');
});

server.listen(8081);
