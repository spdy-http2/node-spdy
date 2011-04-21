var spdy = require('../lib/spdy');

var static = require('connect').static(__dirname + '/../pub');

var server = spdy.createServer({}, function(req, res) {
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
server.listen(8081, function() {
  console.log('Server is running on port : %d', 8081);
});
