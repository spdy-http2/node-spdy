
/**
 * Module dependencies.
 */

var express = require('express'),
    routes = require('./routes'),
    user = require('./routes/user'),
    fs = require('fs'),
    spdy = require('../..'),
    path = require('path');

var app = express();

// all environments
app.set('port', process.env.PORT || 3232);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

app.get('/', routes.index);
app.get('/users', user.list);

var options = {
  key: fs.readFileSync('keys/spdy-key.pem'),
  cert: fs.readFileSync('keys/spdy-cert.pem')
};

spdy.createServer(options, app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
