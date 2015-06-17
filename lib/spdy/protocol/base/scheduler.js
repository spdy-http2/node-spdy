'use strict';

var spdy = require('../../../spdy');
var utils = spdy.utils;

var util = require('util');
var Duplex = require('stream').Duplex;

/*
 * We create following structure in `pending`:
 * [ [ id = 0 ], [ id = 1 ], [ id = 2 ], [ id = 0 ] ]
 *     chunks      chunks      chunks      chunks
 *     chunks                  chunks
 *     chunks
 *
 * Then on the `.tick()` pass we pick one chunks from each item and remove the
 * item if it is empty:
 *
 * [ [ id = 0 ], [ id = 2 ] ]
 *     chunks      chunks
 *     chunks
 *
 * Writing out: chunks for 0, chunks for 1, chunks for 2, chunks for 0
 *
 * This way data is interleaved between the different streams.
 */

function Scheduler() {
  Duplex.call(this, {
    writableObjectMode: true
  });

  this.pending = [];
  this.pendingCount = 0;
  this.pendingTick = false;
}
util.inherits(Scheduler, Duplex);
module.exports = Scheduler;

// Just for testing, really
Scheduler.create = function create() {
  return new Scheduler();
};

Scheduler.prototype._write = function _write(data, enc, cb) {
  var priority = data.priority;
  var stream = data.stream;
  var chunks = data.chunks;

  while (priority >= this.pending.length)
    this.pending.push(new utils.Queue());

  var queue = this.pending[priority];
  var item = queue.tail();

  // Not possible to coalesce
  if (item && item.stream !== stream)
    item = null;

  if (!item) {
    item = new SchedulerItem(stream);
    queue.insertTail(item);
  }

  item.push(chunks);

  this.pendingCount += chunks.length;
  cb();

  this._read();
};

Scheduler.prototype._read = function _read() {
  if (this.pendingCount === 0)
    return;

  if (this.pendingTick)
    return;
  this.pendingTick = true;

  var self = this;
  setImmediate(function() {
    self.pendingTick = false;
    self.tick();
  });
};

Scheduler.prototype.tick = function tick() {
  for (var i = 0; i < this.pending.length; i++) {
    var queue = this.pending[i];
    if (!this.tickQueue(queue))
      break;
  }
};

Scheduler.prototype.tickQueue = function tickQueue(queue) {
  if (queue.isEmpty())
    return true;

  var res = true;
  var next;
  var current = queue.head();
  do {
    var chunks = current.shift();
    var next = current.next;

    if (current.isEmpty())
      queue.remove(current);

    for (var i = 0; i < chunks.length; i++) {
      this.pendingCount--;
      res = this.push(chunks[i]);
    }
    if (!res)
      break;

    current = next;
  } while (current !== queue.head());

  return res;
};

function SchedulerItem(stream) {
  utils.QueueItem.call(this);

  this.stream = stream;
  this.queue = [];
}
util.inherits(SchedulerItem, utils.QueueItem);

SchedulerItem.prototype.push = function push(chunks) {
  this.queue.push(chunks);
};

SchedulerItem.prototype.shift = function shift() {
  return this.queue.shift();
};

SchedulerItem.prototype.isEmpty = function isEmpty() {
  return this.queue.length === 0;
};
