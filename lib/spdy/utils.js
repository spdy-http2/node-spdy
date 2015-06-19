'use strict';

var utils = exports;

var spdy = require('../spdy');
var util = require('util');

utils.isArgvParser = !/^v(0\.12|0\.11|0\.10|0\.8|0\.9)\./.test(process.version);

function Queue() {
  QueueItem.call(this);

  this.prev = this;
  this.next = this;
}
util.inherits(Queue, QueueItem);
exports.Queue = Queue;

Queue.prototype.insertTail = function insertTail(item) {
  item.prev = this.prev;
  item.next = this;
  item.prev.next = item;
  item.next.prev = item;
};

Queue.prototype.remove = function remove(item) {
  var next = item.next;
  var prev = item.prev;

  item.next = item;
  item.prev = item;
  next.prev = prev;
  prev.next = next;
};

Queue.prototype.head = function head() {
  return this.next;
};

Queue.prototype.tail = function tail() {
  return this.prev;
};

Queue.prototype.isEmpty = function isEmpty() {
  return this.next === this;
};

Queue.prototype.isRoot = function isRoot(item) {
  return this === item;
};

function QueueItem() {
  this.prev = null;
  this.next = null;
}
exports.QueueItem = QueueItem;

function LockStream(stream) {
  this.locked = false;
  this.queue = [];
  this.stream = stream;
}
exports.LockStream = LockStream;

LockStream.prototype.write = function write(chunks, callback) {
  var self = this;

  // Do not let it interleave
  if (this.locked) {
    this.queue.push(function() {
      return self.write(chunks, callback);
    });
    return;
  }

  this.locked = true;

  function done(err, chunks) {
    self.stream.removeListener('error', done);

    self.locked = false;
    if (self.queue.length > 0)
      self.queue.shift()();
    callback(err, chunks);
  }

  this.stream.on('error', done);

  if (chunks.length === 0)
    chunks = [ new Buffer(0) ];

  for (var i = 0; i < chunks.length - 1; i++)
    this.stream.write(chunks[i]);
  this.stream.write(chunks[i], function(err) {
    if (err)
      return done(err);

    var chunks = [];
    while (true) {
      var chunk = self.stream.read();
      if (!chunk)
        break;

      chunks.push(chunk);
    }

    done(null, chunks);
  });

  if (this.stream.execute) {
    this.stream.execute(function(err) {
      if (err)
        return done(err);
    });
  }
};
