var spdy = require('../../lib/spdy'),
    tls = require('tls'),
    frames = require('../fixtures/frames'),
    keys = require('../fixtures/keys');

var uri = require('url').parse(process.argv[2]),
    host = uri.hostname,
    port = +uri.port,
    url = uri.path;

frames.createSynStream(host, url, function(syn_stream) {
  var server = spdy.createServer(keys, function(req, res) {
    res.end('ok');
  });

  var start = +new Date;
  batch(port, host, syn_stream, 200, 1000, function() {
    var end = +new Date;
    console.log('requests/sec : %d', 10 / (end - start));
  });
});

function request(port, host, data, callback) {
  var socket = tls.connect(port, host, {NPNProtocols: ['spdy/2']}, function() {
    socket.write(data);
    socket.on('data', function() {
      socket.destroy();
      callback();
    });
  });

  return socket;
};

function batch(port, host, data, parallel, num, callback) {
  var left = num;

  for (var i = 0; i < parallel; i++) {
    run();
  }

  function run() {
    request(port, host, data, function() {
      if (--left === 0) return callback();
      if (left < 0) return;
      run();
    });
  }
};
