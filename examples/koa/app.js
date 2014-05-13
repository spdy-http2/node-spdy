/**
 * Module dependencies.
 */

var fs = require('fs'),
    koa = require('koa'),
    app = koa(),
    spdy = require('../..');

app.use(function * () {
  this.body = 'hello, koa.';
});

var options = {
  key: fs.readFileSync('keys/spdy-key.pem'),
  cert: fs.readFileSync('keys/spdy-cert.pem')
};

spdy.createServer(options, app.callback()).listen(3232, function() {
  console.log('koa server listening on port 3232');
});
