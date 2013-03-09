var scheduler = exports;

//
// ### function Scheduler (connection)
// #### @connection {spdy.Connection} active connection
// Connection's streams scheduler
//
function Scheduler(connection) {
  this.connection = connection;
  this.priorities = [[], [], [], [], [], [], [], []];
  this._flush_scheduled = false;
}

//
// ### function create (connection)
// #### @connection {spdy.Connection} active connection
//
exports.create = function create(connection) {
  return new Scheduler(connection);
};

//
// ### function schedule (stream, data)
// #### @stream {spdy.Stream} Source stream
// #### @data {Buffer} data to write on tick
// Use stream priority to invoke callbacks in right order
//
Scheduler.prototype.schedule = function schedule(stream, data) {
  this.priorities[stream.priority].push(data);
};

//
// ### function tick ()
// Add .nextTick callback if not already present
//
Scheduler.prototype.tick = function tick() {
  if (this._flush_scheduled) return;
  this._flush_scheduled = true;
  process.nextTick(this._flush.bind(this));
};

Scheduler.prototype._flush = function _flush() {
  this._flush_scheduled = false;

  var task, priorities = this.priorities;

  priority_loop:
  for (var i = 0; i < priorities.length; i++) {
    while (task = priorities[i].shift()) {
      if (task instanceof Function) {
        // A task might be a function
        task();
      } else {
        // or a chunk to be written
        if (!this.connection.write(task)) {
          // The buffer of the socket is full. Waiting until we can write again.
          this._flush_scheduled = true;
          this.connection.once('drain', this._flush.bind(this));
          break priority_loop;
        }
      }
    }
  }
};
