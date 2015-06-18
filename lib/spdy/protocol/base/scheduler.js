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

  this.sync = [];
  this.pending = {
    list: [],
    map: {},
    count: 0,
    tick: false
  };
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

  // Synchronous frames should not be interleaved
  if (priority === false) {
    this.sync.push(chunks);
    this.pending.count += chunks.length;
    return cb();
  }

  while (priority >= this.pending.list.length)
    this.pending.list.push(new utils.Queue());

  var queue = this.pending.list[priority];
  var item = queue.isEmpty() ? null : queue.tail();

  // Not possible to coalesce try looking up in map
  if (item && item.stream !== stream)
    item = this.pending.map[stream];

  if (!item) {
    item = new SchedulerItem(stream);
    this.pending.map[stream] = item;
    queue.insertTail(item);
  }

  item.push(chunks);

  this.pending.count += chunks.length;
  cb();

  this._read();
};

Scheduler.prototype._read = function _read() {
  if (this.pending.count === 0)
    return;

  if (this.pending.tick)
    return;
  this.pending.tick = true;

  var self = this;
  process.nextTick(function() {
    self.pending.tick = false;
    self.tick();
  });
};

Scheduler.prototype.tick = function tick() {
  // Empty sync queue first
  var sync = this.sync;
  var res = true;
  this.sync = [];
  for (var i = 0; i < sync.length; i++) {
    var chunks = sync[i];
    for (var j = 0; j < chunks.length; j++) {
      this.pending.count--;
      res = this.push(chunks[j]);
    }
  }

  // No luck for not-sync frames
  if (!res)
    return;

  for (var i = 0; i < this.pending.list.length; i++) {
    var queue = this.pending.list[i];
    if (!this.tickQueue(queue, false))
      break;
  }
};

Scheduler.prototype.tickQueue = function tickQueue(queue, sync) {
  if (queue.isEmpty())
    return true;

  var res = true;
  var next;
  for (var current = queue.head();
       !queue.isRoot(current);
       current = next) {
    var chunks = current.shift();
    next = current.next;

    if (current.isEmpty()) {
      queue.remove(current);
      delete this.pending.map[current.stream];
    }

    if (!chunks)
      continue;

    for (var i = 0; i < chunks.length; i++) {
      this.pending.count--;
      res = this.push(chunks[i]);
    }
    if (!res)
      break;
  }

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
