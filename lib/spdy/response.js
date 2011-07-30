/**
 * Response class
 */

var Buffer = require('buffer').Buffer,
    util = require('util'),
    stream = require('stream'),
    fs = require('fs'),
    enums = require('../spdy').enums,
    createControlFrame = require('../spdy').createControlFrame,
    createDataFrame = require('../spdy').createDataFrame,
    createPushStream = require('../spdy').createPushStream,
    createParser = require('../spdy').createParser,
    createZLib = require('../spdy').createZLib;

/**
 * Class constructor
 */
var Response = exports.Response = function(cframe, c) {
  stream.Stream.call(this);
  this.cframe = cframe;
  this.streamID = cframe.data.streamID;
  this.c = c;

  this.statusCode = 200;
  this._headers = {
    'Connection': 'keep-alive'
  };
  this._written = false;
  this._reasonPhrase = 'OK';
  this._push = function() {};

  // For stream.pipe and others
  this.writable = true;
};
util.inherits(Response, stream.Stream);

exports.createResponse = function(cframe, c) {
  return new Response(cframe, c);
};

/**
 * Respond w/ SYN_REPLY
 */
Response.prototype.writeHead = function(code, reasonPhrase, headers) {
  if (headers === undefined) {
    headers = reasonPhrase;
    reasonPhrase = '';
  }

  headers = headers || {};
  for (var i in headers) {
    this._headers[i] = headers[i];
  }
  this._reasonPhrase || (this.reasonPhrase = reasonPhrase);
  this.statusCode = code;
};

/**
 * Flush buffered head
 */
Response.prototype._flushHead = function() {
  if (this._written) {
    throw Error('Headers was already written');
  }
  this._written = true;

  var headers = this._headers;

  headers.status = this.statusCode + ' ' + this._reasonPhrase;
  headers.version = 'HTTP/1.1';

  var cframe = createControlFrame(this.c.zlib, {
    type: enums.SYN_REPLY,
    streamID: this.streamID
  }, headers);

  return this.c.write(cframe);
};

Response.prototype.pushLater = function(resources) {
  var that = this;

  this.deferred_streams = [];

  // Send headers for each post-response server push stream, but DO
  // NOT sent data yet
  resources.forEach(function(push_contents) {
    var filename = push_contents[0]
      , url = push_contents[1]
      , data = fs.readFileSync(filename)
      , push_stream = createPushStream(that.cframe, that.c, url);

    push_stream._flushHead();
    push_stream._written = true;
    that.deferred_streams.push([push_stream, data]);
  });
};

Response.prototype._pushLaterData = function(resources) {
  if (typeof(this.deferred_streams) == 'undefined') return;

  this.deferred_streams.forEach(function(stream_and_data) {
    var stream = stream_and_data[0]
      , data = stream_and_data[1];

    stream.write(data);
    stream.end();
  });
};

/**
 * Write any data (Internal)
 */
Response.prototype._write = function(data, encoding, fin) {
  if (!this._written) {
    this._flushHead();
    this._push_stream();
  }
  encoding = encoding || 'utf8';

  if (data === undefined) {
    data = new Buffer(0);
  }

  // Write the data frame
  var dframe = createDataFrame(this.getStreamCompressor(), {
    streamID: this.streamID,
    flags: 0
  }, Buffer.isBuffer(data) ? data : new Buffer(data, encoding));

  this.c.write(dframe);

  // Write the data FIN if this if fin
  if (fin) {
    var dfin = createDataFrame(this.getStreamCompressor(), {
      streamID: this.streamID,
      flags: enums.DATA_FLAG_FIN
    }, new Buffer(0));
    this.c.write(dfin);
  }

  // Push any deferred data streams
  this._pushLaterData();
};


Response.prototype.getStreamCompressor = function(streamID) {
  if (this.stream_compressor)
    return this.stream_compressor;

  this.stream_compressor = createZLib({use_dictionary: false});

  return this.stream_compressor;
};

/**
 * Write data
 */
Response.prototype.write = function(data, encoding) {
  return this._write(data, encoding, false);
};

/**
 * End stream
 */
Response.prototype.end = function(data, encoding) {
  this.writable = false;
  return this._write(data, encoding, true);
};

/**
 * Cloning node.js default API
 */
Response.prototype.setHeader = function(name, value) {
  if (arguments.length < 2) {
    throw new Error("`name` and `value` are required for setHeader().");
  }

  if (this._written) {
    throw new Error("Can't set headers after they are sent.");
  }

  this._headers[name] = Array.isArray(value) ? value.join(';') : value;
};

/**
 * Cloning node.js default API
 */
Response.prototype.getHeader = function(name) {
  if (arguments.length < 1) {
    throw new Error("`name` is required for getHeader().");
  }

  if (this._written) {
    throw new Error("Can't use mutable header APIs after sent.");
  }

  return this._headers[name];
};

/**
 * Cloning node.js default API
 */
Response.prototype.removeHeader = function(name) {
  if (arguments.length < 1) {
    throw new Error("`name` is required for getHeader().");
  }

  if (this._written) {
    throw new Error("Can't remove headers after they are sent.");
  }

  delete this._headers[name];
};

/**
 * Server push
 */

Response.prototype.setPush = function(fn) {
  if (typeof(fn) === "function")
    this._push = fn;
};

Response.prototype._push_stream = function() {
  return this._push(this);
};

Response.prototype.push_file = function(filename, url) {
  console.log("[warn] Response#push_file has been deprecate.  Please switch to pushFile instead.");
  return this.pushFile(filename, url);
};

Response.prototype.pushFile = function(filename, url) {
  this.push(fs.readFileSync(filename), url);
};

Response.prototype.push = function(data, url) {
  var push_stream = createPushStream(this.cframe, this.c, url);

  push_stream.write(data);

  push_stream.end();
};
